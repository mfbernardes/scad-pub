// PresetPicker.tsx — a plain preset list (Bundled / Yours), with a
// "Save current as…" row. Used as a popover on desktop (CommandBar) and as the
// Presets tab on mobile.
import { useCallback, useRef, useState } from "react";
import type { Design } from "../openscad/types";
import type { ParsedSet, Values } from "../lib/presets";
import { deletePreset, loadPreset, savePreset } from "../lib/presets";
import { Button } from "./ui/button";
import { IconButton } from "./IconButton";
import { Input } from "./ui/input";
import { X as XIcon } from "lucide-react";

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

  const content = (
    <div className={`preset-picker${inline ? " preset-picker--inline" : ""}`}>
      <div className="preset-picker__sections" ref={sectionsRef} onKeyDown={onListKeyDown}>
        {bundled.length > 0 && (
          <section>
            <h3 className="preset-picker__section-title">Bundled</h3>
            <ul className="preset-picker__list" role="listbox" aria-label="Bundled presets">
              {bundled.map((p) => {
                const id = `bundled:${design.id}:${p.name}`;
                return (
                  <li key={p.name} role="option" aria-selected={selected === id}>
                    <button
                      className={`preset-picker__item${selected === id ? " selected" : ""}`}
                      onClick={() => applyBundled(p)}
                    >
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
            <h3 className="preset-picker__section-title">Yours</h3>
            <ul className="preset-picker__list" role="listbox" aria-label="Your saved presets">
              {userPresets.map((name) => {
                const id = `user:${design.id}:${name}`;
                return (
                  <li key={name} role="option" aria-selected={selected === id} className="preset-picker__user-item">
                    <button
                      className={`preset-picker__item${selected === id ? " selected" : ""}`}
                      onClick={() => applyUser(name)}
                    >
                      {name}
                    </button>
                    <button
                      className="preset-picker__delete"
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
          <p className="preset-picker__empty">No presets available.</p>
        )}
      </div>

      {values && (
        <div className="preset-picker__save">
          <Input
            type="text"
            className="h-8"
            placeholder="Save current as…"
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
    </div>
  );

  if (inline) return content;

  return (
    <div className="preset-picker-popover" role="dialog" aria-label={presetsLabel}>
      <div className="preset-picker-popover__header">
        <span className="preset-picker-popover__title">{presetsLabel}</span>
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
