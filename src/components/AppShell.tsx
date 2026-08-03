// AppShell.tsx: responsive layout shell. Owns the full-bleed viewer canvas with:
//   Desktop (≥ 860px): CommandBar + docked ParamPanel + ActionCluster + ViewerHUD
//   Mobile (< 860px):  full-bleed viewer + top bar + BottomSheet + floating ActionCluster
// Both layouts float the same compact action cluster over the viewer bottom.
// Mobile no longer reserves a solid footer band. The mobile HUD is a single
// collapsed trigger rather than the desktop column (see ViewerHUD's own doc),
// and the sheet's Full detent stops short of the top edge, leaving a live
// model strip; the chrome floating over that band is hidden there, driven by
// the `data-sheet-detent` attribute this file publishes on the mobile root.
//
// App.tsx still owns render orchestration (useRenderPipeline) and the values/
// presets/export/URL/theme state a design edit touches. What AppShell itself
// owns is layout: which breakpoint's tree is mounted, panel width, focus
// restoration and `inert` management across a breakpoint switch, and the
// handful of viewer/panel toggles (dimensions, grid, view) both layouts
// share. Three self-contained pieces: production-readiness derivation + the
// Review dialog (useReadinessModel.ts), the Output console's open/auto-open
// state machine (useOutputConsole.ts), and the mobile sheet's first-visit
// policy (useSheetPolicy.ts). Are extracted hooks this component composes, not
// logic it owns itself.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import type { Design, Schema, UiConfig, WorkerProgress } from "../openscad/types";
import type { Values, ParsedSet } from "../lib/presets";
import type { RenderResult } from "../openscad/types";
import type { RenderMetrics } from "../lib/renderMetrics";
import type { ViewerHandle, Dimensions } from "./Viewer";

// Peek shows only the drag handle + the tab bar (Presets/Parameters),
// ending at the tab underline: no sliver of the tab's content.
const PEEK_HEIGHT = 60;
// Stable empty-log identity so idle re-renders don't break memo'd children.
const EMPTY_LOG: string[] = [];
// The floating action cluster that wraps the ActionButtons row: a solid raised
// card shared verbatim by the desktop and mobile clusters so a tweak to
// padding/border lands once.
const ACTION_CLUSTER_CLASS =
  "action-cluster flex max-w-full items-center gap-[0.3rem] whitespace-nowrap rounded-lg border-(color:--glass-border) border bg-(--glass-bg) px-[0.45rem] py-[0.35rem] shadow-(--elevation)";
// The bottom-anchored dock wrapping the action cluster (and, when shown, the
// after-export panel riding above it). Positioning (absolute/bottom/left/
// transform, plus the mobile sheet-follow override) lives on `.action-dock`
// in index.css; a plain flex column here means an ExportSuccess panel
// pushes the cluster down from a fixed bottom edge: no height measurement
// needed to stack the two.
const ACTION_DOCK_CLASS = "action-dock flex flex-col items-center gap-2";
// Off-screen until focused, shared verbatim by the two skip links below so a
// tweak to the focused position/chrome lands once. `.skip-link` carries no
// stylesheet rule: it's a script hook (see CLAUDE.md), so the decoration
// lives here.
const SKIP_LINK_CLASS =
  "skip-link absolute left-2 -top-12 z-[200] rounded-(--radius-sm) border border-brand bg-card px-[0.7rem] py-[0.4rem] text-foreground touch-manipulation [transition:top_0.15s_ease] focus:top-2";

import { CommandBar } from "./CommandBar";
import { ParamPanel } from "./ParamPanel";
import { ActionButtons } from "./ActionButtons";
import { ExportSuccess, type ExportSuccessState } from "./ExportSuccess";
import { OutputToggle } from "./OutputToggle";
import { BarActions } from "./BarActions";
import { ICON_BUTTON_CLASS } from "./IconButton";
import { cn } from "../lib/utils";
import { ViewerStage } from "./ViewerStage";
import { ViewerHUD } from "./ViewerHUD";
import { type ViewName } from "./views";
import { OutputConsole } from "./OutputConsole";
import { BottomSheet, type SheetDetent } from "./BottomSheet";
import { SheetTabs } from "./SheetTabs";
import { DesignHeading } from "./DesignHeading";
import { BarBrand } from "./BarBrand";
import { parseComputedInfo } from "../lib/computedInfo";
import { useAssetAvailability } from "../lib/useAssetAvailability";
import { useAppActions } from "../lib/appActions";
import { useIsMobile } from "../lib/useIsMobile";
import { useSafeAreaBottom } from "../lib/useSafeAreaInset";
import { usePanelState } from "../lib/usePanelState";
import { PARAM_SEARCH_INPUT_ID } from "./ParamSearch";
import { ns } from "../lib/appId";
import { readLocal, writeLocal } from "../lib/safeStorage";
import { useViewerToggles } from "../lib/useViewerToggles";
import { useCssPublishers } from "../lib/useCssPublishers";
import { SheetSwipeHint } from "./SheetSwipeHint";
import { useReadinessModel } from "../lib/useReadinessModel";
import { useOutputConsole } from "../lib/useOutputConsole";
import { useSheetPolicy } from "../lib/useSheetPolicy";
import { ReviewDialog } from "./ReviewDialog";
import { StatusStrip, type StatusStripProps } from "./StatusStrip";
import { tn } from "../lib/i18n";

