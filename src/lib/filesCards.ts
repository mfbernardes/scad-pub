// filesCards.ts — pure derivation behind the Files tab's schema-driven task
// cards (PR19 item 1; simplified to exactly two cards in the round-2 review
// pass): a design's own params — plus, for the graphic card, the `fileImport`
// config — decide which cards are even relevant, so a design with no
// `@font`/`@svg` params never shows copy about a file type it doesn't use.
// Kept dependency-free (no React) so it's a plain unit-testable function,
// mirroring readiness.ts's own "pure derivation, UI reads it" split.
import type { AttentionItem } from "./readiness";
import type { FileImport, Param } from "../openscad/types";

export interface FilesCardsInfo {
  /** Whether the design has at least one visible-in-schema `font` param
   *  (string or enum, `isFont: true`) — gates the Files tab's font card. */
  showFontCard: boolean;
  /**
   * Whether the Files tab's graphic card should show: the design has an
   * `@svg` param, i.e. it genuinely consumes an SVG via `import()`. This is
   * per-design on purpose (the round-2 review's "Custom graphic … for designs
   * that support it"): a font-only or plain design never invites "Import an
   * SVG graphic" just because the deployment's `fileImport.accept` happens to
   * admit SVGs globally. `fileImport` still gates whether the tab exists at
   * all and supplies the picker's accept filter (see `graphicAccept`).
   */
  showGraphicCard: boolean;
}

const SVG_ACCEPT_DEFAULT = ".svg,image/svg+xml";

/** Which task cards the Files tab should show, given this design's params.
 *  `fileImport` is unused for the card-visibility decision (it gates the tab
 *  itself and the picker accept filter elsewhere) but kept in the signature
 *  so callers can pass what they already have without branching. */
export function deriveFilesCards(params: Param[], _fileImport?: FileImport | null): FilesCardsInfo {
  let showFontCard = false;
  let hasSvgParam = false;
  for (const p of params) {
    if ((p.type === "string" || p.type === "enum") && p.isFont) showFontCard = true;
    if (p.type === "string" && p.svg) hasSvgParam = true;
  }
  return { showFontCard, showGraphicCard: hasSvgParam };
}

/**
 * The graphic card's file-picker `accept` filter: `fileImport.accept`
 * narrowed down to just its SVG-relevant comma-separated tokens (so a config
 * scoped broadly, or to unrelated extensions alongside ".svg", never hands
 * the picker something that doesn't belong on an "Import SVG" button),
 * falling back to the plain SVG default when nothing configured survives the
 * filter — including when `accept` is unset entirely.
 */
export function graphicAccept(fileImportAccept: string | undefined): string {
  if (!fileImportAccept) return SVG_ACCEPT_DEFAULT;
  const svgTokens = fileImportAccept
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token && /svg/i.test(token));
  return svgTokens.length ? svgTokens.join(",") : SVG_ACCEPT_DEFAULT;
}

/**
 * The missing font families named by `attention` (src/lib/readiness.ts's
 * `deriveAttention`), in order. Reused rather than re-derived so the Files
 * tab's font card can never disagree with the Review stage's warning card
 * about what counts as "not loaded" — same predicate, same
 * live input, computed once in AppShell.
 */
export function missingFontFamilies(attention: AttentionItem[]): string[] {
  const families: string[] = [];
  for (const item of attention) {
    if (item.kind === "font-fallback") families.push(item.family);
  }
  return families;
}
