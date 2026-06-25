// LicensesModal.tsx — open-source attribution notice. Lists the third-party
// components shipped in this app with their license and source links, and the
// reproducible license text where applicable, to satisfy their license terms.
import { LICENSES } from "../lib/licenses";
import type { SoftwareLicense } from "../openscad/types";
import { Modal } from "./Modal";

export function LicensesModal({
  extra = [],
  onClose,
}: {
  /** Consumer-configured components, appended after the built-in attributions
   *  (never replacing them). */
  extra?: SoftwareLicense[];
  onClose: () => void;
}) {
  // Built-ins first, config additions appended: the list only ever grows.
  const all = [...LICENSES, ...extra];
  return (
    <Modal title="Open-source licenses" onClose={onClose}>
      <p className="modal-intro">
        This configurator is built with the following open-source components,
        listed to comply with their licenses.
      </p>
      <div className="modal-body">
        {all.map((l, i) => (
          <section className="license-entry" key={`${i}-${l.name}`}>
            <h3>
              <a href={l.url} target="_blank" rel="noopener noreferrer">
                {l.name}
              </a>
              {l.version && <span className="lic-version"> {l.version}</span>}
              <span className="lic-spdx">{l.license}</span>
            </h3>
            <p className="lic-copyright">{l.copyright}</p>
            {l.note && <p className="lic-note">{l.note}</p>}
            <p className="lic-links">
              <a href={l.licenseUrl} target="_blank" rel="noopener noreferrer">
                License text ↗
              </a>
              {l.sourceUrl && (
                <>
                  {" · "}
                  <a href={l.sourceUrl} target="_blank" rel="noopener noreferrer">
                    Source ↗
                  </a>
                </>
              )}
            </p>
            {l.text && (
              <details>
                <summary>Show full license text</summary>
                <pre className="lic-text">{l.text}</pre>
              </details>
            )}
          </section>
        ))}
      </div>
    </Modal>
  );
}
