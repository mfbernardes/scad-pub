// AttentionItems.tsx — warning-card rendering for src/lib/readiness.ts's
// AttentionItem list: a font param whose selected family isn't loaded, a
// flagged notice category with a pending notice, or a bare OpenSCAD
// warning/assert diagnostic not already covered by a notice category. Used by
// ReviewDialog. Ported (simplified) from a donor branch's design-reference
// component: no i18n (plain English), no "go to setting" action (ReviewDialog
// is not anchored near any particular control, but the donor's third action
// isn't part of this repo's simpler surface set either — Import font / Use a
// bundled font / View messages cover what CLAUDE.md's Phase 2 scope asks for).
import { AlertTriangle as WarningIcon } from "lucide-react";
import type { Design } from "../openscad/types";
import type { Values } from "../lib/presets";
import type { AttentionItem } from "../lib/readiness";
import { fontFallback } from "../lib/fontFallback";
import { useAppActions } from "../lib/appActions";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";
import { FontImportActions } from "./FontImportActions";
import { Button } from "./ui/button";

interface Props {
  attention: AttentionItem[];
  /** The active design — looked up per font-fallback item to compute its
   *  one-click bundled-font replacement (src/lib/fontFallback.ts). */
  design: Design;
  /** Live parameter values — a font-fallback item's fallback is computed
   *  against the CURRENT value, same as ParamForm's own inline hint. */
  values: Values;
  availableFontFamilies?: Set<string>;
  fontSuggestion?: string | null;
  /** Opens the Output console (Messages) for a notice item's "View messages" action. */
  onOpenMessages: () => void;
  className?: string;
}

export function AttentionItems({
  attention,
  design,
  values,
  availableFontFamilies,
  fontSuggestion,
  onOpenMessages,
  className,
}: Props) {
  const { change } = useAppActions();
  if (attention.length === 0) return null;
  return (
    <div
      className={cn(
        "attention-card flex flex-col gap-3 rounded-lg border border-warn/50 bg-warn-bg px-4 py-3",
        className
      )}
      role="status"
    >
      {attention.map((item, i) => {
        const param = item.kind === "font-fallback" ? design.params.find((p) => p.name === item.param) : null;
        const fallback =
          item.kind === "font-fallback" && param
            ? fontFallback(param, String(values[item.param] ?? ""), availableFontFamilies, fontSuggestion)
            : null;
        const key =
          item.kind === "font-fallback"
            ? `font:${item.param}`
            : item.kind === "notice"
              ? `notice:${item.marker}`
              : `diagnostic:${item.text}`;
        return (
          <div
            key={key}
            className={cn(
              "attention-card__item flex items-start gap-2",
              i > 0 && "border-t border-warn/25 pt-3"
            )}
          >
            <WarningIcon aria-hidden="true" size={18} className="mt-[1px] shrink-0 text-warn" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {item.kind === "font-fallback" ? (
                <>
                  <p className="m-0 font-semibold text-foreground">
                    {t("attention.fontFallbackLead")}:{" "}
                    <span className="inline-block max-w-[12rem] truncate align-bottom" title={item.family}>
                      {item.family}
                    </span>
                  </p>
                  <p className="m-0 text-[0.85rem] text-muted-foreground">
                    {t("attention.substituteFont")}
                  </p>
                  <FontImportActions
                    className="mt-1 flex flex-wrap gap-2"
                    renderImport={(open) => (
                      <Button type="button" variant="secondary" size="sm" onClick={open}>
                        {t("attention.importFont")}
                      </Button>
                    )}
                    renderFallback={
                      fallback
                        ? () => (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => change(item.param, fallback.value)}
                            >
                              {t("attention.useBundledFont")}
                            </Button>
                          )
                        : undefined
                    }
                  />
                </>
              ) : item.kind === "notice" ? (
                <>
                  <p className="m-0 font-semibold text-foreground">
                    {t("attention.noticePending", { count: item.count, label: item.label })}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={onOpenMessages}>
                      {t("attention.viewMessages")}
                    </Button>
                  </div>
                </>
              ) : (
                // A bare OpenSCAD WARNING:/assert() diagnostic (readiness.ts's
                // DiagnosticAttentionItem) — the raw message IS the card's
                // headline (unlike a notice item, there's no separate
                // count/label to template), same "View messages" action.
                <>
                  <p className="m-0 font-semibold text-foreground">{item.text}</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={onOpenMessages}>
                      {t("attention.viewMessages")}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
