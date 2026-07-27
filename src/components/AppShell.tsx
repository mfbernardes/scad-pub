// AppShell.tsx — responsive layout shell. Owns the full-bleed viewer canvas with:
//   Desktop (≥ 860px): CommandBar + docked ParamPanel + ActionCluster + ViewerHUD
//   Mobile (< 860px):  full-bleed viewer + top bar + BottomSheet + floating ActionCluster
// Both layouts float the same compact action cluster over the viewer bottom —
// mobile no longer reserves a solid footer band. All state/logic stays in
// App.tsx; this is a pure view extraction.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import type { Design, Schema, UiConfig, WorkerProgress } from "../openscad/types";
import type { Values, ParsedSet } from "../lib/presets";
import type { RenderResult } from "../openscad/types";
import type { RenderMetrics } from "../lib/renderMetrics";
import type { ViewerHandle, Dimensions } from "./Viewer";

// Peek shows just the drag handle + the tab bar (Presets/Parameters),
// ending at the tab underline — no sliver of the tab's content.
const PEEK_HEIGHT = 60;
// Stable empty-log identity so idle re-renders don't break memo'd children.
const EMPTY_LOG: string[] = [];
// The floating action cluster that wraps the ActionButtons row — a solid raised
// card shared verbatim by the desktop and mobile clusters so a tweak to
// padding/border lands once.
const ACTION_CLUSTER_CLASS =
  "action-cluster flex items-center gap-[0.3rem] whitespace-nowrap rounded-lg border-(color:--glass-border) border bg-(--glass-bg) px-[0.45rem] py-[0.35rem] shadow-(--elevation)";
// The bottom-anchored dock wrapping the action cluster (and, when shown, the
// after-export panel riding above it). Positioning (absolute/bottom/left/
// transform, plus the mobile sheet-follow override) lives on `.action-dock`
// in index.css; a plain flex column here means an ExportSuccess panel simply
// pushes the cluster down from a fixed bottom edge — no height measurement
// needed to stack the two.
const ACTION_DOCK_CLASS = "action-dock flex flex-col items-center gap-2";

