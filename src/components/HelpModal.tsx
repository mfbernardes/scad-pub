// HelpModal.tsx — renders the user guide from structured content. The content
// is project-agnostic by default (DEFAULT_HELP) and fully overridable via the
// config's `help`, so no design-specific copy is baked into the app. A config
// may group its guide into many tabs (`help.tabs`); without tabs it renders as
// a single pane exactly as before.
import { Modal, MODAL_BODY, MODAL_INTRO } from "./Modal";
import { Markdown } from "./Markdown";
import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger, chipTabTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";
import { HardDriveDownload as InstallIcon, ListChecks as ChecklistIcon } from "lucide-react";
import { DEFAULT_HELP } from "../lib/defaultHelp";
import { t } from "../lib/i18n";
import { useIsMobile } from "../lib/useIsMobile";
import type { HelpContent, HelpSection, HelpTab } from "../openscad/types";

/* The help sections' typography, applied to the scrolling body wrapper (the
   Markdown renderer emits bare p/ul/li). */
const HELP_BODY = cn(
  MODAL_BODY,
  "help-body [&_section]:my-[0.9rem] [&_h3]:mb-1 [&_h3]:text-[0.95rem] [&_h3]:text-brand",
  "[&_p]:m-0 [&_p]:text-[0.88rem] [&_p]:leading-[1.5] [&_p]:text-foreground",
  "[&_ul]:mt-[0.35rem] [&_ul]:pl-[1.1rem] [&_ul]:text-[0.88rem] [&_ul]:leading-[1.5] [&_ul]:text-foreground [&_li]:my-[0.2rem]"
);

/** The sections of one pane: an optional intro followed by titled sections. */
function HelpSections({
  intro,
  sections,
}: {
  intro?: string;
  sections: HelpSection[];
}) {
  return (
    <>
      {intro && (
        <div className="mb-[0.6rem] text-[0.85rem] text-muted-foreground [&_p]:m-0">
          <Markdown body={intro} />
        </div>
      )}
      {sections.map((s, i) => (
        <section key={i}>
          <h3>{s.title}</h3>
          <Markdown body={s.body} />
        </section>
      ))}
    </>
  );
}

/** Tab strip + panels, built on the shared Radix Tabs primitive (which provides
 *  the full ARIA tabs pattern — roving tabindex, arrow/Home/End nav — for free). */
