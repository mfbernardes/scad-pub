// gen-schema.mjs — derive the configurator's parameter schema from a directory
// of OpenSCAD designs, parsing OpenSCAD's own Customizer syntax
// (SECTION_RE / PARAM_RE, skipping the [Hidden] section). Generic: the source
// directory, the design list, the always-on OpenSCAD features and the bundled
// fonts all come from scadpub.config.json (override with SCADPUB_CONFIG).
//
// For each design it parses the Customizer parameters and gathers the shared
// .scad the renderer needs, copying them (preserving their relative paths) into
// public/scad/ so the in-browser renderer can mount them. Dependencies come from
// the config's `assets` list (files, whole directories like "lib", or globs like
// "lib/*.scad" / "**/*.svg"); when that is omitted it falls back to following
// each design's `use`/`include` graph. Run
// via the `prebuild`/`predev` npm hooks so the UI never drifts from the source.
//
// `generate()` is exported (and pure-ish: all I/O paths are arguments) so the
// unit tests can drive it against fixtures; running the file directly builds the
// real schema.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  statSync,
  existsSync,
  rmSync,
  renameSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { WASM_VERSION } from "./wasm-version.mjs";
import { computeRenderHash, computeBinAssetVersions } from "./lib/hash.mjs";
import { fontFaces, fontFamilyNames, parseFontFallback, renderFontsConf } from "./lib/fonts.mjs";
import { humanize, parseParams } from "./lib/params.mjs";
import { createAssetTools } from "./lib/assets.mjs";
import { createDestinationRegistry, reconcileGenerated } from "./lib/destinations.mjs";
import { sanitizeSvg } from "./lib/svg-sanitize.mjs";
import { resolveWorkerDependencyClosure } from "./lib/worker-deps.mjs";
import { generatePwaAssets } from "./lib/pwa-assets.mjs";
import {
  COLOR_VALUE_RE,
  parseColors,
  parseDir,
  parseFileImport,
  parseFormat,
  parseRestOnGrid,
  parseLang,
  parseLicenses,
  parseNotices,
  parsePopup,
  parseRender,
  parseUi,
} from "./lib/config-parsers.mjs";

// Re-export the parsers/helpers the unit tests (tests/gen-schema.test.mjs)
// import from this entry, so the module split is invisible to the test suite.
export {
  COLOR_TOKENS,
  parseColors,
  parseDir,
  parseFileImport,
  parseFormat,
  parseRestOnGrid,
  parseLang,
  parseLicenses,
  parseNotices,
  parsePopup,
  parseRender,
  parseUi,
} from "./lib/config-parsers.mjs";
export { parseFontFallback, renderFontsConf, fontFamilyNames } from "./lib/fonts.mjs";
export { firstSentence, parseEnumHint, parseParams } from "./lib/params.mjs";

// Every top-level key gen-schema (or its helpers) reads from scadpub.config.json.
// A key outside this set is almost always a typo (`popups`, `fontfallback`, …)
// that would otherwise be silently ignored, so — matching gen-schema's fail-fast
// convention for unknown *nested* keys (colour tokens, license fields) — an
// unrecognised top-level key fails the build. `$schema` is allowed so a config
// can point at a JSON Schema for editor tooling without tripping the check.
export const KNOWN_TOP_LEVEL_KEYS = new Set([
  "$schema",
  // App identity & PWA chrome
  "title", "shortName", "id", "description", "lang", "dir",
  "icon", "iconMaskable", "themeColor", "themeColorLight", "backgroundColor",
  "categories", "screenshots", "shortcuts",
  // Design sources
  "source", "designs", "defaultDesign", "assets",
  // Rendering
  "features", "format", "restOnGrid", "fonts", "fontFallback", "render",
  // Appearance & UI behaviour
  "logo", "colors", "extraCss", "ui", "fileImport",
  // In-app content
  "popup", "help", "notices", "licenses",
]);

// Fail early and clearly when a configured path doesn't exist — these are the
// most common ways a config drifts from the designs it points at.
const makeMustExist = (configPath) => (abs, what) => {
  if (!existsSync(abs))
    throw new Error(
      `gen-schema: ${what} not found:\n  ${abs}\n` +
        `  (referenced from ${configPath} — check its source/assets/designs/logo/icon)`
    );
  return abs;
};

// An id namespaces storage and is interpolated into a default filename
// (`${id}.scad`), the URL deep link (`#d=${id}`), manifest shortcuts, and —
// for the app-level id — the theme key inside index.html's inline pre-paint
// <script> string literal, so restrict it to a safe, path/URL/script-friendly
// character set. Used for both the app id and every design id.
const checkId = (id, what = "design id") => {
  if (typeof id !== "string" || !/^[A-Za-z0-9._-]+$/.test(id))
    throw new Error(
      `gen-schema: ${what} ${JSON.stringify(id)} must match [A-Za-z0-9._-]+`
    );
  return id;
};

// A top-level array-of-strings config key (categories, features): absent ->
// [], otherwise every entry must be a non-empty string. Used for keys that
// are interpolated verbatim into generated output (the manifest, `--enable`
// render flags), so a stray non-string would otherwise surface as a cryptic
// downstream failure instead of a clear config error.
const parseStringArray = (raw, key) => {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string" || !v.trim()))
    throw new Error(`gen-schema: '${key}' must be an array of non-empty strings (got ${JSON.stringify(raw)})`);
  return raw;
};

