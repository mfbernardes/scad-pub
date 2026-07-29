// Hand-written types for securityHeaders.mjs (plain-ESM shared module), so
// vite.config.ts can import it typed. Mirrors fontNameTable.d.mts's role.
export function extractInlineScripts(html: string): string[];
export function buildAppHeadersBlock(scriptHashes: string[]): string;

export interface HeaderRule {
  pattern: string;
  headers: [string, string][];
}

export function parseHeadersFile(text: string): HeaderRule[];
export function headersFor(rules: HeaderRule[], pathname: string): Record<string, string>;
