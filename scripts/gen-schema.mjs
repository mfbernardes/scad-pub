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
import { resolveFileField } from "./lib/prose-files.mjs";
import { splitHelpMarkdown } from "./lib/help-file.mjs";
import { slugifyPresetNames } from "./lib/preset-slug.mjs";
import { resolveWorkerDependencyClosure } from "./lib/worker-deps.mjs";
import { generatePwaAssets } from "./lib/pwa-assets.mjs";
import { scadpubVersion } from "./lib/version.mjs";
import { componentVersions } from "./lib/dep-versions.mjs";
import {
  applyGroupSpec,
  parseColors,
  parseDir,
  parseFileImport,
  parseFormat,
  parseLang,
  parseLicenses,
  parseNotices,
  parsePopup,
  parsePwa,
  parseRender,
  parseStringArray,
  parseStrings,
  parseUi,
  parseViewer,
  unknownNestedKeyError,
} from "./lib/config-parsers.mjs";
import { KNOWN_TOP_LEVEL_KEYS, CONFIG_SPEC } from "./lib/config-spec.mjs";

// Re-export the parsers/helpers the unit tests (tests/gen-schema.test.mjs)
// import from this entry, so the module split is invisible to the test suite.
export {
  COLOR_TOKENS,
  parseAfterExport,
  parseColors,
  parseDir,
  parseFileImport,
  parseFormat,
  parseLang,
  parseLicenses,
  parseNotices,
  parsePopup,
  parsePwa,
  parsePwaThemeColor,
  parseRender,
  parseStringArray,
  parseStrings,
  parseUi,
  parseViewer,
} from "./lib/config-parsers.mjs";
export { parseFontFallback, renderFontsConf, fontFamilyNames } from "./lib/fonts.mjs";
export { firstSentence, parseEnumHint, parseParams } from "./lib/params.mjs";
export { resolveFileField } from "./lib/prose-files.mjs";
export { splitHelpMarkdown } from "./lib/help-file.mjs";

// Every top-level key gen-schema (or its helpers) reads from scadpub.config.json.
// A key outside this set is almost always a typo (`popups`, `fontfallback`, …)
// that would otherwise be silently ignored, so — matching gen-schema's fail-fast
// convention for unknown *nested* keys (colour tokens, license fields) — an
// unrecognised top-level key fails the build. `$schema` is allowed so a config
// can point at a JSON Schema for editor tooling without tripping the check.
// Derived from scripts/lib/config-spec.mjs — the single declarative surface
// description — rather than hand-maintained here; re-exported (not just used
// internally) because tests/gen-schema.test.mjs imports it directly.
export { KNOWN_TOP_LEVEL_KEYS };

// Extensions tried, in order, for a `designs[].presets.images` DIRECTORY
// entry's per-preset lookup (see buildDesigns) — the same three image types
// the map form documents accepting (docs/config.md).
const PRESET_IMAGE_EXTENSIONS = [".svg", ".png", ".webp"];

// Path to the bundled English UI-text catalogue (src/locales/en.json),
// resolved relative to this file rather than the config being built — it's
// part of the app, not the consumer's project. `strings` overrides are
// validated against its key set (see parseStrings): a config key that isn't a
// real catalogue key would otherwise be silently ignored by every `t()` call.
const EN_CATALOG_PATH = fileURLToPath(new URL("../src/locales/en.json", import.meta.url));

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

