// CommandBar.tsx — top bar: brand, design picker (shadcn Select), status +
// action icons (theme / help / licenses). Presets are a tab in the parameter
// panel (mirroring the mobile sheet), not a top-bar popover; notices surface
// via the auto-opening output console; PWA install is demoted to the Help
// modal — so the bar stays lean.
import { memo } from "react";
import { BookOpen as GuideIcon, FolderOpen as FilesIcon } from "lucide-react";
import type { Design, Schema, RenderResult } from "../openscad/types";
import { useAppActions } from "../lib/appActions";
import { DesignPicker } from "./DesignPicker";
import { DesignPickerButton } from "./DesignPickerButton";
import { BarBrand } from "./BarBrand";
import { BarActions } from "./BarActions";
import { OutputToggle } from "./OutputToggle";
import { IconButton, ICON_BUTTON_CLASS } from "./IconButton";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";

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
  /** Bumped by the intro popup's CTA to open the design picker. */
  openPickerSignal: number;
  /** Whether the desktop bar is the visible layout (so only its picker opens). */
  pickerActive: boolean;
  /** Wave 2 (guided shell, `ui.workflow: "guided"`): the design-name button
   *  always opens the unified selector (UnifiedSelectorDialog.tsx) regardless
   *  of `ui.gallery`/design count, and an "Imported files" icon appears when
   *  the design imports files (Files tab equivalent moved off primary nav —
   *  see FileBar.tsx / ImportedFilesModal.tsx). Default false: "tabs"
   *  workflow's bar is completely unaffected. */
  guided?: boolean;
  /** Whether the active design has file import configured at all — gates the
   *  guided-only "Imported files" icon (mirrors FileBar's own `fileImport`
   *  gate). Ignored outside guided mode. */
  hasFileImport?: boolean;
  /** Opens ImportedFilesModal (AppShell owns the open state). */
  onOpenImportedFiles?: () => void;
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
  openPickerSignal,
  pickerActive,
  guided = false,
  hasFileImport = false,
  onOpenImportedFiles,
}: Props) {
  const { showDesignDoc } = useAppActions();
  const currentDesign = designs.find((d) => d.id === designId);

  return (
    <header
      className="command-bar z-10 grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b bg-background pt-[calc(0.5rem+env(safe-area-inset-top,0px))] pb-2 pl-[calc(1rem+env(safe-area-inset-left,0px))] pr-[calc(1rem+env(safe-area-inset-right,0px))]"
      role="banner"
    >
      {/* Brand */}
      <div className="inline-flex items-center gap-[0.45rem] justify-self-start p-[0.2rem]">
        <BarBrand schema={schema} theme={theme} titleClassName="text-[1.05rem] font-bold" />
      </div>

      {/* Design picker, centered in the bar */}
      <div className="command-bar__design-picker inline-flex items-center gap-[0.4rem] justify-self-center whitespace-nowrap">
        {guided || (designs.length > 1 && schema.ui?.gallery) ? (
          // Wave 2: the design name is always the unified-selector trigger in
          // guided mode, regardless of `ui.gallery`/design count — it also
          // surfaces Examples/Saved, not just other designs, so it's worth
          // opening even for a single-design build. Outside guided mode, the
          // same button is `ui.gallery`'s multi-design picker trigger.
          <DesignPickerButton design={currentDesign ?? designs[0]} />
        ) : designs.length > 1 ? (
          <DesignPicker
            designs={designs}
            value={designId}
            openSignal={openPickerSignal}
            active={pickerActive}
          />
        ) : (
          <span className="text-[0.88rem] font-semibold text-foreground">
            {currentDesign?.label ?? designId}
          </span>
        )}
        {currentDesign?.doc && (
          <IconButton
            label={t("bar.designGuide")}
            title={t("bar.aboutDesign")}
            onClick={showDesignDoc}
            className="command-bar__design-doc size-7 p-[0.3rem]"
          >
            <GuideIcon size={15} />
          </IconButton>
        )}
      </div>

      <div className="command-bar__right flex items-center gap-[0.4rem] justify-self-end">
        {/* The Output bell doubles as the render-status indicator (a status dot
            rides its corner while working / on failure / when stale), so no
            separate StatusPill is needed. */}
        <OutputToggle
          outputOpen={outputOpen}
          noticeCount={noticeCount}
          onToggleOutput={onToggleOutput}
          status={{ rendering, ready, result, stale: stalePreview }}
          className={cn(ICON_BUTTON_CLASS, "command-bar__output")}
          // Wave 1 (round-5): guided mode's own quiet dot indicator, never
          // the numeric pill — see OutputToggle's own `variant` doc. `guided`
          // false (every "tabs" workflow call, including every existing
          // caller that omits it) keeps today's "count" badge unchanged.
          variant={guided ? "dot" : "count"}
        />
        {guided && hasFileImport && onOpenImportedFiles && (
          <IconButton
            label={t("files.importedTitle")}
            title={t("files.importedTitle")}
            onClick={onOpenImportedFiles}
            className="command-bar__imported-files"
          >
            <FilesIcon size={16} />
          </IconButton>
        )}
        <BarActions themeMode={themeMode} />
      </div>
    </header>
  );
});
