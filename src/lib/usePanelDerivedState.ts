// usePanelDerivedState.ts — the panel-facing business state AppShell derives
// from render/design state: real production-readiness gaps (attention),
// overall readiness, whether the Review summary is stale, the getting-started
// checklist's derived state, the hidden-advanced-diff used by both the
// Customize tab's "Review" chip and the friendly-error card's "Review hidden
// settings" action, the friendly render-failure summary, and whether
// QuickStart is the active guide. These are exactly the inputs ParamPanel/
// SheetTabs (and, further down, CustomizeTab/GettingStarted/OutputConsole)
// read — so lifting them into one hook here mirrors that real seam instead of
// leaving them as inline computation AppShell happens to also own.
//
// A behavior-preserving LIFT, not a redesign: every memoization key and the
// computation itself is unchanged from what previously lived inline in
// AppShell (see git history around AppShell.tsx's former lines ~461-544) —
// only the "where" moved.
import { useMemo } from "react";
import type { Design, RenderResult } from "../openscad/types";
import type { Values } from "./presets";
import type { SettingsView, ExperienceMode } from "./useExperience";
import type { ChecklistState } from "./checklist";
import type { NoticeAttentionInput, AttentionItem, ReadinessState } from "./readiness";
import { deriveAttention, readinessState } from "./readiness";
import { quickStartAvailable } from "./quickStart";
import { friendlyRenderError, type FriendlyErrorInfo } from "./friendlyErrors";
import { hiddenAdvancedDiff } from "./paramFilter";
import { defaultsFor } from "./presets";
import { isMeasurementStale } from "./renderState";
import type { BadgeCount } from "./diagnostics";

/** One configured notice category, as far as this hook needs it — the same
 *  shape AppShell already has on hand from `schema.notices`. */
interface NoticeCategoryInput {
  marker: string;
  label: string;
  attention?: boolean;
}

export interface PanelDerivedStateInputs {
  design: Design;
  values: Values;
  /** Normalised font families the renderer can use — see readiness.ts's
   *  DeriveAttentionInputs. */
  availableFontFamilies: Set<string>;
  /** Config-driven notice categories (schema.notices). */
  notices: NoticeCategoryInput[];
  /** Per-category live pending counts this render (diagnostics.ts's
   *  countBadges), already computed by the caller from `log`/`notices`. */
  badges: BadgeCount[];
  result: RenderResult | null;
  retainedResult: RenderResult | null;
  stalePreview: boolean;
  rendering: boolean;
  /** How many designs this build ships — checklist.ts's designCount. */
  designCount: number;
  checklistProgress: {
    designChanged: boolean;
    paramInteracted: boolean;
    exported: boolean;
  };
  /** Guided experience AND the config allows the checklist at all
   *  (`ui.checklist !== false`) — see checklist.ts's ChecklistState.enabled. */
  showChecklist: boolean;
  settingsView: SettingsView;
  experienceMode: ExperienceMode;
  /** Build-time `ui.quickStart` opt-out. */
  quickStartEnabled: boolean;
}

export interface PanelDerivedState {
  noticeAttentionInputs: NoticeAttentionInput[];
  attention: AttentionItem[];
  readiness: ReadinessState;
  reviewStale: boolean;
  checklistState: ChecklistState;
  defaults: Values;
  hasHiddenDiff: boolean;
  friendlyError: FriendlyErrorInfo | null;
  quickStartActive: boolean;
}

export function usePanelDerivedState({
  design,
  values,
  availableFontFamilies,
  notices,
  badges,
  result,
  retainedResult,
  stalePreview,
  rendering,
  designCount,
  checklistProgress,
  showChecklist,
  settingsView,
  experienceMode,
  quickStartEnabled,
}: PanelDerivedStateInputs): PanelDerivedState {
  // QuickStart's build-time opt-out (see docs/config.md's `ui.quickStart`) —
  // default true, since declaring `@step` sections on a design is itself the
  // opt-in. Threaded to CustomizeTab (via ParamPanel/SheetTabs), which also
  // gates on experienceMode/settingsView/design.steps — see quickStartAvailable.
  const quickStartActive = quickStartAvailable(design, experienceMode, settingsView, quickStartEnabled);

  // src/lib/readiness.ts's attention items: real, verifiable gaps between a
  // successful render and genuine production-readiness (a font param whose
  // selected family isn't loaded, or a flagged `notices` category with a
  // pending notice this render — see NoticeCategory.attention). Pairs each
  // configured category with its live pending count from `badges` (already
  // computed by the caller), so a category flagged `attention: true` in the
  // config only surfaces here once it actually has something pending, not
  // merely because it's configured.
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

  // PR18's Review stage: overall production-readiness for the current render
  // (failed > attention > ready > building — see readiness.ts's own
  // precedence doc), mirroring checklistState's `resultOk` below exactly so
  // the Review stage's readiness line and the checklist's "Preview" row can
  // never disagree.
  const readiness = useMemo(
    () => readinessState(result ? result.ok : null, attention),
    [result, attention]
  );
  // Whether the Review stage's summary figures are stale — shared with
  // ViewerStage's DimensionInfo panel via renderState.ts's isMeasurementStale
  // so the two "what will actually be produced" surfaces can never disagree.
  const reviewStale = useMemo(
    () => isMeasurementStale(stalePreview, result, retainedResult),
    [stalePreview, result, retainedResult]
  );

  const checklistState: ChecklistState = {
    enabled: showChecklist,
    designCount,
    designChanged: checklistProgress.designChanged,
    paramInteracted: checklistProgress.paramInteracted,
    exported: checklistProgress.exported,
    rendering,
    resultOk: result ? result.ok : null,
    hasAttention: attention.length > 0,
  };

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

  return {
    noticeAttentionInputs,
    attention,
    readiness,
    reviewStale,
    checklistState,
    defaults,
    hasHiddenDiff,
    friendlyError,
    quickStartActive,
  };
}
