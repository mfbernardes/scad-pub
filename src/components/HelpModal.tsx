// HelpModal.tsx: renders the user guide from structured content. The content
// is project-agnostic by default (defaultHelp()) and fully overridable via the
// config's `help`, so no design-specific copy is baked into the app. A config
// may group its guide into multiple tabs (`help.tabs`); without tabs it renders as
// a single pane exactly as before.
import { Modal, MODAL_BODY, MODAL_INTRO } from "./Modal";
import { Markdown } from "./Markdown";
import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger, chipTabTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";
import { HardDriveDownload as InstallIcon } from "lucide-react";
import { defaultHelp } from "../lib/defaultHelp";
import type { HelpContent, HelpSection, HelpTab } from "../openscad/types";
import { t } from "../lib/i18n";
import { useLocale } from "../lib/localeStore";
import { OVERVIEW_TAB_ID } from "../lib/helpShape.mjs";

/* The help sections' typography, applied to the scrolling body wrapper (the
   Markdown renderer emits bare p/ul/li).

   `[&_p]:m-0` zeroes the browser's paragraph margins so a section's first
   paragraph sits directly under its <h3> (which brings its own `mb-1`). That
   held while every section body was one paragraph, but a body with two
   would then run them together, since a blank line in the source becomes a
   second <p> with no gap. The sibling rules restore that gap for exactly the
   paragraphs that follow something: p-after-p and p-after-list. */
const HELP_BODY = cn(
  MODAL_BODY,
  "help-body [&_section]:my-[0.9rem] [&_h3]:mb-1 [&_h3]:text-[0.95rem] [&_h3]:text-brand",
  "[&_p]:m-0 [&_p]:text-[0.88rem] [&_p]:leading-[1.5] [&_p]:text-foreground",
  "[&_p+p]:mt-[0.55rem] [&_ul+p]:mt-[0.55rem]",
  "[&_ul]:mt-[0.35rem] [&_ul]:list-disc [&_ul]:pl-[1.4rem] [&_ul]:text-[0.88rem] [&_ul]:leading-[1.5] [&_ul]:text-foreground [&_li]:my-[0.2rem] [&_li]:pl-[0.2rem]"
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
 *  the full ARIA tabs pattern (roving tabindex, arrow/Home/End nav) for free). */
function HelpTabs({ tabs, initialTab }: { tabs: HelpTab[]; initialTab?: string }) {
  // `initialTab` (from ui.afterExport's "Open printing help" action, or any
  // other future deep link) picks which tab is active on mount: matched by
  // `id` first, then by its exact label (back-compat with a config written
  // before tab ids existed — see gen-schema.mjs's checkAfterExportHelpTab,
  // which validates a config's `helpTab` reference the same way); an
  // unmatched or omitted value falls back to the first tab. Radix Tabs'
  // `defaultValue` is uncontrolled, so this only matters at mount: fine here
  // since HelpModal remounts fresh every time it opens (see App.tsx's
  // `{showHelp && <HelpModal/>}`).
  const matched = initialTab
    ? (() => {
        const byId = tabs.findIndex((t) => t.id === initialTab);
        return byId >= 0 ? byId : tabs.findIndex((t) => t.label === initialTab);
      })()
    : -1;
  const defaultValue = matched >= 0 ? String(matched) : "0";
  // `min-h-0 flex-1` lets this tab block fill the dialog's remaining height and,
  // crucially, shrink below its content: otherwise the default `min-height:auto`
  // makes it grow past the dialog, which clips (rather than scrolls) long tabs.
  return (
    <Tabs defaultValue={defaultValue} className="min-h-0 flex-1 gap-0">
      <TabsList
        className="mx-4 mt-2 h-auto w-auto flex-wrap justify-start rounded-none border-0 border-b bg-transparent p-0"
        aria-label={t("help.topicsAria")}
      >
        {tabs.map((t, i) => (
          <TabsTrigger key={i} value={String(i)} className={cn(chipTabTrigger, "px-3")}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t, i) => (
        <TabsContent
          key={i}
          value={String(i)}
          // `min-h-0` + the body's `overflow-y-auto` make each tab scroll
          // its own content within the constrained `Tabs` height above.
          className={cn(HELP_BODY, "mt-0")}
          tabIndex={0}
        >
          <HelpSections intro={t.intro} sections={t.sections} />
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
  initialTab,
}: {
  help?: HelpContent | null;
  onClose: () => void;
  /** Show a permanent "Install app" action (only when the browser offers it and
   *  the config allows it). Demoted here from a standing top-bar button. */
  canInstall?: boolean;
  onInstall?: () => void;
  /** Deep-link to a specific tab by its exact label (e.g. from the after-export
   *  panel's "Open printing help" action), see HelpTabs' own doc. */
  initialTab?: string;
}) {
  useLocale(); // subscription only: re-render this component's t() calls on a locale switch
  const content = help ?? defaultHelp();
  // Normalise to tabs when the config supplies any. Top-level `sections` (the
  // single-pane form) become a leading "Overview" tab so adding `tabs` to an
  // existing help never drops the original content.
  const tabs: HelpTab[] | null = content.tabs?.length
    ? [
        ...(content.sections?.length
          ? [{ id: OVERVIEW_TAB_ID, label: t("help.overviewTab"), sections: content.sections }]
          : []),
        ...content.tabs,
      ]
    : null;

  return (
    <Modal title={content.title ?? t("help.defaultTitle")} onClose={onClose}>
      {content.intro && (
        <div className={MODAL_INTRO}>
          <Markdown body={content.intro} />
        </div>
      )}
      {tabs ? (
        <HelpTabs tabs={tabs} initialTab={initialTab} />
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
          <Button size="sm" className="ml-auto" onClick={onInstall} title={t("help.installAsAppTitle")}>
            <InstallIcon size={14} /> {t("help.installApp")}
          </Button>
        </div>
      )}
    </Modal>
  );
}
