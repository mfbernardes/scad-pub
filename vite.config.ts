import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { headStyleInjection } from "./src/lib/configCss";

import { cloudflare } from "@cloudflare/vite-plugin";

// Read the active config's generated schema (written by the predev/prebuild
// gen-schema step) so the page chrome and storage namespace are config-driven.
function readSchema(): {
  title?: string;
  shortName?: string;
  id?: string;
  format?: "3mf" | "stl";
  description?: string;
  themeColor?: string;
  themeColorLight?: string;
  colors?: {
    light?: Record<string, string>;
    dark?: Record<string, string>;
  } | null;
  extraCss?: string | null;
  appleSplash?: { href: string; media: string }[];
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
  // Dark theme-color (used when prefers-color-scheme: dark).
  const darkColor = s.themeColor ?? "#1f2229";
  // Light theme-color (panel surface in light mode).
  const lightColor = s.themeColorLight ?? "#ffffff";
  const appleTitle = s.shortName ?? s.title ?? "ScadPub";
  // iOS launch images — one <link> per generated splash (empty string when none).
  // `media`/`href` are fully derived by gen-schema from a fixed device table
  // (integers) and the `apple-splash-<w>x<h>.png` filename — no config/user input
  // reaches them, so the raw attribute interpolation below is safe.
  const appleSplashLinks = (s.appleSplash ?? [])
    .map((sp) => `<link rel="apple-touch-startup-image" media="${sp.media}" href="${sp.href}" />`)
    .join("\n    ");
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
          .replace(/%APP_THEME_COLOR_DARK%/g, darkColor)
          .replace(/%APP_THEME_COLOR_LIGHT%/g, lightColor)
          .replace(/%APP_APPLE_TITLE%/g, appleTitle)
          .replace(/%APP_APPLE_SPLASH%/g, () => appleSplashLinks)
          // Insert before </head> via a replacer so $-sequences in colour values
          // (there shouldn't be any) are never treated as substitution patterns.
          .replace("</head>", () => `${headInjection}</head>`);
      },
    },
  };
}

// Stamp a per-build version into the shipped service worker. sw.js lives in
// public/ (copied verbatim), so without this every deploy ships a byte-identical
// sw.js — the browser never detects a new worker and the "update available"
// prompt never fires (src/lib/swUpdate.ts only flags an update when a *new* worker
// reaches `waiting`). The version is a hash of every emitted, content-hashed
// chunk/asset filename, so any code or asset change bumps it; it replaces the
// `__SW_VERSION__` placeholder in dist/sw.js after the bundle is written.
function swVersion(): Plugin {
  let outDir = "dist";
  let version = "dev";
  return {
    name: "sw-version",
    apply: "build",
    configResolved(c) {
      outDir = c.build.outDir;
    },
    generateBundle(_options, bundle) {
      version = createHash("sha256")
        .update(Object.keys(bundle).sort().join("\n"))
        .digest("hex")
        .slice(0, 16);
    },
    closeBundle() {
      const swPath = resolve(outDir, "sw.js");
      try {
        const src = readFileSync(swPath, "utf-8");
        if (src.includes("__SW_VERSION__"))
          writeFileSync(swPath, src.replace(/__SW_VERSION__/g, version));
      } catch {
        /* no sw.js in this build (e.g. a non-default target) — skip */
      }
    },
  };
}

// Inject resource hints for the render-critical chunks into the built
// index.html. Two birds:
//  1. Startup speed — the browser fetches the render worker and the lazy
//     three.js Viewer chunk in parallel with the entry instead of discovering
//     them after it executes.
//  2. Deterministic offline — sw.js precaches by parsing index.html's
//     src/href attributes (plus Vite's asset-manifest, which does NOT list
//     worker chunks), so without these links the worker chunk was only ever
//     cached opportunistically at runtime. The links make install-time
//     precache cover everything a render needs.
// Runs at closeBundle (like swVersion) because the chunk names are only known
// once the bundle is emitted; base-aware for subpath deploys.
function preloadLinks(): Plugin {
  let outDir = "dist";
  let base = "/";
  let workerFile: string | null = null;
  let viewerFile: string | null = null;
  return {
    name: "preload-links",
    apply: "build",
    configResolved(c) {
      outDir = c.build.outDir;
      base = c.base;
    },
    generateBundle(_options, bundle) {
      // Worker chunks are emitted by a nested rollup build and reach this hook
      // as plain assets (no chunk.name), so match them by file name.
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (!fileName.endsWith(".js")) continue;
        if (/(?:^|\/)worker-[^/]+\.js$/.test(fileName)) workerFile = fileName;
        if (chunk.type === "chunk" && chunk.name === "Viewer") viewerFile = fileName;
      }
    },
    closeBundle() {
      const htmlPath = resolve(outDir, "index.html");
      const links = [
        // as="worker" warms the actual worker-script fetch.
        workerFile && `<link rel="preload" as="worker" href="${base}${workerFile}" />`,
        viewerFile && `<link rel="modulepreload" href="${base}${viewerFile}" />`,
      ].filter(Boolean);
      if (!links.length) return;
      try {
        const html = readFileSync(htmlPath, "utf-8");
        writeFileSync(htmlPath, html.replace("</head>", () => `  ${links.join("\n    ")}\n  </head>`));
      } catch {
        /* no index.html in this build target — skip */
      }
    },
  };
}

// Defaults to serving at the domain root. Set BASE_PATH to the subpath your
// host serves the app under (e.g. "/app/" for example.com/app/). Dev uses "/".
export default defineConfig(({ command }) => {
  const schema = readSchema();
  return {
    base: command === "build" ? process.env.BASE_PATH || "/" : "/",
    plugins: [react(), tailwindcss(), configHtml(schema), swVersion(), preloadLinks(), cloudflare()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    // Compile-time constants so app modules can namespace storage / set chrome
    // without importing JSON (which Node's test runner can't load untyped).
    define: {
      __APP_ID__: JSON.stringify(schema.id || "scadpub"),
      __APP_THEME_COLOR__: JSON.stringify(schema.themeColor || "#1f2229"),
      // The build-time model format. A literal here lets the viewer's dead
      // loader branch (and its loader import) tree-shake out of the bundle.
      __APP_FORMAT__: JSON.stringify(schema.format || "3mf"),
    },
    worker: { format: "es" },
    build: {
      target: "es2022",
      chunkSizeWarningLimit: 1500,
      manifest: "asset-manifest.json",
    },
  };
});