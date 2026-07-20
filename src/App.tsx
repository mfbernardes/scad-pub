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
  hashDesignIdMissing,
  hashHasDesignId,
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
import { shouldOfferInstallHint, type ExportOutcomeKind } from "./lib/exportOutcome";
import { t } from "./lib/i18n";
import type { ExportSuccessState } from "./components/ExportSuccess";
import { toast } from "sonner";
import { AppActionsProvider, type AppActions } from "./lib/appActions";
import { AppShell } from "./components/AppShell";
import { Toaster } from "./components/ui/sonner";
import { LicensesModal } from "./components/LicensesModal";
import { HelpModal } from "./components/HelpModal";
import { DesignDocModal } from "./components/DesignDocModal";
import { PopupModal } from "./components/PopupModal";
import { DesignPickerDialog } from "./components/DesignPickerDialog";
import { UnifiedSelectorDialog } from "./components/UnifiedSelectorDialog";
import { rememberPopup, resolvePopupSurface, type PopupSurface } from "./lib/popup";

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
// PR9: the optional inline after-export success panel (ExportSuccess.tsx).
// Absent -> null -> the feature is off entirely, exportModel never sets any
// export-success state, and the install hint keeps its old behaviour below
// (see shouldOfferInstallHint's doc for the precedence rule this implies).
const afterExportConfig = schema.ui?.afterExport ?? null;
// First-vs-later show for the panel's auto-hide duration (see
// src/lib/exportOutcome.ts's afterExportAutoHideMs) — tracks "has this
// browser ever SEEN THE PANEL", independent of whether afterExport was
// configured at the time.
const afterExportFlag = makeOnceFlag("afterexport.v1");
// PR7: the card-grid DesignPickerDialog replaces the dropdown Select when
// `ui.gallery` is on — meaningless with zero/one design, so also require more
// than one. Computed once at module scope (like `popup`/`installMode` above)
// since it never changes at runtime.
const galleryEnabled = schema.ui?.gallery === true && schema.designs.length > 1;
// A stale/broken deep link (a `#d=<id>` naming a design this build doesn't
// have) — computed once from the hash the page loaded with, same source
// `readInitialState` already read above. Only meaningful when the dialog
// exists at all (`galleryEnabled`); the classic Select has no such recovery UI.
const initialBrokenLink = galleryEnabled && hashDesignIdMissing(schema, location.hash);
// Whether THIS load's hash already names a design at all (valid or not) — a
// deep link or share link, as opposed to a bare visit. Used below to keep
// the welcome design picker (`popup.mode: "picker"`) from showing to a
// visitor who already chose via a link — see resolvePopupSurface's doc.
const initialIsDeepLink = hashHasDesignId(location.hash);
// Wave 2 (guided shell, `ui.workflow: "guided"`): the ONE selector
// (UnifiedSelectorDialog) replaces DesignPickerDialog wherever a selector is
// shown — the design-name header button (always DesignPickerButton in guided
// mode — see CommandBar.tsx/GuidedMobileHeader.tsx), this build's own
// first-run auto-open (below), AND (round-5 Wave 2, item 1) the configurable
// popup's own `popup.mode: "picker"` first-run "welcome" surface (see the
// `popupSurface === "welcome"` branch further down) — DesignPickerDialog's
// separate two-step highlight-then-confirm welcome variant is now "tabs"
// workflow only. Independent of `galleryEnabled`: the unified selector also
// surfaces Examples/Saved, not just other designs, so it's worth opening
// even for a single-design build. Never affects "tabs" workflow, which keeps
// DesignPickerDialog/PresetPicker exactly as before.
const workflowGuided = schema.ui?.workflow === "guided";
// First run (no design chosen yet, no deep link, no popup already about to
// cover the same "what am I making" job): auto-open the unified selector on
// mount so a guided visitor lands on a deliberate choice instead of
// whatever `designs[0]` happens to be. Computed once here (not read from the
// `popupSurface` state below, which isn't resolved until inside the
// component) via the same resolvePopupSurface call that state's own
// initializer makes, so the two can never disagree about whether a popup is
// already covering this first-run moment.
const initialPopupSurface = resolvePopupSurface({ popup, galleryEnabled, isDeepLink: initialIsDeepLink });
const guidedFirstRunAutoOpen =
  workflowGuided && schema.designs.length > 1 && !initialIsDeepLink && initialPopupSurface === "none";

