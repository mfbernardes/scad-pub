// share.ts — thin wrappers over the Web Share API (OUTBOUND sharing): hand a
// link or an exported model file to the OS share sheet on capable devices
// (mobile especially). Each reports how it went so callers can fall back to
// clipboard / download. This is distinct from the manifest share_target /
// file_handlers (INBOUND), which this app has no place to route content to.

export type ShareOutcome = "shared" | "cancelled" | "unsupported" | "failed";

// The Web Share API also exists on desktop, but routing an export or a link to
// the OS share sheet there is worse than a plain download / clipboard copy — the
// user can't actually get the file into Downloads. Restrict outbound sharing to
// touch devices: a coarse pointer with no hover is the signal for a phone/tablet
// rather than a mouse-driven desktop (a merely-narrow desktop window still reads
// as desktop here, unlike a viewport-width breakpoint).
function isTouchDevice(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse) and (hover: none)").matches
  );
}

/** Whether shareUrl()/shareFile() would actually attempt the native OS share
 *  sheet on this device (a touch device exposing `navigator.share`) rather
 *  than falling straight to clipboard/download — the same test those
 *  functions apply internally. ActionButtons uses this to pick an icon and
 *  aria-label that match the Share button's real behavior instead of always
 *  implying "copy a link". The capability doesn't change mid-session, so
 *  callers can compute it once (e.g. a module-level constant) rather than
 *  re-checking on every render. */
export function canShareNatively(): boolean {
  return (
    isTouchDevice() &&
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function"
  );
}

function outcomeFromError(e: unknown): ShareOutcome {
  // A user dismissing the share sheet rejects with AbortError — not a failure,
  // and the caller must NOT then fall back (the user already declined).
  return (e as { name?: string })?.name === "AbortError" ? "cancelled" : "failed";
}

/** Share a URL via the native share sheet. "unsupported" → fall back to clipboard. */
export async function shareUrl(url: string, title?: string): Promise<ShareOutcome> {
  if (!isTouchDevice()) return "unsupported"; // desktop → copy to clipboard instead
  if (typeof navigator === "undefined" || typeof navigator.share !== "function")
    return "unsupported";
  try {
    await navigator.share(title ? { url, title } : { url });
    return "shared";
  } catch (e) {
    return outcomeFromError(e);
  }
}

/** Share a file via the sheet, or run the caller's save/download fallback when
 *  sharing is unavailable or fails. A user-cancelled sheet does NOT fall back
 *  (the user already declined) — callers stop announcing on "cancelled". */
export async function shareFileOrFallback(
  file: File,
  fallback: () => void
): Promise<"shared" | "cancelled" | "fell-back"> {
  const outcome = await shareFile(file, file.name);
  if (outcome === "cancelled") return "cancelled";
  if (outcome === "shared") return "shared";
  fallback();
  return "fell-back";
}

/** Share a file (e.g. an exported model). "unsupported" → fall back to download. */
export async function shareFile(file: File, title?: string): Promise<ShareOutcome> {
  if (!isTouchDevice()) return "unsupported"; // desktop → download instead
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
