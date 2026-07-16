// AppShell.tsx — responsive layout shell. Owns the full-bleed viewer canvas with:
//   Desktop (≥ 860px): CommandBar + docked ParamPanel + ActionCluster + ViewerHUD
//   Mobile (< 860px):  full-bleed viewer + top bar + BottomSheet + floating ActionCluster
// Both layouts float the same compact action cluster over the viewer bottom —
// mobile no longer reserves a solid footer band. All state/logic stays in
// App.tsx; this is a pure view extraction.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Design, Schema } from "../openscad/types";
import type { Values, ParsedSet } from "../lib/presets";
import type { RenderResult, WorkerProgress } from "../openscad/types";
import type { RenderMetrics } from "../lib/renderMetrics";
import type { SettingsView, ExperienceMode } from "../lib/useExperience";
import type { PauseReason } from "../lib/renderState";
import type { ViewerHandle, Dimensions } from "./Viewer";
import type { ChecklistState } from "../lib/checklist";
import type { NoticeAttentionInput } from "../lib/readiness";
import { deriveAttention } from "../lib/readiness";
import { quickStartAvailable } from "../lib/quickStart";
import { initialSheetDetent } from "../lib/sheetDetent";
import { makeOnceFlag } from "../lib/prefs";
import { pauseReasonText } from "../lib/pauseReason";
import { t } from "../lib/i18n";
import { friendlyRenderError } from "../lib/friendlyErrors";
import { hiddenAdvancedDiff } from "../lib/paramFilter";
import { defaultsFor } from "../lib/presets";

// Peek shows just the drag handle + the tab bar (Presets/Parameters/Files),
// ending at the tab underline — no sliver of the tab's content.
const PEEK_HEIGHT = 60;
// Stable empty-log identity so idle re-renders don't break memo'd children.
const EMPTY_LOG: string[] = [];
// The floating action cluster that wraps the ActionButtons row — a solid raised
// card shared verbatim by the desktop and mobile clusters so a tweak to
// padding/border lands once.
const ACTION_CLUSTER_CLASS =
  // flex-wrap + a viewport-relative max-width (matching .action-dock's own
  // budget in index.css — a plain `max-w-full`/100% doesn't resolve
  // reliably here since this row's containing block, .action-dock, is
  // itself shrink-to-fit rather than a definite width): at a narrow
  // viewport the three buttons' combined preferred width (the two-line
  // export CTA especially) can exceed even a fully shrunk row, so instead
  // of relying on shrinking alone (which can only go so far — the CTA's own
  // main label deliberately stays on one line), the row wraps Image/Share
  // onto a second line below Export rather than spilling past the screen
  // edge. Verified at a 320px viewport (the narrowest realistic target).
  "action-cluster flex w-[min(calc(100vw-1.5rem),24rem)] flex-wrap items-center justify-center gap-[0.3rem] rounded-lg border-(color:--glass-border) border bg-(--glass-bg) px-[0.45rem] py-[0.35rem] shadow-(--elevation)";
