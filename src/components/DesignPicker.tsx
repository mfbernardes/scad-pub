// DesignPicker.tsx: the shadcn Select used to switch designs. Shared by the
// desktop CommandBar and the mobile top bar (each wraps it differently and
// handles the single-design fallback in its own markup).
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Design } from "../openscad/types";
import { Check as CheckIcon, ChevronDown as ChevronDownIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { isCoarsePointer } from "../lib/pointer";
import { THUMB_FRAME, Thumbnail } from "./Thumbnail";
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
   * so only the visible layout's picker opens: both bars mount at once.
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
    <div className="design-gallery flex min-h-0 flex-1 flex-col gap-3">
      {designs.length > 6 && (
        <input
          type="search"
          name="design-search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search designs…"
          aria-label="Search designs"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No designs match your search.</p>
        )}
        {grouped.map((run, index) => (
          <section key={run.group ?? `ungrouped-${index}`} className="mb-4">
            {run.group && <h3 className="mb-2 text-sm font-semibold text-brand">{run.group}</h3>}
            {/* 2 columns below `sm` (phones), same as PresetPicker's imaged
                preset grid, so a chooser of a dozen designs isn't a dozen
                full-width screens of swiping; 3 from `lg` up, unchanged from
                before. Art/text scale down at the base size for the narrower
                phone card and grow back at `sm`. */}
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
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
                    {design.image ? (
                      <Thumbnail src={design.image} />
                    ) : (
                      <span className={THUMB_FRAME}>
                        {design.icon ? (
                          <img
                            src={design.icon}
                            alt=""
                            loading="lazy"
                            width={64}
                            height={64}
                            className="h-12 w-12 object-contain sm:h-16 sm:w-16"
                          />
                        ) : (
                          <span className="text-xl font-bold text-muted-foreground sm:text-3xl" aria-hidden="true">{design.label.charAt(0)}</span>
                        )}
                      </span>
                    )}
                    {current && (
                      <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground sm:right-2 sm:top-2 sm:size-6" aria-hidden="true">
                        <CheckIcon size={12} />
                      </span>
                    )}
                    <span className="flex min-h-14 flex-col gap-1 px-2 py-1.5 sm:min-h-20 sm:px-3 sm:py-2">
                      <strong className="text-xs text-foreground sm:text-sm">{design.label}</strong>
                      {design.description && (
                        <span className="line-clamp-1 text-[0.7rem] text-muted-foreground sm:line-clamp-2 sm:text-xs">
                          {design.description}
                        </span>
                      )}
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
      // can't be computed during render. A ref already tracks "last seen"
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
        <DialogContent
          className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden p-4 sm:p-6"
          onOpenAutoFocus={(e) => {
            if (isCoarsePointer()) e.preventDefault();
          }}
        >
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
