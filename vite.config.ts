import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { headStyleInjection } from "./src/lib/configCss";

// Read the active config's generated schema (written by the predev/prebuild
// gen-schema step) so the page chrome and storage namespace are config-driven.
function readSchema(): {
  title?: string;
  id?: string;
  description?: string;
  themeColor?: string;
  colors?: {
    light?: Record<string, string>;
    dark?: Record<string, string>;
  } | null;
  extraCss?: string | null;
} {
  try {
    return JSON.parse(
      readFileSync(
        fileURLToPath(new URL("./src/generated/designs.json", import.meta.url)),
        "utf-8"
      )
    );
  } catch {
    return {};
  }
}

// Inject title/description/theme-color, the config colour scheme, and any
// consumer `extraCss` into index.html so the page chrome is config-driven (not
// hard-coded to one project). Runs with `order: "post"` so the bundled app CSS
// <link> has already been injected: the colour <style> and the extraCss <link>
// land *after* it, giving consumer styles the final say (the escape hatch can
// override the app's own rules by source order, not just specificity). The CSS
// assembly lives in src/lib/configCss.ts so it's unit-testable without Vite.
function configHtml(s: ReturnType<typeof readSchema>): Plugin {
  const headInjection = headStyleInjection(s);
  return {
    name: "config-html",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return html
          .replace(/%APP_TITLE%/g, s.title ?? "ScadPub")
          .replace(
            /%APP_DESCRIPTION%/g,
            s.description ?? "Configure and export designs in your browser."
          )
          .replace(/%APP_THEME_COLOR%/g, s.themeColor ?? "#1f2229")
          // Insert before </head> via a replacer so $-sequences in colour values
          // (there shouldn't be any) are never treated as substitution patterns.
          .replace("</head>", () => `${headInjection}</head>`);
      },
    },
  };
}

// Defaults to serving at the domain root. Set BASE_PATH to the subpath your
// host serves the app under (e.g. "/app/" for example.com/app/). Dev uses "/".
export default defineConfig(({ command }) => {
  const schema = readSchema();
  return {
    base: command === "build" ? process.env.BASE_PATH || "/" : "/",
    plugins: [react(), configHtml(schema)],
    // Compile-time constants so app modules can namespace storage / set chrome
    // without importing JSON (which Node's test runner can't load untyped).
    define: {
      __APP_ID__: JSON.stringify(schema.id || "scadpub"),
      __APP_THEME_COLOR__: JSON.stringify(schema.themeColor || "#1f2229"),
    },
    worker: { format: "es" },
    build: {
      target: "es2022",
      chunkSizeWarningLimit: 1500,
      manifest: "asset-manifest.json",
    },
  };
});
