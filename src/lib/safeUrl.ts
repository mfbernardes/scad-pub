// safeUrl.ts: gate links built from config-derived content (help text,
// Markdown links) before they reach an href. Returns the URL when its protocol
// can't execute script: http:, https:, mailto:, or a same-document/relative
// reference, and undefined for anything else (javascript:, data:,
// protocol-relative //host/x, etc.). The config is normally trusted, so this
// is defence-in-depth for the generic-publisher case where help/link content
// may be less tightly controlled.
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function safeUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  // Browsers ignore leading/embedded control chars and whitespace when parsing
  // a scheme (so "java\tscript:" still runs); strip them before inspecting it.
  // eslint-disable-next-line no-control-regex -- deliberately stripping control chars, see comment above
  const stripped = url.replace(/[\u0000-\u0020]/g, "");
  // "//host/x" has no scheme but still navigates cross-origin under the page's
  // current protocol, so it can't be waved through as "relative". The URL
  // spec folds `\` to `/` for special schemes, so "\\host", "/\host" and
  // "\/host" resolve the same way and are stripped-equivalent here (backslash
  // survives the control-char strip above): reject any two leading slashes of
  // either kind.
  if (/^[/\\]{2}/.test(stripped)) return undefined;
  const scheme = stripped.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!scheme) return url; // relative reference (no scheme, no leading //): safe
  return SAFE_PROTOCOLS.has(`${scheme[1].toLowerCase()}:`) ? url : undefined;
}