// Load + sanity-check the config. Catches typo'd / stale top-level keys before
// doing any work — a whole-key typo would otherwise be silently ignored (see
// KNOWN_TOP_LEVEL_KEYS).
function loadConfig(configPath) {
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  for (const key of Object.keys(config)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key))
      throw new Error(
        `gen-schema: unknown config key '${key}' in ${configPath}.\n` +
          `  Valid keys: ${[...KNOWN_TOP_LEVEL_KEYS].filter((k) => k !== "$schema").join(", ")}`
      );
  }
  return config;
}

// ── App identity & PWA chrome ───────────────────────────────────────────────
// (icon/iconMaskable/screenshots/shortcuts are consumed by generatePwaAssets.)
function parseIdentity(config) {
  const TITLE = config.title ?? "ScadPub";
  const SHORT_NAME = config.shortName ?? TITLE;
  const ID = checkId(config.id ?? "scadpub", "config 'id'");
  const DESCRIPTION =
    config.description ?? "Configure and export designs in your browser.";
  // Document / manifest language and text direction. Default "en" / "ltr"
  // (the previously hard-coded values). Validated so they're safe to interpolate
  // into the generated <html lang dir> attributes and the manifest.
  const LANG = parseLang(config.lang);
  const DIR = parseDir(config.dir);
  // PWA / browser chrome colours (default to the dark palette's chrome).
  // Validated like every other colour input (COLOR_VALUE_RE) so they stay safe
  // when interpolated into generated SVG/HTML attributes.
  const THEME_COLOR = config.themeColor ?? "#1f2229";
  const THEME_COLOR_LIGHT = config.themeColorLight ?? "#ffffff";
  const BG_COLOR = config.backgroundColor ?? "#15171c";
  for (const [key, val] of [
    ["themeColor", THEME_COLOR],
    ["themeColorLight", THEME_COLOR_LIGHT],
    ["backgroundColor", BG_COLOR],
  ]) {
    if (typeof val !== "string" || !COLOR_VALUE_RE.test(val.trim()))
      throw new Error(`gen-schema: '${key}' must be a CSS colour string (got ${JSON.stringify(val)})`);
  }
  const CATEGORIES = parseStringArray(config.categories, "categories");
  return { TITLE, SHORT_NAME, ID, DESCRIPTION, LANG, DIR, THEME_COLOR, THEME_COLOR_LIGHT, BG_COLOR, CATEGORIES };
}

// ── Rendering: bundled fonts ────────────────────────────────────────────────
// Fonts are referenced by basename under /fonts. An entry is either a font
// already present in public/fonts (the Liberation fallbacks that ship with the
// app) or a path into the source tree (a design repo bundling its own font),
// which we copy into public/fonts so it is served like the rest. Also writes
// the fontconfig config the renderer mounts — optionally pinning a weak
// last-resort fallback family (config.fontFallback) so an imported font can't
// hijack Fontconfig's global default; generated into the served tree (and
// hashed into renderHash) so the matching rules stay config-driven.
// `register`/`checkContained` are the H5/H6 helpers from createAssetTools:
// a source-tree font is checked against SOURCE containment (a font path is a
// source-owned path, like a design or asset) and its destination is
// registered so two `fonts` entries that share a basename from different
// source directories collide loudly instead of one silently overwriting the
// other. `fontCopies` collects every dest this call actually wrote — the
// tracked Liberation fallbacks under public/fonts are never written here (the
// "already present" branch below is a no-op), so they never enter the list
// and stay outside the M8 generated-font lifecycle the caller reconciles.
function bundleFonts(config, SOURCE, outPublicDir, configPath, { checkContained, register, fontCopies } = {}) {
  // The font tree is generated output too, so — like the scad tree — it is
  // validated, digested and family/face-read here but NOT written into the live
  // public/fonts until generate()'s commit point (see the caller). Otherwise a
  // later fallible step (design parsing, asset validation, PWA rasterization)
  // would leave a replaced font (or a rewritten fonts.conf) paired with the
  // PREVIOUS build's scad/schema — an internally inconsistent last-good set.
  // `fontWrites` are the deferred source->dest copies; `fontsConf` is the
  // rendered config content to write at commit; `fontPaths` maps each font name
  // to where its bytes can be READ right now (its source file, or an
  // already-present public/fonts fallback) so hashing works before the copy.
  const fontWrites = [];
  const fontPaths = {};
  const FONTS = (config.fonts ?? []).map((entry) => {
    const name = String(entry).split(/[\\/]/).pop();
    const srcAbs = resolve(SOURCE, entry);
    if (outPublicDir) {
      if (existsSync(srcAbs) && statSync(srcAbs).isFile()) {
        checkContained?.(srcAbs, `font '${entry}'`, configPath);
        const dest = join(outPublicDir, "fonts", name);
        register?.(dest, `font '${entry}'`);
        fontWrites.push({ src: srcAbs, dest });
        fontCopies?.push(dest);
        fontPaths[name] = srcAbs; // source bytes == the bytes that will be copied
      } else if (existsSync(join(outPublicDir, "fonts", name))) {
        // An already-bundled font (e.g. the Liberation fallbacks tracked under
        // public/fonts) — read it in place; it isn't rewritten, so no staging.
        fontPaths[name] = join(outPublicDir, "fonts", name);
      } else {
        // Neither a source-tree path nor an already-bundled font — a silent skip
        // here used to ship an app whose `// @font` selector lists a face that
        // can never load.
        throw new Error(
          `gen-schema: font '${entry}' not found:\n  ${srcAbs}\n` +
            `  (and not already present in public/fonts/${name})\n` +
            `  (referenced from ${configPath} — check its 'fonts')`
        );
      }
    }
    return name;
  });
  const FONT_FALLBACK = parseFontFallback(config.fontFallback);
  const fontsConf = outPublicDir ? renderFontsConf(FONT_FALLBACK) : null;
  // The bundled fonts' real embedded family names, so the app can decide font
  // availability by family rather than filename — plus their face descriptions
  // ({ family, style }), which the app's font selector lists under friendly
  // names. Read from each font's current source location; only meaningful in a
  // real build (outPublicDir present).
  const FONT_FAMILIES = [];
  const FONT_FACES = [];
  if (outPublicDir) {
    const seen = new Set();
    const seenFaces = new Set();
    for (const name of FONTS) {
      let buf;
      try {
        buf = readFileSync(fontPaths[name]);
      } catch {
        continue; // font not resolvable here (e.g. a fixture's placeholder name)
      }
      for (const fam of fontFamilyNames(buf)) {
        const key = fam.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          FONT_FAMILIES.push(fam);
        }
      }
      for (const face of fontFaces(buf)) {
        const key = `${face.family.toLowerCase()} ${face.style.toLowerCase()}`;
        if (!seenFaces.has(key)) {
          seenFaces.add(key);
          FONT_FACES.push(face);
        }
      }
    }
    FONT_FAMILIES.sort((a, b) => a.localeCompare(b));
    FONT_FACES.sort(
      (a, b) => a.family.localeCompare(b.family) || a.style.localeCompare(b.style)
    );
  }
  return { FONTS, FONT_FAMILIES, FONT_FACES, fontPaths, fontsConf, fontWrites };
}

