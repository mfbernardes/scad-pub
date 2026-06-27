// CommandBar.tsx — top bar: brand, design picker (shadcn Select), presets
// dropdown (shadcn Popover), status, action icons (theme / help / licenses),
// optional PWA install. Notices surface via the auto-opening output console,
// so the bar carries no advisory badge.
import { memo, useState } from "react";
import type { Design, Schema, RenderResult } from "../openscad/types";
import type { ParsedSet, Values } from "../lib/presets";
import { presetLabel } from "../lib/presets";
import { useAppActions } from "../lib/appActions";
import { StatusPill } from "./StatusPill";
import { IconButton } from "./IconButton";
import { PresetPicker } from "./PresetPicker";
import { DesignPicker } from "./DesignPicker";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Sun as SunIcon,
  Moon as MoonIcon,
  SunMoon as AutoThemeIcon,
  CircleHelp as HelpIcon,
  Info as InfoIcon,
  HardDriveDownload as InstallIcon,
  ChevronDown as ChevronDownIcon,
} from "lucide-react";
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
  canInstall: boolean;
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
  canInstall,
}: Props) {
  const {
    install,
    designChange,
    applyPreset,
    selectedPresetChange,
    presetsChange,
    cycleTheme,
    showHelp,
    showLicenses,
  } = useAppActions();
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

      {/* Design picker + presets, centered in the bar */}
      <div className="command-bar__center">
        <div className="command-bar__design-picker">
        <span className="command-bar__design-label">Design</span>
        <span className="command-bar__sep" aria-hidden="true">·</span>
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
            aria-label={`Presets${presetName ? ` — ${presetName}` : ""}`}
          >
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
            onApply={applyPreset}
            onSelectedChange={selectedPresetChange}
            onPresetsChange={presetsChange}
            onClose={() => setShowPresets(false)}
          />
        </PopoverContent>
      </Popover>
      </div>

      <div className="command-bar__right">
        <StatusPill rendering={rendering} ready={ready} result={result} />

        {/* Action icons */}
        <IconButton label={themeLabel} title={themeLabel} onClick={cycleTheme}>
          {themeIcon}
        </IconButton>
        <IconButton label="Help" title="Help & keyboard shortcuts" onClick={showHelp}>
          <HelpIcon size={16} />
        </IconButton>
        <IconButton label="Open-source licenses" title="Open-source licenses" onClick={showLicenses}>
          <InfoIcon size={16} />
        </IconButton>

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
      </div>
    </header>
  );
});
