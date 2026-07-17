// DesignPicker.tsx — the shadcn Select used to switch designs. Shared by the
// desktop CommandBar and the mobile top bar (each wraps it differently and
// handles the single-design fallback in its own markup).
import { useState, type ReactNode } from "react";
import type { Design } from "../openscad/types";
import { useAppActions } from "../lib/appActions";
import { t } from "../lib/i18n";
import { useSignal } from "../lib/useSignal";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface Props {
  designs: Design[];
  value: string;
  /**
   * Monotonically-increasing signal: each increment asks this picker to open
   * (used by the intro popup's "start designing" CTA). Ignored unless `active`,
   * so only the visible layout's picker opens — both bars mount at once.
   */
  openSignal?: number;
  /** Whether this instance belongs to the currently-shown layout (desktop vs mobile). */
  active?: boolean;
}

// Cluster designs under their `group` header while preserving config order: a
// group's run starts where its first design appears, and ungrouped designs
// (group null/absent) stay as a headerless run. Falls back to a flat list when
// no design declares a group.
export function groupDesigns(designs: Design[]): { group: string | null; items: Design[] }[] {
  const runs: { group: string | null; items: Design[] }[] = [];
  for (const d of designs) {
    const group = d.group ?? null;
    const last = runs[runs.length - 1];
    if (last && last.group === group) last.items.push(d);
    else runs.push({ group, items: [d] });
  }
  return runs;
}

// A design's optional icon, shown as a small leading thumbnail in the dropdown.
function designIcon(d: Design): ReactNode {
  return d.icon ? (
    <img src={d.icon} alt="" aria-hidden="true" width={16} height={16} className="size-4 shrink-0 object-contain" />
  ) : undefined;
}

export function DesignPicker({ designs, value, openSignal, active = true }: Props) {
  const { designChange } = useAppActions();
  const runs = groupDesigns(designs);
  const grouped = runs.some((r) => r.group !== null);
  const [open, setOpen] = useState(false);

  // Open on a fresh signal (the CTA), but only for the visible layout's
  // picker (both bars mount at once — see the prop's own doc). useSignal
  // (F8) tracks "last seen" internally so a later `active` flip alone can't
  // re-open it; `active` itself is read at fire time via useSignal's
  // latest-callback ref, so this closure never goes stale.
  useSignal(openSignal, () => {
    if (active) setOpen(true);
  });

  const item = (d: Design) => (
    <SelectItem key={d.id} value={d.id} icon={designIcon(d)} description={d.description ?? undefined}>
      {d.label}
    </SelectItem>
  );
  return (
    <Select value={value} onValueChange={designChange} open={open} onOpenChange={setOpen}>
      <SelectTrigger
        size="sm"
        aria-label={t("picker.button")}
        className="font-display h-7 gap-1 border-0 bg-transparent px-1 font-semibold shadow-none focus-visible:ring-0"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {grouped
          ? runs.map((run, i) => (
              <SelectGroup key={run.group ?? `ungrouped-${i}`}>
                {run.group && <SelectLabel>{run.group}</SelectLabel>}
                {run.items.map(item)}
              </SelectGroup>
            ))
          : designs.map(item)}
      </SelectContent>
    </Select>
  );
}