export default function App() {
  const { mode: themeMode, resolved: theme, cycle: cycleTheme } = useTheme();
  const { experienceMode, settingsView, setSettingsView } = useExperience();
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
  // Which Help tab to open straight to, set only via a deep-linked showHelp()
  // call (the after-export panel's "Printing guide" action) — see
  // AppActions.showHelp's doc and HelpModal's initialTab.
  const [helpInitialTab, setHelpInitialTab] = useState<string | undefined>(undefined);
  // The after-export panel's current state (null -> not shown). `key`
  // increments on every export so the panel's auto-hide timer restarts even
  // when two exports in a row land on the same outcome — see
  // ExportSuccess.tsx's own doc.
  const [exportSuccess, setExportSuccess] = useState<ExportSuccessState | null>(null);
  const exportSuccessKeyRef = useRef(0);
  const dismissExportSuccess = useCallback(() => setExportSuccess(null), []);
  const [showDesignDoc, setShowDesignDoc] = useState(false);
  // Which of the configurable popup's surfaces (none/classic/welcome) this
  // load should show — see resolvePopupSurface's own doc for the full
  // precedence (mode, design count, ui.gallery, deep-link skip, remembered
  // dismissal). Resolved once at mount; every path that dismisses either
  // surface below sets it back to "none".
  const [popupSurface, setPopupSurface] = useState<PopupSurface>(initialPopupSurface);
  const closePopup = (remember: boolean) => {
    if (remember && popup) rememberPopup(popup);
    setPopupSurface("none");
  };
  // Bumped by the popup's primary CTA to open the design picker (the obvious
  // first step). AppShell routes it to whichever layout's picker is visible.
  // Only meaningful for the classic Select (see DesignPicker.tsx); when
  // `galleryEnabled`, the CTA opens the DesignPickerDialog below instead.
  const [openPickerSignal, setOpenPickerSignal] = useState(0);
  // DesignPickerDialog / (guided workflow) UnifiedSelectorDialog: App owns
  // the shared open state, same as showHelp/showDesignDoc/showLicenses
  // above — see workflowGuided's own doc for why the two dialogs share this
  // one `showPicker` trigger rather than each owning a separate flag.
  // `pickerReason` carries why DesignPickerDialog opened uninvited (a stale
  // deep link) so it can show a short explanation just that once; any
  // deliberate open (button/CTA/⌘K) clears it. Wave 2's own uninvited-open
  // reason, guidedFirstRunAutoOpen, needs no such explanation (it's the
  // EXPECTED first-run state, not a recovery from a broken link), so it
  // isn't threaded into `pickerReason`.
  const [showPicker, setShowPicker] = useState(initialBrokenLink || guidedFirstRunAutoOpen);
  const [pickerReason, setPickerReason] = useState<"brokenLink" | null>(
    initialBrokenLink ? "brokenLink" : null
  );
  // Wave 2: which group UnifiedSelectorDialog lands on — "designs" for every
  // deliberate open (the header button, ⌘K, first-run auto-open — see
  // `openPicker` below, which always resets it), "examples" for the welcome
  // popup's own "Browse examples" action (see `browseExamples` below,
  // guided branch, which sets it explicitly right before opening).
  // Narrower than UnifiedSelectorDialog's own SelectorGroup (which also has
  // "saved"): App's setters only ever land on "designs" (openPicker) or
  // "examples" (browseExamples) — "saved" is reachable only via the dialog's
  // own internal segmented-row clicks, which live in its own `group` state,
  // not this one.
  const [selectorGroup, setSelectorGroup] = useState<"designs" | "examples">("designs");
  const openPicker = useCallback(() => {
    setPickerReason(null);
    setSelectorGroup("designs");
    setShowPicker(true);
  }, []);
  const closePicker = useCallback(() => setShowPicker(false), []);
  const popupPrimary = (remember: boolean) => {
    closePopup(remember);
    if (schema.designs.length > 1) {
      if (galleryEnabled || workflowGuided) openPicker();
      else setOpenPickerSignal((n) => n + 1);
    }
  };

  // ⌘K / Ctrl-K opens the design picker dialog from anywhere — a small power-
  // user affordance, only wired up when a dialog actually exists to open
  // (`galleryEnabled`, or `workflowGuided` — guided mode's UnifiedSelector is
  // always reachable via `showPicker`, independent of `ui.gallery`). Ignored
  // while typing in a field (so it doesn't interrupt entering a "k" into a
  // text/number param or the picker's own search box) or while any dialog is
  // already open (any Radix Dialog instance — help/licenses/doc/popup/the
  // picker itself — carries role="dialog"), so it can't stack a second modal
  // on top of one that's already up.
  useEffect(() => {
    if (!galleryEnabled && !workflowGuided) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      openPicker();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openPicker]);

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
    retainedResult,
    rendering,
    ready,
    loadProgress,
    engineDownloaded,
    renderedValues,
    renderMetrics,
    autoRender,
    setAutoRender,
    stalePreview,
    pauseReason,
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

  // A deliberate choice made through either DesignPickerDialog instance (the
  // welcome variant AND the regular ⌘K/top-bar one) — a thin wrapper over
  // handleDesignChange kept as its own name/identity so the picker call
  // sites read as "the user deliberately confirmed a choice in the dialog"
  // rather than the design-change plumbing itself.
  const pickDesign = useCallback(
    (id: string) => {
      handleDesignChange(id);
    },
    [handleDesignChange]
  );

  // UnifiedSelectorDialog's Examples/Saved groups applying a preset — lifted
  // out of the JSX below (matching openPicker/pickDesign/closePicker's own
  // useCallback pattern) so the dialog, wrapped in React.memo, doesn't
  // reconcile every time App re-renders for something unrelated.
  const applySelectorPreset = useCallback((v: Values, selectedId: string) => {
    setValues(v);
    setPresetSel(selectedId);
  }, []);

  // Bumped by the welcome design picker's "Browse examples" action to switch
  // AppShell's docked/sheet panel to the Presets tab — see AppShell's own
  // openExamplesSignal doc. Unused in guided workflow, which has no Presets
  // tab to switch to — the same action instead opens the unified selector
  // straight to its Examples group (see `browseExamples` below).
  const [openExamplesSignal, setOpenExamplesSignal] = useState(0);
  const browseExamples = useCallback(() => {
    if (workflowGuided) {
      // Opens UnifiedSelectorDialog straight to Examples — deliberately NOT
      // `openPicker()`, which always resets the group to "designs" (see its
      // own doc); this is the one caller that wants a different landing
      // group.
      setPickerReason(null);
      setSelectorGroup("examples");
      setShowPicker(true);
    } else {
      setOpenExamplesSignal((n) => n + 1);
    }
  }, []);

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

  const setValue = useCallback((name: string, value: ParamValue) => {
    setValues((v) => ({ ...v, [name]: value }));
  }, []);

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
    toast(t("app.installHintToast"), {
      id: "install-hint",
      duration: 12000,
      action: { label: t("app.installAction"), onClick: () => void promptInstall() },
      cancel: { label: t("app.notNow"), onClick: () => {} },
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
    // Only ever read/set post-export UI state (the panel or the toast) AFTER
    // this settles, so neither can ever appear over, or race, the share sheet.
    const outcome = await shareFileOrFallback(
      new File([blob], name, { type: blob.type }),
      () => downloadBlob(blob, name)
    );
    if (outcome === "cancelled") return; // user dismissed the sheet — don't also download
    // "fell-back" is a real browser download (shareFile was unsupported/
    // failed, so the fallback ran); "shared" is navigator.share() resolving.
    // See src/lib/exportOutcome.ts's file doc for why "shared" still maps to
    // the modest readyToShare wording rather than an overclaiming "completed".
    const kind: ExportOutcomeKind = outcome === "shared" ? "shared" : "downloaded";
    if (afterExportConfig) {
      // The panel is this deployment's one and only post-export surface (see
      // shouldOfferInstallHint's precedence doc below) — it replaces the
      // plain announcement toast entirely rather than stacking with it.
      const isFirstShow = !afterExportFlag.seen();
      afterExportFlag.remember();
      exportSuccessKeyRef.current += 1;
      setExportSuccess({ outcome: kind, key: exportSuccessKeyRef.current, isFirstShow });
    } else {
      setAnnouncement(outcome === "shared" ? t("app.sharedName", { name }) : t("app.exportedName", { name }));
    }
    // Precedence rule (src/lib/exportOutcome.ts): the install hint only ever
    // fires on a deployment that hasn't configured the after-export panel —
    // the simplest rule that can never stack the two on the same export.
    if (shouldOfferInstallHint(!!afterExportConfig)) offerInstallHint();
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
    setAnnouncement(outcome === "shared" ? t("app.sharedName", { name }) : t("app.savedName", { name }));
  }, [exportable, snapshot, setAnnouncement]);

  // Whether the CURRENT design/values/imports are fully described by a plain
  // share URL, and which local-only files are missing if not. Recomputed on
  // every change so `copyLink` never has to guess after the fact.
  // See docs/architecture-review.md H2.
  const shareability = useMemo(
    () => computeShareability(design, values, userFiles, schema.fontFaces ?? []),
    [design, values, userFiles]
  );

  // Shared by copyLink's clipboard fallback and copyLinkClipboard: write the
  // share URL to the clipboard and announce success (the shareability
  // warning, if any, takes priority) or failure.
  const copyUrlToClipboard = useCallback(
    async (url: string, warning: string | null) => {
      try {
        await navigator.clipboard.writeText(url);
        setAnnouncement(warning ?? t("app.copiedShareLink"));
      } catch {
        setAnnouncement(t("app.copyFailed"));
      }
    },
    [setAnnouncement]
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
    await copyUrlToClipboard(url, warning);
  }, [design, values, presetSel, shareability, setAnnouncement, copyUrlToClipboard]);

  // Clipboard-only variant of copyLink, for the export dock's "More" menu
  // (see ActionButtons.tsx): copyLink() reaches for the native OS share sheet
  // first on a capable device, which means the Share button never leaves a
  // plain clipboard copy reachable there — this action skips that branch
  // entirely so "Copy link" always lands the URL on the clipboard, regardless
  // of device.
  const copyLinkClipboard = useCallback(async () => {
    const url = buildShareUrl(design, values, presetSel);
    const warning = shareabilityWarning(shareability);
    await copyUrlToClipboard(url, warning);
  }, [design, values, presetSel, shareability, copyUrlToClipboard]);

  const handleReset = useCallback(() => { setValues(defaultsFor(design)); setPresetSel(""); }, [design]);
  const showHelpModal = useCallback((tab?: string) => {
    setHelpInitialTab(tab);
    setShowHelp(true);
  }, []);
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
    copyLinkClipboard,
    reset: handleReset,
    addFile,
    removeFile,
    clearFiles: clearImportedFiles,
    autoRenderChange: setAutoRender,
    cycleTheme,
    showHelp: showHelpModal,
    showDesignDoc: showDesignDocModal,
    showLicenses: showLicensesModal,
    showPicker: openPicker,
  };

  useAppNotices({
    bundleStale,
    forceUpdate,
    updateReady,
    applyUpdate,
    dismissUpdate,
    online,
    engineReady: ready,
    renderCompleted: result !== null,
    engineDownloaded,
  });

  return (
    <>
      {popupSurface === "classic" && popup && (
        <PopupModal
          // "picker" mode falls back to this classic modal only when it can't
          // show the picker itself (see resolvePopupSurface) — rendered here
          // with "dismissible" behaviour (a checkbox opt-out) rather than
          // "picker"'s own semantics, which PopupModal doesn't know how to
          // render. closePopup/popupPrimary still hash-remember against the
          // ORIGINAL configured popup (mode "picker"), not this display copy.
          popup={popup.mode === "picker" ? { ...popup, mode: "dismissible" } : popup}
          onClose={closePopup}
          onPrimary={popupPrimary}
        />
      )}
      {popupSurface === "welcome" && popup && (
        workflowGuided ? (
          // Wave 2 round-5 (item 1): guided workflow's first-run "welcome"
          // surface is now the SAME UnifiedSelectorDialog every later
          // selection uses (Designs/Examples/Saved in one dialog), not the
          // separate DesignPickerDialog-welcome two-step highlight-then-
          // confirm flow "tabs" workflow (below) still keeps. The popup's
          // own header/body/footnote become the dialog's heading/subtitle/
          // footer note (see UnifiedSelectorDialog's own `welcome` prop
          // doc); no separate "Browse examples" action is needed here — the
          // Examples group is just another tab in the same dialog. Picking a
          // design (or an example/saved setup) both applies the choice AND
          // remembers the popup dismissed, via the same `onClose`.
          <UnifiedSelectorDialog
            designs={schema.designs}
            design={design}
            bundled={bundledPresets}
            userPresets={userPresets}
            selectedPreset={presetSel}
            values={values}
            onSelectDesign={pickDesign}
            onApplyPreset={applySelectorPreset}
            onPresetsChange={refreshUserPresets}
            onClose={() => closePopup(true)}
            welcome={{
              heading: popup.header,
              subtitle: popup.body,
              footnote: popup.footnote,
            }}
          />
        ) : (
          <DesignPickerDialog
            designs={schema.designs}
            value={design.id}
            onSelect={(id) => {
              pickDesign(id);
              closePopup(true);
            }}
            onClose={() => closePopup(true)}
            welcome={{
              heading: popup.header,
              subtitle: popup.body,
              footnote: popup.footnote,
              onBrowseExamples: (id) => {
                pickDesign(id);
                closePopup(true);
                browseExamples();
              },
            }}
          />
        )
      )}
      {showHelp && (
        <HelpModal
          help={schema.help}
          onClose={() => {
            setShowHelp(false);
            setHelpInitialTab(undefined);
          }}
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
        <LicensesModal extra={schema.licenses} onClose={() => setShowLicenses(false)} />
      )}
      {showPicker && workflowGuided && (
        // Wave 2 (guided shell): the ONE selector — Designs/Examples/Saved —
        // in place of DesignPickerDialog. Opened by the header's design-name
        // button (always DesignPickerButton in guided mode), the first-run
        // auto-open (guidedFirstRunAutoOpen), and the welcome popup's own
        // "Browse examples" action (browseExamples, guided branch).
        <UnifiedSelectorDialog
          designs={schema.designs}
          design={design}
          bundled={bundledPresets}
          userPresets={userPresets}
          selectedPreset={presetSel}
          values={values}
          onSelectDesign={pickDesign}
          onApplyPreset={applySelectorPreset}
          onPresetsChange={refreshUserPresets}
          onClose={closePicker}
          initialGroup={selectorGroup}
        />
      )}
      {showPicker && !workflowGuided && (
        <DesignPickerDialog
          designs={schema.designs}
          value={design.id}
          onSelect={(id) => {
            pickDesign(id);
            closePicker();
          }}
          onClose={closePicker}
          reason={pickerReason}
        />
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
          retainedResult={retainedResult}
          rendering={rendering}
          ready={ready}
          loadProgress={loadProgress}
          autoRender={autoRender}
          stalePreview={stalePreview}
          pauseReason={pauseReason}
          exportable={exportable}
          theme={theme}
          themeMode={themeMode}
          openPickerSignal={openPickerSignal}
          openExamplesSignal={openExamplesSignal}
          settingsView={settingsView}
          experienceMode={experienceMode}
          exportSuccess={exportSuccess}
          onDismissExportSuccess={dismissExportSuccess}
        />
      </AppActionsProvider>
    </>
  );
}
