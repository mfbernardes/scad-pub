// AppShell.tsx — responsive layout shell. Owns the full-bleed viewer canvas with:
//   Desktop (≥ 860px): CommandBar + docked ParamPanel + ActionCluster + ViewerHUD
//   Mobile (< 860px):  full-bleed viewer + top bar + BottomSheet + floating ActionCluster
// Both layouts float the same compact action cluster over the viewer bottom —
// mobile no longer reserves a solid footer band. All state/logic stays in
// App.tsx; this is a pure view extraction (usePanelDerivedState.ts owns the
// panel-facing business state derived FROM that App.tsx state — attention,
// readiness, the checklist, … — see its own doc) plus one PanelDataProvider
// mount (src/lib/panelData.ts) that hands the derived bundle to both layouts'
// CustomizeTab/GettingStarted without threading it through ParamPanel/
// SheetTabs by hand.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Design, Schema } from "../openscad/types";
import type { Values, ParsedSet } from "../lib/presets";
import type { RenderResult, WorkerProgress } from "../openscad/types";
import type { RenderMetrics } from "../lib/renderMetrics";
import type { SettingsView, ExperienceMode } from "../lib/useExperience";
import type { PauseReason } from "../lib/renderState";
import type { ViewerHandle, Dimensions } from "./Viewer";
import { initialSheetDetent, reviewDetentOnEnter, reviewDetentOnLeave, sheetTopCapRatio } from "../lib/sheetDetent";
import { REVIEW_STEP_ID } from "../lib/quickStart";
import { makeOnceFlag, readPref, writePref } from "../lib/prefs";
import { GRID_PREF_KEY, initialGridVisible } from "../lib/viewerPrefs";
import { pauseReasonText } from "../lib/pauseReason";
import { t } from "../lib/i18n";
import { usePanelDerivedState } from "../lib/usePanelDerivedState";
import { useSignal } from "../lib/useSignal";
import { noticeAttentionCount } from "../lib/readiness";

// Peek shows just the drag handle + the tab bar (Presets/Parameters/Files),
// ending at the tab underline — no sliver of the tab's content.
const PEEK_HEIGHT = 60;
// Stable empty-log identity so idle re-renders don't break memo'd children.
const EMPTY_LOG: string[] = [];
// The floating action cluster — a compact card housing ActionButtons' two
// rows (primary Download + split trigger, then Share/More). Desktop docks it
// at the viewer's lower right; mobile collapses it to a single row between
// the preview and the sheet — see index.css's `.action-cluster`/
// `.action-row--*` doc for why the flex-direction/display swap that does
// that lives entirely in CSS (a Tailwind utility here for the very
// properties that swap per breakpoint would lose to the responsive override
// every time — cascade layers put `@layer utilities` ahead of the app's own
// `@layer components` regardless of specificity or media-query scoping).
// Only genuinely breakpoint-INVARIANT decoration stays here as Tailwind
// utilities (the card chrome); layout that differs by breakpoint (direction,
// display, flex-basis) is pure CSS on the `.action-cluster`/`.action-row--*`
// hooks below.
const ACTION_CLUSTER_CLASS =
  "action-cluster gap-2 rounded-(--radius-card) border-(color:--glass-border) border bg-(--glass-bg) px-[0.5rem] py-[0.5rem] shadow-(--shadow-2)";
// Wraps the action cluster (and, when present, the after-export panel riding
// above it) — see .action-dock in index.css for the shared bottom-anchored
// positioning both layouts used to put directly on .action-cluster. Anchoring
// the WRAPPER's bottom edge, not the cluster's own, means the cluster's own
// screen position never moves when the panel appears/disappears above it: the
// box just grows upward, since its height is auto and only its bottom edge is
// pinned. Alignment (right-aligned on desktop, centered on mobile) is pure
// CSS too, for the same cross-layer-override reason as ACTION_CLUSTER_CLASS.
const ACTION_DOCK_CLASS = "action-dock flex flex-col gap-2";
// One-time onboarding hint gate for the sheet handle (see sheetHintVisible
// below) — a fresh key, distinct from the pre-existing hint.* i18n strings it
// reuses text from, so it never collides with an unrelated once-flag.
const sheetHintFlag = makeOnceFlag("hint.sheet.v1");
// How long the sheet-handle hint stays up before auto-dismissing if the
// visitor never touches the handle.
const SHEET_HINT_TIMEOUT_MS = 5000;

