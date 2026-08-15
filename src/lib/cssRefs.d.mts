// Types for cssRefs.mjs, which is plain JS so build scripts (which cannot
// import TypeScript) and the app can share one implementation. Same
// arrangement as showIfSyntax.d.mts.
export function isSameDocumentRef(value: string): boolean;
export const CSS_IMPORT_RE: RegExp;
export const CSS_URL_RE: RegExp;
export function urlRefValue(match: RegExpMatchArray): string;
export function normalizeCssEscapes(css: string): string;
export function cssUnsafeReason(css: string): string;
export function scrubForeignRefs(css: string): { css: string; removed: number };
export function hasForeignRefs(css: string): boolean;
