// DesignPicker.tsx: the shadcn Select used to switch designs. Shared by the
// desktop CommandBar and the mobile top bar (each wraps it differently and
// handles the single-design fallback in its own markup).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Design } from "../openscad/types";
import { Check as CheckIcon, ChevronDown as ChevronDownIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { preventTouchAutoFocus } from "../lib/pointer";
import { t } from "../lib/i18n";
import { useLocale } from "../lib/localeStore";
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
   * (used by the intro popup's "start designing" CTA). Only one picker is ever
   * mounted — AppShell mounts one layout tree or the other (M7) — so there is
   * no visible/hidden instance to tell apart.
   */
  openSignal?: number;
  /** Render a searchable card gallery instead of the compact Select. */
  gallery?: boolean;
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

export function DesignGallery({
  designs,
  value,
  onChange,
}: Pick<Props, "designs" | "value" | "onChange">) {
  useLocale(); // subscription only: re-render this component's t() calls on a locale switch
  const [query, setQuery] = useState("");
  // Whether the gallery's scroll port has content past its bottom edge, which
  // drives the fade above. Measured rather than assumed: the port's height
  // depends on the dialog's, and a filter can take a scrollable list down to
  // one row.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  const updateMoreBelow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
  }, []);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? designs.filter((d) =>
        [d.label, d.description ?? "", d.group ?? ""].some((s) => s.toLowerCase().includes(q))
      )
    : designs;
  const grouped = groupDesigns(filtered);
  // Two triggers, because neither covers the other. The layout effect catches a
  // filter changing the row count, synchronously, so the first paint after a
  // keystroke is already right. The observer catches the port itself changing
  // size — a rotation, a resized window, the on-screen keyboard opening — which
  // changes whether anything is below the fold and fires no scroll event, so
  // the fade would otherwise sit stale until the next scroll.
  useLayoutEffect(updateMoreBelow, [updateMoreBelow, filtered.length]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateMoreBelow);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateMoreBelow]);
  return (
    <div className="design-gallery flex min-h-0 flex-1 flex-col gap-3">
      {designs.length > 6 && (
        <input
          type="search"
          name="design-search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("designPicker.searchPlaceholder")}
          aria-label={t("designPicker.searchLabel")}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}
      {/* The scroll port shows about six cards and the dialog's footnote sits
          directly under the last visible row, so a twelve-design chooser read
          as a six-design one. This says the total in words; `moreBelow` adds
          the fade that says which direction. Not a live region: it sits beside
          the search box and would announce on every keystroke. */}
      {designs.length > 6 && (
        <p className="design-gallery__count -mb-1 shrink-0 text-xs text-muted-foreground">
          {filtered.length === designs.length
            ? t("designPicker.count", { count: designs.length })
            : t("designPicker.countFiltered", { shown: filtered.length, total: designs.length })}
        </p>
      )}
      {/* The fade is an OVERLAY, not a `mask-image` on the scroller. A mask made
          Chromium treat the faded region as not-visible for intersection
          purposes, so it never fetched the `loading="lazy"` cards below the
          fold at all: a twelve-design gallery showed six cards and six empty
          boxes that only populated once scrolled to. Verified by A/B on one
          build — mask on, 6 of 12 never loaded; mask off, all 12 did. An
          absolutely-positioned gradient outside the scroller paints the same
          thing and changes nothing about what the browser thinks is on screen.
          `pointer-events-none` so it cannot eat a click on the card beneath. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1"
        ref={scrollRef}
        onScroll={updateMoreBelow}
      >
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("designPicker.noMatches")}</p>
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
      {moreBelow && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent"
        />
      )}
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

export function DesignPicker({ designs, value, onChange, openSignal, gallery = false }: Props) {
  useLocale(); // subscription only: re-render this component's t() calls on a locale switch
  const runs = groupDesigns(designs);
  const grouped = runs.some((r) => r.group !== null);
  const [open, setOpen] = useState(false);

  // Open on a fresh signal (the CTA). A ref tracks the last-seen value so a
  // re-render alone can't re-open it.
  const lastSignal = useRef(openSignal);
  useEffect(() => {
    if (openSignal !== undefined && openSignal !== lastSignal.current) {
      lastSignal.current = openSignal;
      // `openSignal` is an external one-shot broadcast (a CTA click elsewhere
      // in the tree), not state derived from props, so it can't be computed
      // during render. The ref above makes this idempotent against re-renders.
      setOpen(true);
    }
  }, [openSignal]);

  if (gallery) {
    const current = designs.find((d) => d.id === value);
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        {/* Through DialogTrigger rather than a bare button with onClick: Radix
            then knows which element opened the dialog and restores focus to it
            on close. A bare button left that to the FocusScope fallback, which
            guesses. */}
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={t("designPicker.title")}
            className="font-display inline-flex h-8 min-w-0 items-center gap-1 rounded-md px-2 text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="truncate">{current?.label ?? value}</span>
            <ChevronDownIcon size={14} aria-hidden="true" />
          </button>
        </DialogTrigger>
        <DialogContent
          className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden p-4 sm:p-6"
          onOpenAutoFocus={preventTouchAutoFocus}
        >
          <DialogHeader>
            <DialogTitle>{t("designPicker.title")}</DialogTitle>
            <DialogDescription>{t("designPicker.description")}</DialogDescription>
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
