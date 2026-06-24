// PresetBar.tsx — presets dropdown combining read-only bundled presets (shipped
// with the app, per design) and the user's own browser-local presets, plus
// desktop-compatible parameterSets import/export and in-browser upload of an
// external font. All copy here is config-driven (see `fontPrompt`), so the bar
// is project-agnostic. All user storage is client-side.
import { useEffect, useState } from "react";
import type { Design, Schema } from "../openscad/types";
import {
  deletePreset,
  listPresets,
  loadPreset,
  parseParameterSetsFile,
  savePreset,
  toParameterSetsFile,
  type ParsedSet,
  type Values,
} from "../lib/presets";

import { downloadBlob } from "../lib/download";
import { FileInput } from "./FileInput";
import { SaveIcon, TrashIcon, DownloadIcon, UploadIcon } from "./Icons";

interface Props {
  design: Design;
  values: Values;
  /** Read-only presets bundled with the app for this design. */
  bundled: ParsedSet[];
  onApply: (values: Values) => void;
  onAddFont: (name: string, bytes: Uint8Array) => void;
  /** The configured external-font prompt, or null. When set, the bar shows a
   *  font-import button + download link (all copy from the config). */
  fontPrompt: Schema["fontPrompt"];
  loadedFonts: string[];
  /** The namespaced selected-preset id, owned by the app so it can be shared in
   *  the URL ("bundled:Name" / "user:Name" / ""). */
  selected: string;
  onSelectedChange: (value: string) => void;
}

// Dropdown option values are namespaced so a bundled and a user preset can share
// a name without clashing.
const userVal = (name: string) => `user:${name}`;
const bundledVal = (name: string) => `bundled:${name}`;

export function PresetBar({
  design,
  values,
  bundled,
  onApply,
  onAddFont,
  fontPrompt,
  loadedFonts,
  selected,
  onSelectedChange,
}: Props) {
  const [presets, setPresets] = useState<string[]>(() => listPresets(design.id));

  const refresh = () => setPresets(listPresets(design.id));

  // Refresh the user-preset list when the design changes (the app clears the
  // selection, since it owns it for the URL).
  useEffect(() => {
    setPresets(listPresets(design.id));
  }, [design.id]);

  const isUser = selected.startsWith("user:");
  const selectedName = selected.replace(/^(user|bundled):/, "");

  const onSave = () => {
    const name = prompt("Save preset as:", (isUser && selectedName) || "My preset");
    if (!name) return;
    savePreset(design.id, name, values);
    refresh();
    onSelectedChange(userVal(name));
  };

  const onLoad = (value: string) => {
    onSelectedChange(value);
    if (value.startsWith("bundled:")) {
      const set = bundled.find((s) => s.name === value.slice("bundled:".length));
      if (set) onApply(set.values);
    } else if (value.startsWith("user:")) {
      const v = loadPreset(design.id, value.slice("user:".length));
      if (v) onApply(v);
    }
  };

  const onDelete = () => {
    // Only the user's own presets can be deleted; bundled ones are read-only.
    if (isUser && confirm(`Delete preset "${selectedName}"?`)) {
      deletePreset(design.id, selectedName);
      onSelectedChange("");
      refresh();
    }
  };

  const onExport = () => {
    const setName = selectedName || "Web preset";
    const file = toParameterSetsFile(design, setName, values);
    const blob = new Blob([JSON.stringify(file, null, 2)], {
      type: "application/json",
    });
    downloadBlob(blob, `${design.id}.json`);
  };

  const onImportFile = async (file: File) => {
    try {
      const sets = parseParameterSetsFile(design, await file.text());
      if (sets.length === 0) throw new Error("No parameter sets in file.");
      // Apply the first set; if several, let the user pick.
      let chosen = sets[0];
      if (sets.length > 1) {
        const name = prompt(
          `Which set? (${sets.map((s) => s.name).join(", ")})`,
          sets[0].name
        );
        chosen = sets.find((s) => s.name === name) ?? sets[0];
      }
      onApply(chosen.values);
    } catch (e) {
      alert(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onFontFile = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    onAddFont(file.name, bytes);
  };

  return (
    <div className="preset-bar">
      <div className="row">
        <select
          aria-label="Preset"
          value={selected}
          onChange={(e) => onLoad(e.target.value)}
        >
          <option value="">— presets —</option>
          {bundled.length > 0 && (
            <optgroup label="Bundled">
              {bundled.map((s) => (
                <option key={s.name} value={bundledVal(s.name)}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          )}
          {presets.length > 0 && (
            <optgroup label="Saved">
              {presets.map((p) => (
                <option key={p} value={userVal(p)}>
                  {p}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
      <div className="grp-label">This preset</div>
      <div className="row btn-row">
        <button
          type="button"
          className="btn-labeled"
          title="Save the current parameters as a browser preset"
          onClick={onSave}
        >
          <SaveIcon size={16} /> Save
        </button>
        <button
          type="button"
          className="btn-labeled"
          title="Delete the selected preset (bundled presets can't be deleted)"
          onClick={onDelete}
          disabled={!isUser}
        >
          <TrashIcon size={16} /> Delete
        </button>
      </div>
      <div className="grp-label">Parameter file</div>
      <div className="row btn-row">
        <FileInput accept=".json,application/json" onFile={onImportFile}>
          {(open) => (
            <button
              type="button"
              className="btn-labeled"
              title="Import a parameter file (an OpenSCAD parameterSets JSON)"
              onClick={open}
            >
              <UploadIcon size={16} /> Import…
            </button>
          )}
        </FileInput>
        <button
          type="button"
          className="btn-labeled"
          title="Export a parameter file (OpenSCAD parameterSets JSON — opens in the desktop Customizer)"
          onClick={onExport}
        >
          <DownloadIcon size={16} /> Export
        </button>
      </div>
      {fontPrompt && (
        <>
          <div className="grp-label">{fontPrompt.heading ?? "Font"}</div>
          <div className="row btn-row">
            <FileInput accept=".ttf,.otf,font/ttf" onFile={onFontFile}>
              {(open) => (
                <button
                  type="button"
                  className="btn-labeled"
                  title={`Add ${fontPrompt.label ?? "the font"} (TTF/OTF) for the designs that need it`}
                  onClick={open}
                >
                  <UploadIcon size={16} /> Import font…
                </button>
              )}
            </FileInput>
            <a
              className="font-link"
              href={fontPrompt.url}
              target="_blank"
              rel="noopener noreferrer"
              title={fontPrompt.note ?? `Download ${fontPrompt.label ?? "the font"}, then add it with “Import font…”.`}
            >
              {fontPrompt.linkText ?? `Get ${fontPrompt.label ?? "the font"}`} ↗
            </a>
            {loadedFonts.length > 0 && (
              <span className="hint">added: {loadedFonts.join(", ")}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