function HelpTabs({ tabs, defaultTab }: { tabs: HelpTab[]; defaultTab: string }) {
  // Narrow screens: a handful of tab chips (5+ in the dogfood config) no
  // longer fit one line at 320px, so `flex-wrap` used to wrap them onto a
  // second/third row, pushing the active tab's content further down before
  // it even starts. Below the mobile breakpoint the strip instead scrolls
  // horizontally on one row (`flex-nowrap overflow-x-auto`, each chip
  // `shrink-0` so it keeps its natural width rather than being squeezed).
  // Desktop keeps the original wrapping behaviour untouched.
  const isMobile = useIsMobile();
  // `min-h-0 flex-1` lets this tab block fill the dialog's remaining height and,
  // crucially, shrink below its content — otherwise the default `min-height:auto`
  // makes it grow past the dialog, which clips (rather than scrolls) long tabs.
  return (
    <Tabs defaultValue={defaultTab} className="min-h-0 flex-1 gap-0">
      <TabsList
        className={cn(
          "mx-4 mt-2 h-auto w-full min-w-0 justify-start rounded-none border-0 border-b bg-transparent p-0",
          isMobile ? "flex-nowrap overflow-x-auto" : "flex-wrap"
        )}
        aria-label={t("help.topicsAria")}
      >
        {tabs.map((tab, i) => (
          <TabsTrigger key={i} value={String(i)} className={cn(chipTabTrigger, "shrink-0 px-3")}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab, i) => (
        <TabsContent
          key={i}
          value={String(i)}
          // `min-h-0` + the body's `overflow-y-auto` make each tab scroll
          // its own content within the constrained `Tabs` height above.
          className={cn(HELP_BODY, "mt-0")}
          tabIndex={0}
        >
          <HelpSections intro={tab.intro} sections={tab.sections} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

export function HelpModal({
  help,
  onClose,
  canInstall = false,
  onInstall,
  canReplayChecklist = false,
  onReplayChecklist,
  initialTab,
}: {
  help?: HelpContent | null;
  onClose: () => void;
  /** Show a permanent "Install app" action (only when the browser offers it and
   *  the config allows it). Demoted here from a standing top-bar button. */
  canInstall?: boolean;
  onInstall?: () => void;
  /** Show the "show the getting-started checklist again" row (only where the
   *  checklist could ever show at all — guided experience + `ui.checklist
   *  !== false`; see App.tsx's canReplayChecklist). */
  canReplayChecklist?: boolean;
  /** Clears the checklist's dismiss flag and brings GettingStarted back —
   *  see src/components/GettingStarted.tsx. */
  onReplayChecklist?: () => void;
  /** Open straight to the tab whose label matches this (e.g. from the
   *  after-export panel's "Printing guide" action — see App.tsx's showHelp
   *  and gen-schema's `ui.afterExport.helpTab` validation, which guarantees
   *  a configured value always names a real tab). Unmatched or absent ->
   *  the first tab, same as before this existed. Ignored when the config has
   *  no tabs at all. */
  initialTab?: string;
}) {
  const content = help ?? DEFAULT_HELP;
  // Normalise to tabs when the config supplies any. Top-level `sections` (the
  // single-pane form) become a leading "Overview" tab so adding `tabs` to an
  // existing help never drops the original content.
  const tabs: HelpTab[] | null = content.tabs?.length
    ? [
        // This label is exactly what gen-schema's `ui.afterExport.helpTab`
        // cross-check (scripts/gen-schema.mjs) treats as the synthesized
        // "Overview" tab's name — it reads the same `help.overviewTab` key
        // out of src/locales/en.json rather than a hardcoded literal, so the
        // two can never drift apart. Change the en.json string and both
        // sides move together.
        ...(content.sections?.length
          ? [{ label: t("help.overviewTab"), sections: content.sections }]
          : []),
        ...content.tabs,
      ]
    : null;
  // Radix Tabs indexes panels by position (see HelpTabs' `value={String(i)}`),
  // so the deep link resolves to that same index string. A miss (stale
  // config, no match) falls back to the first tab exactly like before.
  const initialTabIndex = tabs && initialTab ? tabs.findIndex((tab) => tab.label === initialTab) : -1;
  const defaultTab = initialTabIndex >= 0 ? String(initialTabIndex) : "0";
  // On mobile the config-level intro used to sit above the tab strip on every
  // tab, pushing the tabs (and their content) further down the already-short
  // viewport for a paragraph most visitors skip past. Below the mobile
  // breakpoint it collapses into a closed <details> "About" disclosure so the
  // tab strip + content lead; opening it is one tap away. Desktop is
  // unchanged — the intro still renders open, as before.
  const isMobile = useIsMobile();

  return (
    <Modal title={content.title ?? t("help.defaultTitle")} label={t("help.label")} onClose={onClose}>
      {content.intro && (
        isMobile ? (
          <details className="help-about mx-4 mt-[0.6rem] text-[0.85rem] text-muted-foreground [&_p]:m-0">
            <summary className="cursor-pointer font-medium text-foreground select-none">
              {t("help.aboutSummary")}
            </summary>
            <div className="mt-[0.4rem]">
              <Markdown body={content.intro} />
            </div>
          </details>
        ) : (
          <div className={MODAL_INTRO}>
            <Markdown body={content.intro} />
          </div>
        )
      )}
      {tabs ? (
        <HelpTabs tabs={tabs} defaultTab={defaultTab} />
      ) : (
        <div className={HELP_BODY}>
          <HelpSections sections={content.sections ?? []} />
        </div>
      )}
      {canInstall && onInstall && (
        <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
          <span className="text-[0.85rem] text-muted-foreground">
            {t("help.installBlurb")}
          </span>
          <Button size="sm" className="ml-auto" onClick={onInstall} title={t("help.installTitle")}>
            <InstallIcon size={14} /> {t("help.installButton")}
          </Button>
        </div>
      )}
      {canReplayChecklist && onReplayChecklist && (
        <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={onReplayChecklist}
            title={t("help.replayChecklist")}
          >
            <ChecklistIcon size={14} /> {t("help.replayChecklist")}
          </Button>
        </div>
      )}
    </Modal>
  );
}
