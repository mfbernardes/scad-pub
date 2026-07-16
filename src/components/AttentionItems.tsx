// AttentionItems.tsx — the shared row rendering for src/lib/readiness.ts's
// AttentionItem list: a font param whose selected family isn't loaded, or a
// flagged notice category with a pending notice. Used by CustomizeTab's own
// attention chip strip (top of the tab, visible regardless of which step/view
// is showing) AND QuickStart's Review stage (PR18, a second, self-contained
// listing of the same gaps right where the visitor is about to export) — one
// rendering, not two, so a future wording/action tweak can't drift between
// the two surfaces. Callers own their own classNames (the two surfaces look
// different — a muted top strip vs. a compact card row) so this stays pure
// content + action wiring.
import type { AttentionItem } from "../lib/readiness";
import { t } from "../lib/i18n";

interface Props {
  attention: AttentionItem[];
  /** A font-fallback item's action: reveal + focus the owning param's control
   *  (CustomizeTab's `focusOnParam`). */
  onGoToSetting: (name: string) => void;
  /** A notice item's action: open the Output console (Messages). */
  onOpenMessages?: () => void;
  /** Wraps the whole list — omit to render just the rows with no wrapper. */
  className?: string;
  itemClassName?: string;
  actionClassName?: string;
}

export function AttentionItems({
  attention,
  onGoToSetting,
  onOpenMessages,
  className,
  itemClassName,
  actionClassName,
}: Props) {
  if (attention.length === 0) return null;
  return (
    <div className={className}>
      {attention.map((item) => (
        <div
          key={item.kind === "font-fallback" ? `font:${item.param}` : `notice:${item.marker}`}
          className={itemClassName}
        >
          <span aria-hidden="true" className="attention-chip__dot size-[6px] shrink-0 rounded-full bg-warn" />
          <span className="flex-1">
            {item.kind === "font-fallback"
              ? t("attention.fontFallback", { family: item.family })
              : t("attention.notice", { label: item.label, count: item.count })}
          </span>
          <button
            type="button"
            className={actionClassName}
            onClick={() => (item.kind === "font-fallback" ? onGoToSetting(item.param) : onOpenMessages?.())}
          >
            {item.kind === "font-fallback" ? t("attention.goToSetting") : t("attention.openMessages")}
          </button>
        </div>
      ))}
    </div>
  );
}
