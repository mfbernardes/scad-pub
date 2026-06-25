// PresetBar.tsx — presets dropdown combining read-only bundled presets (shipped
// with the app, per design) and the user's own browser-local presets, plus
// Save and desktop-compatible parameterSets Export. (Generic file import lives
// in FileBar, at the bottom of the panel.) All user storage is client-side.
// The dropdown itself is PresetSelect, shared with the topbar copy on small
// screens; the user-preset list is owned by App so both copies stay in sync.
import type { Design } from "../openscad/types";
import {
  savePreset,
  toParameterSetsFile,
  type ParsedSet,
  type Values,
} from "../lib/presets";

import { downloadBlob } from "../lib/download";
import { SaveIcon, DownloadIcon } from "./Icons";
import { PresetSelect } from "./PresetSelect";

// Dropdown option values are namespaced so a bundled and a user preset can share
// a name without clashing.
const userVal = (name: string) => `user:${name}`;

interface Props {
  design: Design;
  values: Values;
  /** Read-only presets bundled with the app for this design. */
  bundled: ParsedSet[];
  /** Names of the user's browser-local presets, owned by App. */
  userPresets: string[];
  onApply: (values: Values) => void;
  /** The namespaced selected-preset id, owned by the app so it can be shared in
   *  the URL ("bundled:Name" / "user:Name" / ""). */
  selected: string;
  onSelectedChange: (value: string) => void;
  /** Re-read the saved-preset list from storage (after a Save). */
  onPresetsChange: () => void;
}

export function PresetBar({
  design,
  values,
  bundled,
  userPresets,
  onApply,
  selected,
  onSelectedChange,
  onPresetsChange,
}: Props) {
  const isUser = selected.startsWith("user:");
  const selectedName = selected.replace(/^(user|bundled):/, "");

  const onSave = () => {
    const name = prompt("Save preset as:", (isUser && selectedName) || "My preset");
    if (!name) return;
    savePreset(design.id, name, values);
    onPresetsChange();
    onSelectedChange(userVal(name));
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
        <PresetSelect
          design={design}
          values={values}
          bundled={bundled}
          userPresets={userPresets}
          onApply={onApply}
          selected={selected}
          onSelectedChange={onSelectedChange}
        />
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
