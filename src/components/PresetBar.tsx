// PresetBar.tsx — presets dropdown combining read-only bundled presets (shipped
// with the app, per design) and the user's own browser-local presets, plus
// Save and desktop-compatible parameterSets Export. (Generic file import lives
// in FileBar, at the bottom of the panel.) All user storage is client-side.
import { useEffect, useMemo, useState } from "react";
import type { Design } from "../openscad/types";
import {
  listPresets,
  loadPreset,
  savePreset,
  toParameterSetsFile,
  type ParsedSet,
  type Values,
} from "../lib/presets";

import { downloadBlob } from "../lib/download";
import { SaveIcon, DownloadIcon } from "./Icons";

interface Props {
  design: Design;
  values: Values;
  /** Read-only presets bundled with the app for this design. */
  bundled: ParsedSet[];
  onApply: (values: Values) => void;
  /** The namespaced selected-preset id, owned by the app so it can be shared in
   *  the URL ("bundled:Name" / "user:Name" / ""). */
  selected: string;
  onSelectedChange: (value: string) => void;
}

// Dropdown option values are namespaced so a bundled and a user preset can share
// a name without clashing.
const userVal = (name: string) => `user:${name}`;
const bundledVal = (name: string) => `bundled:${name}`;
// Synthetic dropdown value shown when the live parameters have drifted from the
// selected preset (a "<name> (modified)" entry); never a real preset id.
const MODIFIED_OPT = "__modified__";

export function PresetBar({
  design,
  values,
  bundled,
  onApply,
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

  // Values of the currently selected preset (bundled or saved), if any.
  const selectedPresetValues = useMemo<Values | undefined>(() => {
    if (selected.startsWith("bundled:"))
      return bundled.find((s) => s.name === selectedName)?.values;
    if (selected.startsWith("user:")) return loadPreset(design.id, selectedName) ?? undefined;
    return undefined;
  }, [selected, selectedName, bundled, design.id]);

  // True when a preset is selected but the live parameters no longer match it —
  // each param's effective value (override or default) is compared, so an
  // omitted-but-default param doesn't count as a change. Drives the
  // "(modified)" dropdown entry.
  const modified =
    !!selectedPresetValues &&
    design.params.some(
      (p) => (values[p.name] ?? p.default) !== (selectedPresetValues[p.name] ?? p.default)
    );

  const onSave = () => {
    const name = prompt("Save preset as:", (isUser && selectedName) || "My preset");
    if (!name) return;
    savePreset(design.id, name, values);
    refresh();
    onSelectedChange(userVal(name));
  };

  const onLoad = (value: string) => {
    if (value === MODIFIED_OPT) return; // the synthetic current-state entry
    onSelectedChange(value);
    if (value.startsWith("bundled:")) {
      const set = bundled.find((s) => s.name === value.slice("bundled:".length));
      if (set) onApply(set.values);
    } else if (value.startsWith("user:")) {
      const v = loadPreset(design.id, value.slice("user:".length));
      if (v) onApply(v);
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

  return (
    <div className="preset-bar">
      <div className="row">
        <select
          aria-label="Preset"
          value={modified ? MODIFIED_OPT : selected}
          onChange={(e) => onLoad(e.target.value)}
        >
          <option value="">— presets —</option>
          {modified && (
            // Current state: a modified copy of the selected preset. Re-selecting
            // the preset below re-applies it (reverting the changes).
            <option value={MODIFIED_OPT}>{selectedName} (modified)</option>
          )}
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
          title="Export a parameter file (OpenSCAD parameterSets JSON — opens in the desktop Customizer)"
          onClick={onExport}
        >
          <DownloadIcon size={16} /> Export
        </button>
      </div>
    </div>
  );
}
