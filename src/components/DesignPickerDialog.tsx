// DesignPickerDialog.tsx — the card-grid design switcher shown instead of
// DesignPicker's dropdown Select when `ui.gallery` is enabled (see
// docs/config.md). Fully controlled by App.tsx (mounted only while open, like
// HelpModal/DesignDocModal/LicensesModal): App owns `value`/`onSelect`/
// `onClose`, and an optional `reason` for why it opened uninvited (a stale
// deep link — see urlState.ts's hashDesignIdMissing).
import { useMemo, useState } from "react";
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
// this count, scanning the grid is faster than typing. Documented here (not
// just in docs/config.md) since it's a plain literal, not a config knob.
const SEARCH_THRESHOLD = 6;

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
  const searchVisible = designs.length > SEARCH_THRESHOLD;
  const filtered = useMemo(() => {
    if (!searchVisible || !query.trim()) return designs;
    return designs.filter((d) => matches(d, query.trim()));
  }, [designs, query, searchVisible]);
  const runs = useMemo(() => groupDesigns(filtered), [filtered]);

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
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("picker.search")}
              aria-label={t("picker.search")}
              className="w-full min-w-0 rounded-(--radius-sm) border bg-transparent px-3 py-[0.35rem] text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        )}
        <div className={cn(MODAL_BODY, "min-h-0 flex-1")}>
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
