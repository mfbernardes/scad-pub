// configCss.ts — build-time chrome. Turns the active config's `colors` token map
// and `extraCss` escape hatch into the CSS that vite.config.ts injects into the
// document <head>. Pure string logic with no Vite/Node imports, so it's
// unit-testable in isolation (see tests/configCss.test.mjs) and shared verbatim
// by the build. None of this reaches the client JS bundle.

export interface ConfigChrome {
  /** Per-theme CSS custom-property overrides (token without the `--`, value). */
  colors?: {
    light?: Record<string, string>;
    dark?: Record<string, string>;
  } | null;
  /** Served URL of a consumer-controlled stylesheet, or null. */
  extraCss?: string | null;
}

// Safe shapes for an interpolated token name / colour value. The value set
// mirrors gen-schema.mjs's COLOR_VALUE_RE; both exclude the structural
// characters (`; { } < > " '`) that could end the declaration, close the rule,
// or break out of the <style> element. gen-schema already validates the
// config's `colors` before they reach designs.json, so this is defence-in-depth
// that also keeps colorStyle safe when called standalone — any token whose name
// or value falls outside these sets is dropped rather than emitted.
const SAFE_NAME = /^[A-Za-z0-9_-]+$/;
const SAFE_VALUE = /^[#a-zA-Z0-9 ,.()%/-]+$/;

// A <style> block of the per-theme colour overrides, applied to :root (dark) and
// :root[data-theme="light"]. The doubled `:root:root` bumps specificity above
// index.css's own `:root` / `:root[data-theme="light"]` rules so the overrides
// win regardless of stylesheet source order. Returns "" when nothing is set.
export function colorStyle(colors: ConfigChrome["colors"]): string {
  if (!colors) return "";
  const block = (sel: string, tokens?: Record<string, string>) => {
    const decls = Object.entries(tokens ?? {})
      .filter(([k, v]) => SAFE_NAME.test(k) && SAFE_VALUE.test(v))
      .map(([k, v]) => `  --${k}: ${v};`)
      .join("\n");
    return decls ? `${sel} {\n${decls}\n}` : "";
  };
  const css = [
    block(":root:root", colors.dark),
    block(':root:root[data-theme="light"]', colors.light),
  ]
    .filter(Boolean)
    .join("\n");
  return css ? `<style>\n${css}\n</style>\n` : "";
}

// The full <head> injection: the colour <style> first, then the consumer's
// extraCss <link>. That order — combined with vite's post-order placement after
// the bundled app CSS — means the escape hatch has the final say (it can even
// override the colour tokens) on source order alone. Returns "" when neither is
// configured.
export function headStyleInjection(chrome: ConfigChrome): string {
  const safeHref = chrome.extraCss
    ? chrome.extraCss.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    : "";
  const link = safeHref ? `<link rel="stylesheet" href="${safeHref}" />\n` : "";
  return colorStyle(chrome.colors) + link;
}
