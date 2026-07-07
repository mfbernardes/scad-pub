// DesignDocModal.tsx — shows a single design's own user documentation. Unlike
// the app-global HelpModal (how the configurator works), this is scoped to the
// active design: its Markdown doc lives beside the .scad and is copied to a
// served URL (design.doc) by gen-schema. It's fetched on open (kept out of the
// initial designs.json to keep that lean) and rendered through the same safe
// Markdown subset — now including `#`/`##`/`###` headings.
import { useEffect, useState } from "react";
import type { Design } from "../openscad/types";
import { assetUrl } from "../lib/assetUrl";
import { cn } from "../lib/utils";
import { Modal, MODAL_BODY } from "./Modal";
import { Markdown } from "./Markdown";

// Typography for the doc body (the Markdown renderer emits bare h2/h3/h4/p/ul).
// Mirrors HelpModal's HELP_BODY, extended to cover the heading levels a full doc
// uses. Kept local — the doc modal is the only consumer.
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
  design: Design;
  onClose: () => void;
}) {
  // idle→loading→(text|error). `design.doc` is guaranteed by the caller (the
  // trigger only renders when it's set), but we guard defensively.
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!design.doc) return;
    let cancelled = false;
    setText(null);
    setError(false);
    fetch(assetUrl(design.doc))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((body) => {
        if (!cancelled) setText(body);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [design.doc]);

  return (
    <Modal title={`About the ${design.label}`} label={`${design.label} guide`} onClose={onClose}>
      <div className={DOC_BODY} tabIndex={0}>
        {error ? (
          <p className="text-[0.88rem] text-muted-foreground">
            Couldn't load this design's documentation. Check your connection and try again.
          </p>
        ) : text === null ? (
          <p className="text-[0.88rem] text-muted-foreground">Loading…</p>
        ) : (
          <Markdown body={text} />
        )}
      </div>
    </Modal>
  );
}
