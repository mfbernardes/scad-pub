// DesignPickerDialog.tsx — the card-grid design switcher shown instead of
// DesignPicker's dropdown Select when `ui.gallery` is enabled (see
// docs/config.md), and reused as the goal-oriented first-run "welcome"
// picker (`popup.mode: "picker"` — see App.tsx and src/lib/popup.ts's
// resolvePopupSurface). App.tsx owns `value`/`onSelect`/`onClose`, an
// optional `reason` for why it opened uninvited (a stale deep link — see
// urlState.ts's hashDesignIdMissing), and — only for the welcome variant —
// the `welcome` bundle below.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Design } from "../openscad/types";
import { Modal, MODAL_BODY, MODAL_INTRO } from "./Modal";
import { Markdown } from "./Markdown";
import { Button } from "./ui/button";
import { groupDesigns } from "./DesignPicker";
import { Check as CheckIcon, Lock as LockIcon } from "lucide-react";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";

interface WelcomeProps {
  /** Popup `header` — the dialog's heading, in place of the plain "Choose a
   *  design" title. */
  heading: string;
  /** Popup `body` — a short Markdown subtitle, in place of `picker.subtitle`. */
  subtitle: string;
  /** Popup `footnote` — a muted privacy/trust note in the footer's left slot.
   *  Null/absent renders no note. */
  footnote?: string | null;
  /** "Browse examples" — closes the dialog and opens the Examples/presets
   *  surface for the highlighted card's design. Only offered when that
   *  design actually ships bundled presets (`design.presets.length > 0`). */
  onBrowseExamples: (id: string) => void;
}

interface Props {
  designs: Design[];
  /** The current design's id — highlighted with a border + check. Also the
   *  welcome variant's initial highlighted card. */
  value: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  /** Why the dialog opened without the user asking — shows a short explanatory
   *  line above the grid. Undefined/null for a normal open (button/CTA/⌘K). */
  reason?: "brokenLink" | null;
  /**
   * Present -> render as the first-run welcome picker: a custom heading/
   * subtitle, a footer (footnote + Browse examples + "Start with {design}"),
   * and a two-step "highlight a card, then confirm" flow — clicking a card
   * only highlights it (see `selectedId` below); the footer's primary button
   * is what actually calls `onSelect`. Absent -> the classic behaviour:
   * clicking (or Enter-ing) a card calls `onSelect` immediately and the
   * dialog has no footer.
   */
  welcome?: WelcomeProps;
}

// The search box only earns its place once there's enough to search: below
// this count, scanning the grid is faster than typing. A fast path — no
// measuring needed, so it can never flash in a beat late — for the common
// case of a build with plenty of designs; a build at or below it can still
// show the box adaptively (see the overflow effect below) once the grid
// actually outgrows the dialog's scroll area at the current viewport size, a
// short/landscape window overflowing well under this count. Documented here
// (not just in docs/config.md) since it's a plain literal, not a config knob.
const SEARCH_THRESHOLD = 6;

// Slack (px) before the grid counts as "overflowing" — a hair of rounding
// jitter in scrollHeight/clientHeight must never flip the search box on/off
// spuriously.
const OVERFLOW_EPSILON = 2;

/** Shared substring search across a design's label/description/group —
 *  exported so UnifiedSelectorDialog's Designs group filters identically
 *  instead of keeping its own copy (see UnifiedSelectorDialog.tsx). */
export function designMatchesQuery(d: Design, query: string): boolean {
  const q = query.toLowerCase();
  return (
    d.label.toLowerCase().includes(q) ||
    (d.description ?? "").toLowerCase().includes(q) ||
    (d.group ?? "").toLowerCase().includes(q)
  );
}

/** A design's picker-card art: its `image` (a real photo/render, cropped to
 *  fill the card), else its small `icon` centred, else a letter glyph derived
 *  from the label. Always fills the same fixed 4:3 box so the grid stays even
 *  regardless of which fallback a given design lands on. Exported so
 *  UnifiedSelectorDialog's Designs group reuses the exact same art instead of
 *  keeping its own copy (see UnifiedSelectorDialog.tsx). */
