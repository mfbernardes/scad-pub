// DesignDocModal.tsx: shows a single design's own user documentation. Unlike
// the app-global HelpModal (how the configurator works), this is scoped to the
// active design: its Markdown doc lives beside the .scad and is copied to a
// served URL (design.doc) by gen-schema. It's fetched on open (kept out of the
// initial designs.json to keep that lean) and rendered through the same safe
// Markdown subset: now including `#`/`##`/`###` headings.
import { useEffect, useState } from "react";
import type { LocalizedDesign } from "../openscad/types";
import { assetUrl } from "../lib/assetUrl";
import { cn } from "../lib/utils";
import { Modal, MODAL_BODY } from "./Modal";
import { Markdown } from "./Markdown";
import { t } from "../lib/i18n";
import { useLocale } from "../lib/localeStore";

// Typography for the doc body (the Markdown renderer emits bare h2/h3/h4/p/ul).
// Mirrors HelpModal's HELP_BODY, extended to cover the heading levels a full doc
// uses. Kept local: the doc modal is the only consumer.
const DOC_BODY = cn(
  MODAL_BODY,
  "[&_h2]:mt-[1.1rem] [&_h2]:mb-1 [&_h2]:text-[1.05rem] [&_h2]:font-semibold [&_h2]:text-brand first:[&_h2]:mt-0",
  "[&_h3]:mt-[0.9rem] [&_h3]:mb-1 [&_h3]:text-[0.95rem] [&_h3]:font-semibold [&_h3]:text-brand",
  "[&_h4]:mt-[0.7rem] [&_h4]:mb-1 [&_h4]:text-[0.9rem] [&_h4]:font-semibold [&_h4]:text-foreground",
  "[&_p]:my-[0.6rem] [&_p]:text-[0.88rem] [&_p]:leading-[1.5] [&_p]:text-foreground",
  "[&_ul]:mt-[0.35rem] [&_ul]:list-disc [&_ul]:pl-[1.4rem] [&_ul]:text-[0.88rem] [&_ul]:leading-[1.5] [&_ul]:text-foreground [&_li]:my-[0.2rem] [&_li]:pl-[0.2rem]",
  "[&_a]:text-link [&_code]:text-[0.85em]"
);

export function DesignDocModal({
  design,
  onClose,
}: {
  design: LocalizedDesign;
  onClose: () => void;
}) {
  const { tag } = useLocale(); // also decides which locale's doc file to fetch, see below
  // One keyed result instead of separate text/error state: the effect reruns
  // in place on a tag change, so a result from a previous (doc, tag) pair must
  // read as "loading", not as stale text or a sticky error. Keying the result
  // and comparing at render needs no reset-setState in the effect.
  const key = `${design.doc} ${tag}`;
  const [result, setResult] = useState<{ key: string; text: string | null; error: boolean } | null>(
    null
  );
  const current = result?.key === key ? result : null;

  useEffect(() => {
    const doc = design.doc;
    if (!doc) return;
    let cancelled = false;
    // `docLocales` (gen-schema.mjs's buildDesigns) lists the tags this design
    // has a `<id>-doc.<tag>.md` translation for; a tag not listed (including
    // every design when the deployment ships no doc sidecars at all) falls
    // back to the design's own authored-language `doc`.
    const localized = design.docLocales?.includes(tag);
    const url = localized ? doc.replace(/\.md$/, `.${tag}.md`) : doc;
    const fetchText = (u: string) =>
      fetch(assetUrl(u)).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      });
    const resultKey = `${doc} ${tag}`;
    fetchText(url)
      // The per-locale file is listed but may still 404 (a build/asset
      // mismatch); fall back to the authored-language doc once before
      // surfacing the failure message.
      .catch(() => (localized ? fetchText(doc) : Promise.reject()))
      .then((body) => {
        if (!cancelled) setResult({ key: resultKey, text: body, error: false });
      })
      .catch(() => {
        if (!cancelled) setResult({ key: resultKey, text: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [design.doc, design.docLocales, tag]);

  return (
    <Modal title={t("docModal.title", { label: design.label })} onClose={onClose}>
      <div className={DOC_BODY} tabIndex={0}>
        {/* The status region stays mounted with its text swapped: a region
            inserted already containing its text is the case VoiceOver drops.
            The fetched markdown renders outside it — a live region over the
            doc body would read the entire document aloud. */}
        <div role="status" aria-live="polite">
          {current?.error ? (
            <p className="text-[0.88rem] text-muted-foreground">{t("docModal.loadFailed")}</p>
          ) : current?.text == null ? (
            <p className="text-[0.88rem] text-muted-foreground">{t("docModal.loading")}</p>
          ) : (
            <p className="sr-only">{t("docModal.loaded")}</p>
          )}
        </div>
        {current != null && !current.error && current.text != null && <Markdown body={current.text} />}
      </div>
    </Modal>
  );
}