import { CommandBar } from "./CommandBar";
import { ParamPanel } from "./ParamPanel";
import { ActionButtons } from "./ActionButtons";
import { ExportSuccess, type ExportSuccessState } from "./ExportSuccess";
import { ExportAttention } from "./ExportAttention";
import { OutputToggle } from "./OutputToggle";
import { BarActions } from "./BarActions";
import { IconButton, ICON_BUTTON_CLASS } from "./IconButton";
import { BookOpen as GuideIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { ViewerStage } from "./ViewerStage";
import { ViewerHUD } from "./ViewerHUD";
import { DEFAULT_VIEW, type ViewName } from "./views";
import { computeViewerInsets, GUIDED_REVIEW_FIT } from "./framing";
import { OutputConsole } from "./OutputConsole";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { BottomSheet, type SheetDetent } from "./BottomSheet";
import { SheetTabs } from "./SheetTabs";
import { DesignPicker } from "./DesignPicker";
import { DesignPickerButton } from "./DesignPickerButton";
import { GuidedMobileHeader } from "./GuidedMobileHeader";
import { ImportedFilesModal } from "./ImportedFilesModal";
import { BarBrand } from "./BarBrand";
import { parseDiagnostics, countBadges } from "../lib/diagnostics";
import { parseComputedInfo } from "../lib/computedInfo";
import { parseDisplayRows } from "../lib/displayRows";
import { parseReviewOverrides } from "../lib/reviewOverrides";
import {
  fontFaces,
  fontFamilyNames,
  mergeInstalledFonts,
  normalizeFamily,
  type FontFaceInfo,
} from "../lib/fonts";
import { isFontFile } from "../openscad/renderArgs";
import { useAppActions } from "../lib/appActions";
import { useIsMobile } from "../lib/useIsMobile";
import { useSafeAreaBottom } from "../lib/useSafeAreaBottom";
import { usePanelState, type PanelTab } from "../lib/usePanelState";
import { PARAM_SEARCH_INPUT_ID } from "./ParamSearch";
import { PanelDataProvider, type PanelData } from "../lib/panelData";

interface Props {
  schema: Schema;
  design: Design;
  designs: Design[];
  values: Values;
  /** Values behind the current render — what the measurements panel reads. */
  renderedValues: Values;
  /** Local-only render performance telemetry, shown in the Output console's Metrics tab. */
  renderMetrics: RenderMetrics;
  bundled: ParsedSet[];
  userPresets: string[];
  selectedPreset: string;
  /** The selected preset's values, or null when no preset is selected (baseline is defaults). */
  presetBaseline: Values | null;
  /** The selected preset's display name, or null when no preset is selected. */
  presetName: string | null;
  /** Values the current params are diffed against — presetBaseline, or design defaults. */
  baseline: Values;
  /** Names of params whose value differs from `baseline`. */
  changedParams: Set<string>;
  userFiles: Record<string, Uint8Array>;
  result: RenderResult | null;
  /** The last successful render kept on display while the LATEST render
   *  failed (see renderState.ts's retainedResultAfterFailure) — null whenever
   *  the latest render succeeded, or no same-design success exists to keep.
   *  Display-only: `exportable` below is untouched by it. */
  retainedResult: RenderResult | null;
  rendering: boolean;
  ready: boolean;
  /** The render worker's bootstrap-download progress, or null once ready (or
   *  when nothing was ever downloaded — a warm Cache Storage hit). Flows to
   *  ViewerStage's pre-first-render loading overlay. */
  loadProgress: WorkerProgress | null;
  autoRender: boolean;
  stalePreview: boolean;
  /** Why live preview is currently paused ("heavy" brake / "manual-design"
   *  start / null — see renderState.ts's PauseReason doc). Flows to
   *  ViewerStage -> StaleBanner's explanation line and into the Messages
   *  Notices list below. */
  pauseReason: PauseReason;
  /** A successful render that still matches the live controls — the only
   * state Download/Image may act on. See docs/architecture-review.md H1. */
  exportable: boolean;
  theme: "dark" | "light";
  themeMode: "light" | "dark" | "auto";
  /** Incremented by the intro popup's primary CTA to open the design picker. */
  openPickerSignal: number;
  /** Incremented by the welcome design picker's "Browse examples" action
   *  (`popup.mode: "picker"`) to switch to the Presets/Examples tab — desktop's
   *  docked panel tab, or the mobile sheet raised to Half so it's visible. */
  openExamplesSignal: number;
  /** Essentials/all settings-view (see src/lib/useExperience.ts). Flows down
   *  to the Customize tab in both layouts; the setter joins AppActions. */
  settingsView: SettingsView;
  /** Guided/standard experience mode (see src/lib/useExperience.ts). Also
   *  gates the getting-started checklist and the viewer gesture hint below,
   *  in addition to the mobile sheet's initial-detent policy (sheetDetent.ts). */
  experienceMode: ExperienceMode;
  /** Real, session-scoped progress facts the getting-started checklist reads
   *  (src/lib/checklist.ts) — owned by App.tsx since they must also be
   *  readable from the Help modal's replay row, a sibling of AppShell. See
   *  the checklistState computation below for how they combine with
   *  schema/render state already available here. */
  checklistProgress: {
    designChanged: boolean;
    paramInteracted: boolean;
    exported: boolean;
  };
  /** Bumped by the Help modal's "show the checklist again" row to clear the
   *  dismiss flag and bring GettingStarted back — see its own doc. */
  checklistReplaySignal: number;
  /** The after-export panel's current state (null -> not shown: no export
   *  yet, `ui.afterExport` isn't configured, or it was dismissed/auto-hid).
   *  Owned by App.tsx (like checklistProgress) since exportModel is what
   *  actually knows the real export outcome. See ExportSuccess.tsx. */
  exportSuccess: ExportSuccessState | null;
  onDismissExportSuccess: () => void;
}

export const AppShell = memo(function AppShell({
  schema,
  design,
  designs,
  values,
  renderedValues,
  renderMetrics,
  bundled,
  userPresets,
  selectedPreset,
  presetBaseline,
  presetName,
  baseline,
  changedParams,
  userFiles,
  result,
  retainedResult,
  rendering,
  ready,
  loadProgress,
  autoRender,
  stalePreview,
  pauseReason,
  exportable,
  theme,
  themeMode,
  openPickerSignal,
  openExamplesSignal,
  settingsView,
  experienceMode,
  checklistProgress,
  checklistReplaySignal,
  exportSuccess,
  onDismissExportSuccess,
}: Props) {
  const actions = useAppActions();
  const desktopViewerRef = useRef<ViewerHandle>(null);
  const mobileViewerRef = useRef<ViewerHandle>(null);
  // The mobile layout root — its --sheet-follow-h CSS var sizes the viewer so it
  // tracks the sheet live (see handleSheetFollow / .app-shell__mobile-viewer).
  const mobileRootRef = useRef<HTMLDivElement>(null);
  // Only the active layout mounts a Viewer (the other layout is CSS-hidden), so
  // we never run two three.js renderers / RAF loops / STL parses at once.
  const isMobile = useIsMobile();
  // The active Viewer's bounding-box size (mm), reported via onMeasure. Local
  // viewer glue like the PNG-snapshot handler — it needs the viewer, not App.
  const [measured, setMeasured] = useState<Dimensions | null>(null);
  // Whether the viewer overlays arrowed W×D×H dimension lines on the model, plus
  // the top-left measurements panel (bounding box + per-design @info). Off by
  // default; the HUD ruler toggle turns it on. Shared across both layouts so the
  // choice survives a desktop⇄mobile breakpoint switch.
  const [showDimensions, setShowDimensions] = useState(false);
  const toggleDimensions = useCallback(() => setShowDimensions((v) => !v), []);
  // Whether the viewer's reference grid is drawn — off by default (the
  // product-stage look has no visible CAD grid; see docs/config.md's
  // ui.grid). A persisted preference wins ahead of the config default on
  // every visit after the first change (src/lib/viewerPrefs.ts mirrors
  // useExperience.ts's own persisted-pref-then-config-then-fallback shape).
  const [showGrid, setShowGrid] = useState(() => initialGridVisible(readPref(GRID_PREF_KEY), schema));
  const toggleGrid = useCallback(() => {
    setShowGrid((v) => {
      const next = !v;
      writePref(GRID_PREF_KEY, next ? "on" : "off");
      return next;
    });
  }, []);
  // The active camera view. Driving it as state (shared across layouts) keeps the
  // picker's highlight and a freshly-mounted Viewer in step; the imperative snap
  // below re-applies it on every pick, including the current one.
  const [view, setView] = useState<ViewName>(DEFAULT_VIEW);
  // The sheet sits directly on the viewport bottom now (no docked footer band),
  // reserving only the iOS home-indicator inset below itself so its peek row
  // clears the gesture bar. Its JS geometry must match that CSS bottom offset.
  // Off-iOS the inset is 0.
  const safeAreaBottom = useSafeAreaBottom();
  const [outputOpen, setOutputOpen] = useState(
    schema.ui?.outputDefault === "open"
  );
  const outputOpenRef = useRef(outputOpen);
  outputOpenRef.current = outputOpen;
  // Sheet detent state (peek/half/full). On mobile the output overlay now covers
  // the sheet, so it no longer has to be positioned relative to the detent.
  // Initial value: the guided+half policy (sheetDetent.ts) — Peek unless the
  // visitor is in guided experience, the config opts in
  // (ui.experience.mobileInitialSheet === "half"), and the viewport is tall
  // enough not to be a landscape-short phone. Desktop mounts never read this
  // state at all (isMobile below gates which layout renders), so evaluating
  // it here unconditionally costs nothing when the initial viewport is
  // desktop-sized.
  const [sheetDetent, setSheetDetent] = useState<SheetDetent>(() =>
    initialSheetDetent(experienceMode, schema, window.innerHeight)
  );

  // One-time "Drag up for all settings" hint on the sheet handle: shown only
  // when the guided+half policy actually landed the sheet at Half on this
  // mount AND the visitor hasn't seen it before (sheetHintFlag). Computed
  // once at mount (sheetDetent's own initializer already resolved the
  // policy) — a later detent change or config change never re-arms it this
  // session.
  const [sheetHintVisible, setSheetHintVisible] = useState(
    () => sheetDetent === "half" && !sheetHintFlag.seen()
  );
  // Dismiss the hint and remember it was seen, so it never shows again on a
  // later visit. Safe to call unconditionally (e.g. on every detent change,
  // every handle touch) — a no-op once already dismissed.
  const dismissSheetHint = useCallback(() => {
    setSheetHintVisible((visible) => {
      if (visible) sheetHintFlag.remember();
      return false;
    });
  }, []);
  // Auto-dismiss after a few seconds if the visitor never touches the handle,
  // so the hint doesn't linger indefinitely over the model.
  useEffect(() => {
    if (!sheetHintVisible) return;
    const timer = setTimeout(dismissSheetHint, SHEET_HINT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [sheetHintVisible, dismissSheetHint]);

  // Wave 1 (guided workflow, PR-guided): the QuickStart step id currently
  // active, mirrored UP from QuickStart's own internal navigation state via
  // its `onActiveStepChange` prop (see panelData below) rather than owned by
  // QuickStart's parent as controlled state — QuickStart keeps its existing
  // navigation mechanics (visited set, scroll-spy, focus handling) entirely
  // to itself; this is purely a read-only mirror so CustomizeTab (stage-
  // scoped suppression), ParamPanel/SheetTabs (hiding PanelFooter on
  // Review), and this component's own mobile-detent effect below can react
  // to "which stage is active" without re-implementing QuickStart's step
  // resolution. QuickStart notifies via `useLayoutEffect` (not `useEffect`)
  // so the mirror lands in the SAME synchronous commit as the step change,
  // before the browser paints — no visible flash of e.g. the Advanced
  // toggle on the wrong stage. Starts null (no stepped design showing yet,
  // or QuickStart hasn't mounted).
  const [activeStepId, setActiveStepId] = useState<string | null>(null);

  // Wave 1: the export dock's "download while unresolved issues exist"
  // guided-workflow confirmation flow — see `handleDownloadClick` and
  // QuickStart's guided Review stage. Cleared automatically once the
  // attention that triggered it resolves itself, so a stale confirmation can
  // never linger after the visitor fixes the underlying issue some other way
  // (e.g. importing the missing font from the contextual warning card).
  const [downloadConfirmPending, setDownloadConfirmPending] = useState(false);

  // Panel tab + search state (see M7): hoisted here — above the desktop/mobile
  // split below — so ONLY the active layout mounts (ParamPanel or SheetTabs,
  // never both), yet a breakpoint change (or a real rotation) doesn't reset
  // the tab, clear the search box, or drop focus, since neither component owns
  // this state locally anymore.
  const panelState = usePanelState(bundled.length > 0);
  // Restore keyboard focus to the search input across a layout switch (M7
  // fully swaps the mounted tree — desktop <-> mobile — so the search input
  // is a BRAND NEW DOM node either way, even though it keeps the same
  // #param-search-input id).
  //
  // "Was it focused" is captured synchronously DURING RENDER, not via
  // ParamSearch's onFocus/onBlur populating a ref for a later effect to
  // read — that raced the OLD input's removal: unmounting a focused element
  // fires a synchronous "blur" as part of the very same commit that swaps
  // the tree, which could clear such a ref before the effect ever got to
  // read it (observed as an intermittent smoke-test flake, not just a test
  // artifact — a real user could lose the restore on the same timing).
  // `document.activeElement` during render still reflects the OLD tree —
  // nothing is mutated until after render completes — so this is the one
  // point that's guaranteed race-free. Mirrors the "adjust state during
  // render" idiom already used elsewhere (e.g. ParamRows' design-identity
  // reset, QuickStart's own current-step reconciliation).
  const wasMobileRef = useRef(isMobile);
  const restoreSearchFocusRef = useRef(false);
  if (wasMobileRef.current !== isMobile) {
    wasMobileRef.current = isMobile;
    // ||=, not =: the media-query path below may already have flagged the
    // restore before this render ever ran (see onParamSearchHiddenBlur).
    if (document.activeElement?.id === PARAM_SEARCH_INPUT_ID) restoreSearchFocusRef.current = true;
  }
  // The render-time capture above has a hole: the layouts are ALSO gated by a
  // CSS media query (index.css hides .app-shell__mobile/__desktop at the same
  // 860px breakpoint React switches on). On a viewport resize the browser's
  // style recalc can hide the focused input — blurring it to <body> — BEFORE
  // React's matchMedia listener gets to render, so the capture reads <body>
  // and the restore never fires (an intermittent, scheduling-dependent loss a
  // real user hits too). Detect that exact case at the blur itself: a blur
  // whose target is still mounted but no longer rendered (no client rects)
  // can only mean "hidden out from under the user", never a deliberate
  // focus move — flag it, and let the same layout effect below consume it.
  const onParamSearchHiddenBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    if (e.target.getClientRects().length === 0) restoreSearchFocusRef.current = true;
  }, []);
  // Layout effect so the restore fires after the new layout's DOM is
  // committed, before the browser paints — otherwise the switch would
  // visibly drop focus to <body> for a frame even when it does recover.
  useLayoutEffect(() => {
    if (!restoreSearchFocusRef.current) return;
    restoreSearchFocusRef.current = false;
    document.getElementById(PARAM_SEARCH_INPUT_ID)?.focus();
  }, [isMobile]);

  // F2: a Radix tab switch (Presets/Parameters/Files) unmounts the OLD tab's
  // content — including a focused search input, if the old tab happened to
  // be Parameters — which fires a blur on that input whose target ends up
  // with zero client rects, EXACTLY the signature onParamSearchHiddenBlur
  // above treats as "hidden out from under the user by a breakpoint flip".
  // Left alone, that tab-switch blur would set restoreSearchFocusRef just
  // like a real breakpoint flip does, and the flag would sit there armed
  // until the NEXT desktop<->mobile switch — stealing focus back to a search
  // box the visitor deliberately navigated away from by switching tabs, not
  // by a device rotation. Every tab change (both direct clicks in
  // ParamPanel/SheetTabs and AppShell's own programmatic switches — see
  // handleReviewSettings/handleReviewHiddenSettings below) is routed through
  // this wrapper instead of panelState.setTab directly, so the flag can never
  // survive a genuine tab switch.
  const setPanelTab = useCallback((tab: PanelTab) => {
    restoreSearchFocusRef.current = false;
    panelState.setTab(tab);
  }, [panelState]);

  // M16: at the Full sheet detent the sheet visually covers the mobile
  // background (top bar + viewer + floating controls), so treat that detent
  // as modal — mark the background `inert` (removes it from both the tab
  // order and the accessibility tree) so keyboard/AT users can't reach a
  // covered control. BottomSheet handles the complementary half: trapping
  // focus inside the sheet and restoring it on close. Non-modal at
  // peek/half, where the background stays fully reachable.
  const mobileBackgroundRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mobileBackgroundRef.current;
    if (!el) return;
    if (isMobile && sheetDetent === "full") el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }, [isMobile, sheetDetent]);

  // Mobile sheet hierarchy (dir 10): two deliberate-action triggers that may
  // raise a Half sheet to Full — Full is otherwise reserved for an explicit
  // drag (see BottomSheet's own doc: "FULL only on deliberate action").
  //
  // 1) Explicit "All settings" selection (SettingsViewToggle, inside
  //    CustomizeTab): the classic filtered form it reveals is taller than
  //    QuickStart's one-step slice, so Half's ~52vh reads as cramped the
  //    moment it appears. Only on a genuine essentials -> all TRANSITION
  //    (not e.g. already being in "all" when the sheet happens to open at
  //    Half) — mirrors GettingStarted's own "adjust state during render,
  //    guard against re-firing on an unrelated render" idiom, just as an
  //    effect since this reads two independent pieces of state (settingsView
  //    from PanelDataContext's bundle above, sheetDetent local to this
  //    component).
  const prevSettingsViewRef = useRef(settingsView);
  useEffect(() => {
    const was = prevSettingsViewRef.current;
    prevSettingsViewRef.current = settingsView;
    if (isMobile && was !== "all" && settingsView === "all" && sheetDetent === "half") {
      setSheetDetent("full");
    }
  }, [isMobile, settingsView, sheetDetent]);

  // 2) Focusing a text-entry control while the sheet is at Half: the
  //    on-screen keyboard can cover most of Half's own height, hiding the
  //    very field the visitor just tapped. Scoped to the sheet's own content
  //    (#params-mobile, set below) so a focus elsewhere (there is currently
  //    nothing else focusable outside the sheet that isn't a plain button)
  //    can never trigger this. Deliberately simple, per the milestone brief
  //    ("keep it simple and non-jumpy"): no viewport-occlusion math, no
  //    debounce — a focus event already only fires once per genuine focus
  //    move, so this can't thrash.
  useEffect(() => {
    if (!isMobile || sheetDetent !== "half") return;
    const isTextEntry = (el: Element) =>
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLInputElement &&
        ["text", "search", "email", "url", "tel", "number", "password"].includes(el.type));
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof Element) || !isTextEntry(target)) return;
      if (!document.getElementById("params-mobile")?.contains(target)) return;
      setSheetDetent("full");
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [isMobile, sheetDetent]);

  const ui = schema.ui ?? {};
  const panelSide = ui.panelSide ?? "left";
  const panelDefaultOpen = (ui.panelDefault ?? "open") === "open";
  // Variable names are developer detail — hidden unless a config opts in.
  const showVarName = ui.showVarName === true;
  // Configurable tab/section labels (default to the built-in names).
  const presetsLabel = ui.presetsLabel ?? t("panel.defaultPresetsLabel");
  const parametersLabel = ui.parametersLabel ?? t("panel.defaultParametersLabel");
  // Whether the viewer offers the measure (dimensions) toggle. Off hides the HUD
  // ruler button; the overlay + panel are only reachable through it, so they
  // stay hidden too.
  const showMeasure = ui.measure !== false;
  // Whether the viewer offers the view picker (camera-angle menu).
  const showViewPicker = ui.viewPicker !== false;
  // Whether the viewer offers the "reset view" button.
  const showReset = ui.reset !== false;
  // Whether the viewer offers the zoom in/out buttons (off by default).
  const showZoom = ui.zoom === true;
  // Whether the viewer offers the fullscreen toggle (where it works at all).
  const showFullscreen = ui.fullscreen !== false;
  // The after-export panel's config overrides (title/body/helpTab), if any —
  // see ExportSuccess.tsx. Absent -> the panel is off, so `exportSuccess`
  // (App.tsx's state) is always null in that case too.
  const afterExport = ui.afterExport ?? null;
  // Guided-only surfaces: the getting-started checklist (config can opt out
  // even in guided mode via `ui.checklist: false`) and the viewer gesture
  // hint (no config switch — it's a single short-lived chip, not standing
  // chrome). Both stay off entirely in standard experience.
  const guided = experienceMode === "guided";
  const showChecklist = guided && ui.checklist !== false;
  const showGestureHint = guided;
  // QuickStart's build-time opt-out (see docs/config.md's `ui.quickStart`) —
  // default true, since declaring `@step` sections on a design is itself the
  // opt-in. Threaded to CustomizeTab (via ParamPanel/SheetTabs), which also
  // gates on experienceMode/settingsView/design.steps — see quickStartAvailable.
  const quickStartEnabled = ui.quickStart !== false;
  // Wave 1's product-workflow flag (default "tabs" — today's behavior,
  // unchanged). "guided" activates the guided-workflow Customize-panel
  // internals/Review/export/mobile-detent behavior below, wherever
  // QuickStart is already showing — see docs/config.md's `ui.workflow`.
  const workflowMode = ui.workflow ?? "tabs";
  const workflowGuided = workflowMode === "guided";

  // Wave 1 (guided workflow): the active QuickStart step becoming Review on
  // mobile raises the sheet to its own taller "review" detent (model still
  // visible above it — see sheetDetent.ts's SheetDetent doc); leaving Review
  // restores Half. Both directions are no-ops in tabs mode (workflowGuided
  // stays false there) and a no-op whenever the sheet isn't at the detent
  // the other direction would expect (reviewDetentOnEnter/reviewDetentOnLeave
  // each leave a deliberately-different current detent untouched — see their
  // own doc, e.g. a visitor who dragged to Full manually keeps that choice).
  useEffect(() => {
    if (!isMobile || !workflowGuided) return;
    if (activeStepId === REVIEW_STEP_ID) setSheetDetent((d) => reviewDetentOnEnter(d));
    else setSheetDetent((d) => reviewDetentOnLeave(d));
  }, [isMobile, workflowGuided, activeStepId]);

  // Wave 2 (guided shell): the persistent mobile header's own DOM node (fed
  // to BottomSheet's `extraTrapContainerRef` so its controls stay reachable
  // by Tab even while the sheet is Full — see GuidedMobileHeader's own doc)
  // and its live-measured height (fed to BottomSheet's `topInset`, and
  // mirrored onto --guided-header-h so the mobile viewer's own CSS can start
  // below it — see .app-shell__mobile--guided in index.css). Both stay at
  // their initial values (null / 0) in "tabs" workflow, where the header
  // never mounts.
  const guidedHeaderRef = useRef<HTMLDivElement | null>(null);
  const [guidedHeaderH, setGuidedHeaderH] = useState(0);
  const handleGuidedHeaderHeight = useCallback((px: number) => {
    setGuidedHeaderH(px);
    mobileRootRef.current?.style.setProperty("--guided-header-h", `${px}px`);
  }, []);

  // Wave 2 (guided shell): "Imported files" — reached from the mobile
  // header's overflow menu and (see the desktop JSX below) an icon button on
  // the command bar, never from primary navigation. Reuses FileBar's own
  // list/remove/clear markup (ImportedFilesModal.tsx) — see DO item 4's own
  // doc in the milestone brief for why font/SVG import itself moved inline
  // to each param's own control instead of staying here.
  const [importedFilesOpen, setImportedFilesOpen] = useState(false);
  const openImportedFiles = useCallback(() => setImportedFilesOpen(true), []);
  const closeImportedFiles = useCallback(() => setImportedFilesOpen(false), []);

  const log = result?.log ?? EMPTY_LOG;
  // Memoized so a config without `notices` doesn't hand a fresh `[]` to the
  // useMemo hooks below on every render.
  const notices = useMemo(() => schema.notices ?? [], [schema.notices]);
  const fileImport = schema.fileImport ?? null;
  const loadedFiles = useMemo(
    () => Object.entries(userFiles).map(([name, bytes]) => ({ name, size: bytes.byteLength })),
    [userFiles]
  );

  // The set of font families the renderer can actually use: bundled families
  // (parsed at build time) plus the embedded families of any imported font.
  // Normalised for case/space-insensitive matching. The font controls compare a
  // design's `font` value against this to flag a missing family (see ParamForm).
  const availableFontFamilies = useMemo(() => {
    const set = new Set((schema.fontFamilies ?? []).map(normalizeFamily));
    for (const [name, bytes] of Object.entries(userFiles)) {
      if (isFontFile(name))
        for (const fam of fontFamilyNames(bytes)) set.add(normalizeFamily(fam));
    }
    return set;
  }, [schema.fontFamilies, userFiles]);
  // A bundled family to offer as a one-click fallback when the selected font
  // isn't loaded. Always available, so it can never itself be missing.
  const fontSuggestion = (schema.fontFamilies ?? [])[0] ?? null;
  // Every face the renderer can actually use, display-ordered: the bundled
  // faces (parsed at build time into schema.fontFaces) merged with the faces of
  // any imported font — so the font selector's list updates the moment a font
  // is imported. Feeds ParamForm's FontSelect.
  const installedFonts = useMemo(() => {
    const imported: FontFaceInfo[] = [];
    for (const [name, bytes] of Object.entries(userFiles)) {
      if (isFontFile(name)) imported.push(...fontFaces(bytes));
    }
    return mergeInstalledFonts(schema.fontFaces ?? [], imported);
  }, [schema.fontFaces, userFiles]);

  // Parse the log once here; the OutputConsole (Notices tab count chips) reads
  // this derived data instead of re-parsing it. Kept as the RAW model
  // diagnostics — the auto-open/auto-close effects below (hasNotices,
  // hasProblem) intentionally key off this, not outputDiagnostics, so a
  // pause explanation (which is about the render pipeline, not the model)
  // never itself triggers those transitions.
  const diagnostics = useMemo(() => parseDiagnostics(log, notices), [log, notices]);
  const badges = useMemo(() => countBadges(log, notices), [log, notices]);

  // The panel-facing business state derived from the above (attention,
  // readiness, the getting-started checklist, the hidden-advanced-diff, the
  // friendly render-failure summary, and whether QuickStart is the active
  // guide) — see usePanelDerivedState.ts for the derivation itself and each
  // field's own doc. Threaded to ParamPanel/SheetTabs (and, through them,
  // CustomizeTab/GettingStarted) and to OutputConsole below.
  const {
    attention,
    readiness,
    reviewStale,
    nonBlockingNoticeCount,
    checklistState,
    hiddenDiff,
    friendlyError,
    quickStartActive,
  } = usePanelDerivedState({
    design,
    values,
    availableFontFamilies,
    fontSuggestion,
    notices,
    badges,
    result,
    retainedResult,
    stalePreview,
    rendering,
    designCount: designs.length,
    checklistProgress,
    showChecklist,
    settingsView,
    experienceMode,
    quickStartEnabled,
  });

  // What OutputConsole's Notices tab actually renders: the model's own
  // diagnostics, plus — least-invasively, as an extra notice row rather than
  // a new console surface — an explanation of a paused live preview, so a
  // visitor who missed the StaleBanner's toast/explanation still finds the
  // "why" in Messages. Deliberately NOT folded into `diagnostics` itself
  // (see the comment above).
  const outputDiagnostics = useMemo(
    () => (pauseReason ? [{ level: "notice" as const, text: pauseReasonText(pauseReason) }, ...diagnostics] : diagnostics),
    [pauseReason, diagnostics]
  );
  // Rows from `echo("@info", label, unit, value)` — internally-calculated
  // values the design surfaced at render time (see lib/computedInfo.ts).
  const computedInfo = useMemo(() => parseComputedInfo(log), [log]);
  // Rows from `echo("@display", step, label, value)` — a design's own
  // generated-content preview surfaced at render time (see lib/displayRows.ts).
  const displayRows = useMemo(() => parseDisplayRows(log), [log]);
  // Param-name -> rendered-value overrides from `echo("@review", param,
  // value)` — the guided Review stage's curated summary shows these instead
  // of a param's raw stored value when present (see lib/reviewOverrides.ts).
  const reviewOverrides = useMemo(() => parseReviewOverrides(log), [log]);

  // Whether a previous successful render's geometry is genuinely still what
  // the viewer shows: exactly when the pipeline retained one (see
  // retainedResultAfterFailure — latest render failed, a same-design success
  // exists). ViewerStage displays that retained geometry (dimmed) whenever
  // this prop is non-null, so the friendly-error card's "your last working
  // preview is still shown" line is true precisely when it renders.
  const lastPreviewKept = !!retainedResult;

  // "Review settings" (FriendlyError's contextual action): switch to the
  // Customize tab and focus its search field — the same tab-switch state path
  // AppShell already uses to restore focus across a layout switch (see the
  // wasMobileRef effect above). Mobile also raises the sheet to half so the
  // panel is actually visible, mirroring the "Drag up for all settings" hint.
  const focusPanelSearch = useCallback(() => {
    requestAnimationFrame(() => {
      document.getElementById(PARAM_SEARCH_INPUT_ID)?.focus();
    });
  }, []);

  // Shared by every handler below that needs to land on the Customize tab:
  // switch to it, and (mobile only) raise the sheet to Half so the panel is
  // actually visible — the same two-step "get the panel on screen" pattern
  // each of these otherwise repeated inline.
  const openParamsTab = useCallback(() => {
    setPanelTab("params");
    if (isMobile) setSheetDetent("half");
  }, [setPanelTab, isMobile]);

  const handleReviewSettings = useCallback(() => {
    openParamsTab();
    focusPanelSearch();
  }, [openParamsTab, focusPanelSearch]);

  // "Browse examples" (the welcome design picker's secondary action, see
  // DesignPickerDialog's `welcome` prop): switch to the Presets tab —
  // desktop's docked panel tab, or the mobile sheet raised to Half so it's
  // actually visible, same policy as handleReviewSettings above just aimed
  // at Presets instead of Parameters.
  useSignal(openExamplesSignal, () => {
    setPanelTab("presets");
    if (isMobile) setSheetDetent("half");
  });

  // "Review hidden settings": the exact same action as CustomizeTab's own
  // "Review" chip (settingsViewChange("all") + focus the first hidden-diff
  // param) — but the button lives in FriendlyError, a sibling of CustomizeTab
  // (both descend from OutputConsole vs. ParamPanel/SheetTabs), so it can't
  // call CustomizeTab's internal reviewHiddenDiff() directly. Bumping this
  // nonce (mirroring DesignPicker's openSignal prop) is how AppShell tells
  // whichever CustomizeTab instance is mounted to run that same function —
  // see CustomizeTab's focusHiddenDiffSignal prop/effect.
  const [reviewHiddenSignal, setReviewHiddenSignal] = useState(0);
  const handleReviewHiddenSettings = useCallback(() => {
    openParamsTab();
    setReviewHiddenSignal((n) => n + 1);
  }, [openParamsTab]);

  // PR22: "Go to setting" from the Notices tab's own friendly attention cards
  // (see OutputConsole's attention prop) — closes Messages (the setting lives
  // on the Customize tab, not in the console) and mirrors CustomizeTab's own
  // attention chip action, reveal + focus the owning param's control.
  // Bumping this (name + nonce, mirroring QuickStart's own focusParam
  // request) is how AppShell tells whichever CustomizeTab instance is
  // mounted to run its internal focusOnParam(name) — see CustomizeTab's
  // focusAttentionParamSignal prop/effect.
  const [focusAttentionParam, setFocusAttentionParam] = useState<{ name: string; nonce: number } | null>(null);
  const handleGoToAttentionSetting = useCallback((name: string) => {
    setOutputOpen(false);
    openParamsTab();
    setFocusAttentionParam({ name, nonce: Date.now() });
  }, [openParamsTab]);

  // PR22: "Review" from the export dock's attention line (see ExportAttention
  // below) — jumps to wherever the visitor can actually resolve the gap:
  // QuickStart's own Review stage when it's the active guide (bumping this
  // nonce, mirroring reviewHiddenSignal above), or just the Customize tab
  // otherwise — its attention chip already sits pinned above the scrollable
  // form (see CustomizeTab.tsx), so simply switching tabs is enough there.
  //
  // Round-2 review item 4 fix: the click most commonly arrives while the
  // Presets (or Files) tab is showing — Customize/QuickStart isn't mounted
  // yet. Bumping the nonce in the SAME tick as openParamsTab() used to mean
  // QuickStart's very first mount already saw the bumped value: useSignal.ts
  // seeds its "last seen" ref from the value at mount, so a signal that's
  // already at its new value on mount reads as "nothing changed" and never
  // fires select(REVIEW_STEP_ID) — the visitor landed on QuickStart's first
  // step instead of Review, with no console error to flag it. Deferring the
  // bump to the next animation frame (mirroring focusPanelSearch's own
  // rAF, a few lines up, for the identical "wait for the tab switch to
  // commit first" reason) lets QuickStart mount with the OLD value, so the
  // deferred bump is then a genuine, detectable change.
  const [reviewStageSignal, setReviewStageSignal] = useState(0);
  const handleReviewAttention = useCallback(() => {
    openParamsTab();
    if (quickStartActive) {
      requestAnimationFrame(() => setReviewStageSignal((n) => n + 1));
    }
  }, [openParamsTab, quickStartActive]);

  // Wave 1 (guided workflow): the export dock's Download button. In tabs
  // mode (or guided with nothing to review) this exports immediately —
  // byte-identical to the plain `exportModel` binding ActionButtons uses
  // directly in tabs mode (see actionButtonsProps below, which only wires
  // this handler up for `workflow: "guided"`). Guided AND an unresolved
  // issue: does NOT download — opens Review (reusing handleReviewAttention's
  // own rAF dance so QuickStart mounts seeing the OLD signal value first,
  // same reasoning as its own doc) and arms the just-in-time "Download
  // anyway" confirmation there instead of downloading — see panelData's
  // `downloadConfirmPending` / `onDownloadAnyway`.
  const handleDownloadClick = useCallback(() => {
    if (workflowGuided && readiness === "attention") {
      setDownloadConfirmPending(true);
      handleReviewAttention();
      return;
    }
    actions.exportModel();
  }, [workflowGuided, readiness, handleReviewAttention, actions]);

  const handleDownloadAnyway = useCallback(() => {
    setDownloadConfirmPending(false);
    actions.exportModel();
  }, [actions]);

  // A stale confirmation can never linger after the visitor resolves the
  // underlying issue some other way (e.g. importing a missing font from the
  // contextual warning card) without ever pressing "Download anyway".
  useEffect(() => {
    if (readiness !== "attention") setDownloadConfirmPending(false);
  }, [readiness]);

  const handleSavePng = useCallback(() => {
    const url = (isMobile ? mobileViewerRef : desktopViewerRef).current?.snapshot();
    if (url) actions.savePng(url);
  }, [isMobile, actions]);

  // Snap the active viewer to a view and remember it (the prop keeps a
  // freshly-mounted viewer in step; the imperative call re-applies on every pick).
  const handleSelectView = useCallback((next: ViewName) => {
    setView(next);
    (isMobile ? mobileViewerRef : desktopViewerRef).current?.setView(next);
  }, [isMobile]);

  // Open Messages. PR16: on mobile this now mounts as a full-height MODAL
  // DIALOG (see the mobile JSX below), not a second surface riding above the
  // sheet — so it no longer needs to force the sheet down to Peek just to
  // keep an overlay from colliding with it. The sheet's tab/scroll/detent are
  // left completely alone, which is also what makes "close restores prior
  // state" free: nothing was ever moved, so there's nothing to restore. The
  // one exception is Full: that detent runs its own modal focus-trap +
  // background-inert wiring (BottomSheet.tsx's M16 effect), and stacking this
  // dialog's OWN trap on top of it would leave two independent keyboard traps
  // fighting over every focus event — so step Full down to Half first
  // (mirrors what Escape already does to leave Full's trap). Nothing is
  // visibly lost by that step-down: the dialog is about to cover the whole
  // screen regardless of which non-Full detent the sheet was at.
  const openOutput = useCallback(() => {
    setOutputOpen(true);
    setSheetDetent((d) => (d === "full" ? "half" : d));
  }, []);

  const toggleOutput = useCallback(() => {
    if (outputOpenRef.current) setOutputOpen(false);
    else openOutput();
  }, [openOutput]);

  // A detent change no longer needs to close Messages: the console is a
  // full-height dialog now, not an overlay anchored to the sheet's peek edge,
  // so the two can never visually collide — and in practice the sheet is
  // unreachable (inert + covered by the dialog's own overlay) while Messages
  // is open, so a detent change can't happen during that window anyway.
  const handleDetentChange = useCallback((d: SheetDetent) => {
    setSheetDetent(d);
    dismissSheetHint();
  }, [dismissSheetHint]);

  // Size the mobile viewer to follow the sheet's live height: write the sheet
  // height (px) into --sheet-follow-h, which sets the viewer's bottom edge (the
  // Viewer's RAF loop reframes the model into the new box). The CSS caps it at
  // the half height, and data-sheet-dragging toggles the easing — see
  // .app-shell__mobile-viewer.
  const handleSheetFollow = useCallback((heightPx: number, dragging: boolean) => {
    const el = mobileRootRef.current;
    if (!el) return;
    el.style.setProperty("--sheet-follow-h", `${Math.round(heightPx)}px`);
    el.dataset.sheetDragging = dragging ? "true" : "false";
  }, []);

  // Mirror the sheet's measured "Peek" height (drag handle + tab row) into
  // --mobile-peek-height: --sheet-top (index.css, sizes the viewer + action
  // dock) falls back to this var before the first live sheet drag, so the
  // real measured row wins over the static CSS fallback, which font scaling
  // can exceed. See BottomSheet's onPeekHeightChange doc.
  const handleSheetPeekHeight = useCallback((heightPx: number) => {
    const el = mobileRootRef.current;
    if (!el) return;
    el.style.setProperty("--mobile-peek-height", `${Math.round(heightPx)}px`);
  }, []);

  // Mirrors the action dock's own live-measured height into --action-dock-h,
  // so .viewer-hint (index.css) can sit just above it with a fixed gap no
  // matter what's currently inside the dock — a plain Export row, or the
  // taller ExportAttention/ExportSuccess card riding above it. Only one of
  // the two layouts' ACTION_DOCK_CLASS divs is ever mounted at a time (see
  // the desktop/mobile JSX below), both wired to this same ref callback, so
  // writing the var to the document root (not a layout-specific root) is
  // safe and simpler than threading a second ref per layout. See
  // .viewer-hint's own doc in index.css for the full geometry.
  const dockResizeObserverRef = useRef<ResizeObserver | null>(null);
  // Numeric twin of --action-dock-h (same ResizeObserver, same measurement):
  // the viewer's insets (below) need a plain number to feed framing.ts's
  // computeViewerInsets/frameDistanceWithInsets, not a CSS custom property.
  const [dockHeight, setDockHeight] = useState(0);
  const dockRef = useCallback((el: HTMLDivElement | null) => {
    dockResizeObserverRef.current?.disconnect();
    dockResizeObserverRef.current = null;
    if (!el) {
      document.documentElement.style.removeProperty("--action-dock-h");
      setDockHeight(0);
      return;
    }
    const ro = new ResizeObserver(() => {
      const h = Math.round(el.offsetHeight);
      document.documentElement.style.setProperty("--action-dock-h", `${h}px`);
      setDockHeight(h);
    });
    ro.observe(el);
    dockResizeObserverRef.current = ro;
  }, []);

  // Info-level notices (config-driven `notices`) are surfaced passively by the
  // dot/count on the Output toggle. A warning or assert is different — the model
  // came out wrong in a way worth seeing — so the console auto-opens the first
  // time a render surfaces one, rather than hiding it behind a badge the user
  // may never click. Both transitions use the react.dev "adjust state during
  // render" pattern (compare against the previous render's value), no effect.
  const hasNotices = diagnostics.length > 0;
  const [prevHasNotices, setPrevHasNotices] = useState(hasNotices);
  if (hasNotices !== prevHasNotices) {
    setPrevHasNotices(hasNotices);
    if (!hasNotices) setOutputOpen(false); // notices cleared → hide the console
  }
  // Auto-open on the false→true edge only, so a persistent warning across edits
  // doesn't re-pop a console the user has dismissed.
  const hasProblem = diagnostics.some((d) => d.level === "warning" || d.level === "assert");
  const [prevHasProblem, setPrevHasProblem] = useState(hasProblem);
  if (hasProblem !== prevHasProblem) {
    setPrevHasProblem(hasProblem);
    if (hasProblem) openOutput();
  }

  const closeOutput = useCallback(() => setOutputOpen(false), []);

  // The PanelDataContext bundle (src/lib/panelData.ts): everything
  // CustomizeTab/GettingStarted read identically in both layouts, assembled
  // once here instead of being threaded through ParamPanel/SheetTabs by
  // hand. Memoized so a render that doesn't touch any of these fields hands
  // out the SAME object (an unchanged reference), matching how individual
  // props behaved before this lift — a consumer re-renders exactly when a
  // field it reads actually changed, same as plain props, NOT the AppActions
  // stable-ref pattern (see panelData.ts's own doc for why that contrast is
  // deliberate).
  const panelData = useMemo<PanelData>(
    () => ({
      design,
      values,
      presetBaseline,
      presetName,
      baseline,
      changedParams,
      showVarName,
      availableFontFamilies,
      fontSuggestion,
      installedFonts,
      settingsView,
      focusHiddenDiffSignal: reviewHiddenSignal,
      focusAttentionParamSignal: focusAttentionParam,
      focusReviewSignal: reviewStageSignal,
      attention,
      onOpenMessages: openOutput,
      readiness,
      measured,
      renderedValues,
      computedInfo,
      displayRows,
      reviewOverrides,
      reviewStale,
      nonBlockingNoticeCount,
      onSelectView: handleSelectView,
      hiddenDiff,
      checklist: checklistState,
      checklistReplaySignal,
      quickStartActive,
      canExport: exportable,
      workflowMode,
      workflowGuided,
      activeStepId,
      onActiveStepChange: setActiveStepId,
      downloadConfirmPending,
      onDownloadAnyway: handleDownloadAnyway,
      autoRender,
    }),
    [
      design,
      values,
      presetBaseline,
      presetName,
      baseline,
      changedParams,
      showVarName,
      availableFontFamilies,
      fontSuggestion,
      installedFonts,
      settingsView,
      reviewHiddenSignal,
      focusAttentionParam,
      reviewStageSignal,
      attention,
      openOutput,
      readiness,
      measured,
      renderedValues,
      computedInfo,
      displayRows,
      reviewOverrides,
      reviewStale,
      nonBlockingNoticeCount,
      handleSelectView,
      hiddenDiff,
      checklistState,
      checklistReplaySignal,
      quickStartActive,
      exportable,
      workflowMode,
      workflowGuided,
      activeStepId,
      downloadConfirmPending,
      handleDownloadAnyway,
      autoRender,
    ]
  );

  // The HUD (camera controls) follows whatever model is actually displayed:
  // the latest success, or the retained last-good geometry after a failure.
  // Shared with the insets memo below (item 1's right inset only applies
  // while the HUD strip is actually on screen) so the two can never disagree
  // about whether it's showing.
  const hudVisible = !!result?.ok || lastPreviewKept;

  // Round-5 review, quality item 4: "guided workflow, currently on the Review
  // stage" is a condition the fit/insets below, the export attention banner
  // further down, and the header notice bell (round-6, item 5) all need —
  // computed ONCE here instead of each re-deriving `workflowGuided &&
  // activeStepId === REVIEW_STEP_ID` (or an equivalent De Morgan'd phrasing)
  // independently, so they can never silently drift apart.
  const isGuidedReview = workflowGuided && activeStepId === REVIEW_STEP_ID;

  // Round-2 review item 1: fit the viewer against the actual UNOBSCURED
  // viewport — excluding the HUD's right-hand strip, the export dock (its
  // own live-measured height, dockHeight), and a small top allowance for the
  // stale-preview banner / dimension panel — never the raw canvas underneath
  // them. See framing.ts's computeViewerInsets for the constants/derivation;
  // Viewer.tsx's applyFraming/refit consume the result. Memoized on its own
  // primitive inputs so Viewer's insets-change effect (keyed the same way)
  // only actually re-fits when one of them genuinely changes value.
  //
  // Round-6, item 1: `reviewStage` (mobile + guided Review only) swaps in a
  // much smaller top reserve — see computeViewerInsets' own `reviewStage`
  // doc for why the flat Content/Appearance-sized reserve was the actual
  // root cause of Review's "shrinks dramatically" bug, not the fit-fraction
  // targets below.
  const viewerInsets = useMemo(
    () =>
      computeViewerInsets({
        isMobile,
        hudVisible,
        dockHeightPx: dockHeight,
        safeAreaBottomPx: safeAreaBottom,
        reviewStage: isMobile && isGuidedReview,
      }),
    [isMobile, hudVisible, dockHeight, safeAreaBottom, isGuidedReview]
  );

  // Round-5 review, quality item 5 (revised round-6, item 5): the header
  // notice bell's count reflects ONLY genuine notice cards — the visible
  // attention cards sourced from a config `notices[]` category flagged
  // `attention: true` (kind "notice") — never a font-fallback attention item
  // (kind "font-fallback"), which is a READINESS gap, not a design notice: it
  // already has its own carrier (the Review chip's amber dot, plus the
  // contextual card in Appearance and the full issue card in Review — see
  // AppShell's `showExportAttentionBanner` doc). Folding font-fallback items
  // into this count is what produced the round-5 bug this revision fixes:
  // the bell lit up for a font problem the Review dot already represented,
  // and (in the aria-label / an eventual numeric surface) announced a count
  // that didn't match a genuine "notice". "tabs" workflow keeps counting
  // every raw diagnostic (diagnostics.length, unchanged/byte-identical) — it
  // has no readiness/notice distinction to begin with. Derived ONCE here
  // instead of separately at GuidedMobileHeader's call site (mobile) and
  // CommandBar's (desktop) so the two layouts can never disagree about which
  // count a given workflow mode should show.
  const noticeBadgeCount = workflowGuided ? noticeAttentionCount(attention) : diagnostics.length;

  // Round-5 Wave 2 (item 7): guided workflow's Review stage fits the model
  // to a slightly smaller target than Content/Appearance (framing.ts's
  // GUIDED_REVIEW_FIT, ~55-65% vs. the plain module defaults' ~60-70% — see
  // its own doc). undefined everywhere else (tabs workflow, or guided
  // outside Review), so every other mount keeps today's framing exactly.
  // Viewer.tsx's own insets-or-fitFraction-change effect fires a refit the
  // instant this flips (a Content/Appearance <-> Review stage switch),
  // whether or not the mobile sheet detent also happens to be changing at
  // the same time (see the reviewDetentOnEnter/Leave effect above) — the two
  // are independent triggers that happen to usually coincide.
  const fitFraction = isGuidedReview ? GUIDED_REVIEW_FIT : undefined;

  // Prop bundles shared verbatim by the two layout trees — each invocation
  // below adds only its layout-specific bits (viewer ref, active flag, …).
  const stageProps = {
    design,
    result,
    retainedResult,
    ready,
    rendering,
    loadProgress,
    engineBytes: schema.engineBytes,
    autoRender,
    stalePreview,
    pauseReason,
    theme,
    selectedPreset,
    showDimensions,
    showGrid,
    view,
    insets: viewerInsets,
    fitFraction,
    onMeasure: setMeasured,
    measured,
    renderedValues,
    computedInfo,
    showGestureHint,
  };
  const hudProps = {
    visible: hudVisible,
    measure: showMeasure,
    showDimensions,
    onToggleDimensions: toggleDimensions,
    showGrid,
    onToggleGrid: toggleGrid,
    viewPicker: showViewPicker,
    reset: showReset,
    zoom: showZoom,
    fullscreen: showFullscreen,
    view,
    onSelectView: handleSelectView,
  };
  const outputProps = {
    log,
    diagnostics: outputDiagnostics,
    badges,
    metrics: renderMetrics,
    open: outputOpen,
    onClose: closeOutput,
    friendlyError,
    lastPreviewKept,
    showReviewHidden: hiddenDiff.length > 0,
    onReviewSettings: handleReviewSettings,
    onReviewHiddenSettings: handleReviewHiddenSettings,
    onRetryRender: actions.render,
    // PR22: the friendly attention cards leading the Notices tab (see
    // OutputConsole's own doc) — the same production-readiness gaps the
    // Customize tab's attention chip shows, plus the "Go to setting" action
    // that closes Messages and jumps there.
    attention,
    onGoToAttentionSetting: handleGoToAttentionSetting,
  };
  // PR22: the export dock's own readiness — gates BOTH the export-attention
  // line below (item 2) and ActionButtons' aria-describedby wiring, in place
  // of the old attention.length > 0 corner dot. Distinct from that raw count:
  // a font fallback is known independent of any render (it just reads the
  // live controls), so attention.length can be > 0 even while a render is
  // still building or has failed — this only lights up once a render has
  // actually SUCCEEDED with something still worth reviewing (readiness.ts's
  // own failed > attention > ready precedence).
  const hasExportAttention = readiness === "attention";
  // Round-6, item 2 (supersedes round-5 Wave 2 item 3): in guided workflow,
  // the standing "N issues to review before download" banner over the
  // viewer never shows, on ANY stage — including Review itself. Round-5 kept
  // it there as "a compact summary above the viewer, alongside Review's own
  // detail", but that made it a literal duplicate: Review already shows the
  // same unresolved-issue count and detail via its own issue card
  // (GuidedReviewContent's `review.issueCount` + AttentionItems, in
  // QuickStart.tsx), so this banner floating above the SAME content was
  // redundant, not complementary. Guided readiness is now carried entirely
  // by the Review chip's own amber dot, the contextual font warning inline
  // in Appearance, and Review's own full issue card — never a standing
  // viewer-overlay banner. Unchanged at every stage in "tabs" workflow (no
  // `@step`/Review notion there to gate on, and no duplicate surface to
  // collide with). Pressing Download while issues exist still routes to
  // Review regardless (see handleDownloadClick above) — only the passive
  // banner itself is gone from guided mode.
  const showExportAttentionBanner = hasExportAttention && !workflowGuided;
  const actionButtonsProps = {
    canExport: exportable,
    modelFormat: schema.format,
    onSavePng: handleSavePng,
    hasAttention: hasExportAttention,
    // Guided-only (see ActionButtons' own doc): the count GuidedActionButtons
    // needs for its sr-only #export-attention-hint text, since ExportAttention
    // (which owns that id in tabs mode) is never mounted in guided workflow.
    attentionCount: attention.length,
    workflow: workflowMode,
    onDownloadClick: handleDownloadClick,
  };
  // The action dock: byte-identical markup on both layouts (only its
  // *position* in the tree differs — floating over the mobile sheet's top
  // edge vs. floating over the desktop viewer canvas), so it's built once
  // here and referenced from both JSX branches below instead of duplicated.
  // ref={dockRef} feeds --action-dock-h (see dockRef's own doc above) — only
  // one of the two layouts' copies is ever mounted at a time, so sharing the
  // one ref callback across both is safe.
  const actionDock = (
    <div className={cn(ACTION_DOCK_CLASS, workflowGuided && "action-dock--guided")} ref={dockRef}>
      {showExportAttentionBanner && <ExportAttention attention={attention} onReview={handleReviewAttention} />}
      {exportSuccess && (
        <ExportSuccess
          state={exportSuccess}
          title={afterExport?.title}
          body={afterExport?.body}
          helpTab={afterExport?.helpTab}
          onDismiss={onDismissExportSuccess}
        />
      )}
      <div className={cn(ACTION_CLUSTER_CLASS, workflowGuided && "action-cluster--guided")}>
        <ActionButtons {...actionButtonsProps} />
      </div>
    </div>
  );
  return (
    <PanelDataProvider value={panelData}>
      <div className="app-shell">
        {/* Skip link: off-screen until focused. Only the active layout is
            mounted below (see M7 — a breakpoint change swaps the whole tree),
            so the href always matches the one #params(-mobile) target that
            actually exists. */}
        <a
          className="skip-link absolute left-2 -top-12 z-[200] rounded-(--radius-sm) border border-brand bg-card px-[0.7rem] py-[0.4rem] text-foreground touch-manipulation [transition:top_0.15s_ease] focus:top-2"
          href={isMobile ? "#params-mobile" : "#params"}
        >
          Skip to parameters
        </a>

        {/* Only the active layout mounts (M7): desktop and mobile used to both
            render at once with CSS hiding one, doubling ParamForm/tab/search
            work and leaving stray focus targets in the hidden tree. Tab, search
            and viewer state are all hoisted above this split (panelState,
            sheetDetent, view, showDimensions, …) so switching trees here loses
            nothing. */}
        {isMobile ? (
          // ── Mobile layout ──
          // --sheet-follow-h (set live by handleSheetFollow) sizes the viewer so
          // its bottom edge tracks the sheet; data-sheet-dragging toggles the
          // easing. See .app-shell__mobile-viewer in CSS.
          <div
            className={cn("app-shell__mobile", workflowGuided && "app-shell__mobile--guided")}
            ref={mobileRootRef}
            // Round-5 Wave 2 (item 4): the reserved space --sheet-top caps
            // the export dock/viewer at — see index.css's own doc for why
            // this has to track the CURRENT detent (peek/half/full share the
            // long-standing Half ratio; "review" gets its own taller one) —
            // written as an inline style, not a class, since it's a plain
            // numeric ratio, not a themeable token.
            style={{ "--sheet-cap-ratio": sheetTopCapRatio(sheetDetent) } as React.CSSProperties}
          >
            {/* Wave 2 (guided shell): the persistent header — brand, the
                design-name button (opens the unified selector), and the ⋮
                overflow menu. Rendered OUTSIDE .app-shell__mobile-background
                (never `inert`) and with a HIGHER z-index than the bottom
                sheet (see .guided-mobile-header in index.css), so it stays
                visible AND operable across every sheet detent, including
                Full — unlike "tabs" workflow's .mobile-top-bar below, which
                that detent covers/inerts. See GuidedMobileHeader's own doc. */}
            {workflowGuided && (
              <GuidedMobileHeader
                schema={schema}
                design={design}
                theme={theme}
                themeMode={themeMode}
                rendering={rendering}
                ready={ready}
                result={result}
                stalePreview={stalePreview}
                outputOpen={outputOpen}
                // Wave 1 (round-5): guided-only — the header bell's count
                // must equal the number of visible notice cards the Notices
                // tab actually renders (AttentionItems' own `attention`
                // list), not every raw diagnostic (which includes
                // informational notices/warnings folded into Technical
                // details and never rendered as a card). "tabs" workflow's
                // own bell (below, untouched) keeps `diagnostics.length`. See
                // `noticeBadgeCount` above (shared with CommandBar's own).
                noticeCount={noticeBadgeCount}
                onToggleOutput={toggleOutput}
                onOpenImportedFiles={openImportedFiles}
                onHeightChange={handleGuidedHeaderHeight}
                containerRef={guidedHeaderRef}
              />
            )}

            {/* Background content: viewer, top bar, floating controls. Marked
                `inert` while the sheet is at the Full detent (M16) — Full
                visually covers this content, so it's removed from the tab
                order and the accessibility tree rather than left as a hidden
                focus trap. See the mobileBackgroundRef effect above. */}
            <div className="app-shell__mobile-background" ref={mobileBackgroundRef}>
              {/* Full-bleed viewer */}
              <div className="app-shell__mobile-viewer">
                <ViewerStage
                  {...stageProps}
                  viewerRef={mobileViewerRef}
                  active
                  reframeOnPreset={false}
                />

                {/* Mobile top bar — logo left, design centered, actions right
                    (mirrors desktop). z-10, below the bottom sheet (z-30), so
                    the full-detent sheet covers it and its drag handle stays
                    grabbable. PR16: Messages used to be an overlay riding above
                    this bar, which needed a z-lift to stay tappable underneath
                    it — now it's a full-height dialog (z-50, see the mobile
                    JSX below) that covers this bar entirely while open, so no
                    such lift is needed any more. Wave 2: "tabs" workflow only —
                    guided workflow renders GuidedMobileHeader above instead. */}
                {!workflowGuided && (
                  <div className="mobile-top-bar absolute inset-x-0 top-0 z-10 grid min-h-12 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-b-(color:--glass-border) bg-(--glass-bg) pt-[calc(env(safe-area-inset-top,0px)+0.4rem)] pb-[0.4rem] pl-[calc(0.75rem+env(safe-area-inset-left,0px))] pr-[calc(0.75rem+env(safe-area-inset-right,0px))]">
                    <span className="inline-flex min-w-0 items-center gap-[0.4rem] justify-self-start overflow-hidden whitespace-nowrap px-[0.2rem] py-[0.3rem] text-[0.92rem] font-bold">
                      <BarBrand schema={schema} theme={theme} logoClassName="h-[1.3rem]" />
                    </span>
                    <div className="mobile-top-bar__center inline-flex min-w-0 items-center justify-self-center">
                      {designs.length > 1 && schema.ui?.gallery ? (
                        <DesignPickerButton design={design} />
                      ) : designs.length > 1 ? (
                        <DesignPicker
                          designs={designs}
                          value={design.id}
                          openSignal={openPickerSignal}
                          active={isMobile}
                        />
                      ) : (
                        <span className="whitespace-nowrap px-[0.2rem] py-[0.3rem] text-[0.85rem] font-semibold">
                          {design.label}
                        </span>
                      )}
                      {design.doc && (
                        <IconButton
                          label={t("bar.designGuide")}
                          title={t("bar.aboutDesign")}
                          onClick={actions.showDesignDoc}
                          className="mobile-top-bar__design-doc size-7 shrink-0 p-[0.3rem]"
                        >
                          <GuideIcon size={15} />
                        </IconButton>
                      )}
                    </div>
                    {/* The Output bell doubles as the render-status indicator (a
                        status dot rides its corner), so the narrow bar needs no
                        separate pill; theme/help/licenses collapse into a ⋮ overflow. */}
                    <div className="inline-flex items-center gap-[0.4rem] justify-self-end">
                      <OutputToggle
                        outputOpen={outputOpen}
                        noticeCount={diagnostics.length}
                        onToggleOutput={toggleOutput}
                        status={{ rendering, ready, result, stale: stalePreview }}
                        className={cn(ICON_BUTTON_CLASS, "mobile-top-bar__output")}
                      />
                      <BarActions themeMode={themeMode} collapse />
                    </div>
                  </div>
                )}
              </div>

              {/* Floating action cluster — the same compact card the desktop
                  floats over its viewer, riding just above the sheet's top edge
                  (it follows the sheet up to the half detent via
                  --sheet-follow-h) instead of a solid docked footer band that
                  would reserve a strip of the viewport. Identical markup +
                  buttons to the desktop cluster. The after-export panel (when
                  shown) rides directly above it in the same dock, never
                  covering it — see ACTION_DOCK_CLASS's doc. */}
              {actionDock}

              {/* Wave 3 (mobile density): guided workflow's mobile HUD folds
                  the view picker/measure/grid/zoom into one "View" menu and
                  shows only Reset + Fullscreen directly — see ViewerHUD's own
                  `compact` doc. Desktop (below) and tabs-mode mobile never
                  pass this, so both keep today's full HUD unchanged. */}
              <ViewerHUD {...hudProps} viewerRef={mobileViewerRef} compact={workflowGuided} />
            </div>

            {/* Output console (mobile): PR16 — a full-height MODAL DIALOG rather
                than a second surface stacked over the sheet. Two review-
                sanctioned options existed: (a) replace the sheet's own content
                area in place (raise it to Half, swap its tab content for the
                console, restore the prior tab/detent on close), or (b) this —
                a full-height dialog. (b) wins: it reuses the exact Dialog +
                focus-trap + background-inert machinery every other overlay in
                the app already relies on (Help, licenses, the design doc — see
                Modal.tsx) instead of a bespoke save-then-restore dance for the
                sheet, and "close the dialog" is already the right mental model
                for skimming Messages — open it, read it, dismiss it, land back
                exactly where the sheet already was, because the sheet's own
                tab/scroll/detent were never touched (see openOutput's doc).
                Radix's own hideOthers marks the rest of the page — including
                the bottom sheet — aria-hidden while this is open, and its
                overlay covers it visually and to the pointer, so the two
                surfaces are never simultaneously reachable: never two stacked
                bottom surfaces. The console's own Notices/Log/Metrics markup is
                untouched — this mounts the SAME <OutputConsole> desktop docks
                inline below its viewer; only the wrapper differs.
                showCloseButton is off because OutputConsole supplies its own
                `.output-console__close` (a stable hook scripts/smoke.mjs and
                scripts/capture-screens.mjs both already depend on) — a second
                Radix close button would be a confusing duplicate.
                P1: a bottom-anchored sheet (not a full-height `inset-0`
                overlay) with a visible titled header (`DialogTitle`,
                "Messages" — `console.title`) directly above OutputConsole, so
                the title and its content read as one surface rising from the
                bottom — the model stays visible above it — instead of a lone
                title floating over a blank full-height sheet. The sheet
                sizes to its content, capped at `max-h-[85dvh]`; OutputConsole
                takes the remaining space (`flex-1 min-h-0`, scrolling
                internally when long), while the inline `height`/`maxHeight`
                it applies in its own "compact" mode (short content — see its
                own doc) still wins (inline style always wins). Radix wires the
                title's id to DialogContent's `aria-labelledby` automatically,
                so no manual `aria-label` is needed here any more. */}
            {outputOpen && (
              <Dialog open onOpenChange={(o) => { if (!o) closeOutput(); }}>
                <DialogContent
                  showCloseButton={false}
                  aria-describedby={undefined}
                  className="output-console-modal fixed inset-x-0 bottom-0 top-auto z-50 flex max-h-[85dvh] flex-col gap-0 rounded-t-2xl rounded-b-none border-x-0 border-b-0 border-t p-0 max-w-none translate-x-0 translate-y-0 sm:max-w-none"
                >
                  <DialogTitle className="output-console-modal__title flex h-12 shrink-0 items-center rounded-t-2xl border-b bg-card px-4 text-base font-semibold">
                    {t("console.title")}
                  </DialogTitle>
                  <OutputConsole {...outputProps} className="min-h-0 flex-1 max-h-none border-t-0" />
                </DialogContent>
              </Dialog>
            )}

            {/* Persistent bottom sheet. Modal at the Full detent — see
                BottomSheet's own focus-trap/restore effect, and the
                mobileBackgroundRef inert wiring above for its background half. */}
            <BottomSheet
              detent={sheetDetent}
              onDetentChange={handleDetentChange}
              onFollow={handleSheetFollow}
              onPeekHeightChange={handleSheetPeekHeight}
              onHandleInteract={dismissSheetHint}
              hint={sheetHintVisible ? t("hint.dragForSettings") : undefined}
              peekHeight={PEEK_HEIGHT}
              bottomInset={safeAreaBottom}
              topInset={workflowGuided ? guidedHeaderH : 0}
              extraTrapContainerRef={workflowGuided ? guidedHeaderRef : undefined}
            >
              {(_detent, expand) => (
                // The tab bar shows at every detent (including peek); tapping a tab
                // raises a collapsed sheet. Auto-render + Reset are param-scoped, so
                // they live inside the Parameters tab (SheetTabs), not here.
                <div className="sheet-content" id="params-mobile">
                  <SheetTabs
                    bundled={bundled}
                    userPresets={userPresets}
                    selected={selectedPreset}
                    fileImport={fileImport}
                    loadedFiles={loadedFiles}
                    onActivate={expand}
                    autoRender={autoRender}
                    presetsLabel={presetsLabel}
                    parametersLabel={parametersLabel}
                    tab={panelState.tab}
                    onTabChange={setPanelTab}
                    search={panelState.search}
                    onSearchChange={panelState.setSearch}
                    onSearchBlur={onParamSearchHiddenBlur}
                    sheetDetent={sheetDetent}
                  />
                </div>
              )}
            </BottomSheet>
          </div>
        ) : (
          // ── Desktop layout ──
          <div className="app-shell__desktop">
            <CommandBar
              schema={schema}
              designs={designs}
              designId={design.id}
              theme={theme}
              themeMode={themeMode}
              rendering={rendering}
              ready={ready}
              result={result}
              stalePreview={stalePreview}
              outputOpen={outputOpen}
              // Wave 1 (round-5): "tabs" workflow keeps `diagnostics.length`
              // (unchanged, byte-identical); guided workflow's own bell
              // counts only the visible attention cards — see
              // `noticeBadgeCount` above (shared with GuidedMobileHeader's
              // own). CommandBar itself decides the badge's visual `variant`
              // from `guided` below, so only the NUMBER differs here.
              noticeCount={noticeBadgeCount}
              onToggleOutput={toggleOutput}
              openPickerSignal={openPickerSignal}
              pickerActive={!isMobile}
              guided={workflowGuided}
              hasFileImport={fileImport !== null}
              onOpenImportedFiles={openImportedFiles}
            />

            <div className={`app-shell__canvas-area${panelSide === "right" ? " panel-right" : ""}`}>
              {/* Docked panel: Presets / Parameters / Files tabs (mirrors mobile). */}
              <ParamPanel
                bundled={bundled}
                userPresets={userPresets}
                selectedPreset={selectedPreset}
                fileImport={fileImport}
                loadedFiles={loadedFiles}
                panelSide={panelSide}
                panelDefaultOpen={panelDefaultOpen}
                autoRender={autoRender}
                presetsLabel={presetsLabel}
                parametersLabel={parametersLabel}
                panelTab={panelState.tab}
                onPanelTabChange={setPanelTab}
                search={panelState.search}
                onSearchChange={panelState.setSearch}
                onSearchBlur={onParamSearchHiddenBlur}
              />

              {/* Canvas */}
              <div className="app-shell__viewer">
                <ViewerStage {...stageProps} viewerRef={desktopViewerRef} active>
                  {/* Floating controls live inside viewer-wrap so they hover over the
                      canvas — which shrinks when the output console docks below it —
                      rather than overlapping the console's notices. The after-export
                      panel (when shown) rides directly above the cluster in the same
                      dock, never covering it — see ACTION_DOCK_CLASS's doc. */}
                  {actionDock}
                  <ViewerHUD {...hudProps} viewerRef={desktopViewerRef} />
                </ViewerStage>

                {/* Output console — inline below viewer */}
                <OutputConsole {...outputProps} className="max-h-56" />
              </div>
            </div>
          </div>
        )}

        {/* Wave 2 (guided shell): "Imported files" management — reached from
            the mobile header's overflow menu (above) and, on desktop, the
            command bar's own icon (see CommandBar.tsx) — never from primary
            navigation. Shared across both layouts (only one is ever
            triggered at a time, since only the active layout mounts a
            trigger for it), so it's rendered once here rather than
            duplicated per branch. */}
        {importedFilesOpen && (
          <ImportedFilesModal
            loadedFiles={loadedFiles}
            onRemoveFile={actions.removeFile}
            onClearFiles={actions.clearFiles}
            onClose={closeImportedFiles}
          />
        )}
      </div>
    </PanelDataProvider>
  );
});
