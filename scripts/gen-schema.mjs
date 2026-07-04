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
} from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { WASM_VERSION } from "./wasm-version.mjs";
import { computeRenderHash } from "./lib/hash.mjs";
import { fontFaces, fontFamilyNames, parseFontFallback, renderFontsConf } from "./lib/fonts.mjs";
import { humanize, parseParams } from "./lib/params.mjs";
import { createAssetTools } from "./lib/assets.mjs";
import { generatePwaAssets } from "./lib/pwa-assets.mjs";
import {
  COLOR_VALUE_RE,
  parseColors,
  parseDir,
  parseFileImport,
  parseFormat,
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
  "features", "format", "fonts", "fontFallback", "render",
  // Appearance & UI behaviour
  "logo", "colors", "extraCss", "ui", "fileImport",
  // In-app content
  "popup", "help", "notices", "licenses",
]);

/**
 * Build the configurator schema and copy the needed .scad/preset files.
 * @param {object} opts
 * @param {string} opts.configPath  Path to the configurator config JSON.
 * @param {string} opts.outSchemaDir  Where designs.json is written.
 * @param {string} opts.outScadDir  Where the copied .scad/presets are written.
 * @returns {object} the schema (also written to outSchemaDir/designs.json).
 */
export function generate({ configPath, outSchemaDir, outScadDir, outPublicDir, rendererFiles }) {
  // Fail early and clearly when a configured path doesn't exist — these are the
  // most common ways a config drifts from the designs it points at.
  const mustExist = (abs, what) => {
    if (!existsSync(abs))
      throw new Error(
        `gen-schema: ${what} not found:\n  ${abs}\n` +
          `  (referenced from ${configPath} — check its source/assets/designs/logo/icon)`
      );
    return abs;
  };

  mustExist(configPath, "config file");
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  // Catch typo'd / stale top-level keys before doing any work — a whole-key typo
  // would otherwise be silently ignored (see KNOWN_TOP_LEVEL_KEYS).
  for (const key of Object.keys(config)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key))
      throw new Error(
        `gen-schema: unknown config key '${key}' in ${configPath}.\n` +
          `  Valid keys: ${[...KNOWN_TOP_LEVEL_KEYS].filter((k) => k !== "$schema").join(", ")}`
      );
  }
  // Everything in the config is resolved relative to the config file's directory.
  const CONFIG_DIR = dirname(configPath);

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

  // ── App identity & PWA chrome ─────────────────────────────────────────────
  // (icon/iconMaskable/screenshots/shortcuts are consumed by generatePwaAssets.)
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
  // when interpolated into generated SVG/HTML attributes below.
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
  const CATEGORIES = Array.isArray(config.categories) ? config.categories : [];

  // ── Design sources ────────────────────────────────────────────────────────
  // `source` defaults to "." (designs live beside the config); set it to point
  // elsewhere (e.g. "examples", a sibling checkout, or an absolute path).
  // (`designs`, `assets`, `logo` and `extraCss` are consumed further down, in
  // the copy/generation steps that need the wiped output tree.)
  const SOURCE = resolve(CONFIG_DIR, config.source ?? ".");
  mustExist(SOURCE, `source directory '${config.source ?? "."}'`);

  // ── Rendering ─────────────────────────────────────────────────────────────
  const FEATURES = config.features ?? [];
  const FORMAT = parseFormat(config.format);
  // Optional build-time render tuning (heavy-render threshold + cache sizing).
  // Validated; absent -> null -> the app keeps its built-in defaults.
  const RENDER = parseRender(config.render);
  // Fonts are referenced by basename under /fonts. An entry is either a font
  // already present in public/fonts (the Liberation fallbacks that ship with the
  // app) or a path into the source tree (a design repo bundling its own font),
  // which we copy into public/fonts so it is served like the rest.
  const FONTS = (config.fonts ?? []).map((entry) => {
    const name = String(entry).split(/[\\/]/).pop();
    const srcAbs = resolve(SOURCE, entry);
    if (outPublicDir && existsSync(srcAbs) && statSync(srcAbs).isFile()) {
      const dest = join(outPublicDir, "fonts", name);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(srcAbs, dest);
    }
    return name;
  });
  // The fontconfig config the renderer mounts. Optionally pins a weak last-resort
  // fallback family (config.fontFallback) so an imported font can't hijack
  // Fontconfig's global default. Generated into the served tree (and hashed into
  // renderHash) so the matching rules stay config-driven, not hand-maintained.
  const FONT_FALLBACK = parseFontFallback(config.fontFallback);
  if (outPublicDir) {
    mkdirSync(join(outPublicDir, "fonts"), { recursive: true });
    writeFileSync(join(outPublicDir, "fonts", "fonts.conf"), renderFontsConf(FONT_FALLBACK));
  }
  // The bundled fonts' real embedded family names, so the app can decide font
  // availability by family rather than filename — plus their face descriptions
  // ({ family, style }), which the app's font selector lists under friendly
  // names. Read from the copied files in the served tree; only meaningful in a
  // real build (outPublicDir present).
  const FONT_FAMILIES = [];
  const FONT_FACES = [];
  if (outPublicDir) {
    const seen = new Set();
    const seenFaces = new Set();
    for (const name of FONTS) {
      let buf;
      try {
        buf = readFileSync(join(outPublicDir, "fonts", name));
      } catch {
        continue; // font not bundled here (e.g. a fixture's placeholder name)
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

  // outScadDir is entirely generated: wipe it before repopulating so files from
  // a previous config/build (a removed, renamed or briefly-private design or
  // dependency) can't survive into the published tree. Recreated empty below.
  rmSync(outScadDir, { recursive: true, force: true });

  // Optional header logo, per theme. `logo` may be a string (used for both
  // themes) or { light, dark } (either may be omitted -> the other is used).
  // Each referenced file is copied into the served tree; the schema records the
  // resolved { light, dark } URLs.
  mkdirSync(outScadDir, { recursive: true });
  let logo = null;
  if (config.logo) {
    // Map each resolved source to the URL it was copied to, so a single source
    // used for both themes is copied once and two distinct sources never clobber
    // each other — even when they share a basename (light/logo.svg vs
    // dark/logo.svg), which a flat basename would silently overwrite.
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
      copyFileSync(abs, join(outScadDir, name));
      const url = `scad/${name}`;
      copiedByAbs.set(abs, url);
      return url;
    };
    const entry = config.logo;
    const lightSrc = typeof entry === "string" ? entry : entry.light ?? entry.dark;
    const darkSrc = typeof entry === "string" ? entry : entry.dark ?? entry.light;
    logo = { light: copyLogo(lightSrc), dark: copyLogo(darkSrc) };
  }

  // SOURCE-bound asset resolution: source-relative paths (relPosix), config
  // `assets` expansion (files/dirs/globs), and the use/include dep-graph walk.
  // See scripts/lib/assets.mjs.
  const { relPosix, expandConfiguredAssets, collectDeps } = createAssetTools({
    SOURCE,
    configPath,
    mustExist,
  });

  // An optional per-design non-empty string field: the picker `description`, or
  // the `icon` path (config-relative, like `logo`, copied into the served tree
  // below and used for the manifest shortcut + picker thumbnail). Absent -> null.
  const checkDesignString = (raw, id, field) => {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== "string" || !raw.trim())
      throw new Error(`gen-schema: design '${id}' '${field}' must be a non-empty string`);
    return raw.trim();
  };

  // The design list from the config, or auto-discovered root .scad files.
  const resolveDesigns = () => {
    if (Array.isArray(config.designs) && config.designs.length) {
      return config.designs.map((d) => ({
        id: checkId(d.id),
        label: d.label ?? humanize(d.id),
        file: d.file ?? `${d.id}.scad`,
        // Heavy designs skip the debounced auto-render (the user renders on demand).
        heavy: d.heavy ?? false,
        // Optional dropdown grouping header (designs sharing a group cluster).
        group: typeof d.group === "string" && d.group.trim() ? d.group.trim() : null,
        // Optional picker description + icon (icon is a config-relative path,
        // resolved to a served URL once outScadDir exists).
        description: checkDesignString(d.description, d.id, "description"),
        iconSrc: checkDesignString(d.icon, d.id, "icon"),
      }));
    }
    return readdirSync(SOURCE)
      .filter((f) => f.endsWith(".scad"))
      .sort()
      .map((f) => {
        const id = f.replace(/\.scad$/, "");
        return { id, label: humanize(id), file: f, heavy: false, group: null, description: null, iconSrc: null };
      });
  };

  // Copy a source file into outScadDir, preserving its relative path.
  const copyAsset = (relPath) => {
    const dest = join(outScadDir, relPath);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(SOURCE, relPath), dest);
  };

  mkdirSync(outSchemaDir, { recursive: true });
  mkdirSync(outScadDir, { recursive: true });

  const designs = resolveDesigns().map(({ iconSrc, ...d }) => {
    const abs = mustExist(join(SOURCE, d.file), `design '${d.id}' source file '${d.file}'`);
    const { params, sections, collapsedSections, meta } = parseParams(abs);
    copyAsset(d.file);
    // Auto-detect a sibling OpenSCAD parameterSets file: <name>.scad -> <name>.json
    // next to it. One file can hold many named sets; absent -> no bundled presets.
    const presetRel = d.file.replace(/\.scad$/, ".json");
    const presets = existsSync(join(SOURCE, presetRel)) ? [presetRel] : [];
    if (presets.length) copyAsset(presetRel);
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
      const dot = iconRel.lastIndexOf(".");
      const ext = dot > 0 ? iconRel.slice(dot) : "";
      const name = `${d.id}-icon${ext}`;
      copyFileSync(src, join(outScadDir, name));
      icon = `scad/${name}`;
    }
    return { ...d, description, icon, presets, abs, sections, collapsedSections, params };
  });

  // Optional default design shown when a visit carries no `#d=` deep link.
  // Must name one of the configured designs.
  let defaultDesign = null;
  if (config.defaultDesign !== undefined && config.defaultDesign !== null) {
    if (!designs.some((d) => d.id === config.defaultDesign))
      throw new Error(
        `gen-schema: 'defaultDesign' ${JSON.stringify(config.defaultDesign)} ` +
          `is not one of the configured design ids (${designs.map((d) => d.id).join(", ")})`
      );
    defaultDesign = config.defaultDesign;
  }

  // Shared dependency files: from the config's `assets` (files/directories) when
  // given, otherwise discovered by following each design's use/include graph.
  const assets = new Set();
  if (Array.isArray(config.assets) && config.assets.length) {
    for (const a of expandConfiguredAssets(config.assets)) assets.add(a);
  } else {
    for (const d of designs) for (const dep of collectDeps(d.abs)) assets.add(dep);
  }
  for (const a of assets) copyAsset(a);

  // Optional raw-CSS escape hatch. Unlike `colors` — a safe, validated token map
  // — this is a stylesheet the consumer fully controls, copied verbatim into the
  // served tree and (see vite.config.ts) loaded *after* the app's own styles so
  // it can override anything. It targets internal class names at the consumer's
  // own risk: not a stable API, and not covered by the accessibility guarantees.
  // Lives under the (gitignored, auto-wiped) scad output dir, so it never goes
  // stale or gets committed. The schema records its served URL, or null.
  let extraCss = null;
  if (config.extraCss) {
    const abs = mustExist(
      resolve(CONFIG_DIR, config.extraCss),
      `extraCss '${config.extraCss}'`
    );
    const name = abs.split(/[\\/]/).pop();
    copyFileSync(abs, join(outScadDir, name));
    extraCss = `scad/${name}`;
  }

  // Generate the PWA icon set, iOS splash images and manifest.webmanifest
  // (skipped for the fixture-driven unit tests, which pass no outPublicDir).
  // Returns the iOS splash <link> descriptors vite injects into index.html.
  let appleSplash = [];
  if (outPublicDir) {
    ({ appleSplash } = generatePwaAssets({
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
    }));
  }

  const renderHash = computeRenderHash({
    SOURCE,
    scadFiles: [...designs.map((d) => d.file), ...assets],
    features: FEATURES,
    format: FORMAT,
    fonts: FONTS,
    rendererFiles,
    outPublicDir,
  });

  const schema = {
    generatedFrom: relPosix(SOURCE) || ".",
    renderHash,
    // Names the render worker's binary Cache Storage entry (and the service
    // worker's warm-up target). Single-sourced from scripts/wasm-version.mjs.
    wasmVersion: WASM_VERSION,
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
  if (outPublicDir) {
    // v2 precache manifest, read by public/sw.js at install:
    //   shell — small runtime assets cached into the per-build shell cache;
    //   bin   — the big version-pinned binaries (the ~10 MB WASM + fonts),
    //           warmed into the render worker's own BIN_CACHE (same cache,
    //           same keys — no double store) so offline rendering works even
    //           before the first render.
    const shell = new Set([
      "icon.svg",
      "icon-192.png",
      "icon-512.png",
      "icon-512-maskable.png",
      "icon-180.png",
      "manifest.webmanifest",
      "wasm/openscad.js",
      "fonts/fonts.conf",
    ]);
    for (const splash of appleSplash) shell.add(splash.href);
    for (const asset of assets) shell.add(`scad/${asset}`);
    for (const d of schema.designs) {
      shell.add(`scad/${d.file}`);
      for (const preset of d.presets) shell.add(`scad/${preset}`);
      if (d.icon) shell.add(d.icon);
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
        urls: ["wasm/openscad.wasm", ...FONTS.map((f) => `fonts/${f}`)].sort(),
      },
    };
    writeFileSync(
      join(outPublicDir, "precache-manifest.json"),
      JSON.stringify(precache, null, 2) + "\n"
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
    // The renderer's source fixes the OpenSCAD CLI contract (flags, mounting),
    // so its bytes belong in renderHash — a worker change invalidates the cache.
    rendererFiles: [join(WEB, "src", "openscad", "worker.ts")],
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
