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
import { HardDriveDownload as InstallIcon } from "lucide-react";
import { DEFAULT_HELP } from "../lib/defaultHelp";
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
function HelpTabs({ tabs }: { tabs: HelpTab[] }) {
  // `min-h-0 flex-1` lets this tab block fill the dialog's remaining height and,
  // crucially, shrink below its content — otherwise the default `min-height:auto`
  // makes it grow past the dialog, which clips (rather than scrolls) long tabs.
  return (
    <Tabs defaultValue="0" className="min-h-0 flex-1 gap-0">
      <TabsList
        className="mx-4 mt-2 h-auto w-auto flex-wrap justify-start rounded-none border-0 border-b bg-transparent p-0"
        aria-label="Help topics"
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
}: {
  help?: HelpContent | null;
  onClose: () => void;
  /** Show a permanent "Install app" action (only when the browser offers it and
   *  the config allows it). Demoted here from a standing top-bar button. */
  canInstall?: boolean;
  onInstall?: () => void;
}) {
  const content = help ?? DEFAULT_HELP;
  // Normalise to tabs when the config supplies any. Top-level `sections` (the
  // single-pane form) become a leading "Overview" tab so adding `tabs` to an
  // existing help never drops the original content.
  const tabs: HelpTab[] | null = content.tabs?.length
    ? [
        ...(content.sections?.length
          ? [{ label: "Overview", sections: content.sections }]
          : []),
        ...content.tabs,
      ]
    : null;

  return (
    <Modal title={content.title ?? "How to use this configurator"} label="Help" onClose={onClose}>
      {content.intro && (
        <div className={MODAL_INTRO}>
          <Markdown body={content.intro} />
        </div>
      )}
      {tabs ? (
        <HelpTabs tabs={tabs} />
      ) : (
        <div className={HELP_BODY}>
          <HelpSections sections={content.sections ?? []} />
        </div>
      )}
      {canInstall && onInstall && (
        <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
          <span className="text-[0.85rem] text-muted-foreground">
            Install this configurator for quick, offline access.
          </span>
          <Button size="sm" className="ml-auto" onClick={onInstall} title="Install as app">
            <InstallIcon size={14} /> Install app
          </Button>
        </div>
      )}
    </Modal>
  );
}
