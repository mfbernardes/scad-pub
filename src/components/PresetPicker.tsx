// PresetPicker.tsx — searchable preset picker with sections (Recent / Bundled / Yours).
// Used as a popover on desktop (CommandBar + panel) and as the Presets tab on mobile.
import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import type { Design } from "../openscad/types";
import type { ParsedSet, Values } from "../lib/presets";
import { deletePreset, loadPreset, savePreset } from "../lib/presets";
import { ns } from "../lib/appId";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { SaveIcon, SearchIcon, StarIcon, StarFilledIcon, XIcon } from "./Icons";

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
}

type RecentEntry = { id: string; name: string; kind: "bundled" | "user" };

const RECENTS_CAP = 4;

function loadRecents(designId: string): RecentEntry[] {
  try {
    const raw = localStorage.getItem(ns(`recents:${designId}`));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.slice(0, RECENTS_CAP) : [];
  } catch {
    return [];
  }
}

function pushRecent(designId: string, entry: RecentEntry) {
  try {
    const next = [entry, ...loadRecents(designId).filter((r) => r.id !== entry.id)].slice(0, RECENTS_CAP);
    localStorage.setItem(ns(`recents:${designId}`), JSON.stringify(next));
  } catch {
    /* storage unavailable — recents are best-effort */
  }
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
}: Props) {
  const [query, setQuery] = useState("");
  const [saveName, setSaveName] = useState("");
  const [recents, setRecents] = useState<RecentEntry[]>(() => loadRecents(design.id));
  const searchRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    if (!inline) searchRef.current?.focus();
  }, [inline]);

  // Reload recents when switching designs.
  useEffect(() => setRecents(loadRecents(design.id)), [design.id]);

  const q = query.toLowerCase();
  const filteredBundled = useMemo(
    () => bundled.filter((p) => p.name.toLowerCase().includes(q)),
    [bundled, q]
  );
  const filteredUser = useMemo(
    () => userPresets.filter((n) => n.toLowerCase().includes(q)),
    [userPresets, q]
  );

  // Recents that still exist, filtered by the query.
  const validRecents = useMemo(
    () =>
      recents.filter((r) =>
        r.name.toLowerCase().includes(q) &&
        (r.kind === "bundled"
          ? bundled.some((b) => b.name === r.name)
          : userPresets.includes(r.name))
      ),
    [recents, q, bundled, userPresets]
  );

  const total = bundled.length + userPresets.length;

  const remember = useCallback(
    (entry: RecentEntry) => {
      pushRecent(design.id, entry);
      setRecents(loadRecents(design.id));
    },
    [design.id]
  );

  const applyBundled = (p: ParsedSet) => {
    const id = `bundled:${design.id}:${p.name}`;
    onApply(p.values);
    onSelectedChange(id);
    remember({ id, name: p.name, kind: "bundled" });
    onClose?.();
  };

  const applyUser = (name: string) => {
    const values = loadPreset(design.id, name);
    if (!values) return;
    const id = `user:${design.id}:${name}`;
    onApply(values);
    onSelectedChange(id);
    remember({ id, name, kind: "user" });
    onClose?.();
  };

  const applyRecent = (r: RecentEntry) => {
    if (r.kind === "bundled") {
      const p = bundled.find((b) => b.name === r.name);
      if (p) applyBundled(p);
    } else {
      applyUser(r.name);
    }
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
    <div className="preset-picker">
      <div className="preset-picker__search">
        <SearchIcon size={14} />
        <input
          ref={searchRef}
          type="text"
          placeholder={total > 0 ? `Search ${total} preset${total !== 1 ? "s" : ""}…` : "Search presets…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search presets"
        />
        {query && (
          <button className="icon-btn" onClick={() => setQuery("")} aria-label="Clear search">
            <XIcon size={14} />
          </button>
        )}
      </div>

      <div className="preset-picker__sections" ref={sectionsRef} onKeyDown={onListKeyDown}>
        {validRecents.length > 0 && (
          <section>
            <h3 className="preset-picker__section-title">Recent</h3>
            <ul className="preset-picker__list" role="listbox" aria-label="Recently used presets">
              {validRecents.map((r) => (
                <li key={r.id} role="option" aria-selected={selected === r.id}>
                  <button
                    className={`preset-picker__item preset-picker__item--recent${selected === r.id ? " selected" : ""}`}
                    onClick={() => applyRecent(r)}
                  >
                    <span className="preset-picker__star" aria-hidden="true">
                      {selected === r.id ? <StarFilledIcon size={14} /> : <StarIcon size={14} />}
                    </span>
                    {r.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {filteredBundled.length > 0 && (
          <section>
            <h3 className="preset-picker__section-title">Bundled ({filteredBundled.length})</h3>
            <ul className="preset-picker__list" role="listbox" aria-label="Bundled presets">
              {filteredBundled.map((p) => {
                const id = `bundled:${design.id}:${p.name}`;
                return (
                  <li key={p.name} role="option" aria-selected={selected === id}>
                    <button
                      className={`preset-picker__item${selected === id ? " selected" : ""}`}
                      onClick={() => applyBundled(p)}
                    >
                      <span className="preset-picker__dot preset-picker__dot--bundled" aria-hidden="true" />
                      {p.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {filteredUser.length > 0 && (
          <section>
            <h3 className="preset-picker__section-title">Yours ({filteredUser.length})</h3>
            <ul className="preset-picker__list" role="listbox" aria-label="Your saved presets">
              {filteredUser.map((name) => {
                const id = `user:${design.id}:${name}`;
                return (
                  <li key={name} role="option" aria-selected={selected === id} className="preset-picker__user-item">
                    <button
                      className={`preset-picker__item${selected === id ? " selected" : ""}`}
                      onClick={() => applyUser(name)}
                    >
                      <span className="preset-picker__dot preset-picker__dot--user" aria-hidden="true" />
                      {name}
                    </button>
                    <button
                      className="icon-btn preset-picker__delete"
                      onClick={() => handleDelete(name)}
                      aria-label={`Delete preset "${name}"`}
                      title={`Delete "${name}"`}
                    >
                      <XIcon size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {filteredBundled.length === 0 && filteredUser.length === 0 && validRecents.length === 0 && (
          <p className="preset-picker__empty">
            {query ? "No presets match your search." : "No presets available."}
          </p>
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
            <SaveIcon size={14} /> Save
          </Button>
        </div>
      )}
    </div>
  );

  if (inline) return content;

  return (
    <div className="preset-picker-popover" role="dialog" aria-label="Presets">
      <div className="preset-picker-popover__header">
        <span className="preset-picker-popover__title">Presets</span>
        {onClose && (
          <button className="icon-btn" onClick={onClose} aria-label="Close presets">
            <XIcon size={16} />
          </button>
        )}
      </div>
      {content}
    </div>
  );
}