// Copy a BROWSER-FACING file (logo, design picker icon, PWA icon — always
// rendered in an <img>/<use>/CSS context, never fed to OpenSCAD) from `src` to
// `dest`. An .svg source is run through sanitizeSvg() first (M13 — see
// docs/config.md "SVG asset trust model" and scripts/lib/svg-sanitize.mjs):
// cheap defense-in-depth so a served SVG can't execute as an active document
// if it's ever navigated to directly, without needing to trust every byte of
// operator-supplied markup. Anything else (PNG, …) copies verbatim. Deliberately
// NOT used for render-input assets (copyAsset, below) — those are geometry
// OpenSCAD's import()/surface() reads, not display markup, and are covered by
// the operator-input trust boundary + public/_headers instead.
function copyBrowserFacing(src, dest) {
  if (/\.svg$/i.test(src)) {
    const { text } = sanitizeSvg(readFileSync(src, "utf-8"));
    writeFileSync(dest, text);
  } else {
    copyFileSync(src, dest);
  }
}

// Optional header logo, per theme. `logo` may be a string (used for both
// themes) or { light, dark } (either may be omitted -> the other is used).
// Each referenced file is copied into the served tree; returns the resolved
// { light, dark } URLs, or null when no logo is configured.
function copyLogoAssets(config, CONFIG_DIR, outScadDir, mustExist, register) {
  if (!config.logo) return null;
  // Map each resolved source to the URL it was copied to, so a single source
  // used for both themes is copied once and two distinct sources never clobber
  // each other — even when they share a basename (light/logo.svg vs
  // dark/logo.svg), which a flat basename would silently overwrite. `register`
  // (H6) additionally catches a logo basename colliding with some other
  // generated output class (a design, asset, icon, doc, or extraCss) sharing
  // the same flat public/scad/ namespace.
  const copiedByAbs = new Map();
  const usedNames = new Set();
  const copyLogo = (src) => {
    const abs = mustExist(resolve(CONFIG_DIR, src), `logo '${src}'`);
    const existing = copiedByAbs.get(abs);
    if (existing) return existing;
    let name = abs.split(/[\\/]/).pop();
    if (usedNames.has(name)) {
      // Same basename, different source: disambiguate with a short hash of the
      // source path so the second logo doesn't overwrite the first.
      const tag = createHash("sha256").update(abs).digest("hex").slice(0, 8);
      const dot = name.lastIndexOf(".");
      name = dot > 0 ? `${name.slice(0, dot)}-${tag}${name.slice(dot)}` : `${name}-${tag}`;
    }
    usedNames.add(name);
    const dest = join(outScadDir, name);
    register(dest, `logo '${src}'`);
    copyBrowserFacing(abs, dest);
    const url = `scad/${name}`;
    copiedByAbs.set(abs, url);
    return url;
  };
  const entry = config.logo;
  const lightSrc = typeof entry === "string" ? entry : entry.light ?? entry.dark;
  const darkSrc = typeof entry === "string" ? entry : entry.dark ?? entry.light;
  return { light: copyLogo(lightSrc), dark: copyLogo(darkSrc) };
}