const ADVANCED_SETTINGS_KEY = ns("settings.advanced");

// The bottom-anchored dock: the ActionButtons cluster, with an optional
// after-export panel riding above it (see ACTION_DOCK_CLASS's own doc). The
// desktop and mobile layouts each mount this verbatim inside their own
// positioning context (.app-shell__mobile / __desktop): extracted so a tweak
// to either half's markup only has to land once instead of twice in step.
function ActionDock({
  exportSuccess,
  afterExport,
  onDismissExportSuccess,
  actionButtonsProps,
  statusPill,
  onHeightChange,
}: {
  exportSuccess: ExportSuccessState | null;
  afterExport: UiConfig["afterExport"];
  onDismissExportSuccess: () => void;
  actionButtonsProps: ComponentProps<typeof ActionButtons>;
  /** The readiness pill, stacked directly above the cluster (StatusStrip).
   *  Undefined in the states that shouldn't announce anything, see
   *  `dockStatusPill` below. */
  statusPill?: Omit<StatusStripProps, "className">;
  /** Reports the dock's live height (px) whenever it changes, see the
   *  `--action-dock-h` effect in AppShell for what reads it. */
  onHeightChange?: (heightPx: number) => void;
}) {
  // The dock is a flex column whose height depends on what it currently holds
  // (cluster alone, + readiness pill, + after-export panel), and the chips that
  // sit above it have to clear whatever that is, so measure rather than let
  // them guess. See the CSS note on `--action-dock-h`.
  const dockRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = dockRef.current;
    if (!el || !onHeightChange) return;
    const measure = () => onHeightChange(Math.ceil(el.getBoundingClientRect().height));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeightChange]);

  return (
    <div className={ACTION_DOCK_CLASS} ref={dockRef}>
      {exportSuccess && (
        <ExportSuccess
          state={exportSuccess}
          helpTab={afterExport?.helpTab}
          onDismiss={onDismissExportSuccess}
        />
      )}
      {statusPill && <StatusStrip {...statusPill} />}
      <div className={ACTION_CLUSTER_CLASS}>
        <ActionButtons {...actionButtonsProps} />
      </div>
    </div>
  );
}

