// BarActions.tsx: the secondary actions shared by both top bars: Save image
// (PNG), Files, theme toggle, Help, and open-source licenses. One component,
// two presentations chosen by the `collapse` prop. The caller passes it rather
// than this component reading a viewport hook, because the caller already knows
// which layout it is: AppShell mounts one tree or the other (M7), and a second
// source of truth for the breakpoint is one more thing to disagree.
//   • inline (desktop CommandBar): icon buttons in a row.
//   • collapsed (mobile top bar): a single "⋮" Popover of rows, so the narrow
//     bar stays uncluttered.
// Render status rides separately on the Output bell (see OutputToggle).
//
// Save-image moved here from the export dock (ActionButtons.tsx) when the dock
// was unified down to two buttons (Download + Share only): it's a lower-frequency
// secondary action, and this is where the app's other secondary chrome
// (theme/help/licenses) already lives in both layouts, so it needs no new
// overflow surface of its own. Files opens FilesModal from here rather than
// sitting beside Presets/Customize as a panel tab, gated on `hasFiles` (the
// caller knows whether the design's config sets `fileImport`). Live preview
// (auto-render) rides this menu on mobile too, where a pinned footer row inside
// the Customize tab would spend ~36px of a ~385px sheet on a mode PanelFooter's
// own doc calls "rarely toggled"; desktop keeps PanelFooter, where the panel has
// the room.
import { useState } from "react";
import { useAppActions } from "../lib/appActions";
import { ThemeToggle, THEME_MODE } from "./ThemeToggle";
import { IconButton, ICON_BUTTON_CLASS } from "./IconButton";
import { MenuRow, MENU_ROW_CLASS } from "./MenuRow";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";
import {
  CircleHelp as HelpIcon,
  Image as ImageIcon,
  Info as InfoIcon,
  EllipsisVertical as MoreIcon,
  Paperclip as FilesIcon,
  RefreshCw as LivePreviewIcon,
} from "lucide-react";

type ThemeMode = "light" | "dark" | "auto";

// One wording for the licenses control in both presentations.
const LICENSES_LABEL = t("bar.licenses");

// The menu's rows are the shared MenuRow (see MenuRow.tsx). The bare class is
// what the Live-preview row needs: it's a <Label> wrapping a Switch, not a
// button, so it takes the look without the component.
const rowClass = MENU_ROW_CLASS;

interface Props {
  themeMode: ThemeMode;
  /** The mode a press moves to; the inline toggle names it. */
  themeNext: ThemeMode;
  /** Collapse into a "⋮" overflow menu (mobile) instead of inline buttons (desktop). */
  collapse?: boolean;
  /** Present -> render the Save-image action (both presentations). Omitted
   *  entirely by a caller that has nowhere for it to act (there is none
   *  currently, but this keeps the action optional rather than assumed). */
  onSavePng?: () => void;
  /** Gates Save-image the same way the dock's Download button is gated for
   *  its direct-export path: a successful render matching the live controls. */
  canSavePng?: boolean;
  /** Shows the Files action, which opens FilesModal: set when the config's
   *  `fileImport` is present (the caller derives this from the schema; see
   *  AppShell's `hasFiles`). False by default: most designs import nothing. */
  hasFiles?: boolean;
  /** Live preview (auto-render) state. Present -> the collapsed (mobile) menu
   *  carries the toggle; the inline desktop presentation ignores it, because
   *  there PanelFooter still owns it at the bottom of the docked panel. */
  autoRender?: boolean;
}

