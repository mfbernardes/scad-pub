// exportOutcome.ts — pure logic behind the after-export success panel
// (src/components/ExportSuccess.tsx): mapping App.tsx's real export outcome to
// wording, how long the panel stays up, and whether the one-time install hint
// still gets to fire. Kept framework/schema-free so tests/exportOutcome.test.mjs
// can exercise every branch directly.
//
// THE HONESTY CALL: src/lib/share.ts's shareFileOrFallback resolves "shared"
// once navigator.share()'s own promise resolves — which the Web Share API
// spec only guarantees means the OS handed the file off to whichever app the
// user picked, NOT that the user finished anything there (Mail could still be
// sitting open with the attachment; AirDrop could still be transferring). That
// is, in effect, indistinguishable from "the share sheet was used" rather than
// a verified "the model reached its destination". Rather than overclaim with
// "Share completed", the share path uses the same modest `export.readyToShare`
// wording as the fallback-download path would if it couldn't confirm either —
// see exportOutcomeTitleKey below. The pre-seeded `export.shareCompleted`
// catalogue key was dropped from both locale bundles as a result (nothing
// honestly warranted it).

/** The two outcomes that reach the after-export panel. `shareFileOrFallback`'s
 *  third possible outcome, "cancelled" (the user dismissed the share sheet),
 *  never reaches here — App.tsx's exportModel returns immediately on it
 *  without touching any export-success state, exactly as before this panel
 *  existed. */
export type ExportOutcomeKind = "shared" | "downloaded";

/** The i18n key for the panel's outcome-led title. */
export function exportOutcomeTitleKey(outcome: ExportOutcomeKind): string {
  // "shared" -> readyToShare, not shareCompleted: see the file doc above.
  return outcome === "shared" ? "export.readyToShare" : "export.downloaded";
}

/** How long the panel stays up before auto-dismissing: generous on the very
 *  first export this browser has ever seen (the visitor's attention is
 *  already on the export they just triggered, and the panel is new to them),
 *  quieter on every export after that (they've seen it; don't linger). */
export function afterExportAutoHideMs(isFirstShow: boolean): number {
  return isFirstShow ? 15000 : 6000;
}

/** Precedence between the after-export panel and the one-time install-hint
 *  toast (App.tsx's offerInstallHint): the simplest honest rule that can
 *  never stack the two on the same export is to hand the install hint the
 *  export entirely when the after-export feature isn't configured at all.
 *  When `ui.afterExport` IS configured, the panel is the export's one and
 *  only post-export surface, on every export, not just the first — the
 *  install hint stays silent for that deployment's exports rather than
 *  trying to time-share a single export event with the panel. */
export function shouldOfferInstallHint(afterExportConfigured: boolean): boolean {
  return !afterExportConfigured;
}
