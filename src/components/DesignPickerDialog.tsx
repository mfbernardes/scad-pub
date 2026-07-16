// DesignPickerDialog.tsx — the card-grid design switcher shown instead of
// DesignPicker's dropdown Select when `ui.gallery` is enabled (see
// docs/config.md). Fully controlled by App.tsx (mounted only while open, like
// HelpModal/DesignDocModal/LicensesModal): App owns `value`/`onSelect`/
// `onClose`, and an optional `reason` for why it opened uninvited (a stale
// deep link — see urlState.ts's hashDesignIdMissing).
import { useCallback, useMemo, useRef, useState } from "react";
import type { Design } from "../openscad/types";
import { Modal, MODAL_BODY, MODAL_INTRO } from "./Modal";
import { groupDesigns } from "./DesignPicker";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";

interface Props {
  designs: Design[];
  /** The current design's id — highlighted with a border + "Current" badge. */
  value: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  /** Why the dialog opened without the user asking — shows a short explanatory
   *  line above the grid. Undefined/null for a normal open (button/CTA/⌘K). */
  reason?: "brokenLink" | null;
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

function matches(d: Design, query: string): boolean {
  const q = query.toLowerCase();
  return d.label.toLowerCase().includes(q) || (d.description ?? "").toLowerCase().includes(q);
}

/** A design's picker-card art: its `image` (a real photo/render, cropped to
 *  fill the card), else its small `icon` centred, else a letter glyph derived
 *  from the label. Always fills the same fixed 4:3 box so the grid stays even
 *  regardless of which fallback a given design lands on. */
function DesignArt({ design }: { design: Design }) {
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

function DesignCard({
  design,
  current,
  onSelect,
}: {
  design: Design;
  current: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      data-design={design.id}
      aria-current={current ? "true" : undefined}
      onClick={() => onSelect(design.id)}
      className={cn(
        "design-picker-dialog__card flex flex-col overflow-hidden rounded-(--radius-sm) border text-left transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        current ? "border-primary bg-primary/10" : "border-border bg-card"
      )}
    >
      <span className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-muted">
        <DesignArt design={design} />
        {current && (
          <span className="absolute top-1.5 right-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[0.65rem] font-semibold text-primary-foreground">
            {t("picker.current")}
          </span>
        )}
      </span>
      <span className="flex flex-col gap-0.5 px-2 py-[0.45rem]">
        <span className="text-[0.85rem] font-semibold text-foreground">{design.label}</span>
        {design.description && (
          <span className="line-clamp-2 text-[0.75rem] text-muted-foreground">
            {design.description}
          </span>
        )}
      </span>
    </button>
  );
}

export function DesignPickerDialog({ designs, value, onSelect, onClose, reason }: Props) {
  const [query, setQuery] = useState("");
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
  const filtered = useMemo(() => {
    if (!searchVisible || !query.trim()) return designs;
    return designs.filter((d) => matches(d, query.trim()));
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

  // Watch the scroll container for overflow via a CALLBACK ref rather than a
  // plain ref + effect: Modal's Dialog (Radix) animates its content in, and a
  // `useLayoutEffect` keyed on stable deps (nothing here changes across most
  // renders) can run its one-and-only pass before that content — including
  // this very div — has actually attached, permanently missing it. A callback
  // ref instead fires exactly when React attaches/detaches the real DOM node,
  // whatever Radix's own mount timing turns out to be, and again whenever its
  // identity changes (countRule flipping — the fast path making this moot).
  // Skipped entirely once the count rule already shows the box.
  const scrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      roRef.current?.disconnect();
      roRef.current = null;
      if (countRule || !el) return;
      measure(el);
      const ro = new ResizeObserver(() => measure(el));
      ro.observe(el);
      roRef.current = ro;
    },
    [countRule, measure]
  );

  return (
    <Modal title={t("picker.title")} label={t("picker.title")} onClose={onClose}>
      <div className="design-picker-dialog flex min-h-0 flex-1 flex-col">
        <div className={MODAL_INTRO}>
          <p>{t("picker.subtitle")}</p>
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
        <div ref={scrollRef} className={cn(MODAL_BODY, "min-h-0 flex-1")}>
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
                <div className="design-picker-dialog__grid grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
                  {run.items.map((d) => (
                    <DesignCard key={d.id} design={d} current={d.id === value} onSelect={onSelect} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
