import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { headStyleInjection, escapeHtml } from "./src/lib/configCss";
import { extractInlineScripts, buildAppHeadersBlock } from "./src/lib/securityHeaders.mjs";
// The build side's one declaration of the two built-in theme colours.
// designs.json always carries a resolved value, so these only apply to a schema
// this file failed to read (dev-server edge cases); re-hardcoding them here
// meant the default lived in four places and could disagree with what
// gen-schema actually emits. src/lib/theme.ts keeps its own last-resort
// literals — app code cannot import from scripts/ — but they are only reached
// when the Vite define and the meta tags are both absent.
import { PWA_THEME_COLOR_DEFAULTS } from "./scripts/lib/config-spec.mjs";
import { readGeneratedSchema, type BuildSchema } from "./scripts/lib/read-schema.mjs";

import { cloudflare } from "@cloudflare/vite-plugin";

// The generated schema drives the page chrome and the storage namespace. Read
// through scripts/lib/read-schema.mjs, whose `strict` flag is the difference
// between a build and the dev server: see that module.
function readSchema(strict = false): Promise<BuildSchema> {
  return readGeneratedSchema(
    fileURLToPath(new URL("./src/generated/designs.json", import.meta.url)),
    strict
  );
}

// Inject title/description/theme-color, the config colour scheme, and any
// consumer `extraCss` into index.html so the page chrome is config-driven (not
// hard-coded to one project). Runs with `order: "post"` so the bundled app CSS
// <link> has already been injected: the colour <style> and the extraCss <link>
// land *after* it, giving consumer styles the final say (the escape hatch can
// override the app's own rules by source order, not only specificity). The CSS
// assembly lives in src/lib/configCss.ts so it's unit-testable without Vite.
function configHtml(s: BuildSchema): Plugin {
  const headInjection = headStyleInjection(s);
  // Dark theme-color (used when prefers-color-scheme: dark).
  const darkColor = s.themeColor ?? PWA_THEME_COLOR_DEFAULTS.dark;
  // Light theme-color (panel surface in light mode).
  const lightColor = s.themeColorLight ?? PWA_THEME_COLOR_DEFAULTS.light;
  // Free-form config strings are HTML-escaped here (they can't be
  // charset-validated like the colours below), and interpolated through
  // function replacers so `$`-sequences in the text are never treated as
  // substitution patterns.
  const title = escapeHtml(s.title ?? "ScadPub");
  const description = escapeHtml(
    s.description ?? "Configure and export designs in your browser."
  );
  const appleTitle = escapeHtml(s.shortName ?? s.title ?? "ScadPub");
  // iOS launch images: one <link> per generated splash (empty string when none).
  // `media`/`href` are fully derived by gen-schema from a fixed device table
  // (integers) and the `apple-splash-<w>x<h>.png` filename: no config/user input
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
          .replace(/%APP_TITLE%/g, () => title)
          .replace(/%APP_LANG%/g, s.lang ?? "en")
          .replace(/%APP_DIR%/g, s.dir ?? "ltr")
          .replace(/%APP_DESCRIPTION%/g, () => description)
          .replace(/%APP_THEME_COLOR_DARK%/g, darkColor)
          .replace(/%APP_THEME_COLOR_LIGHT%/g, lightColor)
          // Per-config theme storage key for the pre-paint script: matches
          // ns("theme") in src/lib/theme.ts (default id → "scadpub.theme").
          // The id lands inside the inline script's string literal; gen-schema
          // charset-validates it (checkId) so it can't break out.
          .replace(/%APP_THEME_KEY%/g, `${s.id ?? "scadpub"}.theme`)
          .replace(/%APP_APPLE_TITLE%/g, () => appleTitle)
          .replace(/%APP_APPLE_SPLASH%/g, () => appleSplashLinks)
          // Insert before </head> via a replacer so $-sequences in colour values
          // (there shouldn't be any) are never treated as substitution patterns.
          .replace("</head>", () => `${headInjection}</head>`);
      },
    },
  };
}

// "This build target has no such file", the only failure the closeBundle
// plugins below may swallow. Everything else is a broken build that would
// otherwise exit 0 having silently dropped the service-worker version stamp or
// the app's CSP block.
function isEnoent(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === "ENOENT";
}

// Every file under `dir`, recursively, as absolute paths.
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(abs));
    else out.push(abs);
  }
  return out;
}

