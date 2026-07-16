// DimensionInfo.tsx — the viewer's measurements panel, shown while the dimension
// overlay is on. Its first line is always the model's bounding box (W × D × H,
// in mm); beneath it sit any per-design facts the design marked with a `// @info`
// annotation in its .scad source (e.g. the engraved text, a font height), then
// any rows the design surfaced at render time via
// `echo("@info", label, unit, value)` (see lib/computedInfo.ts) — the mechanism
// for values OpenSCAD itself computes internally, which gen-schema's static
// parser could never know. All of it is measured/read downstream of the
// export — purely informative, never part of a print.
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Design } from "../openscad/types";
import type { Dimensions } from "./Viewer";
import type { Values } from "../lib/presets";
import type { ComputedInfo } from "../lib/computedInfo";
import { formatBoundingBox, paramInfoRows } from "../lib/reviewSummary";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";

interface Props {
  design: Design;
  /** Bounding-box size in millimetres (the headline "Dimensions" line). */
  size: Dimensions;
  /** Values behind the current render — not the live controls — so the figures
   *  change in step with the measured geometry, only once a render lands. */
  values: Values;
  /** Render is behind the controls (manual mode) — the figures, like the model,
   *  don't yet reflect the latest edits. */
  stale?: boolean;
  /** Runtime "calculated value" rows from `echo("@info", label, unit, value)`
   *  in the design's .scad source — see lib/computedInfo.ts. Rendered as plain
   *  rows after the bounding box and param-@info rows, in echo order. */
  computed?: ComputedInfo[];
}

export function DimensionInfo({ design, size, values, stale = false, computed = [] }: Props) {
  // Folds down to the bounding-box headline alone, so the panel can get out of
  // the way of the model without hiding the overlay entirely.
  const [collapsed, setCollapsed] = useState(false);

  // The params flagged `// @info` that are still visible under their @showIf
  // (if any) and have a non-empty formatted value — the exact same row
  // derivation QuickStart's Review stage reuses (src/lib/reviewSummary.ts),
  // so the two surfaces can never disagree about what a row says.
  const infoLines = paramInfoRows(design, values);

  const hasRows = infoLines.length > 0 || computed.length > 0;
  // Only the headline shows when collapsed; the toggle only appears when there's
  // something to hide.
  const showRows = hasRows && !collapsed;
  const row = "flex items-baseline justify-between gap-3";
  const dd = "m-0 text-right text-foreground tabular-nums break-words";

  return (
    <dl
      // Positioning/size caps come from the .dimension-info CSS block
      // (per-layout offsets); pointer-events-auto so the list can scroll while
      // the rest of the canvas stays orbit-able.
      className={cn(
        "dimension-info pointer-events-auto m-0 flex flex-col gap-[0.15rem] overflow-y-auto overscroll-contain rounded-(--radius-sm) border border-(color:--glass-border) bg-(--glass-bg) px-[0.55rem] py-[0.35rem] text-[0.8rem] text-muted-foreground shadow-(--elevation) [scrollbar-width:thin]",
        // Preview out of date: dim + italic so a stale figure never reads as current.
        stale && "italic opacity-55"
      )}
      aria-label={t("dimensions.aria")}
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
              onClick={() => setCollapsed((c) => !c)}
              aria-expanded={!collapsed}
              title={collapsed ? t("dimensions.showDetails") : t("dimensions.hideDetails")}
              className="-m-1 inline-flex cursor-pointer items-center gap-[0.3rem] rounded-(--radius-sm) bg-transparent p-1 font-semibold text-foreground hover:text-brand"
            >
              <ChevronDown
                size={14}
                aria-hidden
                className={cn("shrink-0 transition-transform", collapsed && "-rotate-90")}
              />
              {t("dimensions.heading")}
            </button>
          ) : (
            t("dimensions.heading")
          )}
        </dt>
        <dd className={dd}>{formatBoundingBox(size)}</dd>
      </div>
      {showRows &&
        infoLines.map((l) => (
          <div className={row} key={l.key}>
            <dt>{l.label}</dt>
            <dd className={dd}>{l.value}</dd>
          </div>
        ))}
      {showRows &&
        computed.map((c, i) => (
          <div className={row} key={`computed-${i}-${c.label}`}>
            <dt>{c.label}</dt>
            <dd className={dd}>{c.value}</dd>
          </div>
        ))}
    </dl>
  );
}
