// CommandBar.tsx — top bar: brand, design picker (shadcn Select), presets
// dropdown (shadcn Popover), status, action icons (theme / help / licenses),
// optional PWA install. Notices surface via the auto-opening output console,
// so the bar carries no notice badge.
import { memo, useState } from "react";
import type { Design, Schema, RenderResult } from "../openscad/types";
import type { ParsedSet, Values } from "../lib/presets";
import { presetLabel } from "../lib/presets";
import { useAppActions } from "../lib/appActions";
import { PresetPicker } from "./PresetPicker";
import { DesignPicker } from "./DesignPicker";
import { BarBrand } from "./BarBrand";
import { BarActions } from "./BarActions";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  HardDriveDownload as InstallIcon,
  ChevronDown as ChevronDownIcon,
} from "lucide-react";

interface Props {
  schema: Schema;
  designs: Design[];
  designId: string;
  design: Design;
  bundled: ParsedSet[];
  userPresets: string[];
  selectedPreset: string;
  values: Values;
  theme: "dark" | "light";
  themeMode: "light" | "dark" | "auto";
  rendering: boolean;
  ready: boolean;
  result: RenderResult | null;
  stalePreview: boolean;
  canInstall: boolean;
  /** Configurable label for the presets control (default "Presets"). */
  presetsLabel?: string;
}

export const CommandBar = memo(function CommandBar({
  schema,
  designs,
  designId,
  design,
  bundled,
  userPresets,
  selectedPreset,
  values,
  theme,
  themeMode,
  rendering,
  ready,
  result,
  stalePreview,
  canInstall,
  presetsLabel = "Presets",
}: Props) {
  const {
    install,
    designChange,
    applyPreset,
    selectedPresetChange,
    presetsChange,
  } = useAppActions();
  const [showPresets, setShowPresets] = useState(false);
  const currentDesign = designs.find((d) => d.id === designId);

  const presetName = selectedPreset ? presetLabel(selectedPreset) : "";

  return (
    <header className="command-bar" role="banner">
      {/* Brand */}
      <div className="command-bar__brand">
        <BarBrand schema={schema} theme={theme} titleClassName="command-bar__title" />
      </div>

      {/* Design picker + presets, centered in the bar */}
      <div className="command-bar__center">
        <div className="command-bar__design-picker">
        {designs.length > 1 ? (
          <DesignPicker designs={designs} value={designId} onChange={designChange} />
        ) : (
          <span className="command-bar__design-name">{currentDesign?.label ?? designId}</span>
        )}
      </div>

      {/* Presets dropdown */}
      <Popover open={showPresets} onOpenChange={setShowPresets}>
        <PopoverTrigger asChild>
          <button
            className="command-bar__presets-btn"
            aria-label={`${presetsLabel}${presetName ? ` — ${presetName}` : ""}`}
          >
            <span className="command-bar__presets-label">
              {presetsLabel}{presetName ? <> · <strong>{presetName}</strong></> : ""}
            </span>
            <ChevronDownIcon size={14} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[22rem] max-w-[90vw] overflow-hidden p-0"
        >
          <PresetPicker
            design={design}
            bundled={bundled}
            userPresets={userPresets}
            selected={selectedPreset}
            values={values}
            onApply={applyPreset}
            onSelectedChange={selectedPresetChange}
            onPresetsChange={presetsChange}
            onClose={() => setShowPresets(false)}
            presetsLabel={presetsLabel}
          />
        </PopoverContent>
      </Popover>
      </div>

      <div className="command-bar__right">
        <BarActions
          rendering={rendering}
          ready={ready}
          result={result}
          stalePreview={stalePreview}
          themeMode={themeMode}
          licensesLabel="Open-source licenses"
          pillClassName="py-[0.25rem] cursor-pointer hover:bg-muted"
        >
          {/* PWA install (when the browser offers it and the config allows it) */}
          {canInstall && schema.ui?.install !== "off" && (
            <Button
              size="sm"
              className="command-bar__install-btn"
              onClick={install}
              title="Install as app"
            >
              <InstallIcon size={14} />
              Install
            </Button>
          )}
        </BarActions>
      </div>
    </header>
  );
});
