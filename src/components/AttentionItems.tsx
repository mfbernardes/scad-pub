// AttentionItems.tsx — the shared row rendering for src/lib/readiness.ts's
// AttentionItem list: a font param whose selected family isn't loaded, or a
// flagged notice category with a pending notice. Used by CustomizeTab's own
// consolidated attention chip (top of the tab, visible regardless of which
// step/view is showing), QuickStart's Review stage (PR18, a second, self-
// contained listing of the same gaps right where the visitor is about to
// export), and OutputConsole's Notices tab (PR22, friendly cards leading the
// raw parsed rows) — one rendering, not three, so a future wording/action
// tweak can't drift between the surfaces. Callers own their own classNames
// (the three surfaces look different — a muted top strip, a compact card
// row, a console card) so this stays pure content + action wiring.
//
// PR22's consolidated form: each row's own text plus up to two actions.
// "Go to setting" (font-fallback only) and "Open Messages" (notice only)
// still differ per call site, so they stay caller-supplied callbacks. "Use a
// bundled font" is different: it's IDENTICAL everywhere (write the
// precomputed fallback value through the normal change path), so this reads
// `change` straight from the AppActions context (available anywhere in the
// tree — see appActions.ts) instead of yet another threaded callback.
import { useAppActions } from "../lib/appActions";
import type { AttentionItem } from "../lib/readiness";
import { t, tn } from "../lib/i18n";

/** One item's display text — the exact copy every surface (the chip, the
 *  Review stage, the export dock's summary line, the Notices tab cards)
 *  shows for it, so none of them can phrase the same gap differently.
 *  `short` drops the trailing explanation for space-constrained spots (the
 *  export dock's one-line summary — see ExportAttention.tsx). */
export function attentionItemText(item: AttentionItem, short = false): string {
  if (item.kind === "font-fallback") {
    return short
      ? t("attention.fontFallbackShort", { family: item.family })
      : t("attention.fontFallback", { family: item.family });
  }
  return t("attention.notice", { label: item.label, count: item.count });
}

interface Props {
  attention: AttentionItem[];
  /** A font-fallback item's action: reveal + focus the owning param's control
   *  (CustomizeTab's `focusOnParam`). */
  onGoToSetting: (name: string) => void;
  /** A notice item's action: open the Output console (Messages), or — when
   *  already inside it (OutputConsole's own cards) — jump to the matching
   *  raw notice below instead. */
  onOpenMessages?: () => void;
  /** Wraps the whole list — omit to render just the rows with no wrapper. */
  className?: string;
  itemClassName?: string;
  actionClassName?: string;
  /** Leads the list with a `tn`-pluralized "N issue(s) to review" line — the
   *  consolidated chip's first line (item 1 of PR22's milestone). Omit for a
   *  surface that already leads with its own summary (QuickStart's Review
   *  stage has its own readiness line above this list). */
  showSummary?: boolean;
  summaryClassName?: string;
}

export function AttentionItems({
  attention,
  onGoToSetting,
  onOpenMessages,
  className,
  itemClassName,
  actionClassName,
  showSummary = false,
  summaryClassName,
}: Props) {
  const { change } = useAppActions();
  if (attention.length === 0) return null;
  return (
    <div className={className}>
      {showSummary && (
        <div className={summaryClassName}>{tn("attention.summary", attention.length)}</div>
      )}
      {attention.map((item) => (
        <div
          key={item.kind === "font-fallback" ? `font:${item.param}` : `notice:${item.marker}`}
          className={itemClassName}
        >
          <span aria-hidden="true" className="attention-chip__dot size-[6px] shrink-0 rounded-full bg-warn" />
          <span className="flex-1">{attentionItemText(item)}</span>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {item.kind === "font-fallback" ? (
              <>
                <button type="button" className={actionClassName} onClick={() => onGoToSetting(item.param)}>
                  {t("attention.goToSetting")}
                </button>
                {item.fallback && (
                  <button
                    type="button"
                    className={actionClassName}
                    onClick={() => change(item.param, item.fallback!.value)}
                  >
                    {t("attention.useBundledFont")}
                  </button>
                )}
              </>
            ) : (
              <button type="button" className={actionClassName} onClick={() => onOpenMessages?.()}>
                {t("attention.openMessages")}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
