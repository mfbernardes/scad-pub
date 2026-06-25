// PresetBar.tsx — presets dropdown combining read-only bundled presets (shipped
// with the app, per design) and the user's own browser-local presets, plus
// desktop-compatible parameterSets import/export and a generic "Import file"
// button for external files (fonts, SVGs, …). All copy here is config-driven
// (see `fileImport`), so the bar is project-agnostic. All user storage is client-side.
import { useEffect, useState } from "react";
import type { Design, FileImport } from "../openscad/types";
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
  onAddFile: (name: string, bytes: Uint8Array) => void;
  /** Remove every imported file (and drop the render cache). */
  onClearFiles: () => void;
  /** Generic file-import config, or null to hide the "Import file" button. */
  fileImport: FileImport | null;
  /** Filenames of every user-supplied file currently loaded. */
  loadedFiles: string[];
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
  onAddFile,
  onClearFiles,
  fileImport,
  loadedFiles,
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

  const onUploadFile = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    onAddFile(file.name, bytes);
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
      {fileImport && (
        <>
          <div className="grp-label">Files</div>
          <div className="row btn-row">
            <FileInput accept={fileImport.accept} onFile={onUploadFile}>
              {(open) => (
                <button
                  type="button"
                  className="btn-labeled"
                  title={
                    fileImport.note ??
                    "Import a file your design references (a font, an SVG, a data file…)"
                  }
                  onClick={open}
                >
                  <UploadIcon size={16} /> {fileImport.label ?? "Import file"}…
                </button>
              )}
            </FileInput>
            <button
              type="button"
              className="btn-labeled"
              title="Remove all imported files and clear the render cache"
              onClick={onClearFiles}
              disabled={loadedFiles.length === 0}
            >
              <TrashIcon size={16} /> Clear
            </button>
          </div>
          {loadedFiles.length > 0 && (
            <div className="row">
              <span className="hint">added: {loadedFiles.join(", ")}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