// The design list from the config, or auto-discovered root .scad files.
function resolveDesignList(config, SOURCE) {
  // An optional per-design non-empty string field: the picker `description`, or
  // the `icon` path (config-relative, like `logo`, copied into the served tree
  // by buildDesigns and used for the manifest shortcut + picker thumbnail).
  // Absent -> null.
  const checkDesignString = (raw, id, field) => {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== "string" || !raw.trim())
      throw new Error(`gen-schema: design '${id}' '${field}' must be a non-empty string`);
    return raw.trim();
  };
  if (Array.isArray(config.designs) && config.designs.length) {
    // Two designs sharing an id would clobber each other's generated
    // <id>-icon/<id>-doc output and collide in storage/URLs (#d=<id>).
    const seenIds = new Set();
    for (const d of config.designs) {
      const id = checkId(d.id);
      if (seenIds.has(id))
        throw new Error(`gen-schema: duplicate design id ${JSON.stringify(id)} in 'designs'`);
      seenIds.add(id);
    }
    return config.designs.map((d) => ({
      id: checkId(d.id),
      label: d.label ?? humanize(d.id),
      file: d.file ?? `${d.id}.scad`,
      // Heavy designs skip the debounced auto-render (the user renders on demand).
      heavy: d.heavy ?? false,
      // Optional dropdown grouping header (designs sharing a group cluster).
      group: typeof d.group === "string" && d.group.trim() ? d.group.trim() : null,
      // Optional picker description + icon + user-doc (icon/doc are config-
      // relative paths, resolved/copied to served URLs once outScadDir exists).
      description: checkDesignString(d.description, d.id, "description"),
      iconSrc: checkDesignString(d.icon, d.id, "icon"),
      imageSrc: checkDesignString(d.image, d.id, "image"),
      docSrc: checkDesignString(d.doc, d.id, "doc"),
    }));
  }
  return readdirSync(SOURCE)
    .filter((f) => f.endsWith(".scad"))
    .sort()
    .map((f) => {
      const id = f.replace(/\.scad$/, "");
      return { id, label: humanize(id), file: f, heavy: false, group: null, description: null, iconSrc: null, imageSrc: null, docSrc: null };
    });
}

// Parse each design's Customizer parameters and copy its .scad, sibling
// parameterSets .json, and picker icon into the served tree.
function buildDesigns({ config, SOURCE, CONFIG_DIR, outScadDir, mustExist, checkContained, relPosix, copyAsset, register }) {
  return resolveDesignList(config, SOURCE).map(({ iconSrc, imageSrc, docSrc, ...d }) => {
    const abs = mustExist(join(SOURCE, d.file), `design '${d.id}' source file '${d.file}'`);
    checkContained(abs, `design '${d.id}' source file '${d.file}'`, `design '${d.id}' config entry`);
    const { params, sections, collapsedSections, meta } = parseParams(abs);
    copyAsset(d.file);
    // Auto-detect a sibling OpenSCAD parameterSets file: <name>.scad -> <name>.json
    // next to it. One file can hold many named sets; absent -> no bundled presets.
    const presetRel = d.file.replace(/\.scad$/, ".json");
    const presetAbs = join(SOURCE, presetRel);
    // H5: the sibling parameterSets file is copied into the served tree like the
    // .scad above, so it must clear the same symlink-containment check first —
    // otherwise a <name>.json symlinked outside SOURCE would be followed and its
    // target copied into public/scad/ (exactly the escape checkContained refuses
    // for the design's own source). checkContained throws on an escape.
    const presets = existsSync(presetAbs) ? [presetRel] : [];
    if (presets.length) {
      checkContained(presetAbs, `design '${d.id}' parameterSets file '${presetRel}'`, `design '${d.id}'`);
      copyAsset(presetRel);
    }
    // Description + icon each fall back to the design's own `// @description` /
    // `// @icon` annotation when the config `designs[]` entry omits them (config
    // wins). A config icon is config-relative (like logo); a `// @icon` path is
    // relative to the design's own .scad file. Copy into the served tree under a
    // deterministic `<id>-icon.<ext>` name so distinct designs never clobber each
    // other; the id charset is already URL-safe.
    const description = d.description ?? meta.description;
    let icon = null;
    const iconRel = iconSrc ?? meta.icon;
    if (iconRel) {
      const base = iconSrc ? CONFIG_DIR : dirname(abs);
      const src = mustExist(resolve(base, iconRel), `design '${d.id}' icon '${iconRel}'`);
      // `// @icon` (unlike a config `icon`) resolves relative to the design's
      // own file, i.e. within SOURCE — so it must stay within SOURCE too.
      if (!iconSrc) checkContained(src, `design '${d.id}' icon '${iconRel}'`, relPosix(abs));
      const dot = iconRel.lastIndexOf(".");
      const ext = dot > 0 ? iconRel.slice(dot) : "";
      const name = `${d.id}-icon${ext}`;
      const dest = join(outScadDir, name);
      register(dest, `design '${d.id}' icon`);
      copyBrowserFacing(src, dest);
      icon = `scad/${name}`;
    }
    // Larger card artwork for the optional visual picker. Config paths are
    // relative to the config; annotation paths are relative to the design.
    let image = null;
    const imageRel = imageSrc ?? meta.image;
    if (imageRel) {
      const base = imageSrc ? CONFIG_DIR : dirname(abs);
      const src = mustExist(resolve(base, imageRel), `design '${d.id}' image '${imageRel}'`);
      if (!imageSrc) checkContained(src, `design '${d.id}' image '${imageRel}'`, relPosix(abs));
      const dot = imageRel.lastIndexOf(".");
      const ext = dot > 0 ? imageRel.slice(dot) : "";
      const name = `${d.id}-image${ext}`;
      const dest = join(outScadDir, name);
      register(dest, `design '${d.id}' image`);
      copyBrowserFacing(src, dest);
      image = `scad/${name}`;
    }
    // User documentation, same fallback + base rules as icon: config `doc` wins
    // (config-relative) over a `// @doc` annotation (relative to the .scad). The
    // Markdown file is copied verbatim under a deterministic `<id>-doc.md` name;
    // its served URL is fetched on demand and rendered by the doc modal. Pure
    // prose, so it's excluded from renderHash (it can't affect geometry).
    let doc = null;
    const docRel = docSrc ?? meta.doc;
    if (docRel) {
      const base = docSrc ? CONFIG_DIR : dirname(abs);
      const src = mustExist(resolve(base, docRel), `design '${d.id}' doc '${docRel}'`);
      // Same containment rule as icon: only the annotation-based (SOURCE-relative) path is checked.
      if (!docSrc) checkContained(src, `design '${d.id}' doc '${docRel}'`, relPosix(abs));
      const name = `${d.id}-doc.md`;
      const dest = join(outScadDir, name);
      register(dest, `design '${d.id}' doc`);
      copyFileSync(src, dest);
      doc = `scad/${name}`;
    }
    return { ...d, description, icon, image, doc, presets, abs, sections, collapsedSections, params };
  });
}

