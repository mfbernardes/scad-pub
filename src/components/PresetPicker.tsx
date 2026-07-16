// PresetPicker.tsx — a plain preset list (Bundled / Yours), with a
// "Save current as…" row. Used as a popover on desktop (CommandBar) and as the
// Presets tab on mobile.
import { useCallback, useEffect, useRef, useState } from "react";
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
import { t } from "../lib/i18n";
import { Button } from "./ui/button";
import { IconButton } from "./IconButton";
import { FileInput } from "./FileInput";
import { Input } from "./ui/input";
import { cn } from "../lib/utils";
import { Upload as UploadIcon, Download as DownloadIcon, X as XIcon, Plus as PlusIcon } from "lucide-react";
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

/* One "Saved by you" row. `preset-picker__item` is a JS hook too (the roving-
   focus querySelector below), not just styling. Rows read as tappable cards —
   the selected one keeps its accent fill. */
const itemClass = (isSelected: boolean) =>
  cn(
    "preset-picker__item my-1 flex w-full items-center gap-2 rounded-(--radius-sm) border bg-background/40 px-3 py-2 text-left text-[0.88rem]",
    isSelected
      ? "border-primary bg-primary font-medium text-primary-foreground"
      : "enabled:hover:border-brand"
  );

/* "Ready-made" bundled presets: a compact card grid rather than a plain list —
   these are starting points to pick from, not settings to scan line by line.
   `preset-picker__item` stays the shared hook (roving-focus + smoke/vis) so
   the two lists behave identically for keyboard/AT users; only the layout
   (grid vs. stacked rows) and typography (a prominent label, no secondary
   text) differ. No thumbnails — a per-preset render isn't available — so the
   name alone has to carry the card, hence the larger/bolder label. */
const bundledItemClass = (isSelected: boolean) =>
  cn(
    "preset-picker__item flex min-h-[3rem] w-full flex-col items-start justify-center gap-0.5 rounded-(--radius-sm) border bg-background/40 px-3 py-2 text-left",
    isSelected
      ? "border-primary bg-primary text-primary-foreground"
      : "enabled:hover:border-brand"
  );

