import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useServiceWorkerUpdate, useOfflineWarmup } from "./lib/swUpdate";
import { useInstallPrompt } from "./lib/useInstallPrompt";
import { useOnline } from "./lib/useOnline";
import { useStandalone } from "./lib/useStandalone";
import { useDocumentScrollLock } from "./lib/useDocumentScrollLock";
import { useRenderPipeline } from "./lib/useRenderPipeline";
import { useFileImports } from "./lib/useFileImports";
import { useAppNotices } from "./lib/useAppNotices";
import { ns } from "./lib/appId";
import { readLocal, writeLocal } from "./lib/safeStorage";
import { toast } from "sonner";
import { t } from "./lib/i18n";
import { AppActionsProvider, type AppActions } from "./lib/appActions";
import { AppShell } from "./components/AppShell";
import { Toaster } from "./components/ui/sonner";
import { PopupModal } from "./components/PopupModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Modal, MODAL_BODY } from "./components/Modal";
import { Button } from "./components/ui/button";
import { shouldShowPopup, rememberPopup, isDesignChooser } from "./lib/popup";
import type { ExportSuccessState } from "./components/ExportSuccess";

// LicensesModal, HelpModal, DesignDocModal and FilesModal are interaction-only
// surfaces most sessions never open. LicensesModal in particular drags in the
// raw OFL-1.1 license text (src/lib/licenses.ts) and HelpModal the built-in
// help copy (src/lib/defaultHelp.ts). Load each behind a module-scope `lazy()`
// (created once, not per render, so `react-hooks/static-components` is
// satisfied, see SvgPrepareControl.tsx for the same pattern) so they land in
// their own chunks instead of the eager main bundle.
//
// The thunks are named so warmModalChunks() below can pull the same dynamic
// imports the `lazy()` wrappers use; the module loader dedupes them, so the
// click path reuses the warmed module instead of re-fetching.
const loadLicensesModal = () =>
  import("./components/LicensesModal").then((m) => ({ default: m.LicensesModal }));
const loadHelpModal = () => import("./components/HelpModal").then((m) => ({ default: m.HelpModal }));
const loadDesignDocModal = () =>
  import("./components/DesignDocModal").then((m) => ({ default: m.DesignDocModal }));
const loadFilesModal = () =>
  import("./components/FilesModal").then((m) => ({ default: m.FilesModal }));

const LicensesModal = lazy(loadLicensesModal);
const HelpModal = lazy(loadHelpModal);
const DesignDocModal = lazy(loadDesignDocModal);
const FilesModal = lazy(loadFilesModal);

// Every one of these opens from a direct click (a menu item, a toolbar button),
// so the goal is keeping them off the *critical* path, not off the wire: warm
// all four once the app is idle, and the click never waits on the network.
//
// It does still wait on React: `lazy()` suspends for a render pass even when
// the module is already in the loader's map (the payload only resolves the
// first time React renders it), so the dialog mounts a tick or two after the
// click rather than synchronously as it did when statically imported. That is
// below the threshold of a frame for a real user, but it IS observable to a
// driver that asserts immediately after clicking, hence the explicit wait in
// scripts/smoke.mjs's gotoFiles().
//
// A rejected warm-up is ignored on purpose: the click path re-requests through
// `lazy()`, which is where a real failure belongs (see the ErrorBoundary
// wrapping the modal group in the JSX below); swallowing it here must not
// mask that.
function warmModalChunks(): void {
  // DesignDocModal is only reachable when some design carries a `doc` (both its
  // triggers are gated on it), so a config without docs never warms that chunk.
  // Typed as unknown-returning: each loader resolves a differently-propped
  // component, and only the fetch matters here.
  const loaders: Array<() => Promise<unknown>> = [
    loadHelpModal,
    loadFilesModal,
    loadLicensesModal,
  ];
  if (schema.designs.some((d) => d.doc)) loaders.push(loadDesignDocModal);
  for (const load of loaders) load().catch(() => {});
}

const schema = validateSchema(schemaJson);
const initialState = readInitialState(schema);
document.title = schema.title;

