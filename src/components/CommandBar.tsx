// CommandBar.tsx — top bar: brand, design picker (shadcn Select), status +
// action icons (theme / help / licenses). Presets are a tab in the parameter
// panel (mirroring the mobile sheet), not a top-bar popover; notices surface
// via the auto-opening output console; PWA install is demoted to the Help
// modal — so the bar stays lean.
import { memo } from "react";
import type { Design, Schema, RenderResult } from "../openscad/types";
import { useAppActions } from "../lib/appActions";
import { DesignPicker } from "./DesignPicker";
import { BarBrand } from "./BarBrand";
import { BarActions } from "./BarActions";
import { OutputToggle } from "./OutputToggle";
import { ICON_BUTTON_CLASS } from "./IconButton";
import { cn } from "../lib/utils";

interface Props {
  schema: Schema;
  designs: Design[];
  designId: string;
  theme: "dark" | "light";
  themeMode: "light" | "dark" | "auto";
  rendering: boolean;
  ready: boolean;
  result: RenderResult | null;
  stalePreview: boolean;
  outputOpen: boolean;
  noticeCount: number;
  onToggleOutput: () => void;
}

export const CommandBar = memo(function CommandBar({
  schema,
  designs,
  designId,
  theme,
  themeMode,
  rendering,
  ready,
  result,
  stalePreview,
  outputOpen,
  noticeCount,
  onToggleOutput,
}: Props) {
  const { designChange } = useAppActions();
  const currentDesign = designs.find((d) => d.id === designId);

  return (
    <header
      className="command-bar z-10 grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b bg-background pt-[calc(0.5rem+env(safe-area-inset-top,0px))] pb-2 pl-[calc(1rem+env(safe-area-inset-left,0px))] pr-[calc(1rem+env(safe-area-inset-right,0px))]"
      role="banner"
    >
      {/* Brand */}
      <div className="inline-flex items-center gap-[0.45rem] justify-self-start p-[0.2rem]">
        <BarBrand schema={schema} theme={theme} titleClassName="text-[0.95rem] font-bold" />
      </div>

      {/* Design picker, centered in the bar */}
      <div className="command-bar__design-picker inline-flex items-center gap-[0.4rem] justify-self-center whitespace-nowrap">
        {designs.length > 1 ? (
          <DesignPicker designs={designs} value={designId} onChange={designChange} />
        ) : (
          <span className="text-[0.88rem] font-semibold text-foreground">
            {currentDesign?.label ?? designId}
          </span>
        )}
      </div>

      <div className="command-bar__right flex items-center gap-[0.4rem] justify-self-end">
        {/* The Output bell doubles as the render-status indicator (a status dot
            rides its corner while working / on failure / when stale), so no
            separate StatusPill is needed. */}
        <OutputToggle
          compact
          outputOpen={outputOpen}
          noticeCount={noticeCount}
          onToggleOutput={onToggleOutput}
          status={{ rendering, ready, result, stale: stalePreview }}
          className={cn(ICON_BUTTON_CLASS, "command-bar__output")}
        />
        <BarActions themeMode={themeMode} licensesLabel="Open-source licenses" />
      </div>
    </header>
  );
});
