// DimensionInfo.tsx: the viewer's measurements panel, shown while the dimension
// overlay is on. Its first line is always the model's bounding box (W × D × H,
// in mm); beneath it sit any per-design facts the design marked with a `// @info`
// annotation in its .scad source (e.g. the engraved text, a font height), then
// any rows the design surfaced at render time via
// `echo("@info", label, unit, value)` (see lib/computedInfo.ts): the mechanism
// for values OpenSCAD itself computes internally, which gen-schema's static
// parser could never know. All of it is measured/read downstream of the
// export: purely informative, never part of a print.
//
// `mm`/`formatValue` are src/lib/format.ts's shared `mm`/`formatParamValue`:
// the same functions reviewSummary.ts's curated review rows use, so this
// panel and a pre-download review summary can never disagree about what a
// value says (see format.ts's own doc).
import { ChevronDown } from "lucide-react";
import type { Design } from "../openscad/types";
import type { Dimensions } from "./Viewer";
import type { Values } from "../lib/presets";
import type { ComputedInfo } from "../lib/computedInfo";
import { isVisible } from "../lib/visibility";
import { cn } from "../lib/utils";
import { mm, formatParamValue as formatValue } from "../lib/format";

interface Props {
  design: Design;
  /** Bounding-box size in millimetres (the headline "Dimensions" line). */
  size: Dimensions;
  /** Values behind the current render (not the live controls) so the figures
   *  change in step with the measured geometry, only once a render lands. */
  values: Values;
  /** Render is behind the controls (manual mode): the figures, like the model,
   *  don't yet reflect the latest edits. */
  stale?: boolean;
  /** Runtime "calculated value" rows from `echo("@info", label, unit, value)`
   *  in the design's .scad source, see lib/computedInfo.ts. Rendered as plain
   *  rows after the bounding box and param-@info rows, in echo order. */
  computed?: ComputedInfo[];
  /** Folded down to the bounding-box headline alone, so the panel can get out
   *  of the way of the model without hiding the overlay entirely. Owned by
   *  AppShell and persisted (see viewerPrefs' initialMeasureCollapsed) rather
   *  than held here: this panel unmounts whenever the ruler is switched off,
   *  the geometry clears or the design changes, and local state meant the
   *  visitor had to re-fold it every time. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function DimensionInfo({
  design,
  size,
  values,
  stale = false,
  computed = [],
  collapsed,
  onToggleCollapsed,
}: Props) {

  // The headline bounding box, then any params flagged `// @info` that are still
  // visible under their @showIf (if any) and have a non-empty formatted value.
  const infoLines = design.params
    .filter((p) => p.info && isVisible(p, values))
    .map((p) => ({
      name: p.name,
      label: p.info!.label ?? p.description,
      value: formatValue(p, values),
    }))
    .filter((l): l is { name: string; label: string; value: string } => l.value !== null);

  const hasRows = infoLines.length > 0 || computed.length > 0;
  // Only the headline shows when collapsed; the toggle only appears when there's
  // something to hide.
  const showRows = hasRows && !collapsed;
  const row = "flex items-baseline justify-between gap-3";
  // Detail rows opt back into pointer events so a long list stays scrollable;
  // the headline row doesn't (see the panel's own className note).
  const detailRow = cn(row, "pointer-events-auto");
  const dd = "m-0 text-right text-foreground tabular-nums break-words";

  return (
    <dl
      // Positioning/size caps come from the .dimension-info CSS block
      // (per-layout offsets). The panel itself is pointer-events-none, with
      // only the fold button and the detail rows opting back in: the rows need
      // it so a long list can still be scrolled (a touch landing on a row
      // scroll-chains to this container), but everything else. The headline,
      // the padding, the whole card when it's folded. Stays transparent to
      // pointers so a drag that starts over the panel orbits the model behind
      // it instead of being swallowed.
      className={cn(
        "dimension-info pointer-events-none m-0 flex flex-col gap-[0.15rem] overflow-y-auto overscroll-contain rounded-(--radius-sm) border border-(color:--glass-border) bg-(--glass-bg) px-[0.55rem] py-[0.35rem] text-[0.8rem] text-muted-foreground shadow-(--elevation) [scrollbar-width:thin]",
        // Preview out of date: dim + italic so a stale figure never reads as current.
        stale && "italic opacity-55"
      )}
      aria-label="Model measurements"
    >
      <div
        className={cn(
          row,
          // Divider under the headline when @info rows follow it.
          showRows && "mb-[0.15rem] border-b border-(color:--glass-border) pb-[0.3rem]"
        )}
      >
        <dt className="font-semibold text-foreground">
          {hasRows ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-expanded={!collapsed}
              title={collapsed ? "Show measurement details" : "Hide measurement details"}
              className="pointer-events-auto -m-1 inline-flex cursor-pointer items-center gap-[0.3rem] rounded-(--radius-sm) bg-transparent p-1 font-semibold text-foreground hover:text-brand"
            >
              <ChevronDown
                size={14}
                aria-hidden
                className={cn("shrink-0 transition-transform", collapsed && "-rotate-90")}
              />
              Dimensions
            </button>
          ) : (
            "Dimensions"
          )}
        </dt>
        <dd className={dd}>{`${mm(size.x)} × ${mm(size.y)} × ${mm(size.z)} mm`}</dd>
      </div>
      {showRows &&
        infoLines.map((l) => (
          <div className={detailRow} key={l.name}>
            <dt>{l.label}</dt>
            <dd className={dd}>{l.value}</dd>
          </div>
        ))}
      {showRows &&
        computed.map((c, i) => (
          <div className={detailRow} key={`computed-${i}-${c.label}`}>
            <dt>{c.label}</dt>
            <dd className={dd}>{c.value}</dd>
          </div>
        ))}
    </dl>
  );
}
