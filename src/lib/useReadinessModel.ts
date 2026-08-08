// useReadinessModel.ts: production-readiness derivation, extracted from
// AppShell: parses the render log into diagnostics and count badges (see
// diagnostics.ts), turns those plus a font-availability scan into
// readiness.ts's structured attention list, derives the overall readiness
// state and any friendly failure copy, and owns the Review dialog's
// open/closed state and the dock Download button's routing through it.
// AppShell is still the sole caller: it feeds this hook the render outcome
// and the few externally-owned inputs (schema notices, design params/values,
// font availability, the export safety gate) the chain needs, and threads the
// result to the status strip, the export dock, the top bars' notice counts and
// ReviewDialog. Pure derivation aside from the Review dialog's own open/closed
// bit and the Download click's exportModel call: no layout, no DOM.
import { useCallback, useMemo, useState } from "react";
import type { LocalizedDesign, RawNoticeCategory, RenderResult } from "../openscad/types";
import type { Values } from "./presets";
import { parseDiagnostics, countBadges, type Diagnostic, type BadgeCount } from "./diagnostics";
import { lxNotice } from "./configI18n";
import {
  deriveAttention,
  readinessState,
  type AttentionItem,
  type NoticeAttentionInput,
  type ReadinessState,
} from "./readiness";
import { friendlyRenderError, type FriendlyErrorInfo } from "./friendlyErrors";
import { useAppActions } from "./appActions";
import { useLocale } from "./localeStore";

// Stable empty-log identity so a render with nothing to show yet doesn't hand
// a fresh `[]` to the memos below on every idle re-render.
const EMPTY_LOG: string[] = [];

export interface UseReadinessModelArgs {
  design: LocalizedDesign;
  /** The live control values (not the values behind the last render: a
   *  missing-font warning should track what's selected right now). */
  values: Values;
  result: RenderResult | null;
  /** The config's notice categories (schema.notices): raw, since a category's
   *  `label` is `LocalizableText`. Projected to plain strings (`lxNotice`) in
   *  this hook's own `notices` memo below, ahead of every consumer
   *  (diagnostics.ts/readiness.ts, whose signatures stay plain-string). */
  notices: RawNoticeCategory[];
  /**
   * Normalised (see fonts.ts's `normalizeFamily`) family names the renderer
   * can actually use right now: bundled ∪ imported. Computed in AppShell
   * (ParamPanel/SheetTabs need the same set for their own font controls), so
   * it arrives here as a raw input rather than being recomputed.
   */
  availableFontFamilies: Set<string>;
  /** The only state Download/Image may ever act on, see
   *  useRenderPipeline's `exportable` / docs/architecture-review.md H1. */
  exportable: boolean;
}

export interface ReadinessModel {
  diagnostics: Diagnostic[];
  badges: BadgeCount[];
  attention: AttentionItem[];
  readiness: ReadinessState;
  /** Friendly {title, body, technical} mapping of a failed render, shared by
   *  the Notices tab (OutputConsole) and the Review dialog so a failure reads
   *  identically wherever it surfaces. Null on a missing/successful result. */
  failure: FriendlyErrorInfo | null;
  /** Whether the Review dialog is open: one instance, its content and footer
   *  driven entirely by the live readiness/attention/failure above; both
   *  entry points (the dock Download button and the status strip) open the
   *  identical dialog. */
  reviewOpen: boolean;
  setReviewOpen: (open: boolean) => void;
  openReview: () => void;
  /** The dock's Download click: a ready render downloads directly (subject to
   *  the same `exportable` safety gate exportModel itself re-checks); anything
   *  else (attention/failed/building) opens the review dialog instead of doing
   *  nothing or exporting something stale/broken. */
  handleDownloadClick: () => void;
}

