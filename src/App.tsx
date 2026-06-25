import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import schemaJson from "./generated/designs.json";
import type { Design, ParamValue, RenderResult } from "./openscad/types";
import { validateSchema } from "./lib/schema";
import { fileSignature, OpenSCADRunner, SupersededError } from "./openscad/runner";
import { toScadExpr } from "./lib/scad";
import {
  defaultsFor,
  fetchBundledPresets,
  listPresets,
  type ParsedSet,
  type Values,
} from "./lib/presets";
import { readInitialState, persistState } from "./lib/urlState";
import { loadFiles, saveFile, clearFiles } from "./lib/fileStore";
import { download, downloadBlob } from "./lib/download";
import { assetUrl } from "./lib/assetUrl";
import { useTheme } from "./lib/theme";
import { useServiceWorkerUpdate } from "./lib/swUpdate";
import { ParamForm } from "./components/ParamForm";
import { IconButton } from "./components/IconButton";
import { PresetBar } from "./components/PresetBar";
import { PresetSelect } from "./components/PresetSelect";
import { FileBar } from "./components/FileBar";
import type { ViewerHandle } from "./components/Viewer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LogPanel } from "./components/LogPanel";
import { Diagnostics } from "./components/Diagnostics";
import { LicensesModal } from "./components/LicensesModal";
import { HelpModal } from "./components/HelpModal";
import {
  InfoIcon,
  HelpIcon,
  SunIcon,
  MoonIcon,
  AutoThemeIcon,
  ResetIcon,
  DownloadIcon,
  ImageIcon,
  LinkIcon,
  PlayIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "./components/Icons";

// Lazy-load the three.js viewer so its (large) chunk isn't in the initial JS.
const Viewer = lazy(() =>
  import("./components/Viewer").then((m) => ({ default: m.Viewer }))
);

// A render slower than this auto-pauses live re-rendering for the design.
const HEAVY_RENDER_MS = 6000;

const schema = validateSchema(schemaJson);
const initialState = readInitialState(schema);
document.title = schema.title;

const fileImport = schema.fileImport ?? null;

export default function App() {
  const { mode: themeMode, resolved: theme, cycle: cycleTheme } = useTheme();
  const {
    updateReady,
    applyUpdate,
    forceUpdate,
    dismiss: dismissUpdate,
  } = useServiceWorkerUpdate();
  const [designId, setDesignId] = useState(initialState.designId);
  const design = useMemo<Design>(
    () => schema.designs.find((d) => d.id === designId)!,
    [designId]
  );
  const [values, setValues] = useState<Values>(initialState.values);
  // The selected-preset id (namespaced), owned here so it rides along in the URL.
  const [presetSel, setPresetSel] = useState(initialState.preset);
  const [bundledPresets, setBundledPresets] = useState<ParsedSet[]>([]);
  // The user's browser-local preset names for this design. Owned here so the
  // PresetBar in the drawer and the compact topbar copy (small screens) stay in
  // sync after a Save; re-read on design change and after saving.
  const [userPresets, setUserPresets] = useState<string[]>(() => listPresets(design.id));
  const refreshUserPresets = () => setUserPresets(listPresets(design.id));
  const [userFiles, setUserFiles] = useState<Record<string, Uint8Array>>({});
  const [result, setResult] = useState<RenderResult | null>(null);
  const [rendering, setRendering] = useState(false);
  // True once any render reports parameters the deployed source has dropped —
  // i.e. this cached bundle is stale (see worker.ts's skew guard). Latched so a
  // later cache hit (which carries no skew info) can't clear the reload prompt.
  const [bundleStale, setBundleStale] = useState(false);
  // Key of the last *successful* render. Drives the "stale preview" notice: when
  // it differs from the current parameters' key, the preview is out of date.
  const [renderedKey, setRenderedKey] = useState("");
  // False until the worker reports its assets (the ~10 MB WASM) are loaded.
  const [ready, setReady] = useState(false);
  // Parameter panel: a slide-in drawer on small screens (closed by default);
  // always visible on wide screens (CSS ignores this there).
  const [menuOpen, setMenuOpen] = useState(false);
  // Short message announced to screen readers for actions that don't change the
  // render status (export, save, font upload).
  const [announcement, setAnnouncement] = useState("");
  const [showLicenses, setShowLicenses] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // Live re-render on edits. Off for designs flagged `heavy`, and auto-paused
  // after a slow render so editing a big model doesn't re-render on every keystroke.
  const [autoRender, setAutoRender] = useState(!design.heavy);
  const autoRenderRef = useRef(autoRender);
  useEffect(() => {
    autoRenderRef.current = autoRender;
  }, [autoRender]);

  const runnerRef = useRef<OpenSCADRunner | null>(null);
  const viewerRef = useRef<ViewerHandle>(null);
  // Key of the last successful render, to skip redundant re-renders.
  const lastKeyRef = useRef("");
  if (!runnerRef.current)
    runnerRef.current = new OpenSCADRunner({
      onReady: () => setReady(true),
      // Namespace the render cache by the build's content hash so a deploy that
      // changes any .scad/font/feature/wasm input can't serve stale geometry.
      cacheVersion: schema.renderHash,
    });

  // Reset to defaults when switching designs — but not on the first render,
  // which must keep the values restored from the URL/last session.
  const firstDesignRun = useRef(true);
  useEffect(() => {
    if (firstDesignRun.current) {
      firstDesignRun.current = false;
      return;
    }
    setValues(defaultsFor(design));
    setResult(null);
    setRenderedKey("");
    lastKeyRef.current = "";
    setAutoRender(!design.heavy);
    setPresetSel("");
    setUserPresets(listPresets(design.id));
  }, [design]);

  // Mirror the current design + values + selected preset into the URL hash and
  // localStorage, so a link reproduces the configuration and its preset.
  useEffect(() => {
    persistState(design, values, presetSel);
  }, [design, values, presetSel]);

  // Load this design's bundled presets (ignore a stale fetch if the design
  // changes before it resolves).
  useEffect(() => {
    let active = true;
    setBundledPresets([]);
    fetchBundledPresets(design).then((p) => active && setBundledPresets(p));
    return () => {
      active = false;
    };
  }, [design]);

  const setValue = (name: string, value: ParamValue) =>
    setValues((v) => ({ ...v, [name]: value }));

  // The OpenSCAD -D defines for the current parameters, and a content key over
  // them (plus design + user files). The key is shared by the render dedupe guard
  // and the stale-preview notice, so both agree on what "unchanged" means.
  const defines = useMemo(() => {
    const d: Record<string, string> = {};
    for (const p of design.params)
      d[p.name] = toScadExpr(p, values[p.name] ?? p.default);
    return d;
  }, [design, values]);
  const renderKey = useMemo(
    () => JSON.stringify({ d: design.id, defines, f: fileSignature(userFiles) }),
    [design.id, defines, userFiles]
  );

  // Live auto-render is off and the current parameters haven't been rendered yet
  // — the preview is stale, so prompt the user to render on demand.
  const stalePreview = !autoRender && renderKey !== renderedKey;

  const doRender = useMemo(
    () => async () => {
      // Memoize: nothing changed since the last successful render.
      if (renderKey === lastKeyRef.current) return;
      setRendering(true);
      try {
        const r = await runnerRef.current!.render({
          design: design.id,
          defines,
          userFiles,
        });
        lastKeyRef.current = r.ok ? renderKey : "";
        // A successful result — including one served from the persistent cache
        // without touching the worker — means we have something to show, so drop
        // the "loading renderer" overlay (the worker emits onReady only when it
        // actually renders, which a cache hit skips).
        if (r.ok) {
          setReady(true);
          setRenderedKey(renderKey);
        }
        setResult(r);
        if (r.staleDefines?.length) setBundleStale(true);
        setRendering(false);
        // A heavy render auto-pauses live updates so further edits don't queue
        // long renders on every keystroke; the user renders on demand instead.
        // A cache hit is instant regardless of the model's original render time,
        // so it never triggers the pause (r.ms is the cached original cost).
        if (r.ok && !r.cached && r.ms > HEAVY_RENDER_MS && autoRenderRef.current) {
          setAutoRender(false);
          setAnnouncement(
            `Large model (${r.ms} ms) — auto-render paused. Click “Render now” after edits.`
          );
        }
      } catch (e) {
        // A newer render superseded this one — leave its progress state alone.
        if (e instanceof SupersededError) return;
        lastKeyRef.current = "";
        setRendering(false);
      }
    },
    [design.id, defines, userFiles, renderKey]
  );

  // Debounced auto-render on any change — unless live rendering is paused.
  useEffect(() => {
    if (!autoRender) return;
    const t = setTimeout(doRender, 400);
    return () => clearTimeout(t);
  }, [doRender, autoRender]);

  useEffect(() => () => runnerRef.current?.dispose(), []);

  // Restore files persisted from previous sessions (uploaded fonts, SVGs, …).
  useEffect(() => {
    loadFiles().then((f) => {
      if (Object.keys(f).length > 0) setUserFiles((prev) => ({ ...f, ...prev }));
    });
  }, []);

  const exportModel = () => {
    if (!result?.ok) return;
    // result.stl carries the rendered model bytes in the build-time format
    // (3MF is colour-bearing; STL is geometry-only). See the render worker.
    const blob = new Blob([result.stl as BlobPart], { type: `model/${schema.format}` });
    downloadBlob(blob, `${design.id}.${schema.format}`);
    setAnnouncement(`Exported ${design.id}.${schema.format}`);
  };

  const savePng = () => {
    const url = viewerRef.current?.snapshot();
    if (url) {
      download(url, `${design.id}.png`);
      setAnnouncement(`Saved ${design.id}.png`);
    }
  };

  // Add a file for this render and persist it for future sessions. Changing the
  // file set drops every cached STL (L1 + L2) so stale geometry can't be served.
  const addFile = (name: string, bytes: Uint8Array) => {
    setUserFiles((f) => ({ ...f, [name]: bytes }));
    void saveFile(name, bytes);
    runnerRef.current?.clearCache();
    lastKeyRef.current = "";
    setAnnouncement(`File added: ${name}`);
  };

  // Remove every imported file (from this session and persistent storage) and
  // drop the render cache, so the next render runs without the cleared files.
  const clearImportedFiles = () => {
    setUserFiles({});
    void clearFiles();
    runnerRef.current?.clearCache();
    lastKeyRef.current = "";
    setAnnouncement("Imported files cleared");
  };

  // Copy a shareable link — the current design + non-default params live in the
  // URL hash (see lib/urlState.ts), so the address bar already reproduces this view.
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setAnnouncement("Link copied to clipboard");
    } catch {
      setAnnouncement("Couldn’t copy — copy the URL from the address bar");
    }
  };

  return (
    <div className={menuOpen ? "app menu-open" : "app"}>
      <a className="skip-link" href="#params">
        Skip to parameters
      </a>
      <header className="topbar">
        <button
          className="menu-toggle"
          aria-label="Toggle parameters"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          ☰
        </button>
        <h1 className="brand">
          {schema.logo ? (
            <img
              className="brand-logo"
              src={assetUrl(schema.logo[theme])}
              alt={schema.title}
            />
          ) : (
            schema.title
          )}
        </h1>
        <div className="design-picker">
          <label>
            Design{" "}
            <select value={designId} onChange={(e) => setDesignId(e.target.value)}>
              {schema.designs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {/* Compact presets dropdown, shown only on small screens where the
            parameter panel (and PresetBar) is hidden behind the hamburger. */}
        <PresetSelect
          className="topbar-preset"
          design={design}
          values={values}
          bundled={bundledPresets}
          userPresets={userPresets}
          onApply={(v) => setValues(v)}
          selected={presetSel}
          onSelectedChange={setPresetSel}
        />
        <span className="status" role="status" aria-live="polite">
          {rendering
            ? "Rendering…"
            : result
              ? result.ok
                ? `Rendered in ${result.ms} ms`
                : `Render failed (exit ${result.exitCode})`
              : "Idle"}
        </span>
        <IconButton
          className="licenses-btn"
          label={`Theme: ${themeMode}`}
          title={`Theme: ${themeMode} (${theme}). Click to change.`}
          onClick={cycleTheme}
        >
          {themeMode === "light" ? (
            <SunIcon />
          ) : themeMode === "dark" ? (
            <MoonIcon />
          ) : (
            <AutoThemeIcon />
          )}
        </IconButton>
        <IconButton
          className="licenses-btn"
          label="Help"
          title="How to use this configurator"
          onClick={() => setShowHelp(true)}
        >
          <HelpIcon />
        </IconButton>
        <IconButton
          className="licenses-btn"
          label="Open-source licenses"
          title="Open-source licenses & attribution"
          onClick={() => setShowLicenses(true)}
        >
          <InfoIcon />
        </IconButton>
      </header>

      {showHelp && <HelpModal help={schema.help} onClose={() => setShowHelp(false)} />}
      {showLicenses && (
        <LicensesModal
          extra={schema.licenses}
          onClose={() => setShowLicenses(false)}
        />
      )}
      {/* Off-screen live region for action confirmations. */}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {bundleStale ? (
        // The running bundle is out of date relative to the deployed sources, so
        // a cryptic "unknown parameter" error would otherwise surface. Prompt a
        // forced reload instead — no "Later", since staying put keeps it broken.
        <div className="update-toast stale-toast" role="alert">
          <span>This page is running an outdated version. Reload to update.</span>
          <button className="primary" onClick={forceUpdate}>
            Reload
          </button>
        </div>
      ) : (
        updateReady && (
          <div className="update-toast" role="status" aria-live="polite">
            <span>A new version is available.</span>
            <button className="primary" onClick={applyUpdate}>
              Reload
            </button>
            <button className="link-btn" onClick={dismissUpdate}>
              Later
            </button>
          </div>
        )
      )}

      <main className="layout">
        <div className="backdrop" onClick={() => setMenuOpen(false)} />
        <aside className="sidebar" id="params" aria-label="Parameters">
          <button className="sidebar-close" onClick={() => setMenuOpen(false)}>
            ✕ Close
          </button>
          <PresetBar
            design={design}
            values={values}
            bundled={bundledPresets}
            userPresets={userPresets}
            onApply={(v) => setValues(v)}
            selected={presetSel}
            onSelectedChange={setPresetSel}
            onPresetsChange={refreshUserPresets}
          />
          <div className="form-toolbar">
            <button
              type="button"
              className="reset-link"
              title="Reset all parameters to this design's defaults"
              onClick={() => {
                setValues(defaultsFor(design));
                setPresetSel("");
              }}
            >
              <ResetIcon size={15} /> Reset to defaults
            </button>
          </div>
          <ParamForm design={design} values={values} onChange={setValue} />
          <FileBar
            fileImport={fileImport}
            loadedFiles={Object.keys(userFiles)}
            onAddFile={addFile}
            onClearFiles={clearImportedFiles}
          />
        </aside>

        <section className="preview" aria-label="Preview and output">
          {stalePreview && (
            <div className="render-pending" role="status">
              <span className="render-pending-text">
                Auto-render is paused — the preview doesn’t reflect your latest
                changes. Click “Render now” to update it.
              </span>
              <button className="primary" onClick={doRender} disabled={rendering}>
                <PlayIcon size={16} /> Render now
              </button>
            </div>
          )}
          <div className="viewer-wrap">
            <ErrorBoundary resetKey={result}>
              <Suspense fallback={null}>
                <Viewer
                  ref={viewerRef}
                  stl={result?.ok ? result.stl : null}
                  theme={theme}
                  designId={design.id}
                />
              </Suspense>
            </ErrorBoundary>
            {(!ready || (rendering && !result)) && (
              <div className="viewer-overlay">
                <div className="spinner" />
                <p>
                  {ready
                    ? "Rendering…"
                    : "Loading renderer… (one-time ~10 MB download)"}
                </p>
              </div>
            )}
            {result?.ok && (
              <div className="viewer-controls">
                <IconButton
                  label="Zoom in"
                  onClick={() => viewerRef.current?.zoomIn()}
                >
                  <ZoomInIcon size={18} />
                </IconButton>
                <IconButton
                  label="Zoom out"
                  onClick={() => viewerRef.current?.zoomOut()}
                >
                  <ZoomOutIcon size={18} />
                </IconButton>
                <IconButton
                  label="Reset view"
                  onClick={() => viewerRef.current?.resetView()}
                >
                  <ResetIcon size={18} />
                </IconButton>
              </div>
            )}
          </div>
          <div className="preview-actions">
            <button className="primary" onClick={doRender} disabled={rendering}>
              <PlayIcon size={16} /> Render now
            </button>
            <label className="auto-render" title="Re-render automatically as you change parameters">
              <input
                type="checkbox"
                checked={autoRender}
                onChange={(e) => setAutoRender(e.target.checked)}
              />
              Auto-render
            </label>
            <button onClick={exportModel} disabled={!result?.ok}>
              <DownloadIcon size={16} /> Export {schema.format.toUpperCase()}
            </button>
            <button onClick={savePng} disabled={!result?.ok}>
              <ImageIcon size={16} /> Save PNG
            </button>
            <button onClick={copyLink} title="Copy a link that reproduces this configuration">
              <LinkIcon size={16} /> Copy link
            </button>
          </div>
          <Diagnostics log={result?.log ?? []} />
          <LogPanel log={result?.log ?? []} />
        </section>
      </main>
    </div>
  );
}