// A render slower than this auto-pauses live re-rendering for the design.
// Configurable via `render.heavyMs`; defaults to 6 s.
const HEAVY_RENDER_MS = schema.render?.heavyMs ?? 6000;
// Optional build-time render-cache sizing (config `render.cache`). Each field
// falls through to the runner's own default when unset.
const cacheConfig = schema.render?.cache;

// Versions the build resolved for the open-source licenses modal: ScadPub's own
// (git describe), the OpenSCAD WASM snapshot, and the bundled npm packages. All
// schema data, so no attribution can name a version this build doesn't ship.
const buildVersions = {
  scadpub: schema.scadpubVersion,
  openscad: schema.wasmVersion,
  packages: schema.componentVersions,
};

const popup = schema.popup ?? null;
const installMode = schema.ui?.install ?? "auto";
const INSTALL_HINT_KEY = ns("install.hint.seen");
// Absent -> the after-export panel is off entirely; see ExportSuccess.tsx.
const afterExportConfig = schema.ui?.afterExport ?? null;

export default function App() {
  // The shell is fixed-height and never scrolls; this puts back any document
  // scroll a browser applied on its own (iOS does, while the software keyboard
  // is up, and does not undo it afterwards). See the hook's own doc.
  useDocumentScrollLock();
  const { mode: themeMode, resolved: theme, cycle: cycleTheme, next: themeNext } = useTheme();
  const { canInstall, promptInstall, installed } = useInstallPrompt();
  const online = useOnline();
  // True when this is the installed app in its own window (see the warm-up below).
  const standalone = useStandalone();
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
  // Set alongside showHelp whenever a caller (e.g. the after-export panel's
  // "Open printing help") asks for a specific tab; cleared (undefined) by the
  // generic Help affordances, which never pass one, see showHelpModal below.
  const [helpInitialTab, setHelpInitialTab] = useState<string | undefined>(undefined);
  const [showDesignDoc, setShowDesignDoc] = useState(false);
  // FilesModal (the imported-file manager): hosted here like Help/Licenses/
  // DesignDoc, opened only via BarActions' "Files" action (gated on
  // `schema.fileImport` being set, see AppShell's `hasFiles`).
  const [showFiles, setShowFiles] = useState(false);
  // Non-null right after a successful export while `ui.afterExport` is
  // configured, see ExportSuccess.tsx. `key` increments so the panel's
  // auto-hide timer restarts even when two exports in a row reuse the same
  // (or no) title/body override.
  const [exportSuccess, setExportSuccess] = useState<ExportSuccessState | null>(null);
  const exportSuccessKeyRef = useRef(0);
  const dismissExportSuccess = useCallback(() => setExportSuccess(null), []);
  // A panel celebrating last design's export makes no sense once the visitor
  // has moved on to a different one: dismiss it on any design switch, however
  // it happened (picker, external URL state, hash navigation). Adjusted
  // during render (the previous-value pattern, as useOutputConsole's edge
  // checks do) rather than in an effect.
  const [exportSuccessDesignId, setExportSuccessDesignId] = useState(design.id);
  if (design.id !== exportSuccessDesignId) {
    setExportSuccessDesignId(design.id);
    setExportSuccess(null);
  }
  // `fromLink` skips the picker intro when the hash already names a design,
  // see shouldShowPopup. That also means a shared link never trips the boot
  // gate below: it renders what it was sent to render, immediately.
  const [showPopup, setShowPopup] = useState(() =>
    shouldShowPopup(popup, initialState.fromLink)
  );
  const closePopup = (remember: boolean) => {
    if (remember && popup) rememberPopup(popup);
    setShowPopup(false);
  };
  // A showing design chooser *is* the app's first screen: a grid of design
  // thumbnails with nothing chosen yet. Until the user picks, there is nothing
  // worth rendering, so the render path stays parked and leaves the network to
  // those thumbnails; see useRenderPipeline's `holdBoot`. `isDesignChooser` is
  // the same predicate PopupModal renders the gallery from, so the two cannot
  // disagree about what this popup is.
  const holdBoot = showPopup && isDesignChooser(popup);
  // Bumped by the popup's primary CTA to open the design picker (the obvious
  // first step). AppShell routes it to whichever layout's picker is visible.
  const [openPickerSignal, setOpenPickerSignal] = useState(0);
  const popupPrimary = (remember: boolean) => {
    closePopup(remember);
    if (schema.designs.length > 1) setOpenPickerSignal((n) => n + 1);
  };

  // File imports and the render pipeline are mutually coupled: imports feed
  // the render key, and an import must invalidate the render cache. The ref
  // breaks the ordering cycle: imports call the pipeline's latest invalidate
  // through it (same latest-wins idiom as the AppActions provider).
  const invalidateRef = useRef<() => void>(() => {});
  const { userFiles, addFile, removeFile, clearImportedFiles } = useFileImports({
    invalidate: useCallback(() => invalidateRef.current(), []),
    setAnnouncement,
  });
  // Every user-supplied file currently loaded (name + byte size). FilesModal's
  // own list. Derived here (not in AppShell) since FilesModal is hosted
  // alongside Help/Licenses/DesignDoc, not drilled through the layout split.
  const loadedFiles = useMemo(
    () => Object.entries(userFiles).map(([name, bytes]) => ({ name, size: bytes.byteLength })),
    [userFiles]
  );

  const {
    result,
    rendering,
    ready,
    progress,
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
    holdBoot,
    setAnnouncement,
  });
  invalidateRef.current = invalidate;

  // Fill the offline cache at the first moment nothing is competing for the
  // connection: installed/standalone, hidden, or the render worker's own
  // bootstrap having landed. The policy lives in `warmDelayMs`; `standalone`
  // recognises a launch of the installed app, `installed` the visit that
  // installed it.
  useOfflineWarmup({
    holdBoot,
    ready,
    committed: installed || standalone,
    updateWaiting: updateReady,
  });

  // Switching designs resets everything design-scoped in the same event:
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
  // applied to React state. Atomically, the same way a design switch is.
  // Performs the same design/values/preset reset handleDesignChange does, so
  // the render pipeline's epoch still advances and a stale render can never
  // land under the newly-applied design. Not shared with it, because the two
  // differ when the design is UNCHANGED (a launch carrying only new
  // values/preset): here that updates values/preset without disturbing
  // epoch/reset state a full design switch would otherwise clear for nothing.
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

  // Nothing is written while the chooser still owns the first screen. Not only
  // because there is no chosen state worth mirroring yet: `persistState` puts
  // `#d=<default>` in the URL, and on the next load `readInitialState` cannot
  // tell that hash from one a person sent, so it would report `fromLink` and
  // skip the chooser the user never answered. Leaving them on the default
  // design, permanently, after a reload.
  useEffect(() => {
    if (holdBoot) return;
    const t = setTimeout(() => persistState(design, values, presetSel), 300);
    return () => clearTimeout(t);
  }, [design, values, presetSel, holdBoot]);

  // M4: consume external navigations that only change the URL hash. A
  // same-document `hashchange` (e.g. a browser/OS "navigate to #d=..." that
  // doesn't reload the document) and the Web App Launch Handler's queued
  // target for an installed app opened via a manifest shortcut
  // (`navigate-existing`, see scripts/lib/pwa-assets.mjs). Neither fires a
  // full module reload, so without this the address bar/launch target would
  // update while the mounted app's design/value/preset state stays put.
  // `persistState` above writes via `history.replaceState`, which per spec
  // never fires `hashchange`, so there's no feedback loop from our own
  // writes; the equality check below is a defensive backstop against any
  // navigation that happens to already match current state (a no-op, not a
  // loop).
  // Read imperatively inside the effect below via refs (not effect deps), so
  // the hashchange/launchQueue subscription is set up once at mount rather
  // than being torn down and re-added on every keystroke: the effect only
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
      // A navigation that names a design answers the chooser's question, so stop
      // asking it: the same rule `shouldShowPopup` applies to a link at load,
      // including not remembering the skip (a notice is left alone: navigating
      // doesn't answer one). Deliberately BEFORE the equality guard below: a
      // launch shortcut or hash naming the design that is already current is a
      // state no-op, but it is not a chooser no-op. Treating it as one left the
      // chooser up and, with it, the render path parked.
      if (isDesignChooser(popup)) setShowPopup(false);
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
        /* malformed launch target: ignore */
      }
    });

    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Clear stale presets the instant the design changes (during render, not an
  // effect: the documented "adjusting state when a prop changes" pattern),
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

  // Warm the lazily-split modal chunks once the browser is idle, see
  // warmModalChunks. requestIdleCallback where it exists (not Safari <17), a
  // macrotask otherwise; either way this lands after first paint and after the
  // render worker has had its turn.
  useEffect(() => {
    const idle = window.requestIdleCallback;
    if (idle) {
      const handle = idle(warmModalChunks, { timeout: 2000 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(warmModalChunks, 1000);
    return () => window.clearTimeout(timer);
  }, []);

  const setValue = useCallback((name: string, value: ParamValue) =>
    setValues((v) => ({ ...v, [name]: value })), []);

  // The unified preset-diff baseline: the selected preset's values when one is
  // selected, else null (meaning "compare against defaults", see `baseline`
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
  // the UX plan, never a standing prompt.
  const offerInstallHint = useCallback(() => {
    if (!canInstall || installMode === "off") return;
    if (readLocal(INSTALL_HINT_KEY)) return;
    // Storage unavailable: skip the hint rather than risk repeating it.
    if (!writeLocal(INSTALL_HINT_KEY, "1")) return;
    toast(t("install.hint"), {
      id: "install-hint",
      duration: 12000,
      action: { label: t("install.action"), onClick: () => void promptInstall() },
      cancel: { label: t("install.dismiss"), onClick: () => {} },
    });
  }, [canInstall, promptInstall]);

  // Gated on `exportable` (a successful render that still matches the live
  // controls, not only "some render succeeded at some point") and named from
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
    if (outcome === "cancelled") return; // user dismissed the sheet: don't also download
    if (afterExportConfig) {
      // The panel is this deployment's one and only post-export surface: it
      // replaces the plain announcement toast entirely rather than stacking
      // with it (see the precedence rule below for the install hint too).
      exportSuccessKeyRef.current += 1;
      setExportSuccess({ key: exportSuccessKeyRef.current });
    } else {
      setAnnouncement(t(outcome === "shared" ? "toast.shared" : "toast.exported", { name }));
    }
    // The install-hint toast and the after-export panel are both "here's what
    // to do next" surfaces, never stack two of those on the same export.
    if (!afterExportConfig) offerInstallHint();
  }, [exportable, snapshot, offerInstallHint, setAnnouncement]);

  const savePng = useCallback(async (url: string) => {
    if (!exportable || !snapshot) return;
    const name = `${snapshot.designId}.png`;
    // The snapshot is a data: URL. Turn it into a File so it can go to the
    // native share sheet (like the model export); fall back to a download.
    const blob = await (await fetch(url)).blob();
    const outcome = await shareFileOrFallback(
      new File([blob], name, { type: blob.type || "image/png" }),
      () => download(url, name)
    );
    if (outcome === "cancelled") return;
    setAnnouncement(t(outcome === "shared" ? "toast.shared" : "toast.saved", { name }));
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
    // Built synchronously from the live design/values/preset, never from
    // `location.href`, which only reflects the last debounced `persistState`
    // write and can lag a recently made edit by up to 300ms.
    const url = buildShareUrl(design, values, presetSel);
    const warning = shareabilityWarning(shareability);
    // Native share sheet where available (mobile); otherwise copy to clipboard.
    // Either way, a local-only dependency gets an explicit warning naming the
    // missing files: the plain URL is copied/shared regardless (no upload;
    // see docs/architecture-review.md H2), but never silently implied complete.
    const outcome = await shareUrl(url, schema.title);
    if (outcome === "cancelled") return;
    if (outcome === "shared") {
      if (warning) setAnnouncement(warning);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setAnnouncement(warning ?? t("share.copied"));
    } catch {
      setAnnouncement(t("share.copyFailed"));
    }
  }, [design, values, presetSel, shareability, setAnnouncement]);

  const handleReset = useCallback(() => { setValues(defaultsFor(design)); setPresetSel(""); }, [design]);
  const showHelpModal = useCallback((tab?: string) => {
    setHelpInitialTab(tab);
    setShowHelp(true);
  }, []);
  const showDesignDocModal = useCallback(() => setShowDesignDoc(true), []);
  const showLicensesModal = useCallback(() => setShowLicenses(true), []);
  const showFilesModal = useCallback(() => setShowFiles(true), []);
  // Fallback for the lazy modal group's ErrorBoundary (below, in the JSX):
  // closes all four `showX` flags at once, since leaving any of them true
  // would immediately re-throw the same chunk-load failure on the next
  // render. Also wired as the fallback dialog's own Close button.
  const closeAllModals = useCallback(() => {
    setShowHelp(false);
    setShowDesignDoc(false);
    setShowLicenses(false);
    setShowFiles(false);
  }, []);

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
    showFiles: showFilesModal,
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
        <PopupModal
          popup={popup}
          onClose={closePopup}
          onPrimary={popupPrimary}
          designs={schema.designs}
          designId={designId}
          onDesignChange={handleDesignChange}
        />
      )}
      {/* Each of these four is lazy-loaded (see the module-scope `lazy()` calls
          above), so a single Suspense boundary covers the group: a pending
          chunk load suspends only this fragment, never AppShell or Toaster.
          The ErrorBoundary contains a failed chunk load (offline, an
          ad-blocked chunk URL, a stale hash after a deploy) to this fragment
          too, instead of letting `lazy()`'s throw reach the root boundary in
          main.tsx and replace the whole session over one optional dialog.
          `resetKey` is the four `showX` flags joined: any open/close changes
          the string, so dismissing a failure (which closes every modal, see
          closeAllModals) clears the boundary before the next open can retry.

          `fallback={null}` on the Suspense is deliberate, not a placeholder
          waiting for a spinner: `lazy()` suspends for one render pass even
          when warmModalChunks() already fetched the chunk (see above), so ANY
          visible fallback here would flash on every single modal open. */}
      <ErrorBoundary
        resetKey={`${showHelp}|${showDesignDoc}|${showLicenses}|${showFiles}`}
        fallback={
          <Modal title={t("error.modalTitle")} onClose={closeAllModals}>
            <div className={`${MODAL_BODY} flex flex-col gap-3`} role="alert">
              <p className="m-0 text-[0.9rem] text-foreground">{t("error.modalLoadFailed")}</p>
              <p className="m-0 text-[0.85rem] text-muted-foreground">
                {t("error.modalLoadFailedReason")}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  // The browser caches a rejected dynamic import for the
                  // document's lifetime, so an in-place retry can't re-fetch
                  // the chunk (see SvgPrepareControl.tsx's wizard fallback for
                  // the same reasoning), only a full reload re-requests it.
                  onClick={() => window.location.reload()}
                >
                  {t("error.reload")}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={closeAllModals}>
                  {t("common.close")}
                </Button>
              </div>
            </div>
          </Modal>
        }
      >
        <Suspense fallback={null}>
          {showHelp && (
            <HelpModal
              help={schema.help}
              onClose={() => setShowHelp(false)}
              canInstall={canInstall && installMode !== "off"}
              onInstall={promptInstall}
              initialTab={helpInitialTab}
            />
          )}
          {showDesignDoc && design.doc && (
            // Keyed on design.id so a design switch while the modal is open remounts
            // it fresh (idle -> loading state) instead of needing to reset state
            // imperatively inside the fetch effect.
            <DesignDocModal key={design.id} design={design} onClose={() => setShowDesignDoc(false)} />
          )}
          {showLicenses && (
            <LicensesModal
              versions={buildVersions}
              extra={schema.licenses}
              onClose={() => setShowLicenses(false)}
            />
          )}
          {showFiles && (
            <FilesModal
              fileImport={schema.fileImport ?? null}
              loadedFiles={loadedFiles}
              onRemoveFile={removeFile}
              onClearFiles={clearImportedFiles}
              onClose={() => setShowFiles(false)}
            />
          )}
        </Suspense>
      </ErrorBoundary>

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
          loadProgress={progress}
          autoRender={autoRender}
          stalePreview={stalePreview}
          exportable={exportable}
          theme={theme}
          themeMode={themeMode}
          themeNext={themeNext}
          openPickerSignal={openPickerSignal}
          introOpen={showPopup && !!popup}
          exportSuccess={exportSuccess}
          onDismissExportSuccess={dismissExportSuccess}
        />
      </AppActionsProvider>
    </>
  );
}