// Optional default design shown when a visit carries no `#d=` deep link.
// Must name one of the configured designs.
function resolveDefaultDesign(config, designs) {
  if (config.defaultDesign === undefined || config.defaultDesign === null) return null;
  if (!designs.some((d) => d.id === config.defaultDesign))
    throw new Error(
      `gen-schema: 'defaultDesign' ${JSON.stringify(config.defaultDesign)} ` +
        `is not one of the configured design ids (${designs.map((d) => d.id).join(", ")})`
    );
  return config.defaultDesign;
}

// Optional raw-CSS escape hatch. Unlike `colors` — a safe, validated token map
// — this is a stylesheet the consumer fully controls, copied verbatim into the
// served tree and (see vite.config.ts) loaded *after* the app's own styles so
// it can override anything. It targets internal class names at the consumer's
// own risk: not a stable API, and not covered by the accessibility guarantees.
// Lives under the (gitignored, auto-wiped) scad output dir, so it never goes
// stale or gets committed. Returns its served URL, or null.
function copyExtraCss(config, CONFIG_DIR, outScadDir, mustExist, register) {
  if (!config.extraCss) return null;
  const abs = mustExist(
    resolve(CONFIG_DIR, config.extraCss),
    `extraCss '${config.extraCss}'`
  );
  const name = abs.split(/[\\/]/).pop();
  // H6: this is exactly the collision that used to overwrite a design file
  // silently (an extraCss basename equal to a design's) — register() now
  // fails the build, naming both owners, instead of clobbering.
  const dest = join(outScadDir, name);
  register(dest, `extraCss '${config.extraCss}'`);
  copyFileSync(abs, dest);
  return `scad/${name}`;
}

// v2 precache manifest, read by public/sw.js at install:
//   shell — small runtime assets cached into the per-build shell cache;
//   bin   — the big version-pinned binaries (the ~10 MB WASM + fonts),
//           warmed into the render worker's own BIN_CACHE (same cache,
//           same keys — no double store) so offline rendering works even
//           before the first render.
// H4: append a `?v=<digest>` query to a binary asset's served path so its
// fetch/Cache-Storage identity is content-addressed. Mirrors
// src/lib/assetUrl.ts's versionedAssetUrl exactly (that file is TypeScript,
// loaded by the worker/main-thread runtime; this one is the same one-line
// scheme applied where gen-schema writes the SW's warm-up URL list — both
// sides must compute byte-identical strings for a given (path, digest) so a
// Cache Storage entry worker.ts writes is the exact one the service worker's
// warm-up either finds already present or writes itself).
function versionedPath(path, digest) {
  return digest ? `${path}?v=${digest}` : path;
}

