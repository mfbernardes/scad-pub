// HelpModal.tsx — renders the user guide from structured content. The content
// is project-agnostic by default (DEFAULT_HELP) and fully overridable via the
// config's `help`, so no design-specific copy is baked into the app. A config
// may group its guide into many tabs (`help.tabs`); without tabs it renders as
// a single pane exactly as before.
import { useRef, useState, type KeyboardEvent } from "react";
import { Modal } from "./Modal";
import { Markdown } from "./Markdown";
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

/** Tab strip + active panel, following the ARIA tabs pattern (roving tabindex,
 *  arrow/Home/End keyboard navigation). */
function HelpTabs({ tabs }: { tabs: HelpTab[] }) {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent) => {
    const last = tabs.length - 1;
    let next = active;
    if (e.key === "ArrowRight") next = active === last ? 0 : active + 1;
    else if (e.key === "ArrowLeft") next = active === 0 ? last : active - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else return;
    e.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  const cur = tabs[active];
  return (
    <>
      <div
        className="help-tabs"
        role="tablist"
        aria-label="Help topics"
        onKeyDown={onKeyDown}
      >
        {tabs.map((t, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            id={`help-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`help-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            className={i === active ? "help-tab active" : "help-tab"}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            onClick={() => setActive(i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        className="modal-body help-body"
        role="tabpanel"
        id={`help-panel-${active}`}
        aria-labelledby={`help-tab-${active}`}
        tabIndex={0}
      >
        <HelpSections intro={cur.intro} sections={cur.sections} />
      </div>
    </>
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
