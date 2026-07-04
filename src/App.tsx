import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { loadFiles, saveFile, deleteFile, clearFiles } from "./lib/fileStore";
import { download, downloadBlob } from "./lib/download";
import { shareUrl, shareFile } from "./lib/share";
import { useTheme } from "./lib/theme";
import { useServiceWorkerUpdate } from "./lib/swUpdate";
import { useInstallPrompt } from "./lib/useInstallPrompt";
import { useOnline } from "./lib/useOnline";
import { ns } from "./lib/appId";
import { toast } from "sonner";
import { AppActionsProvider, type AppActions } from "./lib/appActions";
import { AppShell } from "./components/AppShell";
import { Toaster } from "./components/ui/sonner";
import { LicensesModal } from "./components/LicensesModal";
import { HelpModal } from "./components/HelpModal";
import { PopupModal } from "./components/PopupModal";
import { shouldShowPopup, rememberPopup } from "./lib/popup";

const schema = validateSchema(schemaJson);
const initialState = readInitialState(schema);
document.title = schema.title;

// A render slower than this auto-pauses live re-rendering for the design.
// Configurable via `render.heavyMs`; defaults to 6 s.
const HEAVY_RENDER_MS = schema.render?.heavyMs ?? 6000;
// Optional build-time render-cache sizing (config `render.cache`). Each field
// falls through to the runner's own default when unset.
const cacheConfig = schema.render?.cache;

const popup = schema.popup ?? null;
const installMode = schema.ui?.install ?? "auto";
const INSTALL_HINT_KEY = ns("install.hint.seen");

