// GuidedMobileHeader.tsx — guided workflow's persistent mobile top bar (see
// docs/config.md's `ui.workflow`): brand (left), the current design NAME as
// a dropdown-styled button (center, opens the unified selector — reuses
// DesignPickerButton verbatim, see its own doc), and an overflow "⋮" menu
// (right) holding Help / Theme / Imported files / Technical details / About
// (licenses). Design selection is NOT in the overflow — the name button is
// the one entry point (see UnifiedSelectorDialog.tsx).
//
// Unlike "tabs" workflow's `.mobile-top-bar` (AppShell.tsx, still rendered
// byte-identically there), this bar is mounted OUTSIDE the mobile
// background's `inert` wrapper, as a sibling of the bottom sheet with a
// HIGHER z-index (see index.css's `.guided-mobile-header`) — so it stays
// visible AND operable across every sheet detent, including Full, where
// "tabs" workflow's bar would otherwise be covered/inerted. AppShell reports
// this bar's live height to BottomSheet's new `topInset` prop (so "full"
// stops just below it) and its DOM node to BottomSheet's
// `extraTrapContainerRef` (so Full's focus trap treats this bar's controls
// as part of the trap instead of bouncing focus back into the sheet).
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Design, RenderResult, Schema } from "../openscad/types";
import { useAppActions } from "../lib/appActions";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import { BarBrand } from "./BarBrand";
import { DesignPickerButton } from "./DesignPickerButton";
import { OutputToggle } from "./OutputToggle";
import { ICON_BUTTON_CLASS } from "./IconButton";
import { type ThemeMode, THEME_ICON } from "./BarActions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  CircleHelp as HelpIcon,
  EllipsisVertical as MoreIcon,
  FolderOpen as FilesIcon,
  Info as InfoIcon,
  ScrollText as TechnicalIcon,
} from "lucide-react";

interface Props {
  schema: Schema;
  design: Design;
  theme: "dark" | "light";
  themeMode: ThemeMode;
  rendering: boolean;
  ready: boolean;
  result: RenderResult | null;
  stalePreview: boolean;
  outputOpen: boolean;
  /** The number of visible attention cards the Notices tab renders (not
   *  every raw diagnostic) — see AppShell's own `noticeCount` comment. Drives
   *  only the bell's `variant="dot"` presence/accessible name here, never a
   *  digit. */
  noticeCount: number;
  onToggleOutput: () => void;
  onOpenImportedFiles: () => void;
  /** Live-measured height (px) of this bar, reported on mount and on every
   *  resize — AppShell feeds it to BottomSheet's `topInset` so "full" stops
   *  just below it instead of sliding underneath. */
  onHeightChange: (px: number) => void;
  /** The bar's own DOM node — AppShell forwards this to BottomSheet's
   *  `extraTrapContainerRef` so the Full-detent focus trap treats this bar's
   *  controls as reachable instead of bouncing focus back into the sheet. */
  containerRef: RefObject<HTMLDivElement | null>;
}

