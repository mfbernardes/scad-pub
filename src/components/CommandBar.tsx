// CommandBar.tsx — top bar: brand, design picker (shadcn Select), presets
// dropdown (shadcn Popover), status + advisory badge, action icons
// (theme / help / licenses), optional PWA install.
import { memo, useState } from "react";
import type { Design, Schema, RenderResult } from "../openscad/types";
import type { ParsedSet, Values } from "../lib/presets";
import { presetLabel } from "../lib/presets";
import { StatusPill } from "./StatusPill";
import { AdvisoryBadge } from "./AdvisoryBadge";
import { IconButton } from "./IconButton";
import { PresetPicker } from "./PresetPicker";
import { DesignPicker } from "./DesignPicker";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  SunIcon,
  MoonIcon,
  AutoThemeIcon,
  HelpIcon,
  InfoIcon,
  InstallIcon,
  StarIcon,
  StarFilledIcon,
  ChevronDownIcon,
} from "./Icons";
import { assetUrl } from "../lib/assetUrl";

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
  advisoryCount: number;
  canInstall: boolean;
  onInstall: () => void;
  onDesignChange: (id: string) => void;
  onApplyPreset: (v: Values) => void;
  onSelectedPresetChange: (id: string) => void;
  onPresetsChange: () => void;
  onCycleTheme: () => void;
  onShowHelp: () => void;
  onShowLicenses: () => void;
  onShowOutput: () => void;
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
  advisoryCount,
  canInstall,
  onInstall,
  onDesignChange,
  onApplyPreset,
  onSelectedPresetChange,
  onPresetsChange,
  onCycleTheme,
  onShowHelp,
  onShowLicenses,
  onShowOutput,
}: Props) {
  const [showPresets, setShowPresets] = useState(false);
  const currentDesign = designs.find((d) => d.id === designId);

  const themeIcon = themeMode === "light" ? <SunIcon size={16} /> : themeMode === "dark" ? <MoonIcon size={16} /> : <AutoThemeIcon size={16} />;
  const themeLabel = themeMode === "light" ? "Switch to dark theme" : themeMode === "dark" ? "Switch to auto theme" : "Switch to light theme";

  const presetName = selectedPreset ? presetLabel(selectedPreset) : "";

  return (
    <header className="command-bar" role="banner">
      {/* Brand */}
      <div className="command-bar__brand">
        {schema.logo ? (
          <img className="brand-logo" src={assetUrl(schema.logo[theme])} alt={schema.title} />
        ) : (
          <span className="command-bar__title">{schema.title}</span>
        )}
      </div>

      {/* Design picker — always visible */}
      <div className="command-bar__pill command-bar__design-picker">
        <span className="command-bar__design-label">Design</span>
        <span className="command-bar__sep" aria-hidden="true">·</span>
        {designs.length > 1 ? (
          <DesignPicker designs={designs} value={designId} onChange={onDesignChange} />
        ) : (
          <span className="command-bar__design-name">{currentDesign?.label ?? designId}</span>
        )}
      </div>

      {/* Presets dropdown */}
      <Popover open={showPresets} onOpenChange={setShowPresets}>
        <PopoverTrigger asChild>
          <button
            className="command-bar__pill command-bar__presets-btn"
            aria-label={`Presets${presetName ? ` — ${presetName}` : ""}`}
          >
            {presetName ? <StarFilledIcon size={14} /> : <StarIcon size={14} />}
            <span className="command-bar__presets-label">
              Presets{presetName ? <> · <strong>{presetName}</strong></> : ""}
            </span>
            <ChevronDownIcon size={14} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="command-bar__presets-popover w-[22rem] max-w-[90vw] overflow-hidden p-0"
        >
          <PresetPicker
            design={design}
            bundled={bundled}
            userPresets={userPresets}
            selected={selectedPreset}
            values={values}
            onApply={onApplyPreset}
            onSelectedChange={onSelectedPresetChange}
            onPresetsChange={onPresetsChange}
            onClose={() => setShowPresets(false)}
          />
        </PopoverContent>
      </Popover>

      <div className="command-bar__right">
        {/* Status + advisory badge, grouped */}
        <div className="command-bar__status-group">
          <StatusPill rendering={rendering} ready={ready} result={result} />
          <AdvisoryBadge count={advisoryCount} onClick={onShowOutput} />
        </div>

        {/* Action icons */}
        <IconButton label={themeLabel} title={themeLabel} onClick={onCycleTheme}>
          {themeIcon}
        </IconButton>
        <IconButton label="Help" title="Help & keyboard shortcuts" onClick={onShowHelp}>
          <HelpIcon size={16} />
        </IconButton>
        <IconButton label="Open-source licenses" title="Open-source licenses" onClick={onShowLicenses}>
          <InfoIcon size={16} />
        </IconButton>

        {/* PWA install (when the browser offers it and the config allows it) */}
        {canInstall && schema.ui?.install !== "off" && (
          <Button
            size="sm"
            className="command-bar__install-btn rounded-full"
            onClick={onInstall}
            title="Install as app"
          >
            <InstallIcon size={14} />
            Install
          </Button>
        )}
      </div>
    </header>
  );
});