// Stamp a per-build version into the shipped service worker. sw.js lives in
// public/ (copied verbatim), so without this every deploy ships a byte-identical
// sw.js: the browser never detects a new worker and the "update available"
// prompt never fires (src/lib/swUpdate.ts only flags an update when a *new* worker
// reaches `waiting`). The version hashes every emitted chunk/asset's CONTENT
// (not only its content-hashed filename, which only changes for assets Vite
// itself fingerprints) plus every file under public/, so a stable-URL asset
// like extraCss, a design's <id>-doc.md, an icon, or the manifest also bumps
// it. sw.js itself is excluded (it's what we're about to rewrite). Replaces
// the `__SW_VERSION__` placeholder in dist/sw.js after the bundle is written.
function swVersion(): Plugin {
  let outDir = "dist";
  let publicDir = "";
  let version = "dev";
  return {
    name: "sw-version",
    apply: "build",
    configResolved(c) {
      outDir = c.build.outDir;
      publicDir = c.publicDir;
    },
    generateBundle(_options, bundle) {
      const h = createHash("sha256");
      for (const [fileName, output] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        h.update(fileName);
        h.update(output.type === "chunk" ? output.code : output.source);
      }
      // public/wasm is ~10 MB, but hashing it is cheap next to the download itself.
      if (publicDir) {
        const swJs = join(publicDir, "sw.js");
        for (const abs of filesUnder(publicDir).sort()) {
          if (abs === swJs) continue;
          h.update(relative(publicDir, abs));
          h.update(readFileSync(abs));
        }
      }
      version = h.digest("hex").slice(0, 16);
    },
    closeBundle() {
      const swPath = resolve(outDir, "sw.js");
      try {
        const src = readFileSync(swPath, "utf-8");
        if (src.includes("__SW_VERSION__"))
          writeFileSync(swPath, src.replace(/__SW_VERSION__/g, version));
      } catch (e) {
        // Only "there is no sw.js in this build target" is expected. Anything
        // else — an unwritable dist, a read error — used to be swallowed, and
        // shipping an unversioned sw.js means updates are never detected at
        // all, silently, from a build that exited 0.
        if (!isEnoent(e)) throw e;
      }
    },
  };
}

// Inject resource hints for the render-critical chunks into the built
// index.html. Two birds:
//  1. Startup speed: the browser fetches the render worker and the lazy
//     three.js Viewer chunk in parallel with the entry instead of discovering
//     them after it executes.
//  2. Deterministic offline: sw.js derives its asset list by parsing
//     index.html (plus Vite's asset-manifest, which does NOT list worker
//     chunks), so without these links the worker chunk was only ever cached
//     opportunistically at runtime. The links let warmSupplementary discover
//     it. Install deliberately skips them — fetching them there is the boot
//     stall the warm-up brake exists to prevent.
//
// Hence WARM_ATTR on both: sw.js cannot tell these hints apart from Vite's own
// `rel="modulepreload"` links by `rel` alone, and Vite emits one for every
// chunk the ENTRY statically imports. Those are boot-critical — the entry
// cannot execute without them — so classifying all modulepreloads as
// supplementary left the install shell unable to boot offline. The attribute is
// the only signal that says "this hint is for a chunk the app loads later".
// Runs at closeBundle (like swVersion) because the chunk names are only known
// once the bundle is emitted; base-aware for subpath deploys.
// Marks a resource hint as "the app loads this later" for sw.js's install
// classification. A bare data attribute: valid HTML, ignored by the browser,
// and the string sw.js's WARM_HINT_RE looks for. Keep the two in step.
const WARM_ATTR = "data-warm";

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
        workerFile && `<link rel="preload" as="worker" ${WARM_ATTR} href="${base}${workerFile}" />`,
        viewerFile && `<link rel="modulepreload" ${WARM_ATTR} href="${base}${viewerFile}" />`,
      ].filter(Boolean);
      if (!links.length) return;
      try {
        const html = readFileSync(htmlPath, "utf-8");
        writeFileSync(htmlPath, html.replace("</head>", () => `  ${links.join("\n    ")}\n  </head>`));
      } catch (e) {
        if (!isEnoent(e)) throw e; // no index.html in this build target: skip
      }
    },
  };
}

