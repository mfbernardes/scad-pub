// DisplayRowsPanel.tsx — the read-only "automatic preview" surface QuickStart
// mounts after a step's own parameter sections, for that step's `@display`
// rows (src/lib/displayRows.ts): a design generating content from a
// visitor's other inputs (e.g. a Braille cell pattern derived from plain
// text) shown right where they're working on the input that produces it, not
// buried in the measurements panel with the rest of the render's numbers.
// Muted label, then the value on its own inset surface (the app's `--panel-
// 2`/`bg-muted` token, `--radius-control`, generous padding) — a mostly-
// Braille value (isMostlyBraille) renders larger so its dot pattern stays
// legible at normal body-text size, a generic typographic accommodation, not
// a Braille-specific code path. Renders nothing before the first successful
// render (or when the design emits no `@display` rows at all) — no skeleton,
// matching computedInfo's own "nothing until there's something real to
// show" rule.
import type { DisplayRow } from "../lib/displayRows";
import { isMostlyBraille } from "../lib/displayRows";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";

interface Props {
  rows: DisplayRow[];
  /**
   * Round-2 review fix (mobile vertical rhythm): "less air between the
   * @display preview surface and its confirmation chip". QuickStart's steps
   * variant (mobile) passes true; scroll variant (desktop, more room to
   * spare) keeps the original spacing. Tightens both the value surface's own
   * padding and the gap before the "Generated automatically" chip below it —
   * the two together were what actually read as excess air, not either
   * alone.
   */
  compact?: boolean;
}

export function DisplayRowsPanel({ rows, compact = false }: Props) {
  if (rows.length === 0) return null;
  return (
    <div className={cn("quick-start__display flex flex-col", compact ? "gap-(--space-3)" : "gap-(--space-4)")}>
      {rows.map((r) => (
        <div
          key={`${r.step}:${r.label}`}
          className={cn("quick-start__display-row flex flex-col", compact ? "gap-[0.2rem]" : "gap-[0.3rem]")}
        >
          <span className="quick-start__display-label text-[0.82rem] font-medium text-muted-foreground">
            {r.label}
          </span>
          <div
            className={cn(
              "quick-start__display-value rounded-(--radius-control) bg-muted px-(--space-4) text-foreground break-words",
              compact ? "py-(--space-2)" : "py-(--space-3)",
              isMostlyBraille(r.value)
                ? "text-[1.9em] leading-[1.6] tracking-[0.05em]"
                : "text-[0.95rem]"
            )}
          >
            {r.value}
          </div>
          <span className="quick-start__display-auto self-start rounded-full bg-success-bg px-2 py-[0.1rem] text-[0.72rem] font-medium text-success">
            {t("quickstart.displayAuto")}
          </span>
        </div>
      ))}
    </div>
  );
}
