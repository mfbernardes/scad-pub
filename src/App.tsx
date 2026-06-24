import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import schemaJson from "./generated/designs.json";
import type { Design, ParamValue, RenderResult } from "./openscad/types";
import { validateSchema } from "./lib/schema";
import { ns } from "./lib/appId";
import { fontSignature, OpenSCADRunner, SupersededError } from "./openscad/runner";
import { toScadExpr } from "./lib/scad";
import {
  defaultsFor,
  fetchBundledPresets,
  type ParsedSet,
  type Values,
} from "./lib/presets";
import { readInitialState, persistState } from "./lib/urlState";
import { loadFonts, saveFont } from "./lib/fontStore";
import { download, downloadBlob } from "./lib/download";
import { assetUrl } from "./lib/assetUrl";
import { useTheme } from "./lib/theme";
import { useServiceWorkerUpdate } from "./lib/swUpdate";
import { ParamForm } from "./components/ParamForm";
import { IconButton } from "./components/IconButton";
import { PresetBar } from "./components/PresetBar";
import type { ViewerHandle } from "./components/Viewer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LogPanel } from "./components/LogPanel";
import { Diagnostics } from "./components/Diagnostics";
import { LicensesModal } from "./components/LicensesModal";
import { HelpModal } from "./components/HelpModal";
import { FontPromptModal } from "./components/FontPromptModal";
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

// Persist the user's choice to stop seeing the upload-font nudge.
const FONT_PROMPT_DISMISSED = ns("fontPrompt.dismissed");
function fontPromptDismissed(): boolean {
  try {
    return localStorage.getItem(FONT_PROMPT_DISMISSED) === "1";
  } catch {
    return false;
  }
}

export default function App() {
  const { mode: themeMode, resolved: theme, cycle: cycleTheme } = useTheme();
  const { updateReady, applyUpdate, dismiss: dismissUpdate } = useServiceWorkerUpdate();
  const [designId, setDesignId] = useState(initialState.designId);
  const design = useMemo<Design>(
    () => schema.designs.find((d) => d.id === designId)!,
    [designId]
  );
  const [values, setValues] = useState<Values>(initialState.values);
  // The selected-preset id (namespaced), owned here so it rides along in the URL.
  const [presetSel, setPresetSel] = useState(initialState.preset);
  const [bundledPresets, setBundledPresets] = useState<ParsedSet[]>([]);
  const [userFonts, setUserFonts] = useState<Record<string, Uint8Array>>({});
  const [result, setResult] = useState<RenderResult | null>(null);
  const [rendering, setRendering] = useState(false);
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
  // Startup nudge to upload the external font (see `fontPrompt`), if the config
  // asks for one and the user has none. Gated until the persisted fonts have loaded so we
  // don't flash it when a font is already stored.
  const [showFontPrompt, setShowFontPrompt] = useState(false);
  const fontPromptChecked = useRef(false);
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
    runnerRef.current = new OpenSCADRunner({ onReady: () => setReady(true) });

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
    setAutoRender(!design.heavy);
    setPresetSel("");
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

  const doRender = useMemo(
    () => async () => {
      const defines: Record<string, string> = {};
      for (const p of design.params)
        defines[p.name] = toScadExpr(p, values[p.name] ?? p.default);
      const key = JSON.stringify({
        d: design.id,
        defines,
        f: fontSignature(userFonts),
      });
      // Memoize: nothing changed since the last successful render.
      if (key === lastKeyRef.current) return;
      setRendering(true);
      try {
        const r = await runnerRef.current!.render({
          design: design.id,
          defines,
          userFonts,
        });
        lastKeyRef.current = r.ok ? key : "";
        setResult(r);
        setRendering(false);
        // A heavy render auto-pauses live updates so further edits don't queue
        // long renders on every keystroke; the user renders on demand instead.
        if (r.ok && r.ms > HEAVY_RENDER_MS && autoRenderRef.current) {
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
    [design, values, userFonts]
  );

  // Debounced auto-render on any change — unless live rendering is paused.
  useEffect(() => {
    if (!autoRender) return;
    const t = setTimeout(doRender, 400);
    return () => clearTimeout(t);
  }, [doRender, autoRender]);

  useEffect(() => () => runnerRef.current?.dispose(), []);

  // Restore fonts persisted from previous sessions (any uploaded TTF/OTF),
  // then decide once whether to nudge the user to upload the external font the
  // config expects (only when they have none and haven't dismissed it).
  useEffect(() => {
    loadFonts().then((f) => {
      const hasFonts = Object.keys(f).length > 0;
      if (hasFonts) setUserFonts((prev) => ({ ...f, ...prev }));
      if (fontPromptChecked.current) return;
      fontPromptChecked.current = true;
      if (schema.fontPrompt && !hasFonts && !fontPromptDismissed())
        setShowFontPrompt(true);
    });
  }, []);

  const exportStl = () => {
    if (!result?.ok) return;
    const blob = new Blob([result.stl as BlobPart], { type: "model/stl" });
    downloadBlob(blob, `${design.id}.stl`);
    setAnnouncement(`Exported ${design.id}.stl`);
  };

  const savePng = () => {
    const url = viewerRef.current?.snapshot();
    if (url) {
      download(url, `${design.id}.png`);
      setAnnouncement(`Saved ${design.id}.png`);
    }
  };

  // Add a font for this render and persist it for future sessions.
  const addFont = (name: string, bytes: Uint8Array) => {
    setUserFonts((f) => ({ ...f, [name]: bytes }));
    void saveFont(name, bytes);
    setAnnouncement(`Font added: ${name}`);
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
      {showLicenses && <LicensesModal onClose={() => setShowLicenses(false)} />}
      {showFontPrompt && schema.fontPrompt && (
        <FontPromptModal
          prompt={schema.fontPrompt}
          onUpload={addFont}
          onDismissForever={() => {
            try {
              localStorage.setItem(FONT_PROMPT_DISMISSED, "1");
            } catch {
              /* storage unavailable — dismiss for this session only */
            }
            setShowFontPrompt(false);
          }}
          onClose={() => setShowFontPrompt(false)}
        />
      )}

      {/* Off-screen live region for action confirmations. */}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {updateReady && (
        <div className="update-toast" role="status" aria-live="polite">
          <span>A new version is available.</span>
          <button className="primary" onClick={applyUpdate}>
            Reload
          </button>
          <button className="link-btn" onClick={dismissUpdate}>
            Later
          </button>
        </div>
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
            onApply={(v) => setValues(v)}
            onAddFont={addFont}
            fontPrompt={schema.fontPrompt}
            loadedFonts={Object.keys(userFonts)}
            selected={presetSel}
            onSelectedChange={setPresetSel}
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
        </aside>

        <section className="preview" aria-label="Preview and output">
          <div className="viewer-wrap">
            <ErrorBoundary resetKey={result}>
              <Suspense fallback={null}>
                <Viewer
                  ref={viewerRef}
                  stl={result?.ok ? result.stl : null}
                  theme={theme}
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
            <button onClick={exportStl} disabled={!result?.ok}>
              <DownloadIcon size={16} /> Export STL
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
