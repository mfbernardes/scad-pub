// PresetPicker.tsx — a plain preset list (Bundled / Yours), with a
// "Save current as…" row. Used as a popover on desktop (CommandBar) and as the
// Presets tab on mobile.
//
// The three list-management actions — save-as, import, export — render two
// ways, chosen by the `compact` prop: two standing rows on desktop, one
// "Manage" popover on the mobile sheet, where they were spending a quarter of
// the tab. Both presentations compose the SAME `saveField`/`importButton`/
// `exportButton` below, so what the actions do can't drift between them.
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { Design } from "../openscad/types";
import type { ParsedSet, Values } from "../lib/presets";
import {
  deletePreset,
  loadPreset,
  savePreset,
  toParameterSetsFile,
  parseParameterSetsFile,
} from "../lib/presets";
import { downloadBlob } from "../lib/download";
import { parsePresetCardName } from "../lib/presetCard";
import { t } from "../lib/i18n";
import { Button } from "./ui/button";
import { IconButton } from "./IconButton";
import { FileInput } from "./FileInput";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { cn } from "../lib/utils";
import { Upload as UploadIcon, Download as DownloadIcon, X as XIcon, Check as CheckIcon, EllipsisVertical as MoreIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

/* One preset row. `preset-picker__item` is a JS hook too (the roving-focus
   querySelector below), not just styling. Rows read as tappable cards — a
   ready-made preset is a choice, not a line in a list; the selected one keeps
   its accent fill. */
const itemClass = (isSelected: boolean) =>
  cn(
    "preset-picker__item my-1 flex w-full items-center gap-2 rounded-(--radius-sm) border bg-background/40 px-3 py-2 text-left text-[0.88rem]",
    isSelected
      ? "border-primary bg-primary font-medium text-primary-foreground"
      : "enabled:hover:border-brand"
  );

// Shared look for the "Ready-made" / "Saved by you" section headers. They are
// <h2>: AppShell's visually-hidden <h1> is the page heading, and these are the
// first headings under it, so an <h3> here would skip a level (axe
// heading-order). The level is independent of the styling below.
const sectionHeadingClass =
  "font-display mt-2 mb-[0.2rem] px-[0.4rem] text-[0.72rem] font-semibold uppercase tracking-[0.04em] text-muted-foreground";

// One bundled-preset card (design.presetImages is set) — same art treatment
// as DesignGallery.tsx's design cards: an aspect-[4/3] object-cover
// thumbnail, a selected-state checkmark badge instead of a filled
// background (the plain list's `itemClass` fill would clash with a photo),
// and the name split into overline/title/badge by presetCard.ts. Keeps the
// `preset-picker__item` hook class (the roving-focus querySelector above and
// the smoke script both key off it) even though the layout is a card, not a
// list row.
const cardClass = (isSelected: boolean) =>
  cn(
    "preset-picker__item preset-picker__card relative flex w-full flex-col overflow-hidden rounded-lg border bg-background/40 text-left outline-none",
    isSelected ? "border-primary" : "border-border enabled:hover:border-brand"
  );

interface Props {
  design: Design;
  bundled: ParsedSet[];
  userPresets: string[];
  selected: string;
  /** Current parameter values; when provided, a "Save current as preset" row is shown. */
  values?: Values;
  onApply: (values: Values) => void;
  onSelectedChange: (id: string) => void;
  onPresetsChange: () => void;
  /** When true, renders inline (no popover wrapper). Used in mobile sheet tabs. */
  inline?: boolean;
  /**
   * Collapse the save + import/export rows into a single "Manage" overflow
   * (mobile) instead of two standing rows (desktop).
   *
   * Those two rows are `border-t`-separated, always mounted, and together
   * ~95px tall. On the mobile sheet's half detent the whole tab is ~330-380px,
   * so a quarter of the surface a first-time visitor lands on was going to
   * saving and file round-tripping — while the ready-made cards they came for
   * got about one and a half rows. Nothing is removed: the same three actions
   * live one tap away, in the popover.
   */
  compact?: boolean;
  onClose?: () => void;
}

export function PresetPicker({
  design,
  bundled,
  userPresets,
  selected,
  values,
  onApply,
  onSelectedChange,
  onPresetsChange,
  inline = false,
  compact = false,
  onClose,
}: Props) {
  // Whether the compact footer's "Manage" popover is open (compact only).
  const [manageOpen, setManageOpen] = useState(false);
  // Overridable via the config's `strings` block (src/locales/en.json's
  // presets.title) — see docs/config.md's "Text overrides".
  const presetsLabel = t("presets.title");
  // Preset images are optional per preset (docs/config.md's "Bundled presets"
  // note). A bundled preset that has a configured image renders as a card; one
  // without renders as a plain list row (the same `itemClass` row the "Saved by
  // you" section uses). A design with no `presetImages` at all → every preset is
  // imageless → the whole section is the compact list, exactly as before.
  const imagedBundled = bundled.filter((p) => design.presetImages?.[p.name]);
  const plainBundled = bundled.filter((p) => !design.presetImages?.[p.name]);
  const [saveName, setSaveName] = useState("");
  // The saved preset pending a delete confirmation (its name), or null when no
  // confirmation dialog is open. Deleting a saved preset is un-undoable, so it
  // gets the same AlertDialog guard as ResetButton's "reset to defaults".
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const sectionsRef = useRef<HTMLDivElement>(null);

  // Roving arrow-key navigation across every preset row — the rows are plain
  // buttons (natively tabbable), so this just layers Up/Down/Home/End
  // movement on top for keyboard users, like a typical listbox would give.
  const onListKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = Array.from(
      sectionsRef.current?.querySelectorAll<HTMLButtonElement>("button.preset-picker__item") ?? []
    );
    if (items.length === 0) return;
    e.preventDefault();
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "ArrowDown") next = idx < 0 ? 0 : Math.min(items.length - 1, idx + 1);
    else next = idx < 0 ? items.length - 1 : Math.max(0, idx - 1);
    items[next]?.focus();
  }, []);

  const applyBundled = (p: ParsedSet) => {
    onApply(p.values);
    onSelectedChange(`bundled:${design.id}:${p.name}`);
    onClose?.();
  };

  const applyUser = (name: string) => {
    const v = loadPreset(design.id, name);
    if (!v) return;
    onApply(v);
    onSelectedChange(`user:${design.id}:${name}`);
    onClose?.();
  };

  const handleDelete = (name: string) => {
    deletePreset(design.id, name);
    onPresetsChange();
    if (selected === `user:${design.id}:${name}`) onSelectedChange("");
  };

  const handleSave = () => {
    const name = saveName.trim();
    if (!name || !values) return;
    savePreset(design.id, name, values);
    onPresetsChange();
    onSelectedChange(`user:${design.id}:${name}`);
    setSaveName("");
  };

  // Export your saved presets as an OpenSCAD parameterSets file (round-trips
  // with the desktop Customizer: openscad -p <file>.json -P "Set name").
  const handleExport = () => {
    const sets: Record<string, Values> = {};
    for (const name of userPresets) {
      const v = loadPreset(design.id, name);
      if (v) sets[name] = v;
    }
    if (!Object.keys(sets).length) return;
    const file = toParameterSetsFile(design, sets);
    downloadBlob(
      new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }),
      `${design.id}-presets.json`
    );
  };

  // Import a parameterSets file (from this app or the desktop Customizer): each
  // named set becomes one of your saved presets.
  const handleImport = async (file: File) => {
    let parsed;
    try {
      parsed = parseParameterSetsFile(design, await file.text());
    } catch (err) {
      toast.error(
        `Couldn't import "${file.name}": ${err instanceof Error ? err.message : "not a valid parameterSets file."}`
      );
      return;
    }
    if (parsed.length === 0) {
      toast.error(`"${file.name}" has no parameter sets to import.`);
      return;
    }
    for (const set of parsed) savePreset(design.id, set.name, set.values);
    onPresetsChange();
  };

  // The "save these settings as…" field + its Save button. Shared verbatim by
  // the standing footer and the compact popover, so the two presentations can
  // never drift on what saving actually does.
  const saveField = values ? (
    <div className="flex items-center gap-[0.4rem]">
      <Input
        type="text"
        name="preset-name"
        autoComplete="off"
        className="h-8 flex-1"
        placeholder="Save these settings as…"
        value={saveName}
        aria-label="New preset name"
        onChange={(e) => setSaveName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
        }}
      />
      <Button size="sm" onClick={handleSave} disabled={!saveName.trim()}>
        Save
      </Button>
    </div>
  ) : null;

  // Import / export saved presets as an OpenSCAD parameterSets file — the same
  // format the desktop Customizer reads and writes, so presets carry between
  // the two. Shared by both footers like `saveField`, bar the width/alignment
  // each layout needs.
  const importButton = (
    <FileInput accept=".json,application/json" onFile={handleImport}>
      {(open) => (
        <Button
          variant="ghost"
          size="sm"
          className={compact ? "w-full justify-start" : undefined}
          onClick={open}
          title="Import presets from an OpenSCAD parameterSets file"
        >
          <UploadIcon size={14} /> Import…
        </Button>
      )}
    </FileInput>
  );
  const exportButton = (
    <Button
      variant="ghost"
      size="sm"
      className={compact ? "w-full justify-start" : "ml-auto"}
      onClick={handleExport}
      disabled={userPresets.length === 0}
      title={
        userPresets.length
          ? "Export your saved presets as an OpenSCAD parameterSets file"
          : "Save a preset first"
      }
    >
      <DownloadIcon size={14} /> Export
    </Button>
  );

  // Desktop: both rows stand permanently, where the docked panel has the room.
  const standingFooter = () => (
    <>
      {saveField && (
        <div className="shrink-0 border-t px-[0.6rem] py-2">{saveField}</div>
      )}
      <div className="flex shrink-0 items-center gap-[0.4rem] border-t px-[0.6rem] py-[0.4rem]">
        {importButton}
        {exportButton}
      </div>
    </>
  );

  // Mobile: one row, one tap away from the same three actions. See the
  // `compact` prop's own doc for why. Both footers are FUNCTIONS, not values:
  // PresetPicker re-renders on every parameter change (it takes `values`), and
  // building the branch that isn't used — a whole Popover tree, either way —
  // on each of those was pure waste.
  const compactFooter = () => (
    <div className="flex shrink-0 items-center justify-end border-t px-[0.6rem] py-[0.3rem]">
      <Popover open={manageOpen} onOpenChange={setManageOpen}>
        {/* `outline-none` suppresses index.css's global :focus-visible
            outline, so the replacement ring is required — this is a native
            <button> (PopoverTrigger needs the ref) and gets none of shadcn
            Button's focus styling. `min-h-11` keeps it at the coarse-pointer
            target floor the dock buttons and sheet tabs now share. */}
        <PopoverTrigger
          className="inline-flex min-h-11 cursor-pointer items-center gap-[0.35rem] rounded-(--radius-sm) border-none bg-transparent px-2 py-[0.3rem] text-[0.85rem] text-muted-foreground outline-none transition-[color,box-shadow] hover:text-brand focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:text-brand"
          aria-label={t("presets.manage")}
        >
          <MoreIcon size={15} aria-hidden="true" />
          {t("presets.manage")}
        </PopoverTrigger>
        {/* Opens upward: the trigger sits at the bottom of the sheet. */}
        <PopoverContent side="top" align="end" collisionPadding={8} className="w-64 p-2">
          {saveField}
          <div className="mt-1 flex flex-col gap-[0.1rem]">
            {importButton}
            {exportButton}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );

  const content = (
    <div className={cn("preset-picker flex flex-col", inline && "min-h-0 flex-1")}>
      {/* Inline (mobile sheet): fill the tab height so the list grows and the
          "Save current as…" row pins to the bottom. */}
      <div
        className={cn("overflow-y-auto overscroll-contain px-1 pt-1 pb-2", inline ? "flex-1" : "max-h-72")}
        ref={sectionsRef}
        onKeyDown={onListKeyDown}
      >
        {bundled.length > 0 && (
          <section>
            <h2 className={sectionHeadingClass}>
              Ready-made
            </h2>
            {/* Presets with a configured image render as a card grid; the rest
                render as plain list rows below them. We group (grid, then rows)
                rather than interleave, so a mixed design still reads cleanly
                under the one "Ready-made" heading. The grid keeps the
                "Ready-made presets" aria-label (smoke/vis scripts key off it);
                when there are no imaged presets the row list carries that label
                instead, so a fully-imageless design is unchanged. */}
            {imagedBundled.length > 0 && (
              <ul aria-label="Ready-made presets" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {imagedBundled.map((p) => {
                  const id = `bundled:${design.id}:${p.name}`;
                  const isSelected = selected === id;
                  const parsed = parsePresetCardName(p.name);
                  const image = design.presetImages?.[p.name];
                  return (
                    <li key={p.name}>
                      <button
                        type="button"
                        className={cardClass(isSelected)}
                        aria-pressed={isSelected}
                        onClick={() => applyBundled(p)}
                      >
                        <span className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted">
                          <img
                            src={image}
                            alt=""
                            loading="lazy"
                            width={640}
                            height={480}
                            className="h-full w-full object-cover"
                          />
                        </span>
                        {isSelected && (
                          <span
                            className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
                            aria-hidden="true"
                          >
                            <CheckIcon size={12} />
                          </span>
                        )}
                        <span className="preset-picker__card-body flex min-h-14 flex-col gap-0.5 px-2 py-[0.4rem]">
                          {parsed.overline && (
                            <span className="truncate text-[0.66rem] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
                              {parsed.overline}
                            </span>
                          )}
                          <span className="truncate text-[0.82rem] font-medium text-foreground">{parsed.title}</span>
                          {parsed.badge && (
                            <span className="w-fit rounded-full bg-muted px-[0.4rem] py-[0.05rem] text-[0.66rem] text-muted-foreground">
                              {parsed.badge}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {plainBundled.length > 0 && (
              <ul aria-label={imagedBundled.length > 0 ? "More ready-made presets" : "Ready-made presets"}>
                {plainBundled.map((p) => {
                  const id = `bundled:${design.id}:${p.name}`;
                  return (
                    <li key={p.name}>
                      <button
                        className={itemClass(selected === id)}
                        aria-pressed={selected === id}
                        onClick={() => applyBundled(p)}
                      >
                        {p.name}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
        {userPresets.length > 0 && (
          <section>
            <h2 className={sectionHeadingClass}>
              Saved by you
            </h2>
            <ul aria-label="Your saved presets">
              {userPresets.map((name) => {
                const id = `user:${design.id}:${name}`;
                return (
                  <li key={name} className="flex items-center gap-[0.15rem]">
                    <button
                      className={cn(itemClass(selected === id), "min-w-0 flex-1")}
                      aria-pressed={selected === id}
                      onClick={() => applyUser(name)}
                    >
                      {name}
                    </button>
                    <button
                      className="shrink-0 rounded-(--radius-sm) border border-transparent bg-transparent px-[0.45rem] py-[0.2rem] text-[0.8rem] text-muted-foreground enabled:hover:bg-muted enabled:hover:text-warn"
                      onClick={() => setDeleteTarget(name)}
                      aria-label={`Delete preset "${name}"`}
                      title={`Delete "${name}"`}
                    >
                      Delete
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {bundled.length === 0 && userPresets.length === 0 && (
          <p className="px-[0.6rem] py-2 text-[0.85rem] text-muted-foreground">
            No presets yet — set things up the way you like, then save them below.
          </p>
        )}
      </div>

      {compact ? compactFooter() : standingFooter()}
    </div>
  );

  const deleteDialog = (
    <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete preset?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes your saved preset “{deleteTarget}”.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (deleteTarget) handleDelete(deleteTarget);
              setDeleteTarget(null);
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (inline)
    return (
      <>
        {content}
        {deleteDialog}
      </>
    );

  return (
    <div className="preset-picker-popover overflow-hidden bg-card" role="dialog" aria-label={presetsLabel}>
      <div className="flex items-center border-b py-[0.4rem] pr-2 pl-3">
        <span className="flex-1 text-[0.88rem] font-semibold">{presetsLabel}</span>
        {onClose && (
          <IconButton label="Close presets" onClick={onClose}>
            <XIcon size={16} />
          </IconButton>
        )}
      </div>
      {content}
      {deleteDialog}
    </div>
  );
}
