// PresetPicker.tsx: a plain preset list (Bundled / Yours), with a
// "Save current as…" row. Rendered in place by both layouts: the desktop
// panel's Presets tab and the mobile sheet's.
//
// The three list-management actions (save-as, import, export) render two
// ways, chosen by the `compact` prop: two standing rows on desktop, one row on
// the mobile sheet. Both presentations compose the SAME
// `saveField`/`importButton`/`exportButton` below, so what the actions do
// can't drift between them.
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
  ParameterSetsFormatError,
} from "../lib/presets";
import { downloadBlob } from "../lib/download";
import { parsePresetCardName } from "../lib/presetCard";
import { localizePresetName } from "../lib/designI18n";
import { t, tn, formatList } from "../lib/i18n";
import { useLocale, getDesignStrings } from "../lib/localeStore";
import { Button } from "./ui/button";
import { FileInput } from "./FileInput";
import { Thumbnail } from "./Thumbnail";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { cn } from "../lib/utils";
import { Upload as UploadIcon, Download as DownloadIcon, Check as CheckIcon, EllipsisVertical as MoreIcon } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";

/* One preset row. `preset-picker__item` is a JS hook too (the roving-focus
   querySelector below), not only styling. Rows read as tappable cards: a
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

// One bundled-preset card (design.presetImages is set): same art treatment
// as DesignPicker.tsx's DesignGallery design cards: an aspect-[4/3] object-cover
// thumbnail, a selected-state checkmark badge instead of a filled
// background (the plain list's `itemClass` fill would clash with a photo),
// and the name split into overline/title/badge by presetCard.ts. Keeps the
// `preset-picker__item` hook class (the roving-focus querySelector above and
// the smoke script both key off it) even though the layout is a card, not a
// list row.
// `outline-none` suppresses index.css's global :focus-visible outline (a card
// spans two lines of copy the default outline would just clip a corner of),
// so the replacement ring is required — same treatment as DesignPicker's own
// gallery cards.
const cardClass = (isSelected: boolean) =>
  cn(
    "preset-picker__item preset-picker__card relative flex w-full flex-col overflow-hidden rounded-lg border bg-background/40 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
    isSelected ? "border-primary" : "border-border enabled:hover:border-brand"
  );

/** Summarises colliding preset names for the import dialog: every name when
 *  there are few, else the first `max` with an "N more" tail folded into the
 *  same conjunction join, so "A, B, C, and 2 more" reads as one sentence
 *  instead of a truncated dump. Joins through i18n.ts's `formatList`, which
 *  already reads the active locale's `Intl.ListFormat`. */
