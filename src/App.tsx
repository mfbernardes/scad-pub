import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import schemaJson from "./generated/designs.json";
import type { Design, ParamValue } from "./openscad/types";
import { validateSchema } from "./lib/schema";
import {
  defaultsFor,
  fetchBundledPresets,
  listPresets,
  loadPreset,
  parsePresetId,
  type ParsedSet,
  type Values,
} from "./lib/presets";
import { changedParams } from "./lib/paramDiff";
import { readInitialState, persistState } from "./lib/urlState";
import { download, downloadBlob } from "./lib/download";
import { shareUrl, shareFileOrFallback } from "./lib/share";
import { useTheme } from "./lib/theme";
import { useServiceWorkerUpdate } from "./lib/swUpdate";
import { useInstallPrompt } from "./lib/useInstallPrompt";
import { useOnline } from "./lib/useOnline";
import { useRenderPipeline } from "./lib/useRenderPipeline";
import { useFileImports } from "./lib/useFileImports";
import { useAppNotices } from "./lib/useAppNotices";
import { ns } from "./lib/appId";
import { readLocal, writeLocal } from "./lib/safeStorage";
import { toast } from "sonner";
import { AppActionsProvider, type AppActions } from "./lib/appActions";
import { AppShell } from "./components/AppShell";
import { Toaster } from "./components/ui/sonner";
import { LicensesModal } from "./components/LicensesModal";
import { HelpModal } from "./components/HelpModal";
import { DesignDocModal } from "./components/DesignDocModal";
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
  const [showDesignDoc, setShowDesignDoc] = useState(false);
  const [showPopup, setShowPopup] = useState(() => shouldShowPopup(popup));
  const closePopup = (remember: boolean) => {
    if (remember && popup) rememberPopup(popup);
    setShowPopup(false);
  };
  // Bumped by the popup's primary CTA to open the design picker (the obvious
  // first step). AppShell routes it to whichever layout's picker is visible.
  const [openPickerSignal, setOpenPickerSignal] = useState(0);
  const popupPrimary = (remember: boolean) => {
    closePopup(remember);
    if (schema.designs.length > 1) setOpenPickerSignal((n) => n + 1);
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
    renderMetrics,
    autoRender,
    setAutoRender,
    stalePreview,
    exportable,
    snapshot,
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

  // The unified preset-diff baseline: the selected preset's values when one is
  // selected, else null (meaning "compare against defaults" — see `baseline`
  // below). Resolved from `presetSel` rather than stored separately so it can
  // never drift out of sync with the picker's own selection.
  const parsedPreset = useMemo(() => parsePresetId(presetSel), [presetSel]);
  const presetBaseline = useMemo<Values | null>(() => {
    if (!parsedPreset) return null;
    if (parsedPreset.kind === "bundled")
      return bundledPresets.find((p) => p.name === parsedPreset.name)?.values ?? null;
    return loadPreset(design.id, parsedPreset.name);
  }, [parsedPreset, bundledPresets, design]);
  const presetName = parsedPreset?.name ?? null;
  // The baseline "drifted" is measured against: the selected preset's values,
  // or the design's defaults when no preset is selected.
  const baseline = useMemo(() => presetBaseline ?? defaultsFor(design), [presetBaseline, design]);
  const changed = useMemo(
    () => changedParams(design.params, baseline, values),
    [design, baseline, values]
  );
  const changedNames = useMemo(() => new Set(changed.map((p) => p.name)), [changed]);

  // One-time, post-export install nudge: only when the browser actually offers
  // install, the config allows it, and we haven't shown it before. Demoted per
  // the UX plan — never a standing prompt.
  const offerInstallHint = useCallback(() => {
    if (!canInstall || installMode === "off") return;
    if (readLocal(INSTALL_HINT_KEY)) return;
    // Storage unavailable — skip the hint rather than risk repeating it.
    if (!writeLocal(INSTALL_HINT_KEY, "1")) return;
    toast("Install this configurator for quick, offline access?", {
      id: "install-hint",
      duration: 12000,
      action: { label: "Install", onClick: () => void promptInstall() },
      cancel: { label: "Not now", onClick: () => {} },
    });
  }, [canInstall, promptInstall]);

  // Gated on `exportable` (a successful render that still matches the live
  // controls, not just "some render succeeded at some point") and named from
  // the exported snapshot's own designId rather than the live `design.id`, so
  // a design switch racing the export can never mislabel the bytes it sends
  // out. See docs/architecture-review.md H1.
  const exportModel = useCallback(async () => {
    if (!exportable || !snapshot?.result.ok) return;
    const name = `${snapshot.designId}.${schema.format}`;
    const blob = new Blob([snapshot.result.stl as BlobPart], { type: `model/${schema.format}` });
    // Prefer the native share sheet on capable devices (send straight to a
    // slicer / Files / AirDrop); fall back to a plain download otherwise.
    const outcome = await shareFileOrFallback(
      new File([blob], name, { type: blob.type }),
      () => downloadBlob(blob, name)
    );
    if (outcome === "cancelled") return; // user dismissed the sheet — don't also download
    setAnnouncement(outcome === "shared" ? `Shared ${name}` : `Exported ${name}`);
    offerInstallHint();
  }, [exportable, snapshot, offerInstallHint]);

  const savePng = useCallback(async (url: string) => {
    if (!exportable || !snapshot) return;
    const name = `${snapshot.designId}.png`;
    // The snapshot is a data: URL — turn it into a File so it can go to the
    // native share sheet (like the model export); fall back to a download.
    const blob = await (await fetch(url)).blob();
    const outcome = await shareFileOrFallback(
      new File([blob], name, { type: blob.type || "image/png" }),
      () => download(url, name)
    );
    if (outcome === "cancelled") return;
    setAnnouncement(outcome === "shared" ? `Shared ${name}` : `Saved ${name}`);
  }, [exportable, snapshot]);

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
  const showDesignDocModal = useCallback(() => setShowDesignDoc(true), []);
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
    showDesignDoc: showDesignDocModal,
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
      {showPopup && popup && (
        <PopupModal popup={popup} onClose={closePopup} onPrimary={popupPrimary} />
      )}
      {showHelp && (
        <HelpModal
          help={schema.help}
          onClose={() => setShowHelp(false)}
          canInstall={canInstall && installMode !== "off"}
          onInstall={promptInstall}
        />
      )}
      {showDesignDoc && design.doc && (
        <DesignDocModal design={design} onClose={() => setShowDesignDoc(false)} />
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
          renderMetrics={renderMetrics}
          bundled={bundledPresets}
          userPresets={userPresets}
          selectedPreset={presetSel}
          presetBaseline={presetBaseline}
          presetName={presetName}
          baseline={baseline}
          changedParams={changedNames}
          userFiles={userFiles}
          result={result}
          rendering={rendering}
          ready={ready}
          autoRender={autoRender}
          stalePreview={stalePreview}
          exportable={exportable}
          theme={theme}
          themeMode={themeMode}
          openPickerSignal={openPickerSignal}
        />
      </AppActionsProvider>
    </>
  );
}
