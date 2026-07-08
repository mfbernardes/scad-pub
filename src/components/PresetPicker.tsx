// PresetPicker.tsx — a plain preset list (Bundled / Yours), with a
// "Save current as…" row. Used as a popover on desktop (CommandBar) and as the
// Presets tab on mobile.
import { useCallback, useRef, useState } from "react";
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
import { Button } from "./ui/button";
import { IconButton } from "./IconButton";
import { FileInput } from "./FileInput";
import { Input } from "./ui/input";
import { cn } from "../lib/utils";
import { Upload as UploadIcon, Download as DownloadIcon, X as XIcon } from "lucide-react";

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
}: Props) {
  const [saveName, setSaveName] = useState("");
  const sectionsRef = useRef<HTMLDivElement>(null);

  // Roving arrow-key navigation across every preset row (the lists are
  // role="listbox"/option but the rows are buttons, so keyboard users get
  // Up/Down/Home/End movement here).
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
    try {
      const parsed = parseParameterSetsFile(design, await file.text());
      for (const set of parsed) savePreset(design.id, set.name, set.values);
      onPresetsChange();
    } catch {
      /* not a valid parameterSets file — ignore rather than crash the panel */
    }
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
              Ready-made
            </h3>
            <ul role="listbox" aria-label="Ready-made presets">
              {bundled.map((p) => {
                const id = `bundled:${design.id}:${p.name}`;
                return (
                  <li key={p.name} role="option" aria-selected={selected === id}>
                    <button className={itemClass(selected === id)} onClick={() => applyBundled(p)}>
                      {p.name}
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
              Saved by you
            </h3>
            <ul role="listbox" aria-label="Your saved presets">
              {userPresets.map((name) => {
                const id = `user:${design.id}:${name}`;
                return (
                  <li
                    key={name}
                    role="option"
                    aria-selected={selected === id}
                    className="flex items-center gap-[0.15rem]"
                  >
                    <button
                      className={cn(itemClass(selected === id), "min-w-0 flex-1")}
                      onClick={() => applyUser(name)}
                    >
                      {name}
                    </button>
                    <button
                      className="shrink-0 rounded-(--radius-sm) border border-transparent bg-transparent px-[0.45rem] py-[0.2rem] text-[0.8rem] text-muted-foreground enabled:hover:bg-muted enabled:hover:text-warn"
                      onClick={() => handleDelete(name)}
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

      {values && (
        <div className="flex shrink-0 items-center gap-[0.4rem] border-t px-[0.6rem] py-2">
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
      )}

      {/* Import / export saved presets as an OpenSCAD parameterSets file — the
          same format the desktop Customizer reads and writes, so presets carry
          between the two. */}
      <div className="flex shrink-0 items-center gap-[0.4rem] border-t px-[0.6rem] py-[0.4rem]">
        <FileInput accept=".json,application/json" onFile={handleImport}>
          {(open) => (
            <Button
              variant="ghost"
              size="sm"
              onClick={open}
              title="Import presets from an OpenSCAD parameterSets file"
            >
              <UploadIcon size={14} /> Import…
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
              ? "Export your saved presets as an OpenSCAD parameterSets file"
              : "Save a preset first"
          }
        >
          <DownloadIcon size={14} /> Export
        </Button>
      </div>
    </div>
  );

  if (inline) return content;

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
    </div>
  );
}