export function DesignArt({ design }: { design: Design }) {
  if (design.image) {
    return (
      <img
        src={design.image}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
      />
    );
  }
  if (design.icon) {
    return (
      <img
        src={design.icon}
        alt=""
        loading="lazy"
        className="h-16 w-16 object-contain"
      />
    );
  }
  return (
    <span className="font-display text-3xl font-bold text-muted-foreground" aria-hidden="true">
      {design.label.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** "grid" is today's square tile (image on top, one-line truncated title);
 *  "row" is mobile's horizontal list row (larger thumbnail, full wrapping
 *  title, untruncated 1-2 line description) — see `DesignCard`'s own
 *  `layout` doc (round-5 review, quality item 6). */
export type PickerCardLayout = "grid" | "row";

/** The picker-card shell (art box + badge pill + selected check + title +
 *  description). Exported so UnifiedSelectorDialog's Designs group reuses it
 *  verbatim (with `welcome={false}`, since that dialog has no two-step
 *  highlight-then-confirm flow) instead of keeping its own near-identical
 *  `SelectorCard` for that one group — see UnifiedSelectorDialog.tsx. */
export function DesignCard({
  design,
  current,
  welcome,
  onSelect,
  layout = "grid",
}: {
  design: Design;
  /** Highlighted (accent border + check) — the "current" design outside the
   *  welcome variant, or the pending highlighted choice inside it. */
  current: boolean;
  welcome: boolean;
  onSelect: (id: string) => void;
  /** Round-5 review, quality item 6: "row" is UnifiedSelectorDialog's mobile
   *  one-column list shape (was a separate `SelectorListRow` copy) — a
   *  larger, non-shrinking thumbnail, the FULL title (wraps, never
   *  truncated; no badge pill, matching Wave 2's original row visuals
   *  exactly), and an untruncated 1-2 line description. Defaults to "grid"
   *  (today's square tile) so every existing caller — including "tabs"
   *  workflow's DesignPickerDialog, which never passes this — stays
   *  byte-identical. */
  layout?: PickerCardLayout;
}) {
  const row = layout === "row";
  return (
    <button
      type="button"
      data-design={design.id}
      aria-current={!welcome && current ? "true" : undefined}
      aria-pressed={welcome ? current : undefined}
      onClick={() => onSelect(design.id)}
      className={cn(
        "design-picker-dialog__card rounded-(--radius-card) border text-left shadow-(--shadow-1) transition-[border-color,box-shadow,background-color] outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        row ? "flex w-full items-center gap-3 p-2" : "flex flex-col overflow-hidden",
        current
          ? "border-primary bg-primary/10"
          : row
            ? "border-border bg-card hover:border-brand"
            : "border-border bg-card hover:border-brand hover:shadow-(--shadow-2)"
      )}
    >
      <span
        className={cn(
          "relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted",
          row ? "w-24 shrink-0 rounded-(--radius-sm)" : "w-full"
        )}
      >
        <DesignArt design={design} />
        {!row && design.badge && (
          <span className="design-picker-dialog__badge absolute top-1.5 left-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[0.65rem] font-semibold text-primary-foreground">
            {design.badge}
          </span>
        )}
        {current && (
          <span
            className={cn(
              "design-picker-dialog__check absolute inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground",
              row ? "top-1 right-1" : "top-1.5 right-1.5"
            )}
            aria-hidden="true"
          >
            <CheckIcon size={13} strokeWidth={3} />
          </span>
        )}
      </span>
      {/* Grid: min-h keeps every card's text block the same height whether or
          not a given design has a description, so grid rows stay aligned — a
          card with no description just carries blank space below its title
          rather than shrinking shorter than its neighbours. Row: no min-h
          (a single list column has no row-alignment concern), and the title
          wraps instead of truncating (mobile has the width to spare, and a
          full-width row reads oddly with a clipped title). */}
      <span className={row ? "flex min-w-0 flex-1 flex-col gap-0.5 py-1" : "flex min-h-[4.75rem] flex-col gap-0.5 px-3 py-2"}>
        <span
          className={
            row
              ? "text-[0.92rem] leading-[1.25] font-semibold text-foreground"
              : "block truncate text-[0.85rem] font-semibold text-foreground"
          }
        >
          {design.label}
          {current && (
            <span className="sr-only"> — {t(welcome ? "picker.selected" : "picker.current")}</span>
          )}
        </span>
        {design.description && (
          <span
            className={cn(
              "line-clamp-2 text-muted-foreground",
              row ? "text-[0.8rem] leading-[1.35]" : "text-[0.75rem] leading-[1.35]"
            )}
          >
            {design.description}
          </span>
        )}
      </span>
    </button>
  );
}

export function DesignPickerDialog({ designs, value, onSelect, onClose, reason, welcome }: Props) {
  const [query, setQuery] = useState("");
  // The welcome variant's own pending choice — starts on the design that's
  // already loaded (same as the classic variant's "current" card), but a
  // card click here only highlights it; the footer's buttons are what
  // actually act on it. Enter on a focused card fires the same onClick (it's
  // a native <button>), so keyboard use needs no special handling.
  const [selectedId, setSelectedId] = useState(value);
  const selectedDesign = useMemo(
    () => designs.find((d) => d.id === selectedId),
    [designs, selectedId]
  );
  const pickCard = welcome ? setSelectedId : onSelect;
  const highlighted = welcome ? selectedId : value;

  // Fast path: no measuring needed, no flash.
  const countRule = designs.length > SEARCH_THRESHOLD;
  // Adaptive path: whether the card grid actually overflows the scroll area
  // at the current viewport size — only tracked/measured while the count rule
  // doesn't already force it (see the effect below).
  const [overflowing, setOverflowing] = useState(false);
  const searchVisible = countRule || overflowing;
  const inputRef = useRef<HTMLInputElement>(null);
  // Mirrors `query` for the overflow observer below, which is set up once per
  // scroll-container mount (a callback ref, not an effect — see its own doc)
  // and must read the LATEST query without re-subscribing on every keystroke.
  const queryRef = useRef(query);
  queryRef.current = query;
  const roRef = useRef<ResizeObserver | null>(null);
  // The scroll container itself, kept around so the bottom-fade listener
  // (added below, independent of the count-rule-gated overflow tracking) can
  // find it without needing its own callback-ref plumbing.
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const scrollListenerElRef = useRef<HTMLDivElement | null>(null);
  const filtered = useMemo(() => {
    if (!searchVisible || !query.trim()) return designs;
    return designs.filter((d) => designMatchesQuery(d, query.trim()));
  }, [designs, query, searchVisible]);
  const runs = useMemo(() => groupDesigns(filtered), [filtered]);

  const measure = useCallback((el: HTMLDivElement) => {
    const isOverflowing = el.scrollHeight > el.clientHeight + OVERFLOW_EPSILON;
    setOverflowing((prev) => {
      if (isOverflowing) return true;
      // Never hide the box out from under someone mid-search: a resize that
      // removes the overflow only clears it again when the search input
      // isn't focused AND carries no query — losing focus or a typed query
      // mid-search would be worse than leaving an unnecessary box up.
      if (prev && (document.activeElement === inputRef.current || queryRef.current.trim())) return prev;
      return isOverflowing;
    });
  }, []);

  // Whether the card grid has more content hidden below the current scroll
  // position — drives a subtle bottom-edge fade (see design-picker-dialog__
  // grid-scroll in index.css, the same mask-image pattern HelpModal's mobile
  // tab strip uses for its left/right fades). Tracked independently of the
  // count-rule-gated overflow-search logic above: the fade must work whether
  // or not the search box happens to be showing.
  const [fadeBottom, setFadeBottom] = useState(false);
  const updateFade = useCallback(() => {
    const el = scrollElRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    setFadeBottom(scrollHeight - (scrollTop + clientHeight) > OVERFLOW_EPSILON);
  }, []);
  // Recompute whenever the visible card set changes (search filtering) — a
  // ResizeObserver on the (fixed-height) scroll container alone never fires
  // for that, since only its *content* height changes, not its own box.
  useEffect(() => {
    updateFade();
  }, [runs, updateFade]);

  // Watch the scroll container for overflow via a CALLBACK ref rather than a
  // plain ref + effect: Modal's Dialog (Radix) animates its content in, and a
  // `useLayoutEffect` keyed on stable deps (nothing here changes across most
  // renders) can run its one-and-only pass before that content — including
  // this very div — has actually attached, permanently missing it. A callback
  // ref instead fires exactly when React attaches/detaches the real DOM node,
  // whatever Radix's own mount timing turns out to be, and again whenever its
  // identity changes (countRule flipping — the fast path making this moot).
  // The overflow->search-box measurement is skipped once the count rule
  // already forces the box; the bottom-fade tracking below always runs.
  const scrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      roRef.current?.disconnect();
      roRef.current = null;
      if (scrollListenerElRef.current) {
        scrollListenerElRef.current.removeEventListener("scroll", updateFade);
        scrollListenerElRef.current = null;
      }
      scrollElRef.current = el;
      if (!el) return;

      el.addEventListener("scroll", updateFade, { passive: true });
      scrollListenerElRef.current = el;
      updateFade();

      if (!countRule) measure(el);
      const ro = new ResizeObserver(() => {
        if (!countRule) measure(el);
        updateFade();
      });
      ro.observe(el);
      roRef.current = ro;
    },
    [countRule, measure, updateFade]
  );

  const title = welcome ? welcome.heading : t("picker.title");
  // Bundled presets ("Examples") only make sense to browse for a design that
  // actually ships any — `design.presets` is a build-time fact (the sibling
  // parameterSets file's presence), so this needs no async fetch to know.
  const showBrowseExamples = !!welcome && !!selectedDesign && selectedDesign.presets.length > 0;

  return (
    <Modal title={title} label={title} onClose={onClose} size="wide">
      <div className="design-picker-dialog flex min-h-0 flex-1 flex-col">
        <div className={MODAL_INTRO}>
          {welcome ? <Markdown body={welcome.subtitle} /> : <p>{t("picker.subtitle")}</p>}
          {reason === "brokenLink" && <p className="mt-1 text-warn">{t("picker.brokenLink")}</p>}
        </div>
        {searchVisible && (
          <div className="px-4 pb-2">
            <input
              ref={inputRef}
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("picker.search")}
              aria-label={t("picker.search")}
              className="design-picker-dialog__search w-full min-w-0 rounded-(--radius-sm) border bg-transparent px-3 py-[0.35rem] text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        )}
        <div
          ref={scrollRef}
          data-fade-bottom={fadeBottom || undefined}
          className={cn(MODAL_BODY, "design-picker-dialog__grid-scroll min-h-0 flex-1")}
        >
          {filtered.length === 0 ? (
            <p className="px-1 py-8 text-center text-[0.85rem] text-muted-foreground">
              {t("picker.empty")}
            </p>
          ) : (
            runs.map((run, i) => (
              <div key={run.group ?? `ungrouped-${i}`} className="mb-3 last:mb-0">
                {run.group && (
                  <h3 className="mb-1.5 px-0.5 text-xs font-semibold tracking-wider text-foreground/70 uppercase">
                    {run.group}
                  </h3>
                )}
                <div className="design-picker-dialog__grid grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {run.items.map((d) => (
                    <DesignCard
                      key={d.id}
                      design={d}
                      current={d.id === highlighted}
                      welcome={!!welcome}
                      onSelect={pickCard}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
        {welcome && (
          <div className="design-picker-dialog__footer flex flex-wrap items-center gap-x-2 gap-y-2 border-t px-4 py-3">
            {welcome.footnote && (
              // basis-full: on a narrow dialog (mobile), this always claims its
              // own row above the buttons rather than being squeezed down to a
              // sliver next to them — a plain `flex-1` child can shrink to ~0
              // width before wrapping, since `min-w-0` (needed so the text can
              // wrap at all) also drops its automatic flex-basis floor.
              <div className="flex min-w-0 basis-full items-start gap-1.5 text-[0.78rem] text-muted-foreground sm:basis-auto sm:flex-1">
                <LockIcon size={13} className="mt-[0.15rem] shrink-0" aria-hidden="true" />
                <span>{welcome.footnote}</span>
              </div>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {showBrowseExamples && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="design-picker-dialog__browse"
                  onClick={() => welcome.onBrowseExamples(selectedId)}
                >
                  {t("picker.browseExamples")}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                className="design-picker-dialog__start"
                disabled={!selectedDesign}
                onClick={() => onSelect(selectedId)}
              >
                {t("picker.startWith", { design: selectedDesign?.label ?? "" })}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
