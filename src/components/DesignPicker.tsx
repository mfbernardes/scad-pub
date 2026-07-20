// DesignPicker.tsx — the shadcn Select used to switch designs. Shared by the
// desktop CommandBar and the mobile top bar (each wraps it differently and
// handles the single-design fallback in its own markup).
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Design } from "../openscad/types";
import { Check as CheckIcon, ChevronDown as ChevronDownIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
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
  /**
   * Monotonically-increasing signal: each increment asks this picker to open
   * (used by the intro popup's "start designing" CTA). Ignored unless `active`,
   * so only the visible layout's picker opens — both bars mount at once.
   */
  openSignal?: number;
  /** Whether this instance belongs to the currently-shown layout (desktop vs mobile). */
  active?: boolean;
  /** Render a searchable card gallery instead of the compact Select. */
  gallery?: boolean;
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

export function DesignGallery({
  designs,
  value,
  onChange,
}: Pick<Props, "designs" | "value" | "onChange">) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? designs.filter((d) =>
        [d.label, d.description ?? "", d.group ?? ""].some((s) => s.toLowerCase().includes(q))
      )
    : designs;
  const grouped = groupDesigns(filtered);
  return (
    <div className="design-gallery flex min-h-0 flex-col gap-3">
      {designs.length > 6 && (
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search designs…"
          aria-label="Search designs"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}
      <div className="max-h-[65vh] overflow-y-auto pr-1">
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No designs match your search.</p>
        )}
        {grouped.map((run, index) => (
          <section key={run.group ?? `ungrouped-${index}`} className="mb-4">
            {run.group && <h3 className="mb-2 text-sm font-semibold text-brand">{run.group}</h3>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {run.items.map((design) => {
                const current = design.id === value;
                return (
                  <button
                    key={design.id}
                    type="button"
                    data-design={design.id}
                    aria-current={current ? "true" : undefined}
                    onClick={() => onChange(design.id)}
                    className={`relative overflow-hidden rounded-lg border bg-card text-left shadow-sm outline-none hover:border-brand focus-visible:ring-2 focus-visible:ring-ring ${current ? "border-primary" : "border-border"}`}
                  >
                    <span className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted">
                      {design.image ? (
                        <img src={design.image} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : design.icon ? (
                        <img src={design.icon} alt="" loading="lazy" className="h-16 w-16 object-contain" />
                      ) : (
                        <span className="text-3xl font-bold text-muted-foreground" aria-hidden="true">{design.label.charAt(0)}</span>
                      )}
                    </span>
                    {current && (
                      <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden="true">
                        <CheckIcon size={14} />
                      </span>
                    )}
                    <span className="flex min-h-20 flex-col gap-1 px-3 py-2">
                      <strong className="text-sm text-foreground">{design.label}</strong>
                      {design.description && <span className="line-clamp-2 text-xs text-muted-foreground">{design.description}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// A design's optional icon, shown as a small leading thumbnail in the dropdown.
function designIcon(d: Design): ReactNode {
  return d.icon ? (
    <img src={d.icon} alt="" aria-hidden="true" width={16} height={16} className="size-4 shrink-0 object-contain" />
  ) : undefined;
}

export function DesignPicker({ designs, value, onChange, openSignal, active = true, gallery = false }: Props) {
  const runs = groupDesigns(designs);
  const grouped = runs.some((r) => r.group !== null);
  const [open, setOpen] = useState(false);

  // Open on a fresh signal (the CTA), but only for the visible layout's picker.
  // A ref tracks the last-seen value so a later `active` flip alone can't re-open it.
  const lastSignal = useRef(openSignal);
  useEffect(() => {
    if (openSignal !== undefined && openSignal !== lastSignal.current) {
      lastSignal.current = openSignal;
      // Deliberate: `openSignal` is an external one-shot broadcast (a CTA
      // click elsewhere in the tree), not state derived from props, so it
      // can't be computed during render — a ref already tracks "last seen"
      // to make this idempotent against re-renders.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (active) setOpen(true);
    }
  }, [openSignal, active]);

  if (gallery) {
    const current = designs.find((d) => d.id === value);
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Choose a design"
          className="font-display inline-flex h-8 min-w-0 items-center gap-1 rounded-md px-2 text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">{current?.label ?? value}</span>
          <ChevronDownIcon size={14} aria-hidden="true" />
        </button>
        <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Choose a design</DialogTitle>
            <DialogDescription>Select what you want to configure.</DialogDescription>
          </DialogHeader>
          <DesignGallery designs={designs} value={value} onChange={(id) => { onChange(id); setOpen(false); }} />
        </DialogContent>
      </Dialog>
    );
  }

  const item = (d: Design) => (
    <SelectItem key={d.id} value={d.id} icon={designIcon(d)} description={d.description ?? undefined}>
      {d.label}
    </SelectItem>
  );
  return (
    <Select value={value} onValueChange={onChange} open={open} onOpenChange={setOpen}>
      <SelectTrigger
        size="sm"
        aria-label="Choose a design"
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
