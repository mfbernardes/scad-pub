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
import {
  readInitialState,
  persistState,
  buildShareUrl,
  parseHashState,
  sessionStateEquals,
  type SessionState,
} from "./lib/urlState";
import { computeShareability, shareabilityWarning } from "./lib/shareability";
import { download, downloadBlob } from "./lib/download";
import { shareUrl, shareFileOrFallback } from "./lib/share";
import { useTheme } from "./lib/theme";
import { useServiceWorkerUpdate } from "./lib/swUpdate";
import { useInstallPrompt } from "./lib/useInstallPrompt";
import { useOnline } from "./lib/useOnline";
import { useRenderPipeline } from "./lib/useRenderPipeline";
import { useFileImports } from "./lib/useFileImports";
import { useAppNotices } from "./lib/useAppNotices";
import { useExperience } from "./lib/useExperience";
import { makeOnceFlag } from "./lib/prefs";
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
const installHintFlag = makeOnceFlag("install.hint.seen");

export default function App() {
  const { mode: themeMode, resolved: theme, cycle: cycleTheme } = useTheme();
  const { settingsView, setSettingsView } = useExperience();
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

  // M4: the ONE place external URL state (a same-document hashchange, or an
  // installed-app launch target queued via the Web App Launch Handler) is
  // applied to React state — atomically, the same way a design switch is.
  // Reuses handleDesignChange's own design/values/preset reset so the render
  // pipeline's epoch still advances and a stale render can never land under
  // the newly-applied design. When the design is unchanged (e.g. a launch
  // that only carries new values/preset for the current design), still update
  // values/preset without disturbing render-pipeline epoch/reset state that a
  // full design switch would otherwise reset for no reason.
  const applyExternalState = useCallback(
    (state: SessionState) => {
      const next = schema.designs.find((d) => d.id === state.designId);
      if (!next) return;
      if (next.id !== designId) {
        setDesignId(next.id);
        resetForDesign(next);
      }
      setValues(state.values);
      setPresetSel(state.preset);
      setUserPresets(listPresets(next.id));
    },
    [designId, resetForDesign]
  );

  useEffect(() => {
    const t = setTimeout(() => persistState(design, values, presetSel), 300);
    return () => clearTimeout(t);
  }, [design, values, presetSel]);

  // M4: consume external navigations that only change the URL hash — a
  // same-document `hashchange` (e.g. a browser/OS "navigate to #d=..." that
  // doesn't reload the document) and the Web App Launch Handler's queued
  // target for an installed app opened via a manifest shortcut
  // (`navigate-existing` — see scripts/lib/pwa-assets.mjs). Neither fires a
  // full module reload, so without this the address bar/launch target would
  // update while the mounted app's design/value/preset state stays put.
  // `persistState` above writes via `history.replaceState`, which per spec
  // never fires `hashchange`, so there's no feedback loop from our own
  // writes; the equality check below is a defensive backstop against any
  // navigation that happens to already match current state (a no-op, not a
  // loop).
  // Read imperatively inside the effect below via refs (not effect deps), so
  // the hashchange/launchQueue subscription is set up once at mount rather
  // than being torn down and re-added on every keystroke — the effect only
  // needs the LATEST design/values/preset at the moment a hash actually
  // arrives, the same "mirror the latest without retriggering" idiom used by
  // autoRenderRef in useRenderPipeline.ts.
  const currentSessionRef = useRef<SessionState>({ designId, values, preset: presetSel });
  currentSessionRef.current = { designId, values, preset: presetSel };
  const applyExternalStateRef = useRef(applyExternalState);
  applyExternalStateRef.current = applyExternalState;

  useEffect(() => {
    const applyFromHash = (hash: string) => {
      const state = parseHashState(schema, hash);
      if (!state) return;
      if (sessionStateEquals(currentSessionRef.current, state)) return;
      applyExternalStateRef.current(state);
    };

    const onHashChange = () => applyFromHash(location.hash);
    window.addEventListener("hashchange", onHashChange);

    // Installed-app launches (manifest shortcuts, `launch_handler:
    // navigate-existing`) queue their target URL here instead of navigating
    // the document. Unsupported in most browsers today; a no-op when absent.
    const launchQueue = (window as Window & { launchQueue?: LaunchQueue }).launchQueue;
    launchQueue?.setConsumer((params) => {
      if (!params.targetURL) return;
      try {
        applyFromHash(new URL(params.targetURL).hash);
      } catch {
        /* malformed launch target — ignore */
      }
    });

    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Clear stale presets the instant the design changes (during render, not an
  // effect — the documented "adjusting state when a prop changes" pattern),
  // so a design switch never briefly shows the previous design's presets
  // while the fetch below is in flight.
  const [bundledPresetsDesignId, setBundledPresetsDesignId] = useState(designId);
  if (designId !== bundledPresetsDesignId) {
    setBundledPresetsDesignId(designId);
    setBundledPresets([]);
  }
  useEffect(() => {
    let active = true;
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
    if (installHintFlag.seen()) return;
    // Storage unavailable — skip the hint rather than risk repeating it.
    if (!installHintFlag.remember()) return;
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
  }, [exportable, snapshot, offerInstallHint, setAnnouncement]);

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
  }, [exportable, snapshot, setAnnouncement]);

  // Whether the CURRENT design/values/imports are fully described by a plain
  // share URL, and which local-only files are missing if not. Recomputed on
  // every change so `copyLink` never has to guess after the fact.
  // See docs/architecture-review.md H2.
  const shareability = useMemo(
    () => computeShareability(design, values, userFiles, schema.fontFaces ?? []),
    [design, values, userFiles]
  );

  const copyLink = useCallback(async () => {
    // Built synchronously from the live design/values/preset — never from
    // `location.href`, which only reflects the last debounced `persistState`
    // write and can lag a just-made edit by up to 300ms.
    const url = buildShareUrl(design, values, presetSel);
    const warning = shareabilityWarning(shareability);
    // Native share sheet where available (mobile); otherwise copy to clipboard.
    // Either way, a local-only dependency gets an explicit warning naming the
    // missing files — the plain URL is copied/shared regardless (no upload;
    // see docs/architecture-review.md H2), but never silently implied complete.
    const outcome = await shareUrl(url, schema.title);
    if (outcome === "cancelled") return;
    if (outcome === "shared") {
      if (warning) setAnnouncement(warning);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setAnnouncement(warning ?? "Copied share link");
    } catch {
      setAnnouncement("Couldn't copy — copy the URL from the address bar");
    }
  }, [design, values, presetSel, shareability, setAnnouncement]);

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
    settingsViewChange: setSettingsView,
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
        // Keyed on design.id so a design switch while the modal is open remounts
        // it fresh (idle -> loading state) instead of needing to reset state
        // imperatively inside the fetch effect.
        <DesignDocModal key={design.id} design={design} onClose={() => setShowDesignDoc(false)} />
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
          settingsView={settingsView}
        />
      </AppActionsProvider>
    </>
  );
}
