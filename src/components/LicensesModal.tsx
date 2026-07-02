// LicensesModal.tsx — open-source attribution notice. Lists the third-party
// components shipped in this app with their license and source links, and the
// reproducible license text where applicable, to satisfy their license terms.
import { LICENSES } from "../lib/licenses";
import type { SoftwareLicense } from "../openscad/types";
import { safeUrl } from "../lib/safeUrl";
import { Modal, MODAL_BODY, MODAL_INTRO } from "./Modal";

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
      <p className={MODAL_INTRO}>
        This configurator is built with the following open-source components,
        listed to comply with their licenses.
      </p>
      <div className={`${MODAL_BODY} [&_a]:text-link`}>
        {all.map((l, i) => {
          const nameHref = safeUrl(l.url);
          const licenseHref = safeUrl(l.licenseUrl);
          const sourceHref = l.sourceUrl ? safeUrl(l.sourceUrl) : undefined;
          return (
          <section className="license-entry border-t py-[0.8rem] first:border-t-0" key={`${i}-${l.name}`}>
            <h3 className="mb-[0.3rem] flex flex-wrap items-baseline gap-2 text-[0.95rem]">
              {nameHref ? (
                <a href={nameHref} target="_blank" rel="noopener noreferrer">{l.name}</a>
              ) : (
                <span>{l.name}</span>
              )}
              {l.version && (
                <span className="text-[0.85rem] font-normal text-muted-foreground"> {l.version}</span>
              )}
              <span className="ml-auto rounded-(--radius-sm) border bg-muted px-2 font-mono text-[11px] leading-[normal] text-brand">
                {l.license}
              </span>
            </h3>
            <p className="my-[0.2rem] text-[0.85rem]">{l.copyright}</p>
            {l.note && <p className="my-[0.2rem] text-[0.82rem] text-muted-foreground">{l.note}</p>}
            <p className="my-[0.3rem] text-[0.82rem]">
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
              <details className="mt-[0.4rem]">
                <summary className="cursor-pointer text-[0.82rem] text-muted-foreground">
                  Show full license text
                </summary>
                <pre className="lic-text mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-(--radius-sm) bg-code px-[0.8rem] py-[0.6rem] font-mono text-[11px] leading-[1.45] text-muted-foreground">
                  {l.text}
                </pre>
              </details>
            )}
          </section>
          );
        })}
      </div>
    </Modal>
  );
}
