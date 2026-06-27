// share.ts — thin wrappers over the Web Share API (OUTBOUND sharing): hand a
// link or an exported model file to the OS share sheet on capable devices
// (mobile especially). Each reports how it went so callers can fall back to
// clipboard / download. This is distinct from the manifest share_target /
// file_handlers (INBOUND), which this app has no place to route content to.

export type ShareOutcome = "shared" | "cancelled" | "unsupported" | "failed";

function outcomeFromError(e: unknown): ShareOutcome {
  // A user dismissing the share sheet rejects with AbortError — not a failure,
  // and the caller must NOT then fall back (the user already declined).
  return (e as { name?: string })?.name === "AbortError" ? "cancelled" : "failed";
}

/** Share a URL via the native share sheet. "unsupported" → fall back to clipboard. */
export async function shareUrl(url: string, title?: string): Promise<ShareOutcome> {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function")
    return "unsupported";
  try {
    await navigator.share(title ? { url, title } : { url });
    return "shared";
  } catch (e) {
    return outcomeFromError(e);
  }
}

/** Share a file (e.g. an exported model). "unsupported" → fall back to download. */
export async function shareFile(file: File, title?: string): Promise<ShareOutcome> {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.share !== "function" ||
    typeof navigator.canShare !== "function" ||
    !navigator.canShare({ files: [file] })
  )
    return "unsupported";
  try {
    await navigator.share(title ? { files: [file], title } : { files: [file] });
    return "shared";
  } catch (e) {
    return outcomeFromError(e);
  }
}
