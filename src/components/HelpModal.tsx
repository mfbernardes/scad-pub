// HelpModal.tsx — renders the user guide from structured content. The content
// is project-agnostic by default (DEFAULT_HELP) and fully overridable via the
// config's `help`, so no design-specific copy is baked into the app. A config
// may group its guide into many tabs (`help.tabs`); without tabs it renders as
// a single pane exactly as before.
import { Modal } from "./Modal";
import { Markdown } from "./Markdown";
import { Tabs, TabsContent, TabsList, TabsTrigger, underlineTabTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";
import {
  DEFAULT_HELP,
  type HelpContent,
  type HelpSection,
  type HelpTab,
} from "../lib/defaultHelp";

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
        <div className="help-tab-intro">
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
  return (
    <Tabs defaultValue="0" className="gap-0">
      <TabsList
        className="mx-4 mt-2 h-auto w-auto flex-wrap justify-start rounded-none border-0 border-b bg-transparent p-0"
        aria-label="Help topics"
      >
        {tabs.map((t, i) => (
          <TabsTrigger key={i} value={String(i)} className={cn(underlineTabTrigger, "px-3")}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t, i) => (
        <TabsContent key={i} value={String(i)} className="modal-body help-body mt-0" tabIndex={0}>
          <HelpSections intro={t.intro} sections={t.sections} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

export function HelpModal({
  help,
  onClose,
}: {
  help?: HelpContent | null;
  onClose: () => void;
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
    <Modal title="How to use this configurator" label="Help" onClose={onClose}>
      {content.intro && (
        <div className="modal-intro">
          <Markdown body={content.intro} />
        </div>
      )}
      {tabs ? (
        <HelpTabs tabs={tabs} />
      ) : (
        <div className="modal-body help-body">
          <HelpSections sections={content.sections ?? []} />
        </div>
      )}
    </Modal>
  );
}