import { CommandBar } from "./CommandBar";
import { ParamPanel } from "./ParamPanel";
import { ActionButtons } from "./ActionButtons";
import { ExportSuccess, type ExportSuccessState } from "./ExportSuccess";
import { OutputToggle } from "./OutputToggle";
import { BarActions } from "./BarActions";
import { IconButton, ICON_BUTTON_CLASS } from "./IconButton";
import { BookOpen as GuideIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { ViewerStage } from "./ViewerStage";
import { stageLoading } from "../lib/renderStatus";
import { ViewerHUD } from "./ViewerHUD";
import { DEFAULT_VIEW, type ViewName } from "./views";
import { OutputConsole } from "./OutputConsole";
import { BottomSheet, type SheetDetent } from "./BottomSheet";
import { SheetTabs } from "./SheetTabs";
import { DesignPicker } from "./DesignPicker";
import { BarBrand } from "./BarBrand";
import { parseDiagnostics, countBadges } from "../lib/diagnostics";
import { parseComputedInfo } from "../lib/computedInfo";
import {
  fontFaces,
  fontFamilyNames,
  mergeInstalledFonts,
  normalizeFamily,
  type FontFaceInfo,
} from "../lib/fonts";
import { isFontFile } from "../openscad/renderArgs";
import { svgPresent } from "../lib/svgFiles";
import { useAppActions } from "../lib/appActions";
import { useIsMobile } from "../lib/useIsMobile";
import { useSafeAreaBottom } from "../lib/useSafeAreaBottom";
import { usePanelState } from "../lib/usePanelState";
import { PARAM_SEARCH_INPUT_ID } from "./ParamSearch";
import { ns } from "../lib/appId";
import { readLocal, writeLocal } from "../lib/safeStorage";
import { GRID_PREF_KEY, initialGridVisible } from "../lib/viewerPrefs";
import { SHEET_INTRODUCED_KEY, initialSheetDetent } from "../lib/sheetPolicy";
import { SheetSwipeHint } from "./SheetSwipeHint";
import {
  deriveAttention,
  readinessState,
  type NoticeAttentionInput,
} from "../lib/readiness";
import { friendlyRenderError } from "../lib/friendlyErrors";
import { ReviewDialog } from "./ReviewDialog";
import { StatusStrip, type StatusStripProps } from "./StatusStrip";

const ADVANCED_SETTINGS_KEY = ns("settings.advanced");

// The bottom-anchored dock: the ActionButtons cluster, with an optional
// after-export panel riding above it (see ACTION_DOCK_CLASS's own doc). The
// desktop and mobile layouts each mount this verbatim inside their own
// positioning context (.app-shell__mobile / __desktop) — extracted so a tweak
// to either half's markup only has to land once instead of twice in step.
function ActionDock({
  exportSuccess,
  afterExport,
  onDismissExportSuccess,
  actionButtonsProps,
  statusPill,
}: {
  exportSuccess: ExportSuccessState | null;
  afterExport: UiConfig["afterExport"];
  onDismissExportSuccess: () => void;
  actionButtonsProps: ComponentProps<typeof ActionButtons>;
  /** The readiness pill, stacked directly above the cluster (StatusStrip).
   *  Undefined in the states that shouldn't announce anything — see
   *  `dockStatusPill` below. */
  statusPill?: Omit<StatusStripProps, "className">;
}) {
  return (
    <div className={ACTION_DOCK_CLASS}>
      {exportSuccess && (
        <ExportSuccess
          state={exportSuccess}
          title={afterExport?.title}
          body={afterExport?.body}
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
  rendering: boolean;
  ready: boolean;
  /** The render worker's bootstrap-download progress; null once ready (or
   *  never set at all on a warm Cache Storage hit). Surfaced by ViewerStage's
   *  loading overlay as a thin progress bar. */
  loadProgress: WorkerProgress | null;
  autoRender: boolean;
  stalePreview: boolean;
  /** A successful render that still matches the live controls — the only
   * state Download/Image may act on. See docs/architecture-review.md H1. */
  exportable: boolean;
  theme: "dark" | "light";
  themeMode: "light" | "dark" | "auto";
  /** Incremented by the intro popup's primary CTA to open the design picker. */
  openPickerSignal: number;
  /** Whether the config's welcome popup (schema.popup) is currently up. It is
   *  the one modal that opens unbidden on a first visit and covers the whole
   *  app, so the first-visit sheet nudge holds until it's gone — see
   *  `sheetHintArmed` below. */
  introOpen: boolean;
  /** Non-null right after a successful export, when the config's
   *  `ui.afterExport` opts into the panel — see ExportSuccess.tsx. Null the
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
  openPickerSignal,
  introOpen,
  exportSuccess,
  onDismissExportSuccess,
}: Props) {
  const actions = useAppActions();
  const essentialsEnabled = schema.ui?.essentials === true;
  const [showAdvanced, setShowAdvanced] = useState(() =>
    essentialsEnabled ? readLocal(ADVANCED_SETTINGS_KEY) === "true" : true
  );
  const handleShowAdvancedChange = useCallback((show: boolean) => {
    setShowAdvanced(show);
    writeLocal(ADVANCED_SETTINGS_KEY, String(show));
  }, []);
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
  // Whether the viewer draws its reference grid. Unlike the other HUD controls
  // this isn't config-gated — the button is always offered; `ui.grid` only
  // seeds the first-ever value, after which the visitor's own choice persists
  // (see src/lib/viewerPrefs.ts). Shared across both layouts, like the
  // dimension toggle above, so it survives a desktop⇄mobile breakpoint switch.
  const [showGrid, setShowGrid] = useState(() => initialGridVisible(readLocal(GRID_PREF_KEY), schema));
  const toggleGrid = useCallback(() => {
    setShowGrid((v) => {
      const next = !v;
      writeLocal(GRID_PREF_KEY, next ? "on" : "off");
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
  // First-visit mobile bottom-sheet policy (src/lib/sheetPolicy.ts): on a mobile
  // visitor's genuine first visit the settings sheet opens partway ("half" on a
  // tall viewport, "peek" on a short/landscape one) so a new visitor sees the
  // settings exist while the model stays meaningfully visible; every later visit
  // starts at "peek". Desktop never uses the sheet, so it keeps the prior "peek"
  // default, touches no storage, and shows no hint.
  //
  // Resolved once, on mount, in a single lazy pass held in a ref rather than two
  // useState initializers, because the detent and the hint share one decision:
  // the detent branch SETS the introduced flag, so a second initializer
  // re-reading it could no longer tell this was a first visit. Deciding both
  // together — before that write is observable to any later read — keeps them
  // consistent, and the write itself is the once-per-browser guard (the flag
  // exists ever after, so `firstVisitPeek` can only ever be true on this mount).
  const initialSheet = useRef<{ detent: SheetDetent; firstVisitPeek: boolean } | null>(null);
  if (initialSheet.current === null) {
    if (!isMobile || readLocal(SHEET_INTRODUCED_KEY) !== null) {
      initialSheet.current = { detent: "peek", firstVisitPeek: false };
    } else {
      const detent = initialSheetDetent(window.innerHeight, window.innerWidth > window.innerHeight);
      writeLocal(SHEET_INTRODUCED_KEY, "1");
      initialSheet.current = { detent, firstVisitPeek: detent === "peek" };
    }
  }
  // Sheet detent state (peek/half/full). On mobile the output overlay now covers
  // the sheet, so it no longer has to be positioned relative to the detent.
  const [sheetDetent, setSheetDetent] = useState<SheetDetent>(initialSheet.current.detent);
  // Whether to show the one-time "Swipe up for settings" nudge — true only on a
  // first-visit mount that resolved to peek (a half-open sheet needs no nudge).
  // Dismissed on the first sheet interaction or a timeout (SheetSwipeHint), and
  // permanently false thereafter for this session.
  const [showSheetHint, setShowSheetHint] = useState(initialSheet.current.firstVisitPeek);
  const dismissSheetHint = useCallback(() => setShowSheetHint(false), []);
  // …but not before there's anything to nudge the visitor TOWARDS. The nudge's
  // fade timeout runs from the moment it mounts (SheetSwipeHint), so it must
  // not mount while the visitor can't act on it — otherwise the whole
  // once-per-browser nudge expires unseen and, since the introduced flag was
  // written on mount, never comes back. Two ways that happens, both invisible
  // on a fast machine and both certain on a slow phone:
  //   • first-run boot — a cold ~10 MB engine download plus the first render
  //     easily outlasts the timeout, leaving the nudge to fade behind the
  //     "Getting things ready…" overlay. Same signal ViewerGestureHint arms on.
  //   • the config's welcome popup — the one modal that opens by itself on a
  //     first visit and covers everything, including this chip. A visitor who
  //     reads it (or, in `popup.mode: "picker"`, browses the design cards) for
  //     longer than the timeout would come out the other side to nothing.
  // Not sticky: a later design switch re-raises the loading overlay, and it's
  // better to re-show the still-undismissed nudge over the new model than to
  // let it tick away over a spinner. Once the visitor touches the sheet (or it
  // times out while genuinely visible) `showSheetHint` retires it for good.
  const sheetHintArmed = !introOpen && !stageLoading({ ready, rendering, result });

  // Panel tab + search state (see M7): hoisted here — above the desktop/mobile
  // split below — so ONLY the active layout mounts (ParamPanel or SheetTabs,
  // never both), yet a breakpoint change (or a real rotation) doesn't reset
  // the tab, clear the search box, or drop focus, since neither component owns
  // this state locally anymore.
  const panelState = usePanelState(bundled.length > 0);
  // Restore keyboard focus to the search input across a layout switch when it
  // held focus just before the switch (tracked by ParamSearch's onFocus/onBlur
  // via searchFocusedRef). Runs in a layout effect so it fires after the new
  // layout's DOM (with the same #param-search-input id) is committed, before
  // the browser paints — otherwise the switch would silently drop focus to
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

  const ui = schema.ui ?? {};
  const panelSide = ui.panelSide ?? "left";
  const panelDefaultOpen = (ui.panelDefault ?? "open") === "open";
  // Variable names are developer detail — hidden unless a config opts in.
  const showVarName = ui.showVarName === true;
  // Configurable tab/section labels (default to the built-in names).
  const presetsLabel = ui.presetsLabel ?? "Presets";
  const parametersLabel = ui.parametersLabel ?? "Customize";
  // Whether the viewer offers the measure (dimensions) toggle. Off hides the HUD
  // ruler button; the overlay + panel are only reachable through it, so they
  // stay hidden too.
  const showMeasure = ui.measure !== false;
  // Whether the "Save image (PNG)" action is offered (default true). Off hides
  // it in both secondary-action surfaces (desktop CommandBar and mobile ⋮ menu).
  const showSaveImage = ui.saveImage !== false;
  // Whether the viewer offers the view picker (camera-angle menu).
  const showViewPicker = ui.viewPicker !== false;
  // Whether the viewer offers the "reset view" button.
  const showReset = ui.reset !== false;
  // Whether the viewer offers the zoom in/out buttons (off by default).
  const showZoom = ui.zoom === true;
  // Whether the viewer offers the fullscreen toggle (where it works at all).
  const showFullscreen = ui.fullscreen !== false;
  // Optional after-export success panel (see ExportSuccess.tsx). Undefined
  // when the config never set `ui.afterExport` — `exportSuccess` stays null
  // forever in that case (App.tsx never sets it), so the panel just never mounts.
  const afterExport = ui.afterExport;

  const log = result?.log ?? EMPTY_LOG;
  // Memoized so a config without `notices` doesn't hand a fresh `[]` to the
  // useMemo hooks below on every render.
  const notices = useMemo(() => schema.notices ?? [], [schema.notices]);
  // Gates the toolbar's "Files" action (BarActions) — the actual FilesModal
  // (import button + imported-file list) is hosted in App.tsx alongside
  // Help/Licenses/DesignDoc, opened via AppActions' `showFiles`. Neither
  // ParamPanel nor SheetTabs knows about file imports anymore now that Files
  // is no longer a panel tab.
  const hasFiles = schema.fileImport != null;

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

  // The SVG drawings the renderer can resolve right now: the bundled assets
  // (schema.assets) plus any imported `.svg`. An `@svg` control compares its
  // filename value against this so removing an in-use drawing surfaces a
  // missing-file hint at the control — the SVG mirror of the missing-font hint.
  const availableSvgFiles = useMemo(
    () => svgPresent([...(schema.assets ?? []), ...Object.keys(userFiles)]),
    [schema.assets, userFiles]
  );

  // Parse the log once here; the OutputConsole (Notices tab count chips) reads
  // this derived data instead of re-parsing it.
  const diagnostics = useMemo(() => parseDiagnostics(log, notices), [log, notices]);
  const badges = useMemo(() => countBadges(log, notices), [log, notices]);
  // Rows from `echo("@info", label, unit, value)` — internally-calculated
  // values the design surfaced at render time (see lib/computedInfo.ts).
  const computedInfo = useMemo(() => parseComputedInfo(log), [log]);

  // Production-readiness (src/lib/readiness.ts): a structured, typed list of
  // real gaps between "rendered" and "ready to ship" — a font param whose
  // selected family isn't loaded, or a flagged notice category with a pending
  // notice — plus the overall state that drives the status strip/dock/review
  // dialog. `badges` (already computed above for the Notices tab) gives each
  // notice category's live pending count; joined here with the category's own
  // config-declared `attention`/`labelOne` so deriveAttention can decide which
  // ones matter without re-scanning the raw log itself.
  const noticeAttentionInputs: NoticeAttentionInput[] = useMemo(
    () =>
      notices.map((n) => ({
        marker: n.marker,
        label: n.label,
        labelOne: n.labelOne,
        attention: n.attention === true,
        subsumedByFont: n.subsumedByFont === true,
        count: badges.find((b) => b.key === `notice:${n.marker}`)?.count ?? 0,
      })),
    [notices, badges]
  );
  // Attention-flagged diagnostics that aren't already one of the notice
  // categories above — see readiness.ts's `DeriveAttentionInputs.diagnostics`
  // for why `level === "notice"` is excluded here.
  //
  // Only surfaced for a render that actually SUCCEEDED: a currently-FAILED
  // render's own diagnostics (e.g. the very assert that failed it) are
  // already explained by the Review dialog's friendly-failure card (see
  // `failure` below) — stacking them as attention items too would just
  // repeat the same message under a second heading. readinessState's own
  // failed > attention precedence already keeps the overall readiness state
  // correct either way, but the Review dialog renders `attention` cards
  // unconditionally alongside a failure card, so the gate has to live here.
  const diagnosticAttentionInputs: string[] = useMemo(
    () =>
      result?.ok ? diagnostics.filter((d) => d.attention && d.level !== "notice").map((d) => d.text) : [],
    [diagnostics, result]
  );
  const attention = useMemo(
    () =>
      deriveAttention({
        params: design.params,
        values,
        availableFontFamilies,
        notices: noticeAttentionInputs,
        diagnostics: diagnosticAttentionInputs,
      }),
    [design.params, values, availableFontFamilies, noticeAttentionInputs, diagnosticAttentionInputs]
  );
  // `result` is the only render outcome readiness cares about: null until a
  // FIRST render has ever landed (readinessState's "building"), regardless of
  // whether a later live edit is currently re-rendering over it — matching
  // the viewer's own "Building your preview…" vs. "Updating…" distinction.
  const readiness = useMemo(() => readinessState(result ? result.ok : null, attention), [result, attention]);
  // A pending notice belongs to an `attention: true` category (or is one of
  // OpenSCAD's own hardcoded warning/assert lines, always attention) — the
  // ONLY thing that should colour the Messages bell/console amber. An
  // informational note alone must never contradict a "Ready to download"
  // status strip (see readiness.ts).
  const hasNoticeAttention = useMemo(() => diagnostics.some((d) => d.attention), [diagnostics]);
  // Friendly {title, body, technical} mapping of a failed render, shared by
  // the Notices tab (OutputConsole) and the Review dialog so a failure reads
  // identically wherever it surfaces. Null on a missing/successful result.
  const failure = useMemo(() => friendlyRenderError(result), [result]);

  // Review dialog: one instance, its content and footer driven entirely by the
  // live `readiness`/`attention`/`failure` above — both entry points (the dock
  // Download button and the status strip) open the identical dialog; the footer
  // reflects the current review state, not how it was opened. See ReviewDialog's
  // own doc.
  const [reviewOpen, setReviewOpen] = useState(false);
  const openReview = useCallback(() => {
    setReviewOpen(true);
  }, []);
  // The dock's Download click: a ready render downloads directly (subject to
  // the same `exportable` safety gate exportModel itself re-checks); anything
  // else (attention/failed/building) opens the review dialog instead of doing
  // nothing or exporting something stale/broken.
  const handleDownloadClick = useCallback(() => {
    if (readiness === "ready") {
      if (exportable) actions.exportModel();
      return;
    }
    openReview();
  }, [readiness, exportable, actions, openReview]);

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

  // Open the overlay and collapse the sheet to peek, so the overlay's fixed
  // anchor (just above the peek tab row) never overlaps an expanded sheet.
  const openOutput = useCallback(() => {
    setOutputOpen(true);
    setSheetDetent("peek");
  }, []);

  const toggleOutput = useCallback(() => {
    if (outputOpenRef.current) setOutputOpen(false);
    else openOutput();
  }, [openOutput]);

  // Raising the sheet off peek (dragging the handle OR tapping a tab) would slide
  // its content up under the overlay — close the overlay on any such change so
  // the two are never shown at once.
  const handleDetentChange = useCallback((d: SheetDetent) => {
    setSheetDetent(d);
    if (d !== "peek") {
      setOutputOpen(false);
      // The visitor has opened the sheet, so the first-visit nudge has done its
      // job — retire it for good. Without this a keyboard user who expands then
      // collapses the sheet before the timeout would see the hint return.
      setShowSheetHint(false);
    }
  }, []);

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
  // --mobile-peek-height, so the output console overlay + scrim anchor to the
  // real row instead of the static CSS fallback, which font scaling can
  // exceed. See BottomSheet's onPeekHeightChange doc.
  const handleSheetPeekHeight = useCallback((heightPx: number) => {
    const el = mobileRootRef.current;
    if (!el) return;
    el.style.setProperty("--mobile-peek-height", `${Math.round(heightPx)}px`);
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
    if (hasProblem) {
      setOutputOpen(true);
      setSheetDetent("peek"); // mobile: anchor the overlay above the peek sheet
    }
  }

  const closeOutput = useCallback(() => setOutputOpen(false), []);

  // "View messages" (the review dialog's notice-attention cards) closes the
  // dialog and opens the console — the same anchor-above-peek behaviour as
  // the bell.
  const openMessagesFromReview = useCallback(() => {
    setReviewOpen(false);
    openOutput();
  }, [openOutput]);

  // Whether the dock shows its readiness pill (StatusStrip), shared verbatim
  // by both layouts: only the two states that want a look at the Review dialog.
  // "ready" needs no announcement — the Download button right below it is the
  // confirmation — and "building" is already narrated by the viewer's own
  // loading overlay, so a pill in either state would be noise over the model.
  const hasStatusPill = readiness === "attention" || readiness === "failed";

  // Prop bundles shared verbatim by the two layout trees — each invocation
  // below adds only its layout-specific bits (viewer ref, active flag, …).
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
    showGrid,
    view,
    onMeasure: setMeasured,
    measured,
    renderedValues,
    values,
    computedInfo,
    // While the first-visit "swipe up for settings" nudge is up — or still
    // waiting to arm — suppress the viewer's own gesture hint so the two
    // one-time chips never stack over the sheet's top edge (they share that
    // slot) and the sheet nudge always goes first. Only ever true on mobile.
    // The gesture hint sits in the same bottom-centre slot the dock's readiness
    // pill takes (`.viewer-hint` is offset just above `.action-dock`), so the
    // pill suppresses it exactly as the sheet nudge does — hidden, not
    // dismissed, so it can still teach the gesture once the pill clears.
    suppressGestureHint: (isMobile && showSheetHint) || hasStatusPill,
  };
  const hudProps = {
    visible: !!result?.ok,
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
    failure,
  };
  const actionButtonsProps = {
    canExport: exportable,
    modelFormat: schema.format,
    readiness,
    attentionCount: attention.length,
    onDownloadClick: handleDownloadClick,
  };
  const dockStatusPill = hasStatusPill
    ? { readiness, attentionCount: attention.length, onOpen: openReview }
    : undefined;
  return (
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
        <div className="app-shell__mobile" ref={mobileRootRef}>
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
                mobile
              />

              {/* Mobile top bar — logo left, design centered, actions right
                  (mirrors desktop). Normally z-10 (below the bottom sheet,
                  z-30, so the full-detent sheet covers it and its drag handle
                  stays grabbable). While the output console is open it lifts
                  to z-[33] — above the scrim (z-[31]) and console (z-[32]) —
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
                  {designs.length > 1 ? (
                    <DesignPicker
                      designs={designs}
                      value={design.id}
                      onChange={actions.designChange}
                      openSignal={openPickerSignal}
                      active={isMobile}
                      gallery={schema.ui?.gallery}
                    />
                  ) : (
                    <span className="whitespace-nowrap px-[0.2rem] py-[0.3rem] text-[0.85rem] font-semibold">
                      {design.label}
                    </span>
                  )}
                  {design.doc && (
                    <IconButton
                      label="Design guide"
                      title="About this design"
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
                    hasAttention={hasNoticeAttention}
                    onToggleOutput={toggleOutput}
                    status={{ rendering, ready, result, stale: stalePreview }}
                    className={cn(ICON_BUTTON_CLASS, "mobile-top-bar__output")}
                  />
                  <BarActions
                    themeMode={themeMode}
                    collapse
                    onSavePng={showSaveImage ? handleSavePng : undefined}
                    canSavePng={exportable}
                    hasFiles={hasFiles}
                    // Live preview lives in the ⋮ menu on mobile — the sheet's
                    // Customize tab has no footer row to spare (see SheetTabs).
                    autoRender={autoRender}
                  />
                </div>
              </div>
            </div>

            {/* Floating action dock — the readiness pill and an optional
                after-export panel stacked above the same compact card the
                desktop floats over its viewer, riding just above the sheet's
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
            />

            <ViewerHUD {...hudProps} viewerRef={mobileViewerRef} />
          </div>

          {/* Output console (mobile): a dismissible overlay that slides up just
              above the COLLAPSED (peek) sheet — the sheet's tab row stays visible
              and tappable beneath it — with a scrim dimming only the viewer.
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

          {/* Persistent bottom sheet. Modal at the Full detent — see
              BottomSheet's own focus-trap/restore effect, and the
              mobileBackgroundRef inert wiring above for its background half. */}
          <BottomSheet
            detent={sheetDetent}
            onDetentChange={handleDetentChange}
            onFollow={handleSheetFollow}
            onPeekHeightChange={handleSheetPeekHeight}
            peekHeight={PEEK_HEIGHT}
            bottomInset={safeAreaBottom}
          >
            {(_detent, expand) => (
              // The tab bar shows at every detent (including peek); tapping a tab
              // raises a collapsed sheet. Auto-render + Reset are param-scoped, so
              // they live inside the Parameters tab (SheetTabs), not here.
              <div className="sheet-content" id="params-mobile">
                <SheetTabs
                  design={design}
                  values={values}
                  bundled={bundled}
                  userPresets={userPresets}
                  selected={selectedPreset}
                  presetBaseline={presetBaseline}
                  presetName={presetName}
                  baseline={baseline}
                  changedParams={changedParams}
                  availableFontFamilies={availableFontFamilies}
                  fontSuggestion={fontSuggestion}
                  installedFonts={installedFonts}
                  availableSvgFiles={availableSvgFiles}
                  onActivate={expand}
                  showVarName={showVarName}
                  presetsLabel={presetsLabel}
                  parametersLabel={parametersLabel}
                  showAdvanced={showAdvanced}
                  onShowAdvancedChange={handleShowAdvancedChange}
                  tab={panelState.tab}
                  onTabChange={panelState.setTab}
                  search={panelState.search}
                  onSearchChange={panelState.setSearch}
                  onSearchFocus={handleSearchFocus}
                  onSearchBlur={handleSearchBlur}
                />
              </div>
            )}
          </BottomSheet>

          {/* One-time first-visit nudge: shown only once there's something to
              nudge towards (sheetHintArmed — otherwise it fades behind the boot
              overlay or the welcome popup) and while the sheet is still at peek
              (raising it dismisses the hint), riding just above the sheet's top
              edge. Actionable (not aria-hidden) — see SheetSwipeHint. */}
          {showSheetHint && sheetDetent === "peek" && sheetHintArmed && (
            <SheetSwipeHint onDismiss={dismissSheetHint} />
          )}
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
            noticeCount={diagnostics.length}
            hasAttention={hasNoticeAttention}
            onToggleOutput={toggleOutput}
            openPickerSignal={openPickerSignal}
            pickerActive={!isMobile}
            onSavePng={showSaveImage ? handleSavePng : undefined}
            canSavePng={exportable}
            hasFiles={hasFiles}
          />

          <div className={`app-shell__canvas-area${panelSide === "right" ? " panel-right" : ""}`}>
            {/* Docked panel: Presets / Parameters tabs (mirrors mobile). */}
            <ParamPanel
              design={design}
              values={values}
              bundled={bundled}
              userPresets={userPresets}
              selectedPreset={selectedPreset}
              presetBaseline={presetBaseline}
              presetName={presetName}
              baseline={baseline}
              changedParams={changedParams}
              availableFontFamilies={availableFontFamilies}
              fontSuggestion={fontSuggestion}
              installedFonts={installedFonts}
              availableSvgFiles={availableSvgFiles}
              panelSide={panelSide}
              panelDefaultOpen={panelDefaultOpen}
              showVarName={showVarName}
              autoRender={autoRender}
              presetsLabel={presetsLabel}
              parametersLabel={parametersLabel}
              showAdvanced={showAdvanced}
              onShowAdvancedChange={handleShowAdvancedChange}
              panelTab={panelState.tab}
              onPanelTabChange={panelState.setTab}
              search={panelState.search}
              onSearchChange={panelState.setSearch}
              onSearchFocus={handleSearchFocus}
              onSearchBlur={handleSearchBlur}
            />

            {/* Canvas */}
            <div className="app-shell__viewer">
              <ViewerStage {...stageProps} viewerRef={desktopViewerRef} active>
                {/* Floating controls live inside viewer-wrap so they hover over the
                    canvas — which shrinks when the output console docks below it —
                    rather than overlapping the console's notices. The readiness
                    pill and an optional after-export panel stack above the dock
                    (see ACTION_DOCK_CLASS), exactly as they do on mobile. */}
                <ActionDock
                  exportSuccess={exportSuccess}
                  afterExport={afterExport}
                  onDismissExportSuccess={onDismissExportSuccess}
                  actionButtonsProps={actionButtonsProps}
                  statusPill={dockStatusPill}
                />
                <ViewerHUD {...hudProps} viewerRef={desktopViewerRef} />
              </ViewerStage>

              {/* Output console — inline below viewer */}
              <OutputConsole {...outputProps} className="max-h-56" />
            </div>
          </div>
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