export function useReadinessModel({
  design,
  values,
  result,
  notices: rawNotices,
  availableFontFamilies,
  exportable,
}: UseReadinessModelArgs): ReadinessModel {
  const actions = useAppActions();
  // Subscription only, plus `tag` threaded into the memos below: each derives
  // catalogue text (badge labels, attention copy, the friendly-failure card),
  // so a runtime locale switch must invalidate them even though none of their
  // OTHER inputs changed.
  const { tag } = useLocale();
  const log = result?.log ?? EMPTY_LOG;
  // Projects each category's `label` to plain strings for the active locale
  // (lxNotice) so every consumer below — parseDiagnostics/countBadges
  // (diagnostics.ts) and deriveAttention (readiness.ts) via
  // noticeAttentionInputs — keeps its existing plain-string `NoticeCategory`
  // signature. `tag`: a config without per-locale labels still needs no
  // re-projection, but one that DOES must re-run this on a locale switch.
  const notices = useMemo(() => (rawNotices ?? []).map((n) => lxNotice(n, tag)), [rawNotices, tag]);

  // Parse the log once here; the OutputConsole (Notices tab count chips) reads
  // this derived data instead of re-parsing it.
  const diagnostics = useMemo(() => parseDiagnostics(log, notices), [log, notices]);
  // `tag`: countBadges resolves a catalogue label (diagnostics.assertsBadge)
  // through t(), so a runtime locale switch must invalidate this memo even
  // though log/notices didn't change — react-hooks can't see that a
  // dependency-free t() call inside is itself locale-sensitive.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const badges = useMemo(() => countBadges(log, notices), [log, notices, tag]);

  // Production-readiness (readiness.ts): a structured, typed list of real gaps
  // between "rendered" and "ready to ship". A font param whose selected
  // family isn't loaded, or a flagged notice category with a pending notice,
  // plus the overall state that drives the status strip/dock/review dialog.
  // `badges` (already computed above for the Notices tab) gives each notice
  // category's live pending count; joined here with the category's own
  // config-declared `attention`/`label` so deriveAttention can decide which
  // ones matter without re-scanning the raw log itself.
  const noticeAttentionInputs: NoticeAttentionInput[] = useMemo(
    () =>
      notices.map((n) => ({
        marker: n.marker,
        label: n.label,
        attention: n.attention === true,
        subsumedByFont: n.subsumedByFont === true,
        count: badges.find((b) => b.key === `notice:${n.marker}`)?.count ?? 0,
      })),
    [notices, badges]
  );
  // Attention-flagged diagnostics that aren't already one of the notice
  // categories above, see readiness.ts's `DeriveAttentionInputs.diagnostics`
  // for why `level === "notice"` is excluded here.
  //
  // Only surfaced for a render that actually SUCCEEDED: a currently-FAILED
  // render's own diagnostics (e.g. the assert that failed it) are
  // already explained by the Review dialog's friendly-failure card (see
  // `failure` below). Stacking them as attention items too would only
  // repeat the same message under a second heading. readinessState's own
  // failed > attention precedence already keeps the overall readiness state
  // correct either way, but the Review dialog renders `attention` cards
  // unconditionally alongside a failure card, so the gate has to live here.
  const diagnosticAttentionInputs: string[] = useMemo(
    () =>
      result?.ok ? diagnostics.filter((d) => d.attention && d.level !== "notice").map((d) => d.text) : [],
    [diagnostics, result]
  );
  // `tag`: deriveAttention resolves plural/label copy via selectPlural/t(),
  // which reads the active locale, so a switch must invalidate this memo too
  // — react-hooks can't see that dependency-free call is locale-sensitive.
  const attention = useMemo(
    () =>
      deriveAttention({
        params: design.params,
        values,
        availableFontFamilies,
        notices: noticeAttentionInputs,
        diagnostics: diagnosticAttentionInputs,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [design.params, values, availableFontFamilies, noticeAttentionInputs, diagnosticAttentionInputs, tag]
  );
  // `result` is the only render outcome readiness cares about: null until a
  // FIRST render has ever landed (readinessState's "building"), regardless of
  // whether a later live edit is currently re-rendering over it, matching
  // the viewer's own "Building your preview…" vs. "Updating…" distinction.
  // No `tag` dep needed here: readinessState carries no catalogue text of its
  // own, and `attention`'s own memo (above) already recomputes — with a new
  // array identity — on a locale switch, so this memo invalidates through it.
  const readiness = useMemo(() => readinessState(result ? result.ok : null, attention), [result, attention]);
  // Friendly {title, body, technical} mapping of a failed render, shared by
  // the Notices tab (OutputConsole) and the Review dialog so a failure reads
  // identically wherever it surfaces. Null on a missing/successful result.
  // `tag`: friendlyRenderError resolves its title through t() — react-hooks
  // can't see that dependency-free call is locale-sensitive.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const failure = useMemo(() => friendlyRenderError(result), [result, tag]);

  // Review dialog: one instance, its content and footer driven entirely by the
  // live `readiness`/`attention`/`failure` above. Both entry points (the dock
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

  return {
    diagnostics,
    badges,
    attention,
    readiness,
    failure,
    reviewOpen,
    setReviewOpen,
    openReview,
    handleDownloadClick,
  };
}