export function BarActions({
  themeMode,
  themeNext,
  collapse = false,
  onSavePng,
  canSavePng = true,
  hasFiles = false,
  autoRender,
}: Props) {
  const { cycleTheme, showHelp, showLicenses, showFiles, autoRenderChange } = useAppActions();
  const [open, setOpen] = useState(false);
  // Help/licenses/Save-image/Files close the menu; theme cycles in place.
  const openModal = (fn: () => void) => () => { fn(); setOpen(false); };
  // Names the CURRENT mode ("Theme: Auto"), not the next one THEME_MODE's
  // `nextLabel` describes: the collapsed row's only state feedback is this
  // label updating in place (see the row below), so it has to say what mode
  // is active now.
  const themeLabel = t("theme.label", { mode: t(THEME_MODE[themeMode].nameKey) });

  if (collapse) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        {/* Native button so PopoverTrigger's ref reaches the DOM (Radix anchors to
            it); styled to match the top bar's other icon buttons. */}
        <PopoverTrigger
          // `outline-none` suppresses index.css's global :focus-visible
          // outline, and a native <button> (which PopoverTrigger's ref needs)
          // gets none of shadcn Button's focus styling, so the ring below is
          // what makes this keyboard-visible at all. Same recipe as
          // ViewPicker's and ViewerHUD's triggers.
          className={cn(ICON_BUTTON_CLASS, "inline-flex items-center justify-center rounded-md outline-none transition-[background-color,border-color,color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:border-brand")}
          aria-label={t("bar.moreActions")}
          title={t("bar.more")}
        >
          <MoreIcon size={16} />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-52 p-1">
          {autoRender !== undefined && (
            // Keeps the `.auto-render` hook class and the switch's accessible
            // name from PanelFooter, so the smoke suite finds the same control
            // in either layout. Doesn't close the menu: it's a mode, and the
            // visitor may want to see it flip.
            <Label
              className={cn(rowClass, "auto-render justify-between font-normal")}
              title={t("settings.livePreviewTitle")}
            >
              <span className="inline-flex items-center gap-2">
                <LivePreviewIcon size={16} /> {t("settings.livePreview")}
              </span>
              <Switch
                checked={autoRender}
                onCheckedChange={autoRenderChange}
                aria-label={t("settings.livePreview")}
              />
            </Label>
          )}
          {onSavePng && (
            <MenuRow
              label={t("bar.saveImage")}
              icon={<ImageIcon size={16} />}
              onClick={openModal(onSavePng)}
              disabled={!canSavePng}
            />
          )}
          {hasFiles && (
            <MenuRow label={t("files.title")} icon={<FilesIcon size={16} />} onClick={openModal(showFiles)} />
          )}
          {/* Cycles in place: the visitor usually wants to see the theme
              change, so this row deliberately leaves the menu open — naming
              the current mode in the label (themeLabel) is the only feedback
              a tap did anything, since the first cycle step can be a visual
              no-op (auto -> light under a light OS). */}
          <MenuRow label={themeLabel} icon={THEME_MODE[themeMode].icon} onClick={cycleTheme} />
          <MenuRow label={t("bar.help")} icon={<HelpIcon size={16} />} onClick={openModal(() => showHelp())} />
          <MenuRow label={LICENSES_LABEL} icon={<InfoIcon size={16} />} onClick={openModal(showLicenses)} />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <>
      {onSavePng && (
        <IconButton
          label={t("bar.saveImage")}
          title={t("bar.saveImagePng")}
          onClick={onSavePng}
          disabled={!canSavePng}
        >
          <ImageIcon size={16} />
        </IconButton>
      )}
      {hasFiles && (
        <IconButton label={t("files.title")} title={t("files.title")} onClick={showFiles}>
          <FilesIcon size={16} />
        </IconButton>
      )}
      <ThemeToggle mode={themeMode} next={themeNext} onCycle={cycleTheme} />
      <IconButton label={t("bar.help")} title={t("bar.helpShortcuts")} onClick={() => showHelp()}>
        <HelpIcon size={16} />
      </IconButton>
      <IconButton label={LICENSES_LABEL} title={LICENSES_LABEL} onClick={showLicenses}>
        <InfoIcon size={16} />
      </IconButton>
    </>
  );
}
