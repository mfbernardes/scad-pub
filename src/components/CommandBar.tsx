// CommandBar.tsx — top bar: brand, design picker (shadcn Select), presets
// dropdown (shadcn Popover), status, action icons (theme / help / licenses).
// Notices surface via the auto-opening output console, so the bar carries no
// notice badge; PWA install is demoted to the Help modal + a post-export hint.
import { memo, useState } from "react";
import type { Design, Schema, RenderResult } from "../openscad/types";
import type { ParsedSet, Values } from "../lib/presets";
import { presetLabel } from "../lib/presets";
import { useAppActions } from "../lib/appActions";
import { PresetPicker } from "./PresetPicker";
import { DesignPicker } from "./DesignPicker";
import { BarBrand } from "./BarBrand";
import { BarActions } from "./BarActions";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ChevronDown as ChevronDownIcon } from "lucide-react";

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
  presetsLabel = "Presets",
}: Props) {
  const {
    designChange,
    applyPreset,
    selectedPresetChange,
    presetsChange,
  } = useAppActions();
  const [showPresets, setShowPresets] = useState(false);
  const currentDesign = designs.find((d) => d.id === designId);

  const presetName = selectedPreset ? presetLabel(selectedPreset) : "";

  return (
    <header
      className="command-bar z-10 grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b bg-background pt-[calc(0.5rem+env(safe-area-inset-top,0px))] pb-2 pl-[calc(1rem+env(safe-area-inset-left,0px))] pr-[calc(1rem+env(safe-area-inset-right,0px))]"
      role="banner"
    >
      {/* Brand */}
      <div className="inline-flex items-center gap-[0.45rem] justify-self-start p-[0.2rem]">
        <BarBrand schema={schema} theme={theme} titleClassName="text-[0.95rem] font-bold" />
      </div>

      {/* Design picker + presets, centered in the bar */}
      <div className="inline-flex items-center gap-2 justify-self-center">
        <div className="command-bar__design-picker inline-flex items-center gap-[0.4rem] whitespace-nowrap">
        {designs.length > 1 ? (
          <DesignPicker designs={designs} value={designId} onChange={designChange} />
        ) : (
          <span className="text-[0.88rem] font-semibold text-foreground">
            {currentDesign?.label ?? designId}
          </span>
        )}
      </div>

      {/* Presets dropdown trigger (the popover surface itself is a Radix portal
          styled by the shadcn PopoverContent defaults). */}
      <Popover open={showPresets} onOpenChange={setShowPresets}>
        <PopoverTrigger asChild>
          <button
            className="command-bar__presets-btn inline-flex cursor-pointer items-center gap-[0.4rem] whitespace-nowrap rounded-(--radius-sm) border border-transparent bg-transparent px-[0.45rem] py-[0.3rem] text-foreground [font:inherit] enabled:hover:bg-muted"
            aria-label={`${presetsLabel}${presetName ? ` — ${presetName}` : ""}`}
          >
            <span className="text-[0.85rem] text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground">
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

      <div className="command-bar__right flex items-center gap-[0.4rem] justify-self-end">
        <BarActions
          rendering={rendering}
          ready={ready}
          result={result}
          stalePreview={stalePreview}
          themeMode={themeMode}
          licensesLabel="Open-source licenses"
          pillClassName="py-[0.25rem] cursor-pointer hover:bg-muted"
        />
      </div>
    </header>
  );
});