function writePrecacheManifest({ outPublicDir, schema, appleSplash, assets, logo, extraCss, iconFiles }) {
  // M8: precache only the icon files the PWA-asset step actually wrote
  // (`iconFiles`), not a fixed assumed set — otherwise a missing rasterizer
  // (or one that failed, though that now fails the build outright — see
  // pwa-assets.mjs) would have the service worker try to precache PNGs that
  // were never generated.
  const shell = new Set([
    ...iconFiles,
    "manifest.webmanifest",
    // H3: the render worker fetches the WASM glue and fonts.conf content-
    // addressed (versionedAssetUrl in worker.ts), so precache the SAME
    // ?v=<digest> URLs here. Cache Storage matches the query string, so an
    // unversioned shell entry is a miss for the worker's versioned request —
    // an app taken offline before its first render would fail to bootstrap.
    versionedPath("wasm/openscad.js", schema.binAssets?.glue),
    versionedPath("fonts/fonts.conf", schema.binAssets?.fontsConf),
  ]);
  for (const splash of appleSplash) shell.add(splash.href);
  for (const asset of assets) shell.add(`scad/${asset}`);
  for (const d of schema.designs) {
    shell.add(`scad/${d.file}`);
    for (const preset of d.presets) shell.add(`scad/${preset}`);
    if (d.icon) shell.add(d.icon);
    if (d.doc) shell.add(d.doc);
  }
  if (logo) {
    shell.add(logo.light);
    shell.add(logo.dark);
  }
  if (extraCss) shell.add(extraCss);
  const precache = {
    version: 2,
    shell: [...shell].sort(),
    bin: {
      cache: `openscad-wasm-bin-${WASM_VERSION}`,
      // H4: content-addressed via versionedPath — see its comment. Must match
      // exactly what worker.ts's cachedBuffer() fetches for the same file
      // (both derive the query from schema.binAssets), so the service worker's
      // warm-up and the worker's own first-render fetch always agree on the
      // Cache Storage key for a given build's bytes.
      urls: [
        versionedPath("wasm/openscad.wasm", schema.binAssets?.wasm),
        ...schema.fonts.map((f) => versionedPath(`fonts/${f}`, schema.binAssets?.fonts?.[f])),
      ].sort(),
    },
  };
  writeFileSync(
    join(outPublicDir, "precache-manifest.json"),
    JSON.stringify(precache, null, 2) + "\n"
  );
}

/**
 * Build the configurator schema and copy the needed .scad/preset files.
 * The heavy lifting lives in the section helpers above (and scripts/lib/);
 * this orchestrates them in dependency order and assembles the schema.
 * @param {object} opts
 * @param {string} opts.configPath  Path to the configurator config JSON.
 * @param {string} opts.outSchemaDir  Where designs.json is written.
 * @param {string} opts.outScadDir  Where the copied .scad/presets are written.
 * @returns {object} the schema (also written to outSchemaDir/designs.json).
 */
