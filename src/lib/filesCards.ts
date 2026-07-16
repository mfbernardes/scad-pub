// filesCards.ts — pure derivation behind the Files tab's schema-driven task
// cards (PR19 item 1): a design's own params decide which cards are even
// relevant, so a design with no `@font`/`@svg` params never shows copy about
// a file type it doesn't use. Kept dependency-free (no React) so it's a plain
// unit-testable function, mirroring readiness.ts's own "pure derivation, UI
// reads it" split.
import type { AttentionItem } from "./readiness";
import type { Param } from "../openscad/types";

export interface FilesCardsInfo {
  /** Whether the design has at least one visible-in-schema `font` param
   *  (string or enum, `isFont: true`) — gates the Files tab's font card. */
  showFontCard: boolean;
  /** Whether the design has at least one `@svg` param — gates the Files
   *  tab's SVG/graphics card. */
  showSvgCard: boolean;
}

/** Which task cards the Files tab should show for this design's params. */
export function deriveFilesCards(params: Param[]): FilesCardsInfo {
  let showFontCard = false;
  let showSvgCard = false;
  for (const p of params) {
    if ((p.type === "string" || p.type === "enum") && p.isFont) showFontCard = true;
    if (p.type === "string" && p.svg) showSvgCard = true;
  }
  return { showFontCard, showSvgCard };
}

/**
 * The missing font families named by `attention` (src/lib/readiness.ts's
 * `deriveAttention`), in order. Reused rather than re-derived so the Files
 * tab's font card can never disagree with the Customize tab's attention chip
 * / FontMissingHint about what counts as "not loaded" — same predicate, same
 * live input, computed once in AppShell.
 */
export function missingFontFamilies(attention: AttentionItem[]): string[] {
  const families: string[] = [];
  for (const item of attention) {
    if (item.kind === "font-fallback") families.push(item.family);
  }
  return families;
}
