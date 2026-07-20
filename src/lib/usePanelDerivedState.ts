// usePanelDerivedState.ts — the panel-facing business state AppShell derives
// from render/design state: real production-readiness gaps (attention),
// overall readiness, whether the Review summary is stale, the hidden-
// advanced-diff used by both the Customize tab's "Review" chip and the
// friendly-error card's "Review hidden settings" action, the friendly
// render-failure summary, and whether QuickStart is the active guide. These
// are exactly the inputs ParamPanel/SheetTabs (and, further down,
// CustomizeTab/OutputConsole) read — so lifting them into one hook here
// mirrors that real seam instead of leaving them as inline computation
// AppShell happens to also own.
//
// A behavior-preserving LIFT, not a redesign: every memoization key and the
// computation itself is unchanged from what previously lived inline in
// AppShell (see git history around AppShell.tsx's former lines ~461-544) —
// only the "where" moved.
import { useMemo } from "react";
import type { Design, Param, RenderResult } from "../openscad/types";
import type { Values } from "./presets";
import type { SettingsView, ExperienceMode } from "./useExperience";
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
  labelOne?: string;
  attention?: boolean;
  subsumedByFont?: boolean;
}

export interface PanelDerivedStateInputs {
  design: Design;
  values: Values;
  /** Normalised font families the renderer can use — see readiness.ts's
   *  DeriveAttentionInputs. */
  availableFontFamilies: Set<string>;
  /** A bundled family to offer as a one-click fallback — see readiness.ts's
   *  DeriveAttentionInputs.fontSuggestion. */
  fontSuggestion?: string | null;
  /** Config-driven notice categories (schema.notices). */
  notices: NoticeCategoryInput[];
  /** Per-category live pending counts this render (diagnostics.ts's
   *  countBadges), already computed by the caller from `log`/`notices`. */
  badges: BadgeCount[];
  result: RenderResult | null;
  retainedResult: RenderResult | null;
  stalePreview: boolean;
  settingsView: SettingsView;
  experienceMode: ExperienceMode;
  /** Build-time `ui.quickStart` opt-out. */
  quickStartEnabled: boolean;
}

export interface PanelDerivedState {
  attention: AttentionItem[];
  readiness: ReadinessState;
  reviewStale: boolean;
  /**
   * The total live pending count across notice categories that are NOT
   * `attention`-flagged (config's `notices[].attention`, the same flag
   * `BadgeCount.attention`/`badgeVariant` already use to decide amber vs
   * neutral badge styling) — i.e. the notices Messages shows that
   * `deriveAttention`/`readinessState` never counted against readiness in
   * the first place (an `attention`-flagged category already surfaces
   * through `attention`/`readiness` above; this deliberately excludes those
   * so the two can never double-count the same pending notice, blocking or
   * not). Reuses `badges` — the same per-category counts
   * `noticeAttentionInputs` above already derives from — rather than
   * re-deriving category membership from the raw log. Excludes the
   * hardcoded `assert` badge explicitly: it has no `attention` flag at all
   * (see `BadgeCount.attention`'s own doc — "never set on the hardcoded
   * assert badge"), so `!b.attention` would otherwise wrongly count it, and
   * an assert failure always means `result.ok === false` (readiness
   * "failed") in practice, never the "ready" state this powers a quiet
   * annotation on. Feeds QuickStart's guided Review "ready" strip
   * (`nonBlockingNoticeCount`), an FYI line telling a visitor sitting on an
   * all-clear Review stage that Messages still has something to see —
   * without turning that strip amber or touching readiness gating.
   */
  nonBlockingNoticeCount: number;
  /** The hidden-advanced-diff array itself (src/lib/paramFilter.ts's
   *  hiddenAdvancedDiff) — CustomizeTab's "Review" chip and the friendly-
   *  error card both need the actual params (CustomizeTab jumps to the first
   *  one), not just whether any exist. Callers that only need the boolean
   *  (e.g. OutputConsole's showReviewHidden) derive it with `.length > 0` at
   *  the call site instead of this hook computing both. */
  hiddenDiff: Param[];
  friendlyError: FriendlyErrorInfo | null;
  quickStartActive: boolean;
}

export function usePanelDerivedState({
  design,
  values,
  availableFontFamilies,
  fontSuggestion,
  notices,
  badges,
  result,
  retainedResult,
  stalePreview,
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
        labelOne: n.labelOne,
        attention: n.attention === true,
        subsumedByFont: n.subsumedByFont === true,
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
        fontSuggestion,
        notices: noticeAttentionInputs,
      }),
    [design, values, availableFontFamilies, fontSuggestion, noticeAttentionInputs]
  );

  // PR18's Review stage: overall production-readiness for the current render
  // (failed > attention > ready > building — see readiness.ts's own
  // precedence doc).
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

  // See PanelDerivedState.nonBlockingNoticeCount's own doc: sum of `badges`
  // entries that are non-attention (`!b.attention`) and not the hardcoded
  // `assert` badge — `badges` already only carries entries with `count > 0`
  // (diagnostics.ts's countBadges filters that before returning), so no
  // further `count > 0` check is needed here.
  const nonBlockingNoticeCount = useMemo(
    () => badges.reduce((n, b) => (b.key !== "assert" && !b.attention ? n + b.count : n), 0),
    [badges]
  );

  // Friendly render-failure summary (see src/lib/friendlyErrors.ts) — null
  // whenever the latest render didn't fail. Recomputed only when `result`
  // itself changes (title/body/technical are a pure function of it).
  const friendlyError = useMemo(() => friendlyRenderError(result), [result]);
  // hiddenAdvancedDiff's inputs, mirroring CustomizeTab's own computation
  // exactly — the friendly-error card's "Review hidden settings" action must
  // use the SAME deterministic rule as the Customize tab's "Review" chip, not
  // a re-derived approximation.
  const defaults = useMemo(() => defaultsFor(design), [design]);
  const hiddenDiff = useMemo(
    () => hiddenAdvancedDiff(design.params, values, defaults, settingsView),
    [design, values, defaults, settingsView]
  );

  return {
    attention,
    readiness,
    reviewStale,
    nonBlockingNoticeCount,
    hiddenDiff,
    friendlyError,
    quickStartActive,
  };
}
