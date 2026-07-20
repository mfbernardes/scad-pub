// AttentionItems.tsx — the ONE warning-card rendering for src/lib/
// readiness.ts's AttentionItem list: a font param whose selected family
// isn't loaded, or a flagged notice category with a pending notice. Visual
// design review consolidated every attention surface down to this single
// card treatment (bg --warn-bg, a --warn border, --radius-card, a leading
// icon per item, a bold one-line lead + one explanatory sentence, and
// secondary-button actions) reused verbatim in the app's three remaining
// attention surfaces:
//   - ParamRows' inline font-missing hint (one synthetic single-item list,
//     right under the control it's about — Import font / Use a bundled font
//     only, since the visitor is already AT the setting);
//   - QuickStart's Review stage (the full list, still no "go to setting" —
//     Review's own separate "Open font settings" link covers that once);
//   - OutputConsole's Notices tab (the full list, WITH "go to setting" this
//     time — Messages isn't anchored near any control, so jumping there is
//     the only way back to it).
// The export dock's own amber dot + sr-only hint (ActionButtons.tsx) and the
// Review chip's amber dot are deliberately NOT this component — they're
// glance-only indicators, not places to read or act on an item's own text.
// The "Import font…" action itself is FontImportActions.tsx — the same
// FileInput + addFile wiring FileBar.tsx's font TaskCard uses, so this is
// one of only two places in the app that actually reads a font file off disk.
import { AlertTriangle as WarningIcon, Upload as UploadIcon } from "lucide-react";
import { useAppActions } from "../lib/appActions";
import type { AttentionItem } from "../lib/readiness";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import { FontImportActions } from "./FontImportActions";
import { Button } from "./ui/button";

/** An item's bold one-line lead — what's wrong, at a glance. STABLE text: a
 *  font-fallback item's title never interpolates the family name (no
 *  `{family}` placeholder — see `attention.fontFallbackLead`), so it can
 *  never wrap or need truncation at narrow widths. The family name lives in
 *  the detail sentence below instead, where it's free to wrap naturally
 *  (ux-improvement-plan.md item 3.1, revised: name-in-title + truncation was
 *  reverted in favor of a stable title with the name moved to the body). */
function attentionItemLead(item: AttentionItem): string {
  return item.kind === "font-fallback"
    ? t("attention.fontFallbackLead")
    : t("attention.notice", { label: item.label, count: item.count });
}

/** An item's one explanatory sentence, under the lead — a font-fallback
 *  item's family name interpolates HERE, not the lead, and wraps naturally
 *  with the rest of the sentence across as many lines as it needs; never
 *  truncated. */
function attentionItemDetail(item: AttentionItem): string {
  return item.kind === "font-fallback"
    ? t("attention.fontFallbackDetail", { family: item.family })
    : t("attention.noticeDetail");
}

interface Props {
  attention: AttentionItem[];
  /** A font-fallback item's THIRD action, "Go to setting" (reveal + focus the
   *  owning param's control) — omit where the visitor is already at the
   *  control (the contextual card) or where a single separate link already
   *  covers it once for the whole card (Review's own "Open font settings" —
   *  see ReviewContent in QuickStart.tsx). Provided only by OutputConsole,
   *  whose Notices tab isn't anchored near any control. */
  onGoToSetting?: (name: string) => void;
  /** A notice item's action: open the Output console (Messages) — omit when
   *  the card is already rendering INSIDE Messages (OutputConsole passes
   *  nothing; there's nothing further to "open"). */
  onOpenMessages?: () => void;
  /** Wraps the whole card — the caller's own stable hook class (e.g.
   *  `.font-missing`, `.quick-start__review-attention`, `.console-attention`)
   *  plus any layout-only utilities; the warning-card visual treatment
   *  itself lives here, not per call site. */
  className?: string;
}

export function AttentionItems({ attention, onGoToSetting, onOpenMessages, className }: Props) {
  const { change } = useAppActions();
  if (attention.length === 0) return null;
  return (
    <div
      className={cn(
        "attention-card flex flex-col gap-(--space-3) rounded-(--radius-card) border border-warn/50 bg-warn-bg px-(--space-4) py-(--space-3)",
        className
      )}
      role="status"
    >
      {attention.map((item, i) => (
        <div
          key={item.kind === "font-fallback" ? `font:${item.param}` : `notice:${item.marker}`}
          className={cn(
            "attention-card__item flex items-start gap-(--space-2)",
            i > 0 && "border-t border-warn/25 pt-(--space-3)"
          )}
        >
          <WarningIcon aria-hidden="true" size={18} className="mt-[1px] shrink-0 text-warn" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="attention-card__lead m-0 font-semibold text-foreground">{attentionItemLead(item)}</p>
            <p className="attention-card__detail m-0 text-[0.85rem] text-muted-foreground">
              {attentionItemDetail(item)}
            </p>
            {item.kind === "font-fallback" ? (
              // Import first, then (Go to setting, Use a bundled font) as
              // FontImportActions' fallback slot — a Fragment carrying both,
              // since its render-prop API has only the two slots the other
              // hosts need but this card's THIRD action ("Go to setting")
              // slots into the same trailing position. className="mt-1 flex
              // flex-wrap gap-2" replaces the row div the two other hosts get
              // for free from their own card shell.
              <FontImportActions
                className="mt-1 flex flex-wrap gap-2"
                renderImport={(open) => (
                  <Button type="button" variant="secondary" size="sm" onClick={open}>
                    <UploadIcon size={14} aria-hidden="true" /> {t("params.importFont")}
                  </Button>
                )}
                renderFallback={() => (
                  <>
                    {onGoToSetting && (
                      <Button type="button" variant="secondary" size="sm" onClick={() => onGoToSetting(item.param)}>
                        {t("attention.goToSetting")}
                      </Button>
                    )}
                    {item.fallback && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => change(item.param, item.fallback!.value)}
                      >
                        {t("attention.useBundledFont")}
                      </Button>
                    )}
                  </>
                )}
              />
            ) : (
              onOpenMessages && (
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={onOpenMessages}>
                    {t("attention.openMessages")}
                  </Button>
                </div>
              )
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