export default function App() {
  const { mode: themeMode, resolved: theme, cycle: cycleTheme } = useTheme();
  const { canInstall, promptInstall } = useInstallPrompt();
  const online = useOnline();
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
  const [presetSel, setPresetSel] = useState(initialState.preset);
  const [bundledPresets, setBundledPresets] = useState<ParsedSet[]>([]);
  const [userPresets, setUserPresets] = useState<string[]>(() => listPresets(design.id));
  const refreshUserPresets = useCallback(() => setUserPresets(listPresets(design.id)), [design.id]);
  const [userFiles, setUserFiles] = useState<Record<string, Uint8Array>>({});
  const [result, setResult] = useState<RenderResult | null>(null);
  const [rendering, setRendering] = useState(false);
  const [bundleStale, setBundleStale] = useState(false);
  const [renderedKey, setRenderedKey] = useState("");
  // The parameter values behind the *current* render, captured when it finishes.
  // The viewer's measurements panel reads these (not the live controls) so its
  // figures only change once a render lands, in step with the measured geometry.
  const [renderedValues, setRenderedValues] = useState<Values>(initialState.values);
  const [ready, setReady] = useState(false);
  // Transient user-facing confirmations (export done, link copied, …) go through
  // Sonner toasts, which provide their own polite live region for a11y. A shared
  // id means a new confirmation replaces the previous one instead of stacking.
  const setAnnouncement = useCallback((msg: string) => {
    if (msg) toast(msg, { id: "announcement" });
  }, []);
  const [showLicenses, setShowLicenses] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showPopup, setShowPopup] = useState(() => shouldShowPopup(popup));
  const closePopup = (remember: boolean) => {
    if (remember && popup) rememberPopup(popup);
    setShowPopup(false);
  };
  const [autoRender, setAutoRender] = useState(!design.heavy);
  // Mirrored on every render so async work (doRender) reads the latest value
  // without retriggering the effects that depend on it.
  const autoRenderRef = useRef(autoRender);
  autoRenderRef.current = autoRender;

  const runnerRef = useRef<OpenSCADRunner | null>(null);
  const lastKeyRef = useRef("");
  if (!runnerRef.current)
    runnerRef.current = new OpenSCADRunner({
      onReady: () => setReady(true),
      cacheVersion: schema.renderHash,
      cacheSize: cacheConfig?.maxEntries,
      cacheBytes: cacheConfig?.maxBytes,
      maxCacheEntryBytes: cacheConfig?.maxEntryBytes,
      persistentCache: cacheConfig?.persistent,
    });

  // Switching designs resets everything design-scoped in the same event —
  // values, result, preset selection, auto-render mode.
  const handleDesignChange = useCallback(
    (id: string) => {
      if (id === designId) return;
      const next = schema.designs.find((d) => d.id === id);
      if (!next) return;
      setDesignId(id);
      setValues(defaultsFor(next));
      setResult(null);
      setRenderedKey("");
      lastKeyRef.current = "";
      setAutoRender(!next.heavy);
      setPresetSel("");
      setUserPresets(listPresets(id));
    },
    [designId]
  );

  useEffect(() => {
    const t = setTimeout(() => persistState(design, values, presetSel), 300);
    return () => clearTimeout(t);
  }, [design, values, presetSel]);

  useEffect(() => {
    let active = true;
    setBundledPresets([]);
    fetchBundledPresets(design).then((p) => active && setBundledPresets(p));
    return () => { active = false; };
  }, [design]);

  const setValue = useCallback((name: string, value: ParamValue) =>
    setValues((v) => ({ ...v, [name]: value })), []);

  const defines = useMemo(() => {
    const d: Record<string, string> = {};
    for (const p of design.params)
      d[p.name] = toScadExpr(p, values[p.name] ?? p.default);
    return d;
  }, [design, values]);
  // Hash user files only when they change, not on every param edit (it scans
  // every uploaded byte), then fold the cheap signature into the render key.
  const fileSig = useMemo(() => fileSignature(userFiles), [userFiles]);
  const renderKey = useMemo(
    () => JSON.stringify({ d: design.id, defines, f: fileSig }),
    [design.id, defines, fileSig]
  );

  const stalePreview = !autoRender && renderKey !== renderedKey;

  const doRender = useCallback(
    async () => {
      if (renderKey === lastKeyRef.current) return;
      setRendering(true);
      try {
        const r = await runnerRef.current!.render({
          design: design.id,
          defines,
          userFiles,
        });
        lastKeyRef.current = r.ok ? renderKey : "";
        if (r.ok) {
          setReady(true);
          setRenderedKey(renderKey);
          // Snapshot the values this render was built from (defines derives from
          // them, so doRender is recreated whenever they change) for the panel.
          setRenderedValues(values);
        }
        setResult(r);
        if (!r.ok)
          toast.error("Render failed", {
            id: "render-failed",
            description: `Exit ${r.exitCode}. Open Output for details.`,
          });
        if (r.staleDefines?.length) setBundleStale(true);
        setRendering(false);
        if (r.ok && !r.cached && r.ms > HEAVY_RENDER_MS && autoRenderRef.current) {
          setAutoRender(false);
          setAnnouncement(
            `Large model (${r.ms} ms) — auto-render paused. Click "Render now" after edits.`
          );
        }
      } catch (e) {
        // Superseded: a newer render is already in flight and now owns the
        // spinner state — deliberately do NOT setRendering(false) here, or the
        // indicator would flicker off under the render that replaced this one.
        if (e instanceof SupersededError) return;
        // A hard failure (worker crash, message error) rejects instead of
        // resolving with ok:false — surface it like a failed render rather
        // than silently stopping the spinner over a stale model.
        lastKeyRef.current = "";
        setRendering(false);
        toast.error("Render failed", {
          id: "render-failed",
          description:
            e instanceof Error ? e.message : "Unexpected renderer error.",
        });
      }
    },
    [design.id, defines, userFiles, renderKey, values]
  );

  useEffect(() => {
    if (!autoRender) return;
    const t = setTimeout(doRender, 400);
    return () => clearTimeout(t);
  }, [doRender, autoRender]);

  // First view of a design always renders once, even when auto-render is off
  // (e.g. heavy designs), so the user never faces an empty canvas. Fires when the
  // renderer is ready and there's no result yet (initial load or design switch);
  // skipped when auto-render is on, since the effect above already covers it.
  useEffect(() => {
    if (ready && !result && !rendering && !autoRenderRef.current) doRender();
  }, [ready, result, rendering, doRender]);

  useEffect(() => () => runnerRef.current?.dispose(), []);

  useEffect(() => {
    loadFiles().then((f) => {
      if (Object.keys(f).length > 0) setUserFiles((prev) => ({ ...f, ...prev }));
    });
  }, []);

  // One-time, post-export install nudge: only when the browser actually offers
  // install, the config allows it, and we haven't shown it before. Demoted per
  // the UX plan — never a standing prompt.
  const offerInstallHint = useCallback(() => {
    if (!canInstall || installMode === "off") return;
    try {
      if (localStorage.getItem(INSTALL_HINT_KEY)) return;
      localStorage.setItem(INSTALL_HINT_KEY, "1");
    } catch {
      /* storage unavailable — skip the hint rather than risk repeating it */
      return;
    }
    toast("Install this configurator for quick, offline access?", {
      id: "install-hint",
      duration: 12000,
      action: { label: "Install", onClick: () => void promptInstall() },
      cancel: { label: "Not now", onClick: () => {} },
    });
  }, [canInstall, promptInstall]);

  const exportModel = useCallback(async () => {
    if (!result?.ok) return;
    const name = `${design.id}.${schema.format}`;
    const blob = new Blob([result.stl as BlobPart], { type: `model/${schema.format}` });
    // Prefer the native share sheet on capable devices (send straight to a
    // slicer / Files / AirDrop); fall back to a plain download otherwise.
    const outcome = await shareFile(new File([blob], name, { type: blob.type }), name);
    if (outcome === "cancelled") return; // user dismissed the sheet — don't also download
    if (outcome === "shared") {
      setAnnouncement(`Shared ${name}`);
    } else {
      downloadBlob(blob, name);
      setAnnouncement(`Exported ${name}`);
    }
    offerInstallHint();
  }, [result, design.id, offerInstallHint]);

  const savePng = useCallback(async (url: string) => {
    const name = `${design.id}.png`;
    // The snapshot is a data: URL — turn it into a File so it can go to the
    // native share sheet (like the model export); fall back to a download.
    const blob = await (await fetch(url)).blob();
    const outcome = await shareFile(new File([blob], name, { type: blob.type || "image/png" }), name);
    if (outcome === "cancelled") return;
    if (outcome === "shared") {
      setAnnouncement(`Shared ${name}`);
    } else {
      download(url, name);
      setAnnouncement(`Saved ${name}`);
    }
  }, [design.id]);

  const addFile = useCallback((name: string, bytes: Uint8Array) => {
    setUserFiles((f) => ({ ...f, [name]: bytes }));
    void saveFile(name, bytes);
    runnerRef.current?.clearCache();
    lastKeyRef.current = "";
    setAnnouncement(`File added: ${name}`);
  }, []);

  const removeFile = useCallback((name: string) => {
    setUserFiles((f) => {
      const next = { ...f };
      delete next[name];
      return next;
    });
    void deleteFile(name);
    runnerRef.current?.clearCache();
    lastKeyRef.current = "";
    setAnnouncement(`File removed: ${name}`);
  }, []);

  const clearImportedFiles = useCallback(() => {
    setUserFiles({});
    void clearFiles();
    runnerRef.current?.clearCache();
    lastKeyRef.current = "";
    setAnnouncement("Imported files cleared");
  }, []);

  const copyLink = useCallback(async () => {
    const url = location.href;
    // Native share sheet where available (mobile); otherwise copy to clipboard.
    const outcome = await shareUrl(url, schema.title);
    if (outcome === "shared" || outcome === "cancelled") return;
    try {
      await navigator.clipboard.writeText(url);
      setAnnouncement("Copied share link");
    } catch {
      setAnnouncement("Couldn't copy — copy the URL from the address bar");
    }
  }, []);

  const handleReset = useCallback(() => { setValues(defaultsFor(design)); setPresetSel(""); }, [design]);
  const showHelpModal = useCallback(() => setShowHelp(true), []);
  const showLicensesModal = useCallback(() => setShowLicenses(true), []);

  // The app-level action bundle, read via useAppActions() by the panels. Rebuilt
  // each render; the provider keeps a stable identity so consumers don't churn.
  const actions: AppActions = {
    install: promptInstall,
    designChange: handleDesignChange,
    change: setValue,
    applyPreset: setValues,
    selectedPresetChange: setPresetSel,
    presetsChange: refreshUserPresets,
    render: doRender,
    exportModel,
    savePng,
    copyLink,
    reset: handleReset,
    addFile,
    removeFile,
    clearFiles: clearImportedFiles,
    autoRenderChange: setAutoRender,
    cycleTheme,
    showHelp: showHelpModal,
    showLicenses: showLicensesModal,
  };

  // Stale-bundle (hard) and service-worker-update (soft) notices as Sonner
  // toasts. Stable ids keep them from stacking; they persist until acted on.
  useEffect(() => {
    if (bundleStale)
      toast.error("This page is running an outdated version. Reload to update.", {
        id: "bundle-stale",
        duration: Infinity,
        action: { label: "Reload", onClick: forceUpdate },
      });
  }, [bundleStale, forceUpdate]);

  useEffect(() => {
    if (updateReady && !bundleStale)
      toast("A new version is available.", {
        id: "sw-update",
        duration: Infinity,
        action: { label: "Reload", onClick: applyUpdate },
        cancel: { label: "Later", onClick: dismissUpdate },
      });
  }, [updateReady, bundleStale, applyUpdate, dismissUpdate]);

  // Offline indicator: a persistent (but reassuring) toast while offline, since
  // the cached WASM means rendering and export keep working. Clears on reconnect.
  useEffect(() => {
    if (!online)
      toast("You're offline — rendering and export still work.", {
        id: "offline",
        duration: Infinity,
      });
    else toast.dismiss("offline");
  }, [online]);

  return (
    <>
      {showPopup && popup && <PopupModal popup={popup} onClose={closePopup} />}
      {showHelp && (
        <HelpModal
          help={schema.help}
          onClose={() => setShowHelp(false)}
          canInstall={canInstall && installMode !== "off"}
          onInstall={promptInstall}
        />
      )}
      {showLicenses && (
        <LicensesModal extra={schema.licenses} onClose={() => setShowLicenses(false)} />
      )}

      <Toaster theme={theme} />

      <AppActionsProvider actions={actions}>
        <AppShell
          schema={schema}
          design={design}
          designs={schema.designs}
          values={values}
          renderedValues={renderedValues}
          bundled={bundledPresets}
          userPresets={userPresets}
          selectedPreset={presetSel}
          userFiles={userFiles}
          result={result}
          rendering={rendering}
          ready={ready}
          autoRender={autoRender}
          stalePreview={stalePreview}
          theme={theme}
          themeMode={themeMode}
        />
      </AppActionsProvider>
    </>
  );
}
