// PresetSelect.tsx — just the presets dropdown (bundled + saved + a synthetic
// "(modified)" entry), factored out of PresetBar so it can also live in the
// topbar next to the design picker on small screens (where the parameter drawer
// — and thus PresetBar's copy — is hidden behind the hamburger). The user-preset
// list is owned by App so both copies stay in sync after a Save.
import { useMemo } from "react";
import type { Design } from "../openscad/types";
import { loadPreset, type ParsedSet, type Values } from "../lib/presets";

interface Props {
  design: Design;
  values: Values;
  /** Read-only presets bundled with the app for this design. */
  bundled: ParsedSet[];
  /** Names of the user's browser-local presets for this design. */
  userPresets: string[];
  onApply: (values: Values) => void;
  /** The namespaced selected-preset id ("bundled:Name" / "user:Name" / ""). */
  selected: string;
  onSelectedChange: (value: string) => void;
  /** Extra class on the wrapping <label> (e.g. to scope responsive visibility). */
  className?: string;
}

// Dropdown option values are namespaced so a bundled and a user preset can share
// a name without clashing.
const userVal = (name: string) => `user:${name}`;
const bundledVal = (name: string) => `bundled:${name}`;
// Synthetic dropdown value shown when the live parameters have drifted from the
// selected preset (a "<name> (modified)" entry); never a real preset id.
const MODIFIED_OPT = "__modified__";

export function PresetSelect({
  design,
  values,
  bundled,
  userPresets,
  onApply,
  selected,
  onSelectedChange,
  className,
}: Props) {
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

  return (
    <label className={className}>
      <span className="sr-only">Preset</span>
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
        {userPresets.length > 0 && (
          <optgroup label="Saved">
            {userPresets.map((p) => (
              <option key={p} value={userVal(p)}>
                {p}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}
