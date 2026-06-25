// safeUrl.ts — gate links built from config-derived content (help text,
// filePrompts[].url) before they reach an href. Returns the URL when its protocol
// can't execute script — http:, https:, mailto:, or a relative/protocol-
// relative reference — and undefined for anything else (javascript:, data:,
// etc.). The config is normally trusted, so this is defence-in-depth for the
// generic-publisher case where help/link content may be less tightly controlled.
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function safeUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  // Browsers ignore leading/embedded control chars and whitespace when parsing
  // a scheme (so "java\tscript:" still runs); strip them before inspecting it.
  const stripped = url.replace(/[\u0000-\u0020]/g, "");
  const scheme = stripped.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!scheme) return url; // relative or protocol-relative reference — safe
  return SAFE_PROTOCOLS.has(`${scheme[1].toLowerCase()}:`) ? url : undefined;
}