export function GuidedMobileHeader({
  schema,
  design,
  theme,
  themeMode,
  rendering,
  ready,
  result,
  stalePreview,
  outputOpen,
  noticeCount,
  onToggleOutput,
  onOpenImportedFiles,
  onHeightChange,
  containerRef,
}: Props) {
  const { cycleTheme, showHelp, showLicenses } = useAppActions();
  const [menuOpen, setMenuOpen] = useState(false);
  const localRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    const report = () => onHeightChange(Math.round(el.offsetHeight));
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeThen = (fn: () => void) => () => {
    fn();
    setMenuOpen(false);
  };

  return (
    <div
      ref={(el) => {
        localRef.current = el;
        containerRef.current = el;
      }}
      // Wave 3 (mobile density): min-h-14 (56px) — the mockup's 56-64px
      // header target. Unlike tabs mode's `.mobile-top-bar` (AppShell.tsx,
      // byte-identical, still min-h-12), this bar is the guided visitor's
      // ONLY persistent chrome above the sheet, so it can afford (and the
      // density spec asks for) a touch more room.
      // Round-6 Wave 2, item 10: vertical padding trimmed (0.55rem -> 0.4rem
      // each side) to make room for the overflow/bell buttons growing to
      // 44px below (see their own `size-11` override) while keeping the
      // whole row inside the tighter 56-60px compaction target — min-h-14
      // still wins at 56px (a 44px button + this padding sums to ~53.6px,
      // under the floor), so the header's own rendered height is unchanged.
      className="guided-mobile-header grid min-h-14 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-b-(color:--glass-border) bg-(--glass-bg) pt-[calc(env(safe-area-inset-top,0px)+0.4rem)] pb-[0.4rem] pl-[calc(0.75rem+env(safe-area-inset-left,0px))] pr-[calc(0.75rem+env(safe-area-inset-right,0px))]"
    >
      <span className="inline-flex min-w-0 items-center gap-[0.4rem] justify-self-start overflow-hidden whitespace-nowrap px-[0.2rem] py-[0.3rem] text-[0.92rem] font-bold">
        <BarBrand schema={schema} theme={theme} logoClassName="h-[1.3rem]" />
      </span>

      <div className="guided-mobile-header__center inline-flex min-w-0 items-center justify-self-center">
        <DesignPickerButton design={design} />
      </div>

      <div className="inline-flex items-center gap-[0.4rem] justify-self-end">
        <OutputToggle
          outputOpen={outputOpen}
          noticeCount={noticeCount}
          onToggleOutput={onToggleOutput}
          status={{ rendering, ready, result, stale: stalePreview }}
          // Round-6 Wave 2, item 10: size-11 (44px, was ICON_BUTTON_CLASS's
          // own 32px) — the compaction pass's 44-48px floor for guided
          // mobile's persistent header controls. twMerge (this file's own
          // `cn`) drops ICON_BUTTON_CLASS's `size-8` in favor of this later
          // class — same override precedent as HUD_GLASS_BTN's own
          // breakpoint-varying size on top of the shared icon-button shell.
          className={cn(ICON_BUTTON_CLASS, "guided-mobile-header__output size-11")}
          // Guided workflow's own quiet dot indicator — see OutputToggle's
          // own `variant` doc and this bar's `noticeCount` (already the
          // visible-attention-card count, set by AppShell).
          variant="dot"
        />
        {/* Wave 3 a11y fix: `modal={false}` — Radix's default modal
            DropdownMenu marks everything outside its portal `aria-hidden`
            while open, but this bar is DELIBERATELY mounted as a sibling
            (not a descendant) of the sheet/background specifically so it
            stays reachable regardless of what else is open (see this file's
            own header doc) — a modal menu hiding part of ITSELF (the
            brand/design-name button sit alongside this trigger) while
            leaving them still focusable is exactly the axe-core
            aria-hidden-focus violation this wave's new guided-mode smoke
            coverage caught. Non-modal keeps every visual/interaction
            behavior (Escape closes, outside click closes, roving focus)
            except that trap. */}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
          <DropdownMenuTrigger
            // Round-6 Wave 2, item 10: size-11 (44px) — see the bell button's
            // own doc above for why/how this wins over ICON_BUTTON_CLASS's
            // default 32px.
            className={cn(ICON_BUTTON_CLASS, "guided-mobile-header__overflow size-11 inline-flex items-center justify-center rounded-md outline-none data-[state=open]:border-brand")}
            aria-label={t("bar.moreActionsAria")}
            title={t("bar.more")}
          >
            <MoreIcon size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={closeThen(() => showHelp())}>
              <HelpIcon size={16} /> {t("bar.help")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={closeThen(cycleTheme)}>
              {THEME_ICON[themeMode]} {t("bar.theme")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={closeThen(onOpenImportedFiles)}>
              <FilesIcon size={16} /> {t("files.importedTitle")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={closeThen(onToggleOutput)}>
              <TechnicalIcon size={16} /> {t("overflow.messages")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={closeThen(showLicenses)}>
              <InfoIcon size={16} /> {t("licenses.title")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
