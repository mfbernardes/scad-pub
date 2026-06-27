// DesignPicker.tsx — the shadcn Select used to switch designs. Shared by the
// desktop CommandBar and the mobile top bar (each wraps it differently and
// handles the single-design fallback in its own markup).
import type { Design } from "../openscad/types";
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
  onChange: (id: string) => void;
}

// Cluster designs under their `group` header while preserving config order: a
// group's run starts where its first design appears, and ungrouped designs
// (group null/absent) stay as a headerless run. Falls back to a flat list when
// no design declares a group.
function groupDesigns(designs: Design[]): { group: string | null; items: Design[] }[] {
  const runs: { group: string | null; items: Design[] }[] = [];
  for (const d of designs) {
    const group = d.group ?? null;
    const last = runs[runs.length - 1];
    if (last && last.group === group) last.items.push(d);
    else runs.push({ group, items: [d] });
  }
  return runs;
}

export function DesignPicker({ designs, value, onChange }: Props) {
  const runs = groupDesigns(designs);
  const grouped = runs.some((r) => r.group !== null);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        size="sm"
        aria-label="Select design"
        className="h-7 gap-1 border-0 bg-transparent px-1 font-semibold shadow-none focus-visible:ring-0"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {grouped
          ? runs.map((run, i) => (
              <SelectGroup key={run.group ?? `ungrouped-${i}`}>
                {run.group && <SelectLabel>{run.group}</SelectLabel>}
                {run.items.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>
                ))}
              </SelectGroup>
            ))
          : designs.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>
            ))}
      </SelectContent>
    </Select>
  );
}
