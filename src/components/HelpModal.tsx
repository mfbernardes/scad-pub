// HelpModal.tsx — renders the user guide from structured content. The content
// is project-agnostic by default (DEFAULT_HELP) and fully overridable via the
// config's `help`, so no design-specific copy is baked into the app.
import { Modal } from "./Modal";
import { Markdown } from "./Markdown";
import { DEFAULT_HELP, type HelpContent } from "../lib/defaultHelp";

export function HelpModal({
  help,
  onClose,
}: {
  help?: HelpContent | null;
  onClose: () => void;
}) {
  const content = help ?? DEFAULT_HELP;
  return (
    <Modal title="How to use this configurator" label="Help" onClose={onClose}>
      {content.intro && (
        <div className="modal-intro">
          <Markdown body={content.intro} />
        </div>
      )}
      <div className="modal-body help-body">
        {content.sections.map((s, i) => (
          <section key={i}>
            <h3>{s.title}</h3>
            <Markdown body={s.body} />
          </section>
        ))}
      </div>
    </Modal>
  );
}