// Appends the app-document security headers (CSP + clickjacking/MIME-sniffing/
// referrer/permissions hardening) to dist/_headers at build time. The CSP's
// script-src needs the exact hash of the inline pre-paint theme script in
// index.html, and that script's body is per-config (%APP_THEME_KEY% is the
// active config's storage namespace, substituted by configHtml above), so the
// hash can't be a literal here, it's computed from the actual built HTML.
// Runs at closeBundle, like swVersion/preloadLinks, because dist/index.html
// and dist/_headers (copied from public/) only exist once the bundle, and
// every other index.html-mutating plugin: has already run; ordering after
// preloadLinks (the last index.html mutator above) keeps this hashing the
// final bytes, though preloadLinks only ever touches <link> tags, never
// <script>, so today the ordering doesn't change the hash either way.
//
// Deliberately APPENDS a `/*` block after public/_headers's own content
// rather than replacing it: on Cloudflare Pages (and Netlify) every matching
// rule applies to a request, so `/scad/*` still gets both its own restrictive
// `default-src 'none'; sandbox` block AND this `/*` block. The browser
// enforces the intersection of the two CSPs, which is only ever MORE
// restrictive than either alone, never a weakening. See
// src/lib/securityHeaders.mjs for the policy itself and its rationale.
function securityHeaders(): Plugin {
  let outDir = "dist";
  return {
    name: "security-headers",
    apply: "build",
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const htmlPath = resolve(outDir, "index.html");
      const headersPath = resolve(outDir, "_headers");
      try {
        const html = readFileSync(htmlPath, "utf-8");
        const existing = readFileSync(headersPath, "utf-8");
        const hashes = extractInlineScripts(html).map(
          (body) => `sha256-${createHash("sha256").update(body, "utf8").digest("base64")}`
        );
        const block = buildAppHeadersBlock(hashes);
        writeFileSync(headersPath, `${existing.replace(/\n*$/, "\n")}\n${block}`);
      } catch (e) {
        // A host with no Cloudflare/Netlify _headers convention has no
        // dist/_headers to append to, which is fine. Any other failure drops
        // the entire app CSP block from a build that still exits 0.
        if (!isEnoent(e)) throw e;
      }
    },
  };
}

// Defaults to serving at the domain root. Set BASE_PATH to the subpath your
// host serves the app under (e.g. "/app/" for example.com/app/). Dev uses "/".
export default defineConfig(async ({ command }) => {
  const schema = await readSchema(command === "build");
  return {
    base: command === "build" ? process.env.BASE_PATH || "/" : "/",
    plugins: [
      react(),
      tailwindcss(),
      configHtml(schema),
      swVersion(),
      preloadLinks(),
      securityHeaders(),
      cloudflare(),
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    // Compile-time constants so app modules can namespace storage / set chrome
    // without importing JSON (which Node's test runner can't load untyped).
    define: {
      __APP_ID__: JSON.stringify(schema.id || "scadpub"),
      __APP_THEME_COLOR__: JSON.stringify(schema.themeColor || PWA_THEME_COLOR_DEFAULTS.dark),
      // The build-time model format. A literal here lets the viewer's dead
      // loader branch (and its loader import) tree-shake out of the bundle.
      __APP_FORMAT__: JSON.stringify(schema.format || "3mf"),
      // Whether the viewer rests a model's base on the z=0 grid (true) or
      // centres it on the origin in all three axes (false, the default). A
      // literal so the unused centring branch in the viewer drops out.
      __APP_REST_ON_GRID__: JSON.stringify(schema.viewer?.restOnGrid ?? false),
      // The viewer's presentation (config `viewer.style`). A literal so the
      // unused style branch, and, for "plain", the studio-only
      // environment/shadow modules: tree-shake out of the bundle. The
      // reference grid is not a define: it's a runtime toggle seeded by
      // `viewer.grid` (src/lib/viewerPrefs.ts).
      __APP_VIEWER_STYLE__: JSON.stringify(schema.viewer?.style ?? "plain"),
    },
    // `as const` because the factory is async now (it awaits the schema read so
    // strict validation can import the app's own validator): a Promise return
    // loses the contextual UserConfig type that used to narrow this literal.
    worker: { format: "es" as const },
    build: {
      target: "es2022",
      chunkSizeWarningLimit: 1500,
      manifest: "asset-manifest.json",
    },
  };
});