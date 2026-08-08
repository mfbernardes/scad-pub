// LicensesModal.tsx: open-source attribution notice. Lists the third-party
// components shipped in this app with their license and source links, and the
// reproducible license text where applicable, to satisfy their license terms.
import { licenseList, mergeLicenses, type BuildVersions } from "../lib/licenses";
import type { SoftwareLicense } from "../openscad/types";
import { safeUrl } from "../lib/safeUrl";
import { Modal, MODAL_BODY, MODAL_INTRO } from "./Modal";
import { t } from "../lib/i18n";
import { useLocale } from "../lib/localeStore";
import { lxOpt } from "../lib/configI18n";

export function LicensesModal({
  versions,
  extra = [],
  onClose,
}: {
  /** Build-resolved versions for the built-in entries (ScadPub's own build, the
   *  OpenSCAD WASM snapshot, the bundled npm packages). Each is omitted from its
   *  entry when the build couldn't determine it. */
  versions?: BuildVersions;
  /** Consumer-configured components. Merged into the built-in attributions by
   *  name (see mergeLicenses) rather than appended blindly, so a component the
   *  config bundles for its own reasons doesn't show up twice when it's also
   *  one of ScadPub's own built-ins (never replacing the built-in's legal
   *  fields). A config entry with no matching built-in is appended. */
  extra?: SoftwareLicense[];
  onClose: () => void;
}) {
  const { tag } = useLocale();
  // Project `note` (the only localizable field a config `licenses[]` entry
  // carries — see `SoftwareLicense`'s own comment) to a plain string BEFORE
  // merging, so `mergeLicenses`/`combineNotes` (src/lib/licenses.ts) keep
  // their existing plain-string contract, shared with the built-in entries
  // `licenseList()` itself already returns resolved.
  const localizedExtra = extra.map((l) => ({ ...l, note: lxOpt(l.note, tag) }));
  const all = mergeLicenses(licenseList(versions), localizedExtra);
  return (
    <Modal title={t("bar.licenses")} onClose={onClose}>
      <p className={MODAL_INTRO}>
        {t("licenses.intro")}
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
                <a href={licenseHref} target="_blank" rel="noopener noreferrer">{t("licenses.viewText")} ↗</a>
              ) : (
                <span>{t("licenses.viewText")}</span>
              )}
              {sourceHref && (
                <>
                  {" · "}
                  <a href={sourceHref} target="_blank" rel="noopener noreferrer">{t("licenses.viewSource")} ↗</a>
                </>
              )}
            </p>
            {l.text && (
              <details className="mt-[0.4rem]">
                <summary className="cursor-pointer text-[0.82rem] text-muted-foreground">
                  {t("licenses.showFullText")}
                </summary>
                <pre className="lic-text mt-2 max-h-64 overflow-auto overscroll-contain whitespace-pre-wrap rounded-(--radius-sm) bg-code px-[0.8rem] py-[0.6rem] font-mono text-[11px] leading-[1.45] text-muted-foreground">
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