// Dotted extension (incl. the leading dot) of a relative path, or "" when it
// has none. `dot > 0` so a leading-dot "dotfile" with no real extension yields
// "" rather than the whole basename.
const extOf = (relPath) => {
  const dot = relPath.lastIndexOf(".");
  return dot > 0 ? relPath.slice(dot) : "";
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

// ── App identity ────────────────────────────────────────────────────────────
// title/id/description/lang/dir only — document chrome and storage
// namespacing, read by the running app itself. Everything that's a
// manifest/icon-rasterizer INPUT ONLY (shortName, icon, iconMaskable,
// themeColor/themeColorLight, backgroundColor, categories, screenshots,
// shortcuts, install) now lives under the config's `pwa` block — see
// parsePwa (scripts/lib/config-parsers.mjs) and CONFIG_SPEC.pwa's comment —
// and is computed separately, below, so it can feed both `generatePwaAssets`
// and (unchanged) designs.json's own flat `themeColor`/`themeColorLight` keys.
function parseIdentity(config) {
  const TITLE = config.title ?? "ScadPub";
  const ID = checkId(config.id ?? "scadpub", "config 'id'");
  const DESCRIPTION =
    config.description ?? "Configure and export designs in your browser.";
  // Document / manifest language and text direction. Default "en" / "ltr"
  // (the previously hard-coded values). Validated so they're safe to interpolate
  // into the generated <html lang dir> attributes and the manifest.
  const LANG = parseLang(config.lang);
  const DIR = parseDir(config.dir);
  return { TITLE, ID, DESCRIPTION, LANG, DIR };
}

// ── Rendering: bundled fonts ────────────────────────────────────────────────
// Fonts are referenced by basename under /fonts. An entry is either a font
// already present in public/fonts (the Liberation fallbacks that ship with the
// app) or a path into the source tree (a design repo bundling its own font),
// which we copy into public/fonts so it is served like the rest. Also writes
// the fontconfig config the renderer mounts — optionally pinning a weak
// last-resort fallback family (config.render.fontFallback) so an imported font
// can't hijack Fontconfig's global default; generated into the served tree
// (and hashed into renderHash) so the matching rules stay config-driven.
// `fonts`/`fontFallback` moved under `render` (from the top level) since this
// commit — both are genuine render inputs, so they stay part of renderHash
// exactly as before; only where they're READ from the config changed.
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
  const FONTS = (config.render?.fonts ?? []).map((entry) => {
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
  const FONT_FALLBACK = parseFontFallback(config.render?.fontFallback);
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
  // Shared validator for a config `designs[].presets.images` map entry: an
  // object mapping string keys to non-empty string values. The per-key
  // cross-check (real bundled preset names) happens later in buildDesigns,
  // once parse results are available; this only enforces the shape.
  const checkStringMap = (raw, id, field) => {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== "object" || Array.isArray(raw))
      throw new Error(`gen-schema: design '${id}' '${field}' must be an object`);
    for (const [name, value] of Object.entries(raw)) {
      if (typeof value !== "string" || !value.trim())
        throw new Error(
          `gen-schema: design '${id}' '${field}["${name}"]' must be a non-empty string`
        );
    }
    return raw;
  };
  // `designs[].presets.images` alone additionally accepts a plain STRING — a
  // config-relative directory, looked up per-preset by slug in buildDesigns
  // (scripts/lib/preset-slug.mjs) instead of naming every preset by hand. The
  // map form's shape check (checkStringMap above) still applies to the object
  // form; this only adds the string branch alongside it.
  const checkPresetImages = (raw, id) => {
    if (raw === undefined || raw === null) return null;
    if (typeof raw === "string") {
      if (!raw.trim())
        throw new Error(`gen-schema: design '${id}' 'presets.images' must be a non-empty string or object`);
      return { kind: "dir", dir: raw.trim() };
    }
    return { kind: "map", map: checkStringMap(raw, id, "presets.images") };
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
    return config.designs.map((d) => {
      const id = checkId(d.id);
      // A designs[] entry's own keys (id/label/file/heavy/group/presets)
      // never got the same unknown-key rejection every other nested group
      // has — a stale or mistyped key (a flat 'icon', or a leftover
      // 'description'/'media'/'review' from before a design's own metadata
      // became the sole source — see docs/annotations.md) was silently
      // dropped instead of failing the build. Reuse the exact same error
      // (`unknownNestedKeyError`, the one `applyGroupSpec` itself raises for
      // 'presets' below) against the spec's own `designs.items.properties`,
      // so this can't drift into a second hand-written key list. `id` is
      // checked above, first, by `checkId`, so a design with a missing or
      // malformed id still gets checkId's own clear error rather than being
      // pre-empted by this one; by the time this runs `id` is always a
      // validated string, so the message below always names a real design.
      for (const key of Object.keys(d))
        if (!(key in CONFIG_SPEC.designs.items.properties))
          throw unknownNestedKeyError(`designs[${id}]`, CONFIG_SPEC.designs.items, key);
      // Preset-image presentation, nested under `presets`. `applyGroupSpec`
      // gives it unknown-key rejection for free — see config-spec.mjs's
      // DESIGN_PRESETS_SPEC comment. `presets.images` is `custom: true` (its
      // value needs a cross-reference against parse results only
      // buildDesigns has), so this only validates the surrounding object's
      // shape/unknown keys; `checkPresetImages` below does the per-key check.
      applyGroupSpec(d.presets ?? {}, CONFIG_SPEC.designs.items.properties.presets, `designs[${id}].presets`);
      return {
        id,
        label: d.label ?? humanize(d.id),
        file: d.file ?? `${d.id}.scad`,
        // Heavy designs skip the debounced auto-render (the user renders on demand).
        heavy: d.heavy ?? false,
        // Optional dropdown grouping header (designs sharing a group cluster).
        group: typeof d.group === "string" && d.group.trim() ? d.group.trim() : null,
        presetImagesSrc: checkPresetImages(d.presets?.images, id),
      };
    });
  }
  return readdirSync(SOURCE)
    .filter((f) => f.endsWith(".scad"))
    .sort()
    .map((f) => {
      const id = f.replace(/\.scad$/, "");
      return { id, label: humanize(id), file: f, heavy: false, group: null, presetImagesSrc: null };
    });
}

// Parse each design's Customizer parameters and copy its .scad, sibling
// parameterSets .json, and picker icon into the served tree.
function buildDesigns({ config, SOURCE, CONFIG_DIR, outScadDir, mustExist, checkContained, relPosix, copyAsset, register }) {
  return resolveDesignList(config, SOURCE).map(({ presetImagesSrc, ...d }) => {
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
    // Description/icon/image/doc come ONLY from the design's own annotations
    // now — `// @description`/`// @icon`/`// @image`/`// @doc` (see
    // docs/annotations.md); there is no config-level override left. Each
    // path resolves relative to the design's own .scad file, i.e. within
    // SOURCE, so each is also checked to stay contained in it. Copy icon/
    // image into the served tree under a deterministic `<id>-icon.<ext>` /
    // `<id>-image.<ext>` name so distinct designs never clobber each other;
    // the id charset is already URL-safe.
    const description = meta.description;
    let icon = null;
    if (meta.icon) {
      const src = mustExist(resolve(dirname(abs), meta.icon), `design '${d.id}' icon '${meta.icon}'`);
      checkContained(src, `design '${d.id}' icon '${meta.icon}'`, relPosix(abs));
      const ext = extOf(meta.icon);
      const name = `${d.id}-icon${ext}`;
      const dest = join(outScadDir, name);
      register(dest, `design '${d.id}' icon`);
      copyBrowserFacing(src, dest);
      icon = `scad/${name}`;
    }
    // Larger card artwork for the optional visual picker.
    let image = null;
    if (meta.image) {
      const src = mustExist(resolve(dirname(abs), meta.image), `design '${d.id}' image '${meta.image}'`);
      checkContained(src, `design '${d.id}' image '${meta.image}'`, relPosix(abs));
      const ext = extOf(meta.image);
      const name = `${d.id}-image${ext}`;
      const dest = join(outScadDir, name);
      register(dest, `design '${d.id}' image`);
      copyBrowserFacing(src, dest);
      image = `scad/${name}`;
    }
    // User documentation, same base/containment rule as icon/image. The
    // Markdown file is copied verbatim under a deterministic `<id>-doc.md`
    // name; its served URL is fetched on demand and rendered by the doc
    // modal. Pure prose, so it's excluded from renderHash (it can't affect
    // geometry).
    let doc = null;
    if (meta.doc) {
      const src = mustExist(resolve(dirname(abs), meta.doc), `design '${d.id}' doc '${meta.doc}'`);
      checkContained(src, `design '${d.id}' doc '${meta.doc}'`, relPosix(abs));
      const name = `${d.id}-doc.md`;
      const dest = join(outScadDir, name);
      register(dest, `design '${d.id}' doc`);
      copyFileSync(src, dest);
      doc = `scad/${name}`;
    }
    // Bundled-preset thumbnails (`designs[].presets.images`), either form:
    //   - MAP: each key must name an actual preset in the sibling
    //     parameterSets file — the same typo-protection stance as the rest of
    //     the config, so a stale/misspelled preset name fails the build
    //     instead of silently rendering a text-only card forever. Each value
    //     is a config-relative image path, copied under a deterministic
    //     `<id>-preset-<n>.<ext>` name (n = insertion order — the preset NAME
    //     itself, not the filename, is what the UI keys off of).
    //   - DIRECTORY: every bundled preset's image is looked up by slugifying
    //     its name (scripts/lib/preset-slug.mjs) and trying the supported
    //     extensions in turn. A preset with no matching file simply has no
    //     image — preset images are optional per preset either way — but the
    //     directory itself must exist, and the match count is logged so a
    //     wrong-but-existing directory (e.g. every name misspelled) is
    //     visible in the build log rather than silently yielding zero images.
    let presetImages;
    const presetNames = presets.length
      ? Object.keys(JSON.parse(readFileSync(presetAbs, "utf-8")).parameterSets ?? {})
      : [];
    if (presetImagesSrc?.kind === "map" && Object.keys(presetImagesSrc.map).length) {
      const presetNameSet = new Set(presetNames);
      presetImages = {};
      Object.entries(presetImagesSrc.map).forEach(([presetName, rel], i) => {
        if (!presetNameSet.has(presetName))
          throw new Error(
            `gen-schema: design '${d.id}' 'presets.images["${presetName}"]' does not match any bundled ` +
              `preset name in '${presetRel}'`
          );
        const src = mustExist(
          resolve(CONFIG_DIR, rel),
          `design '${d.id}' presets.images["${presetName}"] '${rel}'`
        );
        const ext = extOf(rel);
        const outName = `${d.id}-preset-${i}${ext}`;
        const dest = join(outScadDir, outName);
        register(dest, `design '${d.id}' presets.images["${presetName}"]`);
        copyBrowserFacing(src, dest);
        presetImages[presetName] = `scad/${outName}`;
      });
    } else if (presetImagesSrc?.kind === "dir") {
      const dirRel = presetImagesSrc.dir;
      const dirAbs = mustExist(resolve(CONFIG_DIR, dirRel), `design '${d.id}' presets.images directory '${dirRel}'`);
      if (!statSync(dirAbs).isDirectory())
        throw new Error(
          `gen-schema: design '${d.id}' 'presets.images' '${dirRel}' is not a directory:\n  ${dirAbs}`
        );
      const slugs = slugifyPresetNames(presetNames);
      const dirEntries = new Set(readdirSync(dirAbs));
      presetImages = {};
      let matched = 0;
      for (const presetName of presetNames) {
        const fileName = PRESET_IMAGE_EXTENSIONS.map((ext) => `${slugs.get(presetName)}${ext}`).find((f) =>
          dirEntries.has(f)
        );
        if (!fileName) continue;
        const ext = extOf(fileName);
        const outName = `${d.id}-preset-${matched}${ext}`;
        const dest = join(outScadDir, outName);
        register(dest, `design '${d.id}' presets.images["${presetName}"]`);
        copyBrowserFacing(join(dirAbs, fileName), dest);
        presetImages[presetName] = `scad/${outName}`;
        matched++;
      }
      console.log(
        `gen-schema: design '${d.id}' presets.images: ${matched}/${presetNames.length} preset(s) ` +
          `matched an image in '${dirRel}'`
      );
      if (!Object.keys(presetImages).length) presetImages = undefined;
    }
    // `reviewLabels`: each declared parameter's own `// @review "<label>"`
    // annotation (see scripts/lib/params.mjs and docs/annotations.md) — the
    // sole source now, with no config-level override left. A label can only
    // ever be declared on a real parameter in the first place, so there's no
    // separate cross-reference to run here (contrast the old config
    // `review.labels`, which needed one against `params`).
    const reviewLabels = {};
    for (const p of params) {
      if (p.reviewLabel) reviewLabels[p.name] = p.reviewLabel;
    }
    // `reviewNote`: the design's own file-level `// @reviewNote "<text>"`
    // annotation — the sole source now, with no config-level override left.
    const reviewNote = meta.reviewNote ?? null;
    // Strip the transient `reviewLabel` annotation flag off each param before
    // it reaches designs.json: it's already folded into `reviewLabels` above,
    // and src/openscad/types.ts's ParamBase carries no such field (that file
    // must never be edited — see this repo's CLAUDE.md).
    const cleanParams = params.map(({ reviewLabel, ...rest }) => rest);
    return {
      ...d,
      description,
      icon,
      image,
      doc,
      presets,
      abs,
      sections,
      collapsedSections,
      params: cleanParams,
      reviewNote,
      // Only present when the design configures at least one preset image.
      ...(presetImages ? { presetImages } : {}),
      // Only present when at least one parameter carries a `// @review` annotation.
      ...(Object.keys(reviewLabels).length ? { reviewLabels } : {}),
    };
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

// Resolve one help "pane" — the top-level `help` object itself, or a single
// `help.tabs[]` entry — against its optional `file` key (see docs/config.md
// "Sourcing help from Markdown files" and scripts/lib/help-file.mjs). `file`
// is an alternative to writing `sections` (and `intro`) inline: the
// referenced Markdown file's content before the first `##` heading becomes
// `intro`, and each `##` heading after that becomes a `{ title, body }`
// section. Setting `file` alongside `sections` or `intro` fails the build,
// naming both keys. A pane with no `file` passes through unchanged.
function resolveHelpPane(raw, CONFIG_DIR, mustExist, what) {
  if (raw?.file == null) return raw;
  if (raw.sections != null)
    throw new Error(`gen-schema: both '${what}.sections' and '${what}.file' are set — remove one.`);
  if (raw.intro != null)
    throw new Error(`gen-schema: both '${what}.intro' and '${what}.file' are set — remove one.`);
  const abs = mustExist(resolve(CONFIG_DIR, raw.file), `${what}.file '${raw.file}'`);
  const { intro, sections } = splitHelpMarkdown(readFileSync(abs, "utf-8"));
  const { file: _file, ...rest } = raw;
  return { ...rest, ...(intro ? { intro } : {}), sections };
}

// Optional `help` config block, with any `file` (top-level, or per-tab)
// resolved to its derived `intro`/`sections` first — see resolveHelpPane
// above. Everything else about `help` is passed through verbatim (see
// CONFIG_SPEC.help's comment): this is the only pre-processing it gets.
export function resolveHelp(raw, CONFIG_DIR, mustExist) {
  if (raw == null) return null;
  // `help` has never had its own shape check (see CONFIG_SPEC.help's
  // comment: "passed through verbatim") — a non-object value passes through
  // completely unchanged here too, exactly as before this function existed.
  // Only a genuine object gets the 'file' treatment below.
  if (typeof raw !== "object" || Array.isArray(raw)) return raw;
  const help = resolveHelpPane(raw, CONFIG_DIR, mustExist, "help");
  if (!Array.isArray(help.tabs)) return help;
  return {
    ...help,
    tabs: help.tabs.map((tab, i) =>
      tab && typeof tab === "object" && !Array.isArray(tab)
        ? resolveHelpPane(tab, CONFIG_DIR, mustExist, `help.tabs[${i}]`)
        : tab
    ),
  };
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

// designs.json vs. scadpub.config.json shape: mirror the config's grouping
// here when the app shares the concept (as `viewer` does — see
// src/openscad/types.ts's Schema comment); keep this file's existing flat
// shape when it doesn't. `render.features`/`.format`/`.fonts`/`.fontFallback`
// land as this schema's own flat `features`/`format`/`fonts`/`fontFallback`
// (the app already reads those flat; only `render.heavyMs`/`.cache` nest,
// under `render`, since that pairing IS its own build-time-tuning concept).
// `pwa` (shortName/icon/iconMaskable/backgroundColor/categories/screenshots/
// shortcuts/themeColor/install) doesn't appear here at all — every one of its
// keys is a manifest.webmanifest / icon-rasterizer input with no runtime
// reader, so there is no app-facing "pwa" concept to mirror it into.

/**
 * Build the configurator schema and copy the needed .scad/preset files.
 * The heavy lifting lives in the section helpers above (and scripts/lib/);
 * this orchestrates them in dependency order and assembles the schema.
 * @param {object} opts
 * @param {string} opts.configPath  Path to the configurator config JSON.
 * @param {string} opts.outSchemaDir  Where designs.json is written.
 * @param {string} opts.outScadDir  Where the copied .scad/presets are written.
 * @param {string} [opts.version]  ScadPub version stamp for this build; defaults
 *   to this checkout's `git describe` (see scripts/lib/version.mjs). Any falsy
 *   value (no git metadata and no override, or an explicit "") leaves the stamp
 *   out of the schema entirely.
 * @param {Record<string,string>} [opts.components]  Installed versions of the
 *   bundled npm packages for the licenses modal; defaults to reading this
 *   checkout's node_modules (see scripts/lib/dep-versions.mjs).
 * @returns {object} the schema (also written to outSchemaDir/designs.json).
 */
export function generate({
  configPath,
  outSchemaDir,
  outScadDir,
  outPublicDir,
  rendererFiles,
  version = scadpubVersion(),
  components = componentVersions(),
}) {
  const mustExist = makeMustExist(configPath);
  mustExist(configPath, "config file");
  const config = loadConfig(configPath);
  // Everything in the config is resolved relative to the config file's directory.
  const CONFIG_DIR = dirname(configPath);

  // ── Prose sourced from files ────────────────────────────────────────────
  // popup.body / fileImport.note / licenses[].text may each be written
  // inline OR sourced from a config-relative file (the sibling '<field>File'
  // key) — see scripts/lib/prose-files.mjs. Resolved here, BEFORE
  // parsePopup/parseFileImport/parseLicenses run below, so each sees its
  // field already populated exactly as if it had been written inline; this
  // content is inlined into designs.json and never reaches the browser as
  // its own fetch (contrast a design's `// @doc` annotation, whose resolved
  // `designs[].doc` URL genuinely is fetched on demand).
  if (config.popup)
    config.popup = resolveFileField({
      obj: config.popup,
      field: "body",
      fileField: "bodyFile",
      CONFIG_DIR,
      mustExist,
      path: "popup",
    });
  if (config.fileImport && typeof config.fileImport === "object" && !Array.isArray(config.fileImport))
    config.fileImport = resolveFileField({
      obj: config.fileImport,
      field: "note",
      fileField: "noteFile",
      CONFIG_DIR,
      mustExist,
      path: "fileImport",
    });
  if (Array.isArray(config.licenses))
    config.licenses = config.licenses.map((entry, i) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? resolveFileField({
            obj: entry,
            field: "text",
            fileField: "textFile",
            CONFIG_DIR,
            mustExist,
            path: `licenses[${i}]`,
          })
        : entry
    );

  const { TITLE, ID, DESCRIPTION, LANG, DIR } = parseIdentity(config);

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
  // `features`/`format`/`fonts`/`fontFallback` now live under `render` (moved
  // in from the top level) — they're genuine render inputs, so they stay
  // folded into renderHash below exactly as before; only their config PATH
  // moved. `render.heavyMs`/`render.cache` are display/perf tuning and stay
  // OUT of renderHash — see CONFIG_SPEC.render's comment and RENDER below.
  const FEATURES = parseStringArray(config.render?.features, "features");
  const FORMAT = parseFormat(config.render?.format);
  // The 3D viewer's presentation, framing (restOnGrid) and per-control
  // visibility — all display-only, so VIEWER reaches the schema without
  // touching renderHash.
  const VIEWER = parseViewer(config.viewer);
  // Optional build-time render tuning (heavy-render threshold + cache
  // sizing) — NOT features/format/fonts/fontFallback, which parseRender
  // deliberately ignores (see its own comment); those are computed above/
  // below instead. Validated; absent -> null -> the app keeps its built-in
  // defaults.
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
  // Build-time UI behaviour config (panel side, default state, etc.). `install`
  // moved to `pwa.install` (see PWA below) — it's spliced back onto UI just
  // below so `schema.ui.install` still carries it, unmoved: App.tsx reads
  // `schema.ui?.install`, and this reorg only moves the CONFIG surface, not
  // designs.json's shape (see gen-schema.mjs's schema-assembly comment).
  const UI = { ...parseUi(config.ui) };
  // Manifest-only PWA chrome (install metadata, icons, theming) — see
  // CONFIG_SPEC.pwa's comment for why none of this is mirrored into
  // designs.json as its own "pwa" object. Always resolves (like parseUi/
  // parseViewer), defaults throughout when `config.pwa` is entirely absent.
  const PWA = parsePwa(config.pwa);
  UI.install = PWA.install;
  // `shortName` moved to `pwa.shortName`, still falling back to `title` —
  // matches designs.json's existing flat `shortName` field exactly.
  const SHORT_NAME = PWA.shortName ?? TITLE;
  // Optional generic file-import button (fonts, SVGs, data files, …). Validated.
  // Absent -> null -> no import button.
  const FILE_IMPORT = parseFileImport(config.fileImport);

  // ── In-app content ────────────────────────────────────────────────────────
  // Optional one-off notice dialog shown over the app on load. Validated; absent
  // -> null -> no popup.
  const POPUP = parsePopup(config.popup);
  // Optional help content; passed through verbatim (any `file` resolved to
  // its derived intro/sections first — see resolveHelp). Absent -> null ->
  // the app falls back to its generic, project-agnostic default help.
  const HELP = resolveHelp(config.help, CONFIG_DIR, mustExist);
  // ui.afterExport.helpTab (if set) must name an existing Help tab — checked
  // here rather than inside parseUi (config-parsers.mjs) because it's a
  // cross-field validation against HELP, only available now. Mirrors
  // HelpModal's own tab-list logic (top-level `help.sections` synthesize a
  // leading tab labelled "Overview" when `help.tabs` are also present — see
  // HelpModal.tsx's own HelpModal() — so a value that passes here is
  // guaranteed to match a real tab the modal renders).
  if (UI.afterExport?.helpTab) {
    const tabLabels = HELP?.tabs?.length
      ? [...(HELP.sections?.length ? ["Overview"] : []), ...HELP.tabs.map((t) => t.label)]
      : [];
    if (!tabLabels.includes(UI.afterExport.helpTab)) {
      throw new Error(
        `gen-schema: 'ui.afterExport.helpTab' is ${JSON.stringify(UI.afterExport.helpTab)}, but no 'help' tab has that label.\n` +
          (tabLabels.length
            ? `  Available tabs: ${tabLabels.map((l) => JSON.stringify(l)).join(", ")}`
            : `  This config's 'help' has no tabs defined.`)
      );
    }
  }
  // Config-driven notice categories surfaced on the OpenSCAD output panel.
  // Validated; off by default (omitted -> none).
  const NOTICES = parseNotices(config.notices);
  // Optional extra third-party software / license notices. Validated and
  // appended (never replacing the built-ins) by the in-app licenses modal.
  const LICENSES_EXTRA = parseLicenses(config.licenses);
  // Optional per-deployment UI text overrides (config's `strings` key),
  // validated against the bundled English catalogue's key set — see
  // src/lib/i18n.ts and docs/config.md's `strings` section. Absent -> {}.
  const EN_CATALOG_KEYS = Object.keys(JSON.parse(readFileSync(EN_CATALOG_PATH, "utf-8")));
  const STRINGS = parseStrings(config.strings, EN_CATALOG_KEYS);

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
      pwa: PWA,
      CONFIG_DIR,
      outPublicDir,
      TITLE,
      SHORT_NAME,
      DESCRIPTION,
      ID,
      LANG,
      DIR,
      THEME_COLOR: PWA.themeColor.dark,
      BG_COLOR: PWA.backgroundColor,
      CATEGORIES: PWA.categories,
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
    // Which ScadPub built this site (`git describe` of the ScadPub checkout, or
    // $SCADPUB_VERSION). Shown in the open-source licenses modal; omitted from
    // the JSON entirely when the build tree carries no git metadata. Display
    // only — deliberately NOT part of renderHash, since it can't affect geometry
    // (a code change that can already hashes the renderer's own sources).
    ...(version ? { scadpubVersion: version } : {}),
    // Versions of the bundled third-party packages, read from the node_modules
    // this build bundles from (scripts/lib/dep-versions.mjs). The licenses modal
    // reads them instead of carrying literals that drift from the dependency.
    // Display-only, like the stamp above — kept out of renderHash.
    componentVersions: components,
    // H4: per-file digests for wasm/glue/fonts/fonts.conf — see BIN_ASSETS above.
    binAssets: BIN_ASSETS,
    title: TITLE,
    shortName: SHORT_NAME,
    id: ID,
    description: DESCRIPTION,
    lang: LANG,
    dir: DIR,
    strings: STRINGS,
    // `pwa.themeColor.{dark,light}` in the config, still flat here — see the
    // module-level comment above generate() (and CONFIG_SPEC.pwa's own) for
    // why designs.json doesn't grow a nested "pwa" object to match: nothing
    // under `pwa` has a runtime reader, so this stays shaped for consumption
    // (vite.config.ts's meta-tag injection) rather than mirroring the config.
    themeColor: PWA.themeColor.dark,
    themeColorLight: PWA.themeColor.light,
    appleSplash,
    colors: COLORS,
    extraCss,
    logo,
    format: FORMAT,
    viewer: VIEWER,
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
      `src/generated/designs.json, public/scad/` +
      // Surfaced here too so a deploy log records which ScadPub produced the
      // bundle (and shows when the stamp is missing, e.g. a git-less tree).
      ` [ScadPub ${schema.scadpubVersion ?? "version unknown"}]`
  );
}

// Run only when executed directly (not when imported by the tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
