// LicensesModal.tsx — open-source attribution notice. Lists the third-party
// components shipped in this app with their license and source links, and the
// reproducible license text where applicable, to satisfy their license terms.
import { LICENSES } from "../lib/licenses";
import type { SoftwareLicense } from "../openscad/types";
import { safeUrl } from "../lib/safeUrl";
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
        {all.map((l, i) => {
          const nameHref = safeUrl(l.url);
          const licenseHref = safeUrl(l.licenseUrl);
          const sourceHref = l.sourceUrl ? safeUrl(l.sourceUrl) : undefined;
          return (
          <section className="license-entry" key={`${i}-${l.name}`}>
            <h3>
              {nameHref ? (
                <a href={nameHref} target="_blank" rel="noopener noreferrer">{l.name}</a>
              ) : (
                <span>{l.name}</span>
              )}
              {l.version && <span className="lic-version"> {l.version}</span>}
              <span className="lic-spdx">{l.license}</span>
            </h3>
            <p className="lic-copyright">{l.copyright}</p>
            {l.note && <p className="lic-note">{l.note}</p>}
            <p className="lic-links">
              {licenseHref ? (
                <a href={licenseHref} target="_blank" rel="noopener noreferrer">License text ↗</a>
              ) : (
                <span>License text</span>
              )}
              {sourceHref && (
                <>
                  {" · "}
                  <a href={sourceHref} target="_blank" rel="noopener noreferrer">Source ↗</a>
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
          );
        })}
      </div>
    </Modal>
  );
}