// Shared look for the "Ready-made" / "Saved by you" section headers.
const sectionHeadingClass =
  "font-display mt-2 mb-[0.2rem] px-[0.4rem] text-[0.72rem] font-semibold uppercase tracking-[0.04em] text-muted-foreground";

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
  onClose?: () => void;
  /** Popover title/aria-label (default "Presets"). */
  presetsLabel?: string;
  /**
   * Whether to show the parameterSets Import/Export row — power-user tools
   * for round-tripping presets with the desktop OpenSCAD Customizer. Default
   * true. The essentials settings view hides this row (Save + the saved-
   * presets list stay either way): a beginner picking a ready-made preset or
   * saving their own doesn't need a JSON file interchange affordance.
   */
  showPowerTools?: boolean;
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
  onClose,
  presetsLabel = "Presets",
  showPowerTools = true,
}: Props) {
  const [saveName, setSaveName] = useState("");
  // Whether the "Save as preset…" input row is revealed. Demoted from an
  // always-visible row (PR19 item 2): a beginner scanning the Ready-made
  // cards above shouldn't have to skip past a naming field they're not using
  // yet — it only appears once they've asked to save something. Starts
  // collapsed every time this component mounts (a fresh design/tab visit),
  // which is also what lets the tab-switch itself act as an implicit cancel.
  const [saveOpen, setSaveOpen] = useState(false);
  const saveInputRef = useRef<HTMLInputElement>(null);
  // The saved preset pending a delete confirmation (its name), or null when no
  // confirmation dialog is open. Deleting a saved preset is un-undoable, so it
  // gets the same AlertDialog guard as ResetButton's "reset to defaults".
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const sectionsRef = useRef<HTMLDivElement>(null);

  // Focus the input the moment it's revealed, so the "Save as preset…" click
  // flows straight into typing a name with no extra tap.
  useEffect(() => {
    if (saveOpen) saveInputRef.current?.focus();
  }, [saveOpen]);

  // Collapses the reveal back to the trigger button and drops any in-progress
  // name — used by both Escape and a blur while the field is still empty (an
  // accidental reveal with nothing typed shouldn't linger as an open row).
  const closeSave = useCallback(() => {
    setSaveOpen(false);
    setSaveName("");
  }, []);

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
    // Collapse back to the trigger button — the new preset now shows in the
    // "Saved by you" list above, so the naming field has done its job.
    closeSave();
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
        t("presets.importError", {
          name: file.name,
          message: err instanceof Error ? err.message : t("presets.importErrorNotValid"),
        })
      );
      return;
    }
    if (parsed.length === 0) {
      toast.error(t("presets.importErrorEmpty", { name: file.name }));
      return;
    }
    for (const set of parsed) savePreset(design.id, set.name, set.values);
    onPresetsChange();
  };

  const content = (
    <div className={cn("preset-picker flex flex-col", inline && "min-h-0 flex-1")}>
      {/* Inline (mobile sheet): fill the tab height so the list grows and the
          "Save current as…" row pins to the bottom. */}
      <div
        className={cn("overflow-y-auto px-1 pt-1 pb-2", inline ? "flex-1" : "max-h-72")}
        ref={sectionsRef}
        onKeyDown={onListKeyDown}
      >
        {bundled.length > 0 && (
          <section>
            <h3 className={sectionHeadingClass}>
              {t("presets.readyMade")}
            </h3>
            <ul className="grid grid-cols-2 gap-2" aria-label={t("presets.readyMadeAria")}>
              {bundled.map((p) => {
                const id = `bundled:${design.id}:${p.name}`;
                return (
                  <li key={p.name}>
                    <button
                      className={bundledItemClass(selected === id)}
                      aria-pressed={selected === id}
                      onClick={() => applyBundled(p)}
                    >
                      <span className="line-clamp-2 text-[0.88rem] leading-[1.25] font-semibold break-words">
                        {p.name}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {userPresets.length > 0 && (
          <section>
            <h3 className={sectionHeadingClass}>
              {t("presets.savedByYou")}
            </h3>
            <ul aria-label={t("presets.savedByYouAria")}>
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
                      aria-label={t("presets.deleteAria", { name })}
                      title={t("presets.deleteTitle", { name })}
                    >
                      {t("presets.delete")}
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

      {values && (
        saveOpen ? (
          <div className="preset-picker__save-row flex shrink-0 items-center gap-[0.4rem] border-t px-[0.6rem] py-2">
            <Input
              ref={saveInputRef}
              type="text"
              name="preset-name"
              autoComplete="off"
              className="h-8 flex-1"
              placeholder={t("presets.savePlaceholder")}
              value={saveName}
              aria-label={t("presets.saveAria")}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                // Collapse the reveal instead of letting Escape bubble up to
                // a surrounding dialog/popover — this row is the thing being
                // dismissed, not whatever hosts it.
                if (e.key === "Escape") {
                  e.stopPropagation();
                  closeSave();
                }
              }}
              onBlur={() => {
                if (!saveName.trim()) closeSave();
              }}
            />
            <Button size="sm" onClick={handleSave} disabled={!saveName.trim()}>
              {t("presets.save")}
            </Button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center border-t px-[0.6rem] py-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="preset-picker__save-trigger w-full"
              onClick={() => setSaveOpen(true)}
              title={t("presets.saveAsNewTitle")}
            >
              <PlusIcon size={14} /> {t("presets.saveAsNew")}
            </Button>
          </div>
        )
      )}

      {/* Import / export saved presets as an OpenSCAD parameterSets file — the
          same format the desktop Customizer reads and writes, so presets carry
          between the two. Power-user tools: hidden in the essentials settings
          view (showPowerTools=false) — Save and the saved list above stay. */}
      {showPowerTools && (
        <div className="flex shrink-0 items-center gap-[0.4rem] border-t px-[0.6rem] py-[0.4rem]">
          <FileInput accept=".json,application/json" onFile={handleImport}>
            {(open) => (
              <Button
                variant="ghost"
                size="sm"
                onClick={open}
                title={t("presets.importTitle")}
              >
                <UploadIcon size={14} /> {t("presets.import")}
              </Button>
            )}
          </FileInput>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={handleExport}
            disabled={userPresets.length === 0}
            title={
              userPresets.length
                ? t("presets.exportTitleReady")
                : t("presets.exportTitleEmpty")
            }
          >
            <DownloadIcon size={14} /> {t("presets.export")}
          </Button>
        </div>
      )}
    </div>
  );

  const deleteDialog = (
    <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("presets.deleteConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("presets.deleteConfirmDescription", { name: deleteTarget ?? "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("dialog.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (deleteTarget) handleDelete(deleteTarget);
              setDeleteTarget(null);
            }}
          >
            {t("presets.delete")}
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
          <IconButton label={t("presets.closeAria")} onClick={onClose}>
            <XIcon size={16} />
          </IconButton>
        )}
      </div>
      {content}
      {deleteDialog}
    </div>
  );
}