function summarizeCollisions(names: string[], max = 3): string {
  if (names.length <= max) return formatList(names);
  return formatList([...names.slice(0, max), tn("presets.moreCount", names.length - max)]);
}

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
  /**
   * Fold the footer into ONE row (mobile) instead of two standing rows
   * (desktop): the save field keeps the row, and import/export. The two
   * actions a first-time visitor never needs. Move into a "⋮" overflow at its
   * end.
   *
   * Two `border-t`-separated rows are ~95px of a mobile sheet whose half detent
   * is ~330-380px, so the cards someone came for got about one and a half rows.
   * Collapsing all three actions behind one overflow trigger was worse still:
   * the trigger row cost a full row anyway and bought back nothing.
   */
  compact?: boolean;
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
  compact = false,
}: Props) {
  // Subscribes this component to every locale-store change (tag switch AND
  // a locale's own async sidecar load, see `designsGeneration` below) — the
  // tag itself isn't read directly here; formatList/localizePresetName read
  // the active locale from i18n.ts/localeStore.ts's own current binding.
  useLocale();
  // Display-only translation of a bundled preset's NAME (localizePresetName's
  // own doc). Re-read on every render rather than memoized: calling
  // useLocale() above already subscribes this component to every store
  // change (tag switch AND a locale's own async sidecar load, see
  // localeStore.ts's `designsGeneration`), so a stale closure here isn't a
  // risk, and the map itself is a cheap object lookup. Every IDENTITY use of
  // a preset name below (the `bundled:<id>:<name>` id, `presetImages` keys)
  // stays on the raw `p.name`, never this.
  const designStrings = getDesignStrings(design.id);
  // Whether the compact footer's import/export overflow is open (compact only).
  const [manageOpen, setManageOpen] = useState(false);
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
  // A save whose name collides with an existing saved preset, pending
  // confirmation, or null when no such dialog is open. Overwriting a saved
  // preset by typing its exact name is exactly as un-undoable as Delete, so
  // it gets the same guard — see handleSave.
  const [pendingSave, setPendingSave] = useState<{ name: string; values: Values } | null>(null);
  // An import whose file collides with one or more existing saved preset
  // names, pending confirmation, or null when no such dialog is open. Holds
  // the FULL parsed file so confirming can apply it — see handleImport.
  // Collisions are derived from this against `userPresets` where needed
  // rather than stored, since they're just a filter over the same two.
  const [pendingImport, setPendingImport] = useState<ParsedSet[] | null>(null);
  const pendingImportCollisions = pendingImport
    ? pendingImport.map((s) => s.name).filter((name) => userPresets.includes(name))
    : [];
  const sectionsRef = useRef<HTMLDivElement>(null);

  // Roving arrow-key navigation across every preset row: the rows are plain
  // buttons (natively tabbable), so this only layers Up/Down/Home/End
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
  };

  const applyUser = (name: string) => {
    const v = loadPreset(design.id, name);
    if (!v) return;
    onApply(v);
    onSelectedChange(`user:${design.id}:${name}`);
  };

  const handleDelete = (name: string) => {
    deletePreset(design.id, name);
    onPresetsChange();
    if (selected === `user:${design.id}:${name}`) onSelectedChange("");
  };

  // Writes the preset and clears the field. Shared by the direct save and the
  // collision dialog's confirm, so the two paths can't drift on what saving
  // actually does.
  const doSave = (name: string, v: Values) => {
    savePreset(design.id, name, v);
    onPresetsChange();
    onSelectedChange(`user:${design.id}:${name}`);
    setSaveName("");
  };

  const handleSave = () => {
    const name = saveName.trim();
    if (!name || !values) return;
    // Exact-name match, the same rule savePreset merges by (store[designId][name]):
    // a collision here IS the overwrite about to happen, not a near-miss.
    if (userPresets.includes(name)) {
      setPendingSave({ name, values });
      return;
    }
    doSave(name, values);
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

  // Writes every set in the parsed file. Shared by the silent no-collision
  // path and the collision dialog's confirm.
  const doImport = (sets: ParsedSet[]) => {
    for (const set of sets) savePreset(design.id, set.name, set.values);
    onPresetsChange();
  };

  // Import a parameterSets file (from this app or the desktop Customizer): each
  // named set becomes one of your saved presets.
  const handleImport = async (file: File) => {
    let parsed;
    try {
      parsed = parseParameterSetsFile(design, await file.text());
    } catch (err) {
      // ParameterSetsFormatError is the parser's one known, expected failure
      // (see its own doc): map it to a catalogue reason rather than its
      // hardcoded-English `.message`, which would otherwise land untranslated
      // inside this (translated) toast. Any other error (malformed JSON, …)
      // keeps its generic `.message` when it's an Error, or the catalogue's
      // locale-neutral fallback reason otherwise. duration: Infinity
      // (WCAG 3.3.1) + a stable id: repeated failures replace this toast
      // rather than stacking.
      const reason =
        err instanceof ParameterSetsFormatError
          ? t("presets.importNotParameterSets")
          : err instanceof Error
            ? err.message
            : t("presets.importInvalidReason");
      toast.error(t("presets.importParseError", { name: file.name, reason }), {
        id: "preset-import-error",
        duration: Infinity,
      });
      return;
    }
    if (parsed.length === 0) {
      toast.error(t("presets.importEmpty", { name: file.name }), {
        id: "preset-import-error",
        duration: Infinity,
      });
      return;
    }
    const collisions = parsed.map((s) => s.name).filter((name) => userPresets.includes(name));
    if (collisions.length > 0) {
      setPendingImport(parsed);
      return;
    }
    doImport(parsed);
  };

  // The "save these settings as…" field + its Save button. Shared verbatim by
  // both footers, so the two presentations can never drift on what saving
  // actually does. `min-w-0` lets it shrink beside the compact overflow.
  const saveField = values ? (
    <div className="flex min-w-0 flex-1 items-center gap-[0.4rem]">
      <Input
        type="text"
        name="preset-name"
        autoComplete="off"
        className="h-8 flex-1"
        placeholder={t("presets.saveAsPlaceholder")}
        value={saveName}
        aria-label={t("presets.newNameAria")}
        onChange={(e) => setSaveName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
        }}
      />
      <Button size="sm" onClick={handleSave} disabled={!saveName.trim()}>
        {t("presets.save")}
      </Button>
    </div>
  ) : null;

  // Import / export saved presets as an OpenSCAD parameterSets file: the same
  // format the desktop Customizer reads and writes, so presets carry between
  // the two. Shared by both footers like `saveField`, bar the width/alignment
  // and the coarse-pointer height each layout needs.
  const importButton = (
    <FileInput accept=".json,application/json" onFile={handleImport}>
      {(open) => (
        <Button
          variant="ghost"
          size="sm"
          className={compact ? "min-h-11 w-full justify-start" : undefined}
          onClick={open}
          title={t("presets.importTitle")}
        >
          <UploadIcon size={14} /> {t("presets.import")}
        </Button>
      )}
    </FileInput>
  );
  const exportButton = (
    <Button
      variant="ghost"
      size="sm"
      className={compact ? "min-h-11 w-full justify-start" : "ml-auto"}
      onClick={handleExport}
      disabled={userPresets.length === 0}
      title={userPresets.length ? t("presets.exportTitleReady") : t("presets.exportTitleEmpty")}
    >
      <DownloadIcon size={14} /> {t("presets.export")}
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

  // Mobile: the save field keeps the one row it was going to cost anyway, and
  // import/export sit in the "⋮" at its end. Both footers are FUNCTIONS, not
  // values: PresetPicker re-renders on every parameter change (it takes
  // `values`), and building the branch that isn't used. A whole Popover tree,
  // either way, on each of those was pure waste.
  const compactFooter = () => (
    <div className="flex shrink-0 items-center gap-[0.4rem] border-t px-[0.6rem] py-[0.4rem]">
      {saveField}
      <Popover open={manageOpen} onOpenChange={setManageOpen}>
        {/* `outline-none` suppresses index.css's global :focus-visible
            outline, so the replacement ring is required. This is a native
            <button> (PopoverTrigger needs the ref) and gets none of shadcn
            Button's focus styling. `size-11` keeps it at the coarse-pointer
            target floor the dock buttons and sheet tabs share; `ml-auto` pins
            it to the end when there is no save field to push it there. */}
        <PopoverTrigger
          className="ml-auto inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-(--radius-sm) border-none bg-transparent text-muted-foreground outline-none transition-[color,box-shadow] hover:text-brand focus-visible:ring-[3px] focus-visible:ring-ring/80 data-[state=open]:text-brand"
          aria-label={t("presets.manage")}
          title={t("presets.manage")}
        >
          <MoreIcon size={17} aria-hidden="true" />
        </PopoverTrigger>
        {/* Opens upward: the trigger sits at the bottom of the sheet. */}
        <PopoverContent side="top" align="end" collisionPadding={8} className="w-56 p-2">
          <div className="flex flex-col gap-[0.1rem]">
            {importButton}
            {exportButton}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );

  const content = (
    <div className="preset-picker flex min-h-0 flex-1 flex-col">
      <div
        className="flex-1 overflow-y-auto overscroll-contain px-1 pt-1 pb-2"
        ref={sectionsRef}
        onKeyDown={onListKeyDown}
      >
        {bundled.length > 0 && (
          <section>
            <h2 className={sectionHeadingClass}>
              {t("presets.readyMade")}
            </h2>
            {/* Presets with a configured image render as a card grid; the rest
                render as plain list rows below them. We group (grid, then rows)
                rather than interleave, so a mixed design still reads cleanly
                under the one "Ready-made" heading. The grid keeps the
                "Ready-made presets" aria-label (smoke/vis scripts key off it);
                when there are no imaged presets the row list carries that label
                instead, so a fully-imageless design is unchanged. */}
            {imagedBundled.length > 0 && (
              <ul aria-label={t("presets.readyMadeAria")} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {imagedBundled.map((p) => {
                  const id = `bundled:${design.id}:${p.name}`;
                  const isSelected = selected === id;
                  const displayName = localizePresetName(designStrings, p.name);
                  const parsed = parsePresetCardName(displayName);
                  const image = design.presetImages?.[p.name];
                  return (
                    <li key={p.name}>
                      <button
                        type="button"
                        className={cardClass(isSelected)}
                        aria-current={isSelected ? "true" : undefined}
                        title={displayName}
                        onClick={() => applyBundled(p)}
                      >
                        <Thumbnail src={image!} />
                        {isSelected && (
                          <span
                            className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
                            aria-hidden="true"
                          >
                            <CheckIcon size={12} />
                          </span>
                        )}
                        {/* min-h-[2lh] (not a fixed rem value) keeps the
                            2-line-clamped name's reserved space in step with
                            its own line-height, so cards in a row stay even
                            whether the title wraps or not. */}
                        <span className="preset-picker__card-body flex min-h-14 flex-col gap-0.5 px-2 py-[0.4rem]">
                          {parsed.overline && (
                            <span
                              className="truncate text-[0.66rem] font-semibold uppercase tracking-[0.03em] text-muted-foreground"
                              title={parsed.overline}
                            >
                              {parsed.overline}
                            </span>
                          )}
                          {/* `line-clamp` only ellipsizes VERTICAL overflow, so a
                              word wider than the card (German compounds
                              routinely are) needs `break-words` or the card's
                              `overflow-hidden` cuts it mid-letter. */}
                          <span className="line-clamp-2 min-h-[2lh] break-words text-[0.82rem] font-medium text-foreground">{parsed.title}</span>
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
              <ul aria-label={imagedBundled.length > 0 ? t("presets.moreReadyMadeAria") : t("presets.readyMadeAria")}>
                {plainBundled.map((p) => {
                  const id = `bundled:${design.id}:${p.name}`;
                  return (
                    <li key={p.name}>
                      <button
                        className={itemClass(selected === id)}
                        aria-current={selected === id ? "true" : undefined}
                        onClick={() => applyBundled(p)}
                      >
                        {localizePresetName(designStrings, p.name)}
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
              {t("presets.savedByYou")}
            </h2>
            <ul aria-label={t("presets.yourSavedAria")}>
              {userPresets.map((name) => {
                const id = `user:${design.id}:${name}`;
                return (
                  <li key={name} className="flex items-center gap-[0.15rem]">
                    <button
                      className={cn(itemClass(selected === id), "min-w-0 flex-1")}
                      aria-current={selected === id ? "true" : undefined}
                      onClick={() => applyUser(name)}
                    >
                      {name}
                    </button>
                    <button
                      // pointer-coarse:min-h-11: matches ParamForm's own
                      // missing-font action links, which raise this same
                      // ~22px control to the coarse-pointer target floor
                      // without touching the fine-pointer (mouse) size.
                      className="inline-flex shrink-0 items-center rounded-(--radius-sm) border border-transparent bg-transparent px-[0.45rem] py-[0.2rem] pointer-coarse:min-h-11 text-[0.8rem] text-muted-foreground enabled:hover:bg-muted enabled:hover:text-warn"
                      onClick={() => setDeleteTarget(name)}
                      aria-label={t("presets.deleteAria", { name })}
                      title={t("presets.deleteTitle", { name })}
                    >
                      {t("presets.deleteLabel")}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {bundled.length === 0 && userPresets.length === 0 && (
          <p className="px-[0.6rem] py-2 text-[0.85rem] text-muted-foreground">
            {t("presets.empty")}
          </p>
        )}
      </div>

      {compact ? compactFooter() : standingFooter()}
    </div>
  );

  const deleteDialog = (
    <ConfirmDialog
      open={deleteTarget !== null}
      onOpenChange={(open) => !open && setDeleteTarget(null)}
      title={t("presets.deleteConfirmTitle")}
      description={t("presets.deleteConfirmBody", { name: deleteTarget ?? "" })}
      cancelLabel={t("presets.cancel")}
      confirmLabel={t("presets.deleteLabel")}
      onConfirm={() => {
        if (deleteTarget) handleDelete(deleteTarget);
        setDeleteTarget(null);
      }}
    />
  );

  const saveCollisionDialog = (
    <ConfirmDialog
      open={pendingSave !== null}
      onOpenChange={(open) => !open && setPendingSave(null)}
      title={t("presets.replaceTitle")}
      description={t("presets.replaceBody", { name: pendingSave?.name ?? "" })}
      cancelLabel={t("presets.cancel")}
      confirmLabel={t("presets.replace")}
      onConfirm={() => {
        if (pendingSave) doSave(pendingSave.name, pendingSave.values);
        setPendingSave(null);
      }}
    />
  );

  const importCollisionDialog = (
    <ConfirmDialog
      open={pendingImport !== null}
      onOpenChange={(open) => !open && setPendingImport(null)}
      title={tn("presets.importCollisionTitle", pendingImportCollisions.length)}
      description={t("presets.importCollisionBody", { names: summarizeCollisions(pendingImportCollisions) })}
      cancelLabel={t("presets.cancel")}
      confirmLabel={t("presets.replace")}
      onConfirm={() => {
        if (pendingImport) doImport(pendingImport);
        setPendingImport(null);
      }}
    />
  );

  return (
    <>
      {content}
      {deleteDialog}
      {saveCollisionDialog}
      {importCollisionDialog}
    </>
  );
}
