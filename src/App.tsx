import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import schemaJson from "./generated/designs.json";
import type { Design, ParamValue } from "./openscad/types";
import { validateSchema } from "./lib/schema";
import {
  defaultsFor,
  fetchBundledPresets,
  listPresets,
  type ParsedSet,
  type Values,
} from "./lib/presets";
import { readInitialState, persistState } from "./lib/urlState";
import { download, downloadBlob } from "./lib/download";
import { shareUrl, shareFile } from "./lib/share";
import { useTheme } from "./lib/theme";
import { useServiceWorkerUpdate } from "./lib/swUpdate";
import { useInstallPrompt } from "./lib/useInstallPrompt";
import { useOnline } from "./lib/useOnline";
import { useRenderPipeline } from "./lib/useRenderPipeline";
import { useFileImports } from "./lib/useFileImports";
import { useAppNotices } from "./lib/useAppNotices";
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

  // File imports and the render pipeline are mutually coupled — imports feed
  // the render key, and an import must invalidate the render cache. The ref
  // breaks the ordering cycle: imports call the pipeline's latest invalidate
  // through it (same latest-wins idiom as the AppActions provider).
  const invalidateRef = useRef<() => void>(() => {});
  const { userFiles, addFile, removeFile, clearImportedFiles } = useFileImports({
    invalidate: useCallback(() => invalidateRef.current(), []),
    setAnnouncement,
  });

  const {
    result,
    rendering,
    ready,
    renderedValues,
    autoRender,
    setAutoRender,
    stalePreview,
    bundleStale,
    doRender,
    invalidate,
    resetForDesign,
  } = useRenderPipeline({
    design,
    values,
    userFiles,
    initialValues: initialState.values,
    heavyMs: HEAVY_RENDER_MS,
    runner: {
      cacheVersion: schema.renderHash,
      cacheSize: cacheConfig?.maxEntries,
      cacheBytes: cacheConfig?.maxBytes,
      maxCacheEntryBytes: cacheConfig?.maxEntryBytes,
      persistentCache: cacheConfig?.persistent,
    },
    setAnnouncement,
  });
  invalidateRef.current = invalidate;

  // Switching designs resets everything design-scoped in the same event —
  // values, preset selection, and the pipeline's render-scoped state.
  const handleDesignChange = useCallback(
    (id: string) => {
      if (id === designId) return;
      const next = schema.designs.find((d) => d.id === id);
      if (!next) return;
      setDesignId(id);
      setValues(defaultsFor(next));
      resetForDesign(next);
      setPresetSel("");
      setUserPresets(listPresets(id));
    },
    [designId, resetForDesign]
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

  useAppNotices({
    bundleStale,
    forceUpdate,
    updateReady,
    applyUpdate,
    dismissUpdate,
    online,
  });

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