interface Props {
  schema: Schema;
  design: Design;
  designs: Design[];
  values: Values;
  /** Values behind the current render: what the measurements panel reads. */
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
  /** Values the current params are diffed against: presetBaseline, or design defaults. */
  baseline: Values;
  /** Names of params whose value differs from `baseline`. */
  changedParams: Set<string>;
  userFiles: Record<string, Uint8Array>;
  result: RenderResult | null;
  rendering: boolean;
  ready: boolean;
  /** The render worker's bootstrap-download progress; null once ready (or
   *  never set at all on a warm Cache Storage hit). Surfaced by ViewerStage's
   *  loading overlay as a thin progress bar. */
  loadProgress: WorkerProgress | null;
  autoRender: boolean;
  stalePreview: boolean;
  /** A successful render that still matches the live controls: the only
   * state Download/Image may act on. See docs/architecture-review.md H1. */
  exportable: boolean;
  theme: "dark" | "light";
  themeMode: "light" | "dark" | "auto";
  /** The mode the theme toggle moves to (theme.ts's nextThemeMode). */
  themeNext: "light" | "dark" | "auto";
  /** Incremented by the intro popup's primary CTA to open the design picker. */
  openPickerSignal: number;
  /** Whether the config's welcome popup (schema.popup) is currently up. It is
   *  the one modal that opens unbidden on a first visit and covers the whole
   *  app, so the first-visit sheet nudge holds until it's gone, see
   *  `sheetHintArmed` below. */
  introOpen: boolean;
  /** Non-null right after a successful export, when the config's
   *  `ui.afterExport` opts into the panel, see ExportSuccess.tsx. Null the
   *  rest of the time, including when `ui.afterExport` is unset. */
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
  rendering,
  ready,
  loadProgress,
  autoRender,
  stalePreview,
  exportable,
  theme,
  themeMode,
  themeNext,
  openPickerSignal,
  introOpen,
  exportSuccess,
  onDismissExportSuccess,
}: Props) {
  const actions = useAppActions();
  // `ui.essentials` is what decides whether `@advanced` params are hideable at
  // all: docs/config.md and docs/annotations.md both scope the whole feature
  // to it ("when `ui.essentials` is enabled"). Off (the default), every param
  // is shown: `showAdvanced` is a constant `true` and the change
  // handler below is withheld, which is what keeps the toggle from rendering
  // (ParamForm mounts EssentialsToggle only when handed one). Passing it
  // unconditionally would give a config that never opted in a toggle that can
  // hide params its operator meant to be permanent.
  const essentialsEnabled = schema.ui?.essentials === true;
  const [showAdvanced, setShowAdvanced] = useState(() =>
    essentialsEnabled ? readLocal(ADVANCED_SETTINGS_KEY) === "true" : true
  );
  const changeShowAdvanced = useCallback((show: boolean) => {
    setShowAdvanced(show);
    writeLocal(ADVANCED_SETTINGS_KEY, String(show));
  }, []);
  const handleShowAdvancedChange = essentialsEnabled ? changeShowAdvanced : undefined;
  const desktopViewerRef = useRef<ViewerHandle>(null);
  const mobileViewerRef = useRef<ViewerHandle>(null);
  // The mobile layout root: its --sheet-follow-h CSS var sizes the viewer so it
  // tracks the sheet live (see handleSheetFollow / .app-shell__mobile-viewer).
  // HTMLElement, not HTMLDivElement: this root is the <main> landmark (see the
  // layout split below). Only style/dataset are read off it.
  const mobileRootRef = useRef<HTMLElement>(null);
  // Only the active layout mounts a Viewer (the other layout is CSS-hidden), so
  // we never run two three.js renderers / RAF loops / STL parses at once.
  const isMobile = useIsMobile();
  // The active Viewer's bounding-box size (mm), reported via onMeasure. Local
  // viewer glue like the PNG-snapshot handler: it needs the viewer, not App.
  const [measured, setMeasured] = useState<Dimensions | null>(null);
  // The viewer HUD's own state: the dimension overlay, the measurements panel's
  // folded state, the grid, and the active camera view. Above the layout split
  // so a breakpoint change doesn't reset any of it (see useViewerToggles).
  const {
    showDimensions,
    toggleDimensions,
    measureCollapsed,
    toggleMeasureCollapsed,
    showGrid,
    toggleGrid,
    view,
    setView,
  } = useViewerToggles(schema, isMobile);
  // The sheet sits directly on the viewport bottom now (no docked footer band),
  // reserving only the iOS home-indicator inset below itself so its peek row
  // clears the gesture bar. Its JS geometry must match that CSS bottom offset.
  // Off-iOS the inset is 0.
  const safeAreaBottom = useSafeAreaBottom();
  // First-visit mobile bottom-sheet policy, the sheet's detent state, and the
  // "swipe up for settings" nudge's visibility, see useSheetPolicy.ts. Layout
  // (handleDetentChange, handleSheetFollow, the mobileBackgroundRef `inert`
  // effect below) still reads/drives `sheetDetent` directly; only the
  // first-visit policy that seeds it lives in the hook.
  const { sheetDetent, setSheetDetent, showSheetHint, dismissSheetHint, sheetHintArmed } = useSheetPolicy({
    isMobile,
    introOpen,
    ready,
    rendering,
    result,
  });

  // Panel tab + search state (see M7): hoisted here. Above the desktop/mobile
  // split below, so ONLY the active layout mounts (ParamPanel or SheetTabs,
  // never both), yet a breakpoint change (or a real rotation) doesn't reset
  // the tab, clear the search box, or drop focus, since neither component owns
  // this state locally anymore.
  const panelState = usePanelState(bundled.length > 0);
  // Restore keyboard focus to the search input across a layout switch when it
  // held focus immediately before the switch (tracked by ParamSearch's onFocus/onBlur
  // via searchFocusedRef). Runs in a layout effect so it fires after the new
  // layout's DOM (with the same #param-search-input id) is committed, before
  // the browser paints: otherwise the switch would silently drop focus to
  // <body>.
  // Bind the ref to a local so the focus/blur handlers mutate a value the
  // React Compiler sees as a ref (`react-hooks/refs`, off here) rather than a
  // property of the hook-returned `panelState` object, which its immutability
  // rule forbids mutating.
  const { searchFocusedRef } = panelState;
  const wasMobileRef = useRef(isMobile);
  useLayoutEffect(() => {
    if (wasMobileRef.current === isMobile) return;
    wasMobileRef.current = isMobile;
    if (searchFocusedRef.current) {
      document.getElementById(PARAM_SEARCH_INPUT_ID)?.focus();
    }
  }, [isMobile, searchFocusedRef]);
  const handleSearchFocus = useCallback(() => {
    searchFocusedRef.current = true;
  }, [searchFocusedRef]);
  const handleSearchBlur = useCallback(() => {
    searchFocusedRef.current = false;
  }, [searchFocusedRef]);

  // M16: at the Full sheet detent the sheet visually covers the mobile
  // background (top bar + viewer + floating controls), so treat that detent
  // as modal. Mark the background `inert` (removes it from both the tab
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


  const ui = schema.ui ?? {};
  const viewerControls = schema.viewer?.controls ?? {};
  const panelSide = ui.panelSide ?? "left";
  const panelDefaultOpen = (ui.panelDefault ?? "open") === "open";
  // Variable names are developer detail: hidden unless a config opts in.
  const showVarName = ui.showVarName === true;
  // Whether the viewer offers the measure (dimensions) toggle. Off hides the HUD
  // ruler button; the overlay + panel are only reachable through it, so they
  // stay hidden too.
  const showMeasure = viewerControls.measure !== false;
  // Whether the "Save image (PNG)" action is offered (default true). Off hides
  // it in both secondary-action surfaces (desktop CommandBar and mobile ⋮ menu).
  const showSaveImage = ui.saveImage !== false;
  // Whether the viewer offers the view picker (camera-angle menu).
  const showViewPicker = viewerControls.viewPicker !== false;
  // Whether the viewer offers the "reset view" button.
  const showReset = viewerControls.reset !== false;
  // Whether the viewer offers the zoom in/out buttons (off by default).
  const showZoom = viewerControls.zoom === true;
  // Whether the viewer offers the fullscreen toggle (where it works at all).
  const showFullscreen = viewerControls.fullscreen !== false;
  // Optional after-export success panel (see ExportSuccess.tsx). Undefined
  // when the config never set `ui.afterExport`: `exportSuccess` stays null
  // forever in that case (App.tsx never sets it), so the panel never mounts.
  const afterExport = ui.afterExport;

  const log = result?.log ?? EMPTY_LOG;
  // Gates the toolbar's "Files" action (BarActions): the actual FilesModal
  // (import button + imported-file list) is hosted in App.tsx alongside
  // Help/Licenses/DesignDoc, opened via AppActions' `showFiles`. Neither
  // ParamPanel nor SheetTabs knows about file imports anymore now that Files
  // is no longer a panel tab.
  const hasFiles = schema.fileImport != null;

  // What the renderer can actually resolve right now: font families/faces and
  // SVG drawings, each the union of what the build bundled with what the
  // visitor has imported (see useAssetAvailability).
  const { availableFontFamilies, fontSuggestion, installedFonts, availableSvgFiles } =
    useAssetAvailability(schema, userFiles);

  // Rows from `echo("@info", label, unit, value)`: internally-calculated
  // values the design surfaced at render time (see lib/computedInfo.ts).
  const computedInfo = useMemo(() => parseComputedInfo(log), [log]);

  // Production-readiness derivation (diagnostics/notices → count badges →
  // attention items → readiness → failure card state), plus the Review
  // dialog's open/closed state and the dock Download button's routing through
  // it, see useReadinessModel.ts. `availableFontFamilies` is computed above
  // (ParamPanel/SheetTabs need the same set), so it's threaded in rather than
  // recomputed.
  const {
    diagnostics,
    badges,
    attention,
    readiness,
    failure,
    reviewOpen,
    setReviewOpen,
    openReview,
    handleDownloadClick,
  } = useReadinessModel({
    design,
    values,
    result,
    notices: schema.notices,
    availableFontFamilies,
    exportable,
  });

  const handleSavePng = useCallback(() => {
    const url = (isMobile ? mobileViewerRef : desktopViewerRef).current?.snapshot();
    if (url) actions.savePng(url);
  }, [isMobile, actions]);

  // Snap the active viewer to a view and remember it (the prop keeps a
  // freshly-mounted viewer in step; the imperative call re-applies on every pick).
  const handleSelectView = useCallback((next: ViewName) => {
    setView(next);
    (isMobile ? mobileViewerRef : desktopViewerRef).current?.setView(next);
  }, [isMobile, setView]);

  // Output console open/closed state + its auto-open-on-problem machine (see
  // useOutputConsole.ts). Opening the console has to collapse an expanded
  // sheet to peek: the overlay's fixed anchor sits immediately above the peek tab
  // row, but that hook has no reason to know about sheet state, so the
  // collapse is injected as a callback instead. Wrapped in its own
  // zero-dependency useCallback (setSheetDetent is a useState setter, always
  // identity-stable) so this stays identity-stable too, which keeps
  // useOutputConsole's `openOutput`, and therefore `toggleOutput`, handed to
  // the memo'd CommandBar: stable across renders as well. `sheetAtPeek` gates
  // the hook's own auto-open-on-problem edge (see its doc): a new warning
  // while the sheet sits at half/full leaves the visitor mid-edit alone.
  const collapseSheetToPeek = useCallback(() => setSheetDetent("peek"), [setSheetDetent]);
  const { outputOpen, openOutput, closeOutput, toggleOutput, tab, setTab } = useOutputConsole({
    diagnostics,
    defaultOpen: schema.ui?.outputDefault === "open",
    collapseSheet: collapseSheetToPeek,
    // The desktop has no sheet, and useSheetPolicy keeps the last mobile detent
    // across the breakpoint: without the layout test, a warning arriving after
    // a resize from an expanded sheet consumed its own edge and the desktop
    // console never auto-opened.
    sheetAtPeek: !isMobile || sheetDetent === "peek",
  });

  // Raising the sheet off peek (dragging the handle OR tapping a tab) would slide
  // its content up under the overlay: close the overlay on any such change so
  // the two are never shown at once.
  const handleDetentChange = useCallback((d: SheetDetent) => {
    setSheetDetent(d);
    if (d !== "peek") {
      closeOutput();
      // The visitor has opened the sheet, so the first-visit nudge has done its
      // job: retire it for good. Without this a keyboard user who expands then
      // collapses the sheet before the timeout would see the hint return.
      dismissSheetHint();
    }
  }, [setSheetDetent, closeOutput, dismissSheetHint]);

  // The four measured values the stylesheet lays out against, published as CSS
  // custom properties (see useCssPublishers): the sheet's live height, its
  // Full-detent top gap, its peek row, and the export dock's height.
  const shellRef = useRef<HTMLDivElement>(null);
  const { handleSheetFollow, handleSheetFullGap, handleSheetPeekHeight, handleDockHeight } =
    useCssPublishers(mobileRootRef, shellRef);

  // "View messages" (the review dialog's notice-attention cards) closes the
  // dialog and opens the console: the same anchor-above-peek behaviour as
  // the bell.
  const openMessagesFromReview = useCallback(() => {
    setReviewOpen(false);
    openOutput();
  }, [setReviewOpen, openOutput]);

  // Whether the dock shows its readiness pill (StatusStrip). "ready" needs no
  // announcement (the Download button right below it is the confirmation)
  // and "building" is already narrated by the viewer's own loading overlay, so
  // a pill in either state would be noise over the model. That leaves the two
  // states that want a look at the Review dialog:
  //
  //   • "failed" pills on both layouts. A failure needs words; there is no
  //     other surface that says the model did not come out.
  //   • "attention" pills on BOTH layouts. Mobile used to leave this state to
  //     a marker inside the Download button, to save a stacked row over the
  //     model. That marker is gone: a small in-button graphic has to earn its
  //     contrast against a fill the deployment chooses, and it says "amber"
  //     rather than saying what is wrong. The pill costs a row and says it in
  //     words, which is the better trade on the layout where the visitor can
  //     see least.
  //
  // It also gates the Messages bell's numeric badge (`showCount` below), so the
  // pill's issue count is never on screen beside the bell's message count, see
  // OutputToggle.tsx for why those two tallies legitimately differ. Now that
  // mobile pills for attention too, that suppression applies there as well,
  // which is what finally makes the two mobile signals one.
  const hasStatusPill = readiness === "failed" || readiness === "attention";
  // At the sheet's Full detent the whole floating chrome — including the dock
  // and its StatusStrip — is hidden (see the `data-sheet-detent` doc above),
  // so "attention" or "failed" would otherwise have no visible indication at
  // all there. ParamForm's own failure banner doesn't cover it either: it
  // only mounts on the Customize tab, so a failed render with Presets
  // selected has no banner. Reuse the same pill inside SheetTabs for those
  // two states only, so peek/half never show it twice.
  const sheetStatusPill =
    isMobile && sheetDetent === "full" && hasStatusPill
      ? { readiness, attentionCount: attention.length, onOpen: openReview }
      : undefined;

  // A transition into "attention" gets a spoken announcement of its own
  // (WCAG 4.1.3): the StatusStrip pill that says it visually is a <button>,
  // not a live region, and it mounts up to twice at once (the dock and
  // SheetTabs' full-detent copy, see `sheetStatusPill` above), so wiring
  // aria-live onto the pill itself risks announcing the same change twice.
  // This region instead lives once here, above the mobile/desktop split (only
  // one of which ever mounts, see M7), so exactly one copy of it exists
  // regardless of layout or sheet detent. Text is empty outside "attention",
  // so a live-region diff only fires on the entry (and exit) transitions, not
  // on every render that leaves the state unchanged. "failed" needs no
  // separate wording here: OutputToggle's own `.render-status` region already
  // announces "Failed (exit N)" on that transition. Reuses `action.attentionHint`
  // (already spoken by the Download button's own aria-describedby) so the two
  // surfaces never disagree on the wording.
  const attentionAnnouncement =
    readiness === "attention" ? tn("action.attentionHint", attention.length) : "";

  // Prop bundles shared verbatim by the two layout trees: each call site below
  // adds only what is genuinely its own (the panel's dock geometry, the
  // sheet's expand callback).
  const paramProps = {
    design,
    values,
    bundled,
    userPresets,
    selectedPreset,
    presetBaseline,
    presetName,
    baseline,
    changedParams,
    availableFontFamilies,
    fontSuggestion,
    installedFonts,
    availableSvgFiles,
    showVarName,
    showAdvanced,
    onShowAdvancedChange: handleShowAdvancedChange,
    panelTab: panelState.tab,
    onPanelTabChange: panelState.setTab,
    search: panelState.search,
    debouncedSearch: panelState.debouncedSearch,
    onSearchChange: panelState.setSearch,
    onSearchFocus: handleSearchFocus,
    onSearchBlur: handleSearchBlur,
    failure,
  };
  const stageProps = {
    design,
    result,
    ready,
    rendering,
    loadProgress,
    autoRender,
    stalePreview,
    theme,
    selectedPreset,
    showDimensions,
    measureCollapsed,
    onToggleMeasureCollapsed: toggleMeasureCollapsed,
    showGrid,
    view,
    onMeasure: setMeasured,
    measured,
    renderedValues,
    values,
    computedInfo,
    // While the first-visit "swipe up for settings" nudge is up, or still
    // waiting to arm: suppress the viewer's own gesture hint so the two
    // one-time chips never stack over the sheet's top edge (they share that
    // slot) and the sheet nudge always goes first. Only ever true on mobile.
    suppressGestureHint: isMobile && showSheetHint,
  };
  const hudProps = {
    visible: !!result?.ok,
    // Mobile collapses the whole HUD into one "View options" popover; desktop
    // keeps the inline column. Passed as a prop rather than read from a
    // viewport hook inside ViewerHUD for the same reason BarActions takes
    // `collapse`: the caller already knows which layout it is, and only one
    // layout tree is mounted at a time (M7).
    collapse: isMobile,
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
    diagnostics,
    badges,
    metrics: renderMetrics,
    open: outputOpen,
    onClose: closeOutput,
    tab,
    onTabChange: setTab,
    failure,
  };
  const actionButtonsProps = {
    canExport: exportable,
    modelFormat: schema.format,
    readiness,
    attentionCount: attention.length,
    onDownloadClick: handleDownloadClick,
  };
  // The document's only <h1>. Visually hidden: BarBrand and the design picker
  // already carry the sighted title treatment, so this names the page for
  // assistive tech without duplicating that chrome. Built once here and
  // rendered by whichever layout branch mounts (M7), so the live tree always
  // holds exactly one.
  const pageHeading = <h1 className="sr-only">{schema.title}</h1>;
  const dockStatusPill = hasStatusPill
    ? { readiness, attentionCount: attention.length, onOpen: openReview }
    : undefined;
  return (
    <div className="app-shell" ref={shellRef}>
      {/* Skip links: off-screen until focused. "Skip to main content" lands on
          the workspace landmark below; "Skip to parameters" additionally jumps
          past the toolbar/viewer chrome straight to the parameter form, which
          saves more tabbing than a main-content jump alone, so it stays
          alongside rather than being replaced. Only the active layout is
          mounted below (see M7: a breakpoint change swaps the whole tree), so
          each href always matches the one target that actually exists:
          #params(-mobile), and #main-content on the mounted branch's root. */}
      <a className={SKIP_LINK_CLASS} href="#main-content">
        Skip to main content
      </a>
      <a className={SKIP_LINK_CLASS} href={isMobile ? "#params-mobile" : "#params"}>
        Skip to parameters
      </a>

      <span className="sr-only" role="status" aria-live="polite">
        {attentionAnnouncement}
      </span>

      {/* Only the active layout mounts (M7): desktop and mobile used to both
          render at once with CSS hiding one, doubling ParamForm/tab/search
          work and leaving stray focus targets in the hidden tree. Tab, search
          and viewer state are all hoisted above this split (panelState,
          sheetDetent, view, showDimensions, …) so switching trees here loses
          nothing.

          Each branch's root IS the page's <main> landmark (and carries
          #main-content + the pageHeading <h1>) rather than a shared wrapper
          around the split. .app-shell is a plain block, not flex, so both
          roots resolve their own height:100% against it and any box spliced
          in between would have to re-declare that height to avoid collapsing
          them. That's the only real cost of a wrapper: the overlays below
          anchor to these roots' own `position: relative`, which a wrapper
          would not disturb, but with two otherwise entirely different trees
          it buys back only three lines. Since exactly one branch is ever
          mounted, the duplicated id and heading resolve to one of each in the
          live tree. */}
      {isMobile ? (
        // ── Mobile layout ──
        // --sheet-follow-h (set live by handleSheetFollow) sizes the viewer so
        // its bottom edge tracks the sheet; data-sheet-dragging toggles the
        // easing. See .app-shell__mobile-viewer in CSS.
        // data-sheet-detent drives the full-detent CSS below: at Full the
        // sheet leaves a live model strip at the top, and the chrome floating
        // over that band is hidden (see the `[data-sheet-detent="full"]` rule
        // in index.css). A data attribute rather than a class so it reads as
        // one enum-valued piece of state, alongside the `data-sheet-dragging`
        // flag handleSheetFollow writes imperatively on the same element.
        <main
          id="main-content"
          tabIndex={-1}
          className="app-shell__mobile"
          data-sheet-detent={sheetDetent}
          ref={mobileRootRef}
        >
          {pageHeading}
          {/* Background content: viewer, top bar, floating controls. Marked
              `inert` while the sheet is at the Full detent (M16). Full
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
                mobile
              />

              {/* Mobile top bar: logo left, design centered, actions right
                  (mirrors desktop). Normally z-10 (below the bottom sheet,
                  z-30, so the full-detent sheet covers it and its drag handle
                  stays grabbable). While the output console is open it lifts
                  to z-[33] (above the scrim (z-[31]) and console (z-[32]))
                  so the design picker/⋮/bell stay tappable; the console only
                  opens at the peek detent, so this never fights the
                  full-detent sheet. */}
              <div className={cn(
                "mobile-top-bar absolute inset-x-0 top-0 grid min-h-12 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-b-(color:--glass-border) bg-(--glass-bg) pt-[calc(env(safe-area-inset-top,0px)+0.4rem)] pb-[0.4rem] pl-[calc(0.75rem+env(safe-area-inset-left,0px))] pr-[calc(0.75rem+env(safe-area-inset-right,0px))]",
                outputOpen ? "z-[33]" : "z-10"
              )}>
                <span className="inline-flex min-w-0 items-center gap-[0.4rem] justify-self-start overflow-hidden whitespace-nowrap px-[0.2rem] py-[0.3rem] text-[0.92rem] font-bold">
                  <BarBrand schema={schema} theme={theme} logoClassName="h-[1.3rem]" />
                </span>
                <div className="mobile-top-bar__center inline-flex min-w-0 items-center justify-self-center">
                  <DesignHeading
                    designs={designs}
                    designId={design.id}
                    label={design.label}
                    hasDoc={!!design.doc}
                    gallery={!!schema.ui?.gallery}
                    onChange={actions.designChange}
                    openPickerSignal={openPickerSignal}
                    onShowDoc={actions.showDesignDoc}
                    docClassName="mobile-top-bar__design-doc"
                  />
                </div>
                {/* The Output bell doubles as the render-status indicator (a
                    status dot rides its corner), so the narrow bar needs no
                    separate pill; theme/help/licenses collapse into a ⋮ overflow. */}
                <div className="inline-flex items-center gap-[0.4rem] justify-self-end">
                  <OutputToggle
                    outputOpen={outputOpen}
                    noticeCount={diagnostics.length}
                    showCount={!hasStatusPill}
                    onToggleOutput={toggleOutput}
                    status={{ rendering, ready, result, stale: stalePreview }}
                    className={cn(ICON_BUTTON_CLASS, "mobile-top-bar__output")}
                  />
                  <BarActions
                    themeMode={themeMode}
                    themeNext={themeNext}
                    collapse
                    onSavePng={showSaveImage ? handleSavePng : undefined}
                    canSavePng={exportable}
                    hasFiles={hasFiles}
                    // Live preview lives in the ⋮ menu on mobile: the sheet's
                    // Customize tab has no footer row to spare (see SheetTabs).
                    autoRender={autoRender}
                  />
                </div>
              </div>
            </div>

            {/* Floating action dock: the readiness pill and an optional
                after-export panel stacked above the same compact card the
                desktop floats over its viewer, riding immediately above the sheet's
                top edge (it follows the sheet up to the half detent via
                --sheet-follow-h) instead of a solid docked footer band that
                would reserve a strip of the viewport. The pill is the mobile
                half of the readiness surface: the sheet has no room for a
                status row, and this puts the warning against the Download
                button it gates. */}
            <ActionDock
              exportSuccess={exportSuccess}
              afterExport={afterExport}
              onDismissExportSuccess={onDismissExportSuccess}
              actionButtonsProps={actionButtonsProps}
              statusPill={dockStatusPill}
              onHeightChange={handleDockHeight}
            />

            <ViewerHUD {...hudProps} viewerRef={mobileViewerRef} />
          </div>

          {/* Output console (mobile): a dismissible overlay that slides up
              immediately above the COLLAPSED (peek) sheet. The sheet's tab row stays visible
              and tappable beneath it, with a scrim dimming only the viewer.
              Only ever shown at the peek detent (handleDetentChange closes it
              on any other change), so it never competes with the Full-detent
              modal sheet above. */}
          {outputOpen && (
            <button
              type="button"
              className="output-console__scrim absolute inset-x-0 top-0 bottom-[calc(var(--safe-area-bottom)+var(--mobile-peek-height))] z-[31] bg-black/40"
              onClick={closeOutput}
              aria-label="Close Messages"
            />
          )}
          <OutputConsole
            {...outputProps}
            className="absolute inset-x-0 bottom-[calc(var(--safe-area-bottom)+var(--mobile-peek-height))] z-[32] max-h-[55vh] rounded-t-(--radius) border-b-0 shadow-(--elevation)"
          />

          {/* Persistent bottom sheet. Modal at the Full detent, see
              BottomSheet's own focus-trap/restore effect, and the
              mobileBackgroundRef inert wiring above for its background half. */}
          <BottomSheet
            detent={sheetDetent}
            onDetentChange={handleDetentChange}
            onFollow={handleSheetFollow}
            onPeekHeightChange={handleSheetPeekHeight}
            onFullGapChange={handleSheetFullGap}
            peekHeight={PEEK_HEIGHT}
            bottomInset={safeAreaBottom}
          >
            {(_detent, expand) => (
              // The tab bar shows at every detent (including peek); tapping a tab
              // raises a collapsed sheet. Auto-render + Reset are param-scoped, so
              // they live inside the Parameters tab (SheetTabs), not here.
              // tabIndex -1: a skip link whose target isn't focusable moves
              // nothing, see #main-content below.
              <div className="sheet-content" id="params-mobile" tabIndex={-1}>
                <SheetTabs {...paramProps} onActivate={expand} sheetPill={sheetStatusPill} />
              </div>
            )}
          </BottomSheet>

          {/* One-time first-visit nudge: shown only once there's something to
              nudge towards (sheetHintArmed: otherwise it fades behind the boot
              overlay or the welcome popup) and while the sheet is still at peek
              (raising it dismisses the hint), riding immediately above the sheet's top
              edge. Actionable (not aria-hidden), see SheetSwipeHint. */}
          {showSheetHint && sheetDetent === "peek" && sheetHintArmed && (
            <SheetSwipeHint onDismiss={dismissSheetHint} />
          )}
        </main>
      ) : (
        // ── Desktop layout ──
        <div className="app-shell__desktop">
          <CommandBar
            schema={schema}
            designs={designs}
            designId={design.id}
            theme={theme}
            themeMode={themeMode}
            themeNext={themeNext}
            rendering={rendering}
            ready={ready}
            result={result}
            stalePreview={stalePreview}
            outputOpen={outputOpen}
            noticeCount={diagnostics.length}
            showCount={!hasStatusPill}
            onToggleOutput={toggleOutput}
            openPickerSignal={openPickerSignal}
            onSavePng={showSaveImage ? handleSavePng : undefined}
            canSavePng={exportable}
            hasFiles={hasFiles}
          />

          {/* The landmark starts BELOW CommandBar: CommandBar renders a
              <header>, i.e. the banner landmark, and a banner nested inside
              <main> is a landmark-nesting violation (axe
              landmark-banner-is-top-level). Mobile has no <header>: its top
              bar is a plain div, so that branch's root carries the landmark
              directly. */}
          <main
            id="main-content"
            // tabIndex -1 so activating "Skip to main content" moves focus INTO
            // the landmark. Without it the browser only shifts the sequential-
            // focus starting point: the next Tab lands in the right place, but
            // document.activeElement stays on <body>, so a screen reader never
            // announces the region it jumped to. Not tab-reachable itself, and
            // `:focus:not(:focus-visible)` in index.css keeps a click on the
            // canvas from drawing a focus ring.
            tabIndex={-1}
            className={`app-shell__canvas-area${panelSide === "right" ? " panel-right" : ""}`}
          >
            {pageHeading}
            {/* Docked panel: Presets / Parameters tabs (mirrors mobile). */}
            <ParamPanel
              {...paramProps}
              panelSide={panelSide}
              panelDefaultOpen={panelDefaultOpen}
              autoRender={autoRender}
            />

            {/* Canvas */}
            <div className="app-shell__viewer">
              <ViewerStage {...stageProps} viewerRef={desktopViewerRef} active>
                {/* Floating controls live inside viewer-wrap so they hover over the
                    canvas (which shrinks when the output console docks below it)
                    rather than overlapping the console's notices. The readiness
                    pill and an optional after-export panel stack above the dock
                    (see ACTION_DOCK_CLASS), exactly as they do on mobile. */}
                <ActionDock
                  exportSuccess={exportSuccess}
                  afterExport={afterExport}
                  onDismissExportSuccess={onDismissExportSuccess}
                  actionButtonsProps={actionButtonsProps}
                  statusPill={dockStatusPill}
                  onHeightChange={handleDockHeight}
                />
                <ViewerHUD {...hudProps} viewerRef={desktopViewerRef} />
              </ViewerStage>

              {/* Output console: inline below viewer */}
              <OutputConsole {...outputProps} className="max-h-56" />
            </div>
          </main>
        </div>
      )}

      <ReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        design={design}
        values={values}
        renderedValues={renderedValues}
        result={result}
        failure={failure}
        measured={measured}
        attention={attention}
        availableFontFamilies={availableFontFamilies}
        fontSuggestion={fontSuggestion}
        canExport={exportable}
        onOpenMessages={openMessagesFromReview}
      />
    </div>
  );
});