// Wraps the action cluster (and, when present, the after-export panel riding
// above it) — see .action-dock in index.css for the shared bottom-anchored
// positioning both layouts used to put directly on .action-cluster. Anchoring
// the WRAPPER's bottom edge, not the cluster's own, means the cluster's own
// screen position never moves when the panel appears/disappears above it: the
// box just grows upward, since its height is auto and only its bottom edge is
// pinned.
const ACTION_DOCK_CLASS = "action-dock flex flex-col items-center gap-2";
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
import { OutputToggle } from "./OutputToggle";
import { BarActions } from "./BarActions";
import { IconButton, ICON_BUTTON_CLASS } from "./IconButton";
import { BookOpen as GuideIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { ViewerStage } from "./ViewerStage";
import { ViewerHUD } from "./ViewerHUD";
import { DEFAULT_VIEW, type ViewName } from "./views";
import { OutputConsole } from "./OutputConsole";
import { BottomSheet, type SheetDetent } from "./BottomSheet";
import { SheetTabs } from "./SheetTabs";
import { DesignPicker } from "./DesignPicker";
import { DesignPickerButton } from "./DesignPickerButton";
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
import { useAppActions } from "../lib/appActions";
import { useIsMobile } from "../lib/useIsMobile";
import { useSafeAreaBottom } from "../lib/useSafeAreaBottom";
import { usePanelState } from "../lib/usePanelState";
import { PARAM_SEARCH_INPUT_ID } from "./ParamSearch";

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
  // Whether QuickStart is the active guide for the CURRENT design+view — the
  // same predicate CustomizeTab gates its own step UI on (quickStart.ts),
  // computed ONCE here and threaded to both GettingStarted mount points
  // (ParamPanel/SheetTabs) so the checklist's compact-vs-full form (PR14)
  // can never disagree with whether QuickStart is actually showing.
  const quickStartActive = quickStartAvailable(design, experienceMode, settingsView, quickStartEnabled);
  // The getting-started checklist's full input state (src/lib/checklist.ts):
  // schema/render facts already available here, plus the session-scoped
  // progress App.tsx tracks (checklistProgress, threaded down because the
  // Help modal replay row — a sibling of AppShell — must reach the same
  // dismiss flag; see GettingStarted.tsx). Assembled below, once `attention`
  // (readiness.ts) is available — see that computation's own comment.

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

  // src/lib/readiness.ts's attention items: real, verifiable gaps between a
  // successful render and genuine production-readiness (a font param whose
  // selected family isn't loaded, or a flagged `notices` category with a
  // pending notice this render — see NoticeCategory.attention). Pairs each
  // configured category with its live pending count from `badges` (already
  // computed above), so a category flagged `attention: true` in the config
  // only surfaces here once it actually has something pending, not merely
  // because it's configured.
  const noticeAttentionInputs = useMemo<NoticeAttentionInput[]>(
    () =>
      notices.map((n) => ({
        marker: n.marker,
        label: n.label,
        attention: n.attention === true,
        count: badges.find((b) => b.key === `notice:${n.marker}`)?.count ?? 0,
      })),
    [notices, badges]
  );
  const attention = useMemo(
    () =>
      deriveAttention({
        params: design.params,
        values,
        availableFontFamilies,
        notices: noticeAttentionInputs,
      }),
    [design, values, availableFontFamilies, noticeAttentionInputs]
  );

  const checklistState: ChecklistState = {
    enabled: showChecklist,
    designCount: designs.length,
    designChanged: checklistProgress.designChanged,
    paramInteracted: checklistProgress.paramInteracted,
    exported: checklistProgress.exported,
    rendering,
    resultOk: result ? result.ok : null,
    hasAttention: attention.length > 0,
  };

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

  // Friendly render-failure summary (see src/lib/friendlyErrors.ts) — null
  // whenever the latest render didn't fail. Recomputed only when `result`
  // itself changes (title/body/technical are a pure function of it).
  const friendlyError = useMemo(() => friendlyRenderError(result), [result]);
  // hiddenAdvancedDiff's inputs, mirroring CustomizeTab's own computation
  // exactly — the friendly-error card's "Review hidden settings" action must
  // use the SAME deterministic rule as the Customize tab's "Review" chip, not
  // a re-derived approximation.
  const defaults = useMemo(() => defaultsFor(design), [design]);
  const hasHiddenDiff = useMemo(
    () => hiddenAdvancedDiff(design.params, values, defaults, settingsView).length > 0,
    [design, values, defaults, settingsView]
  );
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
  const handleReviewSettings = useCallback(() => {
    panelState.setTab("params");
    if (isMobile) setSheetDetent("half");
    focusPanelSearch();
  }, [panelState, isMobile, focusPanelSearch]);

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
    panelState.setTab("params");
    if (isMobile) setSheetDetent("half");
    setReviewHiddenSignal((n) => n + 1);
  }, [panelState, isMobile]);

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
    if (d !== "peek") setOutputOpen(false);
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
    view,
    onMeasure: setMeasured,
    measured,
    renderedValues,
    computedInfo,
    showGestureHint,
  };
  const hudProps = {
    // The HUD (camera controls) follows whatever model is actually displayed:
    // the latest success, or the retained last-good geometry after a failure.
    visible: !!result?.ok || lastPreviewKept,
    measure: showMeasure,
    showDimensions,
    onToggleDimensions: toggleDimensions,
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
    showReviewHidden: hasHiddenDiff,
    onReviewSettings: handleReviewSettings,
    onReviewHiddenSettings: handleReviewHiddenSettings,
    onRetryRender: actions.render,
  };
  const actionButtonsProps = {
    canExport: exportable,
    modelFormat: schema.format,
    onSavePng: handleSavePng,
    hasAttention: attention.length > 0,
  };
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
                  {designs.length > 1 && schema.ui?.gallery ? (
                    <DesignPickerButton design={design} />
                  ) : designs.length > 1 ? (
                    <DesignPicker
                      designs={designs}
                      value={design.id}
                      onChange={actions.designChange}
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
                    onToggleOutput={toggleOutput}
                    status={{ rendering, ready, result, stale: stalePreview }}
                    className={cn(ICON_BUTTON_CLASS, "mobile-top-bar__output")}
                  />
                  <BarActions themeMode={themeMode} collapse />
                </div>
              </div>
            </div>

            {/* Floating action cluster — the same compact card the desktop
                floats over its viewer, riding just above the sheet's top edge
                (it follows the sheet up to the half detent via
                --sheet-follow-h) instead of a solid docked footer band that
                would reserve a strip of the viewport. Identical markup +
                buttons to the desktop cluster. The after-export panel (when
                shown) rides directly above it in the same dock, never
                covering it — see ACTION_DOCK_CLASS's doc. */}
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
              <div className={ACTION_CLUSTER_CLASS}>
                <ActionButtons {...actionButtonsProps} />
              </div>
            </div>

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
              aria-label="Close messages"
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
            onHandleInteract={dismissSheetHint}
            hint={sheetHintVisible ? t("hint.dragForSettings") : undefined}
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
                  fileImport={fileImport}
                  loadedFiles={loadedFiles}
                  availableFontFamilies={availableFontFamilies}
                  fontSuggestion={fontSuggestion}
                  installedFonts={installedFonts}
                  onActivate={expand}
                  showVarName={showVarName}
                  autoRender={autoRender}
                  presetsLabel={presetsLabel}
                  parametersLabel={parametersLabel}
                  tab={panelState.tab}
                  onTabChange={panelState.setTab}
                  search={panelState.search}
                  onSearchChange={panelState.setSearch}
                  onSearchBlur={onParamSearchHiddenBlur}
                  settingsView={settingsView}
                  experienceMode={experienceMode}
                  quickStartEnabled={quickStartEnabled}
                  focusHiddenDiffSignal={reviewHiddenSignal}
                  checklist={checklistState}
                  checklistReplaySignal={checklistReplaySignal}
                  quickStartActive={quickStartActive}
                  sheetDetent={sheetDetent}
                  attention={attention}
                  onOpenMessages={openOutput}
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
            noticeCount={diagnostics.length}
            onToggleOutput={toggleOutput}
            openPickerSignal={openPickerSignal}
            pickerActive={!isMobile}
          />

          <div className={`app-shell__canvas-area${panelSide === "right" ? " panel-right" : ""}`}>
            {/* Docked panel: Presets / Parameters / Files tabs (mirrors mobile). */}
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
              fileImport={fileImport}
              loadedFiles={loadedFiles}
              availableFontFamilies={availableFontFamilies}
              fontSuggestion={fontSuggestion}
              installedFonts={installedFonts}
              panelSide={panelSide}
              panelDefaultOpen={panelDefaultOpen}
              showVarName={showVarName}
              autoRender={autoRender}
              presetsLabel={presetsLabel}
              parametersLabel={parametersLabel}
              panelTab={panelState.tab}
              onPanelTabChange={panelState.setTab}
              search={panelState.search}
              onSearchChange={panelState.setSearch}
              onSearchBlur={onParamSearchHiddenBlur}
              settingsView={settingsView}
              experienceMode={experienceMode}
              quickStartEnabled={quickStartEnabled}
              focusHiddenDiffSignal={reviewHiddenSignal}
              checklist={checklistState}
              checklistReplaySignal={checklistReplaySignal}
              quickStartActive={quickStartActive}
              attention={attention}
              onOpenMessages={openOutput}
            />

            {/* Canvas */}
            <div className="app-shell__viewer">
              <ViewerStage {...stageProps} viewerRef={desktopViewerRef} active>
                {/* Floating controls live inside viewer-wrap so they hover over the
                    canvas — which shrinks when the output console docks below it —
                    rather than overlapping the console's notices. The after-export
                    panel (when shown) rides directly above the cluster in the same
                    dock, never covering it — see ACTION_DOCK_CLASS's doc. */}
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
                  <div className={ACTION_CLUSTER_CLASS}>
                    <ActionButtons {...actionButtonsProps} />
                  </div>
                </div>
                <ViewerHUD {...hudProps} viewerRef={desktopViewerRef} />
              </ViewerStage>

              {/* Output console — inline below viewer */}
              <OutputConsole {...outputProps} className="max-h-56" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