export function generate({ configPath, outSchemaDir, outScadDir, outPublicDir, rendererFiles }) {
  const mustExist = makeMustExist(configPath);
  mustExist(configPath, "config file");
  const config = loadConfig(configPath);
  // Everything in the config is resolved relative to the config file's directory.
  const CONFIG_DIR = dirname(configPath);

  const { TITLE, SHORT_NAME, ID, DESCRIPTION, LANG, DIR, THEME_COLOR, THEME_COLOR_LIGHT, BG_COLOR, CATEGORIES } =
    parseIdentity(config);

  // ── Design sources ────────────────────────────────────────────────────────
  // `source` defaults to "." (designs live beside the config); set it to point
  // elsewhere (e.g. "examples", a sibling checkout, or an absolute path).
  const SOURCE = resolve(CONFIG_DIR, config.source ?? ".");
  mustExist(SOURCE, `source directory '${config.source ?? "."}'`);

  // SOURCE-bound asset resolution (source-relative paths, config `assets`
  // expansion, the use/include dep-graph walk) plus the symlink-containment
  // policy (H5) — see scripts/lib/assets.mjs. Created early so bundleFonts
  // below (a source-owned path, like a design or dependency) can use it too.
  const { relPosix, expandConfiguredAssets, collectDeps, checkContained } = createAssetTools({
    SOURCE,
    configPath,
    mustExist,
  });
  // Destination-ownership registry (H6): every file this run writes anywhere
  // in the served tree is registered here before it's written; a second
  // write aimed at the same path fails the build, naming both owners.
  const registry = createDestinationRegistry();
  // Font files copied from SOURCE this run (not the tracked/already-bundled
  // ones bundleFonts leaves untouched) — reconciled against the previous
  // run's manifest below (M8).
  const fontCopies = [];

  // ── Rendering ─────────────────────────────────────────────────────────────
  const FEATURES = parseStringArray(config.features, "features");
  const FORMAT = parseFormat(config.format);
  const REST_ON_GRID = parseRestOnGrid(config.restOnGrid);
  // Optional build-time render tuning (heavy-render threshold + cache sizing).
  // Validated; absent -> null -> the app keeps its built-in defaults.
  const RENDER = parseRender(config.render);
  const { FONTS, FONT_FAMILIES, FONT_FACES, fontPaths, fontsConf, fontWrites } = bundleFonts(
    config,
    SOURCE,
    outPublicDir,
    configPath,
    {
      checkContained,
      register: registry.register,
      fontCopies,
    }
  );

  // ── Appearance & UI behaviour ─────────────────────────────────────────────
  // Optional per-theme colour-scheme overrides. Validated against the known CSS
  // tokens; emitted by vite.config.ts as a <style> block so a consumer project
  // can restyle the app entirely from its config. Absent -> null.
  const COLORS = parseColors(config.colors);
  // Build-time UI behaviour config (panel side, default state, etc.).
  const UI = parseUi(config.ui);
  // Optional generic file-import button (fonts, SVGs, data files, …). Validated.
  // Absent -> null -> no import button.
  const FILE_IMPORT = parseFileImport(config.fileImport);

  // ── In-app content ────────────────────────────────────────────────────────
  // Optional one-off notice dialog shown over the app on load. Validated; absent
  // -> null -> no popup.
  const POPUP = parsePopup(config.popup);
  // Optional help content; passed through verbatim. Absent -> null -> the app
  // falls back to its generic, project-agnostic default help.
  const HELP = config.help ?? null;
  // Config-driven notice categories surfaced on the OpenSCAD output panel.
  // Validated; off by default (omitted -> none).
  const NOTICES = parseNotices(config.notices);
  // Optional extra third-party software / license notices. Validated and
  // appended (never replacing the built-ins) by the in-app licenses modal.
  const LICENSES_EXTRA = parseLicenses(config.licenses);

  // outScadDir is entirely generated. H6/M8: build the complete new tree in a
  // staging directory first, and only replace the live outScadDir once every
  // fallible step below (design parsing, containment checks, PWA icon
  // generation, …) has succeeded — a build that fails partway used to leave
  // outScadDir wiped-and-half-repopulated (or, per H6, silently
  // cross-clobbered) instead of the previous complete output. A stage left
  // over from a previous crashed run is wiped before use.
  const stageScadDir = `${outScadDir}.staging`;
  rmSync(stageScadDir, { recursive: true, force: true });
  mkdirSync(stageScadDir, { recursive: true });

  const logo = copyLogoAssets(config, CONFIG_DIR, stageScadDir, mustExist, registry.register);

  // Copy a source file into the staged scad dir, preserving its relative
  // path, registering the destination first (H6).
  const copyAsset = (relPath) => {
    const dest = join(stageScadDir, relPath);
    registry.register(dest, `source file '${relPath}'`);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(SOURCE, relPath), dest);
  };

  mkdirSync(outSchemaDir, { recursive: true });

  const designs = buildDesigns({
    config,
    SOURCE,
    CONFIG_DIR,
    outScadDir: stageScadDir,
    mustExist,
    checkContained,
    relPosix,
    copyAsset,
    register: registry.register,
  });
  const defaultDesign = resolveDefaultDesign(config, designs);

  // Shared dependency files: from the config's `assets` (files/directories) when
  // given, otherwise discovered by following each design's use/include graph.
  const assets = new Set();
  if (Array.isArray(config.assets) && config.assets.length) {
    for (const a of expandConfiguredAssets(config.assets)) assets.add(a);
  } else {
    for (const d of designs) for (const dep of collectDeps(d.abs)) assets.add(dep);
  }
  for (const a of assets) copyAsset(a);

  const extraCss = copyExtraCss(config, CONFIG_DIR, stageScadDir, mustExist, registry.register);

  // The staged scad tree is complete, but it is NOT committed to the live
  // outScadDir yet: the swap is deferred to the very end (below), after the
  // fallible PWA generation and once the schema is in hand, so the whole
  // output — render sources, PWA/font assets, and designs.json — commits as
  // one unit. A failure in generatePwaAssets (e.g. a malformed configured
  // icon) therefore leaves the PREVIOUS complete output entirely intact: the
  // old scad tree, the old schema, and the old icons all still match. (PWA
  // icon writes are themselves non-destructive on failure — see
  // pwa-assets.mjs, which rasterizes the whole batch before writing any of it.)

  // Generate the PWA icon set, iOS splash images and manifest.webmanifest
  // (skipped for the fixture-driven unit tests, which pass no outPublicDir).
  // Returns the iOS splash <link> descriptors vite injects into index.html,
  // the icon files actually written (M8), and every path this call wrote
  // (for the M8 lifecycle reconciliation below). It reads design picker-icon
  // dimensions from the STAGING scad dir (scadDir), since the live swap hasn't
  // happened yet.
  let appleSplash = [];
  let iconFiles = ["icon.svg"];
  let pwaWritten = [];
  if (outPublicDir) {
    ({ appleSplash, iconFiles, written: pwaWritten } = generatePwaAssets({
      config,
      CONFIG_DIR,
      outPublicDir,
      TITLE,
      SHORT_NAME,
      DESCRIPTION,
      ID,
      LANG,
      DIR,
      THEME_COLOR,
      BG_COLOR,
      CATEGORIES,
      designs,
      mustExist,
      register: registry.register,
      scadDir: stageScadDir,
    }));
  }

  const renderHash = computeRenderHash({
    SOURCE,
    scadFiles: [...designs.map((d) => d.file), ...assets],
    features: FEATURES,
    format: FORMAT,
    fontPaths,
    fontsConf,
    // H3: the id -> file routing map is part of the render contract — two
    // designs swapping files preserves the mounted file set but changes which
    // model a cache keyed by design id should render.
    designRouting: designs.map((d) => ({ id: d.id, file: d.file })),
    rendererFiles,
    outPublicDir,
  });

  // H4: per-file content digests for the big binary assets (wasm, glue, fonts,
  // fonts.conf). Appended as a `?v=<digest>` query on their fetch URLs (worker.ts
  // AND the precache-manifest `bin.urls` below use the identical scheme — see
  // src/lib/assetUrl.ts's versionedAssetUrl) so the fetch/Cache-Storage identity
  // is content-addressed, not just the combined renderHash used for L2 geometry.
  const BIN_ASSETS = outPublicDir
    ? computeBinAssetVersions({ fontPaths, fontsConf, outPublicDir })
    : {};

  const schema = {
    generatedFrom: relPosix(SOURCE) || ".",
    renderHash,
    // Names the render worker's binary Cache Storage entry (and the service
    // worker's warm-up target). Single-sourced from scripts/wasm-version.mjs.
    wasmVersion: WASM_VERSION,
    // H4: per-file digests for wasm/glue/fonts/fonts.conf — see BIN_ASSETS above.
    binAssets: BIN_ASSETS,
    title: TITLE,
    shortName: SHORT_NAME,
    id: ID,
    description: DESCRIPTION,
    lang: LANG,
    dir: DIR,
    themeColor: THEME_COLOR,
    themeColorLight: THEME_COLOR_LIGHT,
    appleSplash,
    colors: COLORS,
    extraCss,
    logo,
    format: FORMAT,
    restOnGrid: REST_ON_GRID,
    features: FEATURES,
    render: RENDER,
    fonts: FONTS,
    fontFamilies: FONT_FAMILIES,
    fontFaces: FONT_FACES,
    fileImport: FILE_IMPORT,
    popup: POPUP,
    notices: NOTICES,
    help: HELP,
    licenses: LICENSES_EXTRA,
    ui: UI,
    defaultDesign,
    assets: [...assets].sort(),
    designs: designs.map(({ abs, ...d }) => d),
  };

  // COMMIT POINT (H6/M8): every fallible step — design parsing, containment
  // checks, PWA rasterization — has now succeeded and the schema is in hand, so
  // atomically swap the staged scad tree into the live location. Everything
  // past here (font copies, precache manifest, reconciliation, designs.json) is
  // a plain non-fallible write, so scad sources, PWA/font assets, and the
  // schema all land together: a failure earlier left the entire previous output
  // intact and internally consistent.
  rmSync(outScadDir, { recursive: true, force: true });
  renameSync(stageScadDir, outScadDir);

  // The generated font tree is committed here too (deferred from bundleFonts):
  // copy the source-referenced fonts into public/fonts and write fonts.conf,
  // now that all fallible work has succeeded. A source font overwriting a
  // same-named previous one, and the rewritten fonts.conf, therefore never
  // outlive a build that later failed.
  if (outPublicDir) {
    mkdirSync(join(outPublicDir, "fonts"), { recursive: true });
    for (const { src, dest } of fontWrites) {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }
    if (fontsConf != null) writeFileSync(join(outPublicDir, "fonts", "fonts.conf"), fontsConf);
  }

  if (outPublicDir) {
    writePrecacheManifest({ outPublicDir, schema, appleSplash, assets, logo, extraCss, iconFiles });
    // M8: reconcile the generated files this run wrote OUTSIDE outScadDir
    // (which was fully replaced as a unit just above) — source-copied fonts under
    // public/fonts, plus the PWA root assets (icons, splashes, manifest,
    // screenshots) — against what a previous run generated, so removing or
    // renaming a config entry (a dropped font, a renamed screenshot) doesn't
    // leave a stale, still-deployable file behind. Scoped to paths THIS tool
    // recorded writing previously; a tracked bundled .ttf or an unrelated
    // file a contributor placed under public/ was never in that manifest, so
    // it's never a deletion candidate. See scripts/lib/destinations.mjs.
    //
    // The manifest lives ABOVE public/ (repo root), not inside it: Vite copies
    // everything under public/ into dist/ verbatim, so a manifest kept there
    // shipped host-absolute checkout paths into the built site. Its entries are
    // stored relative to public/ and only ever resolve/delete within it.
    // Sweep away a legacy in-public manifest from older builds so it can't be
    // deployed or read as an absolute-path authority.
    rmSync(join(outPublicDir, ".gen-manifest.json"), { force: true });
    reconcileGenerated(
      join(outPublicDir, "..", ".gen-manifest.json"),
      outPublicDir,
      [...fontCopies, ...pwaWritten]
    );
  }
  writeFileSync(
    join(outSchemaDir, "designs.json"),
    JSON.stringify(schema, null, 2) + "\n"
  );
  return schema;
}

// CLI: build the real schema into the app's source/public trees.
function main() {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const WEB = join(HERE, "..");
  const schema = generate({
    configPath:
      process.env.SCADPUB_CONFIG || join(WEB, "scadpub.config.json"),
    outSchemaDir: join(WEB, "src", "generated"),
    outScadDir: join(WEB, "public", "scad"),
    outPublicDir: join(WEB, "public"),
    // H3: the renderer's source fixes the OpenSCAD CLI contract (flags,
    // mounting), so its bytes belong in renderHash — a worker change
    // invalidates the cache. Derived (not hand-listed) as worker.ts's full
    // local-import closure, so a new helper worker.ts starts importing is
    // automatically covered — see scripts/lib/worker-deps.mjs.
    rendererFiles: resolveWorkerDependencyClosure(join(WEB, "src", "openscad", "worker.ts")),
  });
  console.log(
    `gen-schema: ${schema.designs.length} designs, ${schema.assets.length} ` +
      `dependency files, ${schema.features.length} feature(s) -> ` +
      `src/generated/designs.json, public/scad/`
  );
}

// Run only when executed directly (not when imported by the tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
