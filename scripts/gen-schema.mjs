// gen-schema.mjs: derive the configurator's parameter schema from a directory
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
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { WASM_VERSION } from "./wasm-version.mjs";
import { computeRenderHash, computeBinAssetVersions } from "./lib/hash.mjs";
import { fontFaces, fontFamilyNames, parseFontFallback, renderFontsConf } from "./lib/fonts.mjs";
import { humanize, parseParams } from "./lib/params.mjs";
import { createAssetTools } from "./lib/assets.mjs";
import { parseDesignStrings } from "./lib/design-strings.mjs";
import {
  parseTextKey,
  loadTextFiles,
  foldConfigText,
  textDrift,
  textStampsPath,
} from "./lib/config-text.mjs";
import { translatableFields, driftFields, sha256Hex } from "./lib/i18n-coverage.mjs";
import { createDestinationRegistry, reconcileGenerated } from "./lib/destinations.mjs";
import { sanitizeBrowserFacingSvg } from "./lib/svg-sanitize.mjs";
import { resolveFileField } from "./lib/prose-files.mjs";
import { splitHelpMarkdown } from "./lib/help-file.mjs";
import { checkHelpShape, OVERVIEW_TAB_ID } from "../src/lib/helpShape.mjs";
// TypeScript, imported directly: Node strips the types (the repo already
// requires that, see CLAUDE.md), and schema.ts's only value import is
// helpShape.mjs, so no app code is dragged into the build script.
import { validateSchema } from "../src/lib/schema.ts";
// Data-only (no JSON, no React): the registry of locales ScadPub ships chrome
// translations for, imported directly under Node's type stripping, the same
// as src/lib/schema.ts above. `LOCALE_TAGS` feeds parseLanguages's
// `registryTags` argument (see parseIdentity below).
import { LOCALE_TAGS } from "../src/lib/localeRegistry.ts";
import { slugifyPresetNames } from "./lib/preset-slug.mjs";
import { resolveWorkerDependencyClosure } from "./lib/worker-deps.mjs";
import { generatePwaAssets, commitPwaBatch } from "./lib/pwa-assets.mjs";
import { scadpubVersion } from "./lib/version.mjs";
import { componentVersions } from "./lib/dep-versions.mjs";
import {
  applyGroupSpec,
  applyTopLevelScalars,
  parseColors,
  parseDir,
  parseFileImport,
  parseFormat,
  parseLang,
  parseLanguages,
  parseLicenses,
  parseLocalizableText,
  parseNotices,
  parsePopup,
  parsePwa,
  parseRender,
  parseStringArray,
  parseStrings,
  parseUi,
  parseViewer,
  unknownNestedKeyError,
  optionalStringFieldError,
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
  parseLanguages,
  parseLicenses,
  parseLocalizableText,
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
export { parseDesignStrings } from "./lib/design-strings.mjs";
export {
  parseTextKey,
  loadTextFiles,
  foldConfigText,
  flattenTextLeaves,
  configTextCoverage,
  computeTextStamps,
  textDrift,
  textStampsPath,
} from "./lib/config-text.mjs";

// Re-exported so scripts/i18n-status.mjs can drive the SAME config-loading
// and design-parsing steps generate() itself uses, rather than re-implementing
// any part of them: see that script's own doc for why it needs the pre-strip
// per-design shape (`stringsByTag`/`presetNames`/`docAbs`) buildDesigns
// produces, which designs.json's own generate() output no longer carries once
// assembleSchema strips it.
export { loadConfig, parseIdentity, makeMustExist, buildDesigns };

// Every top-level key gen-schema (or its helpers) reads from scadpub.config.json,
// derived from scripts/lib/config-spec.mjs rather than hand-maintained here. A
// key outside the set is almost always a typo (`popups`, `fontfallback`, …) that
// would otherwise be silently ignored, so an unrecognised top-level key fails
// the build, matching the fail-fast convention for unknown *nested* keys (colour
// tokens, license fields). `$schema` is allowed so a config can point at a JSON
// Schema for editor tooling. Re-exported because tests import it directly.
export { KNOWN_TOP_LEVEL_KEYS };

// Extensions tried, in order, for a `designs[].presets.images` DIRECTORY
// entry's per-preset lookup (see buildDesigns): the same three image types
// the map form documents accepting (docs/config.md).
const PRESET_IMAGE_EXTENSIONS = [".svg", ".png", ".webp"];

// Path to the bundled English UI-text catalogue (src/locales/en.json),
// resolved relative to this file rather than the config being built: it's
// part of the app, not the consumer's project. `strings` overrides are
// validated against its key set (see parseStrings): a config key that isn't a
// real catalogue key would otherwise be silently ignored by every `t()` call.
const EN_CATALOG_PATH = fileURLToPath(new URL("../src/locales/en.json", import.meta.url));

// Read once, not once per generate(): the catalogue is part of the app, so it
// cannot change between calls within a process, and the test suite calls
// generate() 250-odd times.
let enCatalogKeysCache = null;
function enCatalogKeys() {
  return (enCatalogKeysCache ??= Object.keys(
    JSON.parse(readFileSync(EN_CATALOG_PATH, "utf-8"))
  ));
}

// Fail early and clearly when a configured path doesn't exist: these are the
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
// (`${id}.scad`), the URL deep link (`#d=${id}`), manifest shortcuts, and,
// for the app-level id: the theme key inside index.html's inline pre-paint
// <script> string literal, so restrict it to a safe, path/URL/script-friendly
// character set. Used for both the app id and every design id.
const checkId = (id, what = "design id") => {
  // "." and ".." match the charset but are path traversal, not names: the id is
  // spliced into `${id}.scad`, into a served URL, and (for the app id) into an
  // inline <script> string literal in index.html.
  if (typeof id !== "string" || !/^[A-Za-z0-9._-]+$/.test(id) || /^\.+$/.test(id))
    throw new Error(
      `gen-schema: ${what} ${JSON.stringify(id)} must match [A-Za-z0-9._-]+ and not be dots alone`
    );
  return id;
};

// Dotted extension (incl. the leading dot) of a relative path, or "" when it
// has none. `dot > 0` so a leading-dot "dotfile" with no real extension yields
// "" rather than the whole basename.
export const extOf = (relPath) => {
  const dot = relPath.lastIndexOf(".");
  const ext = dot > 0 ? relPath.slice(dot) : "";
  // The result is spliced into a generated destination filename
  // (`${id}-icon${ext}`), so constrain it to a real extension. A source path
  // that resolves fine but ends in something like `.svg/../../x` must not be
  // able to steer that write out of the staged tree.
  return /^\.[A-Za-z0-9]+$/.test(ext) ? ext : "";
};

// Escape a literal string for embedding in a RegExp — used to build a
// design's own translation-sidecar filename pattern (buildDesigns) from its
// basename, which is arbitrary user-chosen text, not itself regex-safe.
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Load + sanity-check the config. Catches genuinely typo'd / stale top-level
// keys: a whole-key typo would otherwise be silently ignored (see
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

// title/id/description/lang/dir only: document chrome and storage
// namespacing, read by the running app itself. Everything that's a
// manifest/icon-rasterizer INPUT ONLY (shortName, icon, iconMaskable,
// themeColor/themeColorLight, backgroundColor, categories, screenshots,
// shortcuts, install) now lives under the config's `pwa` block, see
// parsePwa (scripts/lib/config-parsers.mjs) and CONFIG_SPEC.pwa's comment,
// and is computed separately, below, so it can feed both `generatePwaAssets`
// and (unchanged) designs.json's own flat `themeColor`/`themeColorLight` keys.
function parseIdentity(config) {
  // title/description carry CONFIG_SPEC descriptors (including their defaults);
  // applying them is what turns `"title": 42` into a named gen-schema error
  // instead of a TypeError from vite-config three steps later.
  const { title: TITLE, description: DESCRIPTION } = applyTopLevelScalars(config, ["title", "description"]);
  const ID = checkId(config.id ?? "scadpub", "config 'id'");
  // Document / manifest language and text direction, validated so they're safe
  // to interpolate into the generated <html lang dir> attributes and the manifest.
  const LANG = parseLang(config.lang);
  const DIR = parseDir(config.dir);
  // Which shipped chrome locales this deployment's language switcher offers
  // (config's `languages` key); computed alongside LANG since parseLanguages
  // needs it to resolve the default-locale rules described in its own
  // comment (scripts/lib/config-parsers.mjs). Always resolves to a
  // non-empty array, unlike most optional fields here.
  const LANGUAGES = parseLanguages(config.languages, LOCALE_TAGS, LANG);
  return { TITLE, ID, DESCRIPTION, LANG, DIR, LANGUAGES };
}

// Fonts are referenced by basename under /fonts. An entry is either a font
// already present in public/fonts (the Liberation fallbacks that ship with the
// app) or a path into the source tree (a design repo bundling its own font),
// which we copy into public/fonts so it is served like the rest. Also writes
// the fontconfig config the renderer mounts: optionally pinning a weak
// last-resort fallback family (config.render.fontFallback) so an imported font
// can't hijack Fontconfig's global default; generated into the served tree
// (and hashed into renderHash) so the matching rules stay config-driven.
// `fonts`/`fontFallback` live under `render` in the config: both are genuine
// render inputs and are part of renderHash.
// `register`/`checkContained` are the H5/H6 helpers from createAssetTools:
// a source-tree font is checked against SOURCE containment (a font path is a
// source-owned path, like a design or asset) and its destination is
// registered so two `fonts` entries that share a basename from different
// source directories collide loudly instead of one silently overwriting the
// other. `fontCopies` collects every dest this call actually wrote: the
// tracked Liberation fallbacks under public/fonts are never written here (the
// "already present" branch below is a no-op, and a config font that would
// SHADOW one is refused outright by the isTrackedFile check), so they never
// enter the list and stay outside the M8 generated-font lifecycle the caller
// reconciles.
//
// M9: the transient-copy warning: the M8 reconciliation above (see
// destinations.mjs) means a font copied from outside the current build's own
// config is never a permanent leak. The NEXT build against this checkout's
// own config removes it. The real exposure is the window in between: if
// someone runs `git add -A` in that window, the untracked font rides along
// into an unrelated commit. `runGitQuiet`/`isRiskyExternalFontCopy` decide,
// at the moment a font is staged for copying, whether this build is actually
// creating that exposure, so bundleFonts can warn right there instead of the
// old (wrong) CLAUDE.md ritual of hand-deleting after the fact.
//
// `git` is injectable (tests/gen-schema.test.mjs drives it with a stub, same
// pattern as scripts/lib/version.mjs's `runGit`) so the decision is testable
// without a real subprocess or a real git checkout on disk.
function runGitQuiet(dir, args) {
  try {
    return execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      // Inherit nothing on stdin, capture stdout, discard git's diagnostics:
      // a build must never fail, or get noisier, because this probe ran.
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
  } catch {
    return ""; // git missing, outPublicDir doesn't exist yet, not a repo, …
  }
}

// True only when copying `srcAbs` to `outPublicDir/fonts/` risks landing an
// external deployment's font where a `git add -A` could sweep it into a
// commit:
//   - `outPublicDir` must sit inside a git working tree at all. A release
//     tarball or an npm-packed tree isn't one, and nothing there is ever
//     `git add`-ed from.
//   - that checkout's HEAD must be ATTACHED to a branch. A checkout built
//     purely to be thrown away: e.g. a consumer's tools/build-site.sh, which
//     `git checkout --detach`s a fresh ScadPub clone into a directory ITS OWN
//     .gitignore excludes, purely to build against its own config. Is never
//     the target of a stray `git add -A`. Flagging it would cry wolf on
//     exactly the workflow the M8 reconciliation already handles silently
//     every run.
//   - `srcAbs` must lie OUTSIDE that checkout. A design bundling a new font
//     from within ScadPub's own source tree (not yet copied to public/fonts)
//     is an ordinary same-repo change a contributor means to commit, not a
//     stray deployment artifact.
export function isRiskyExternalFontCopy(outPublicDir, srcAbs, git = runGitQuiet) {
  return isRiskyExternalFontCopyIn(gitContext(outPublicDir, git), srcAbs);
}

/** The two `git` answers isRiskyExternalFontCopy needs, both of which depend
 *  only on the destination directory. Probed ONCE per build rather than once
 *  per bundled font: each is a subprocess, and a six-face deployment was
 *  spawning a dozen of them to ask the same two questions. */
function gitContext(outPublicDir, git = runGitQuiet) {
  const toplevel = git(outPublicDir, ["rev-parse", "--show-toplevel"]);
  if (!toplevel) return null; // not inside any git working tree
  const branch = git(outPublicDir, ["symbolic-ref", "-q", "--short", "HEAD"]);
  if (!branch) return null; // detached HEAD: a disposable build-only clone
  return { toplevel };
}

function isRiskyExternalFontCopyIn(ctx, srcAbs) {
  if (!ctx) return false;
  const rel = relative(ctx.toplevel, srcAbs);
  return rel === ".." || rel.startsWith(`..${sep}`);
}

// Whether `abs` is a file git already tracks. Used to tell a bundled font that
// ships with the app (tracked under public/fonts) from a previous run's
// transient copy of an external one (untracked): only the latter is this tool's
// to overwrite and later reconcile away. Outside a git working tree — a release
// tarball, an npm-packed tree — nothing is tracked and nothing can be committed
// by accident, so the answer is correctly "no".
export function isTrackedFile(abs, git = runGitQuiet) {
  return git(dirname(abs), ["ls-files", "--error-unmatch", "--", abs]) !== "";
}

function bundleFonts(config, SOURCE, outPublicDir, configPath, { checkContained, register, fontCopies } = {}) {
  // The font tree is generated output too, so (like the scad tree) it is
  // validated, digested and family/face-read here but NOT written into the live
  // public/fonts until generate()'s commit point (see the caller). Otherwise a
  // later fallible step (design parsing, asset validation, PWA rasterization)
  // would leave a replaced font (or a rewritten fonts.conf) paired with the
  // PREVIOUS build's scad/schema: an internally inconsistent last-good set.
  // `fontWrites` are the deferred source->dest copies; `fontsConf` is the
  // rendered config content to write at commit; `fontPaths` maps each font name
  // to where its bytes can be READ right now (its source file, or an
  // already-present public/fonts fallback) so hashing works before the copy.
  const fontWrites = [];
  const fontPaths = {};
  // Probed once for the whole FONTS loop below (see gitContext).
  const gitCtx = outPublicDir ? gitContext(outPublicDir) : null;
  const FONTS = (config.render?.fonts ?? []).map((entry) => {
    const name = String(entry).split(/[\\/]/).pop();
    const srcAbs = resolve(SOURCE, entry);
    if (outPublicDir) {
      if (existsSync(srcAbs) && statSync(srcAbs).isFile()) {
        checkContained?.(srcAbs, `font '${entry}'`, configPath);
        const dest = join(outPublicDir, "fonts", name);
        // The destination is keyed on the basename, so a config listing
        // `myfonts/LiberationSans-Regular.ttf` aims at a TRACKED bundled font.
        // Overwriting it puts the copy into the generated manifest, and the
        // next build against a config without that entry deletes tracked repo
        // content. A shadowed bundled font is a real conflict either way.
        if (existsSync(dest) && isTrackedFile(dest)) {
          throw new Error(
            `gen-schema: font '${entry}' would overwrite the bundled font at\n  ${dest}\n` +
              `  (a tracked file that ships with ScadPub; a config font may not shadow one)\n` +
              `  Rename the font file, or drop the entry and reference '${name}' directly.\n` +
              `  (referenced from ${configPath} — check its 'render.fonts')`
          );
        }
        register?.(dest, `font '${entry}'`);
        fontWrites.push({ src: srcAbs, dest });
        fontCopies?.push(dest);
        fontPaths[name] = srcAbs; // source bytes == the bytes that will be copied
        if (isRiskyExternalFontCopyIn(gitCtx, srcAbs)) {
          console.warn(
            `gen-schema: '${name}' is being copied into public/fonts/ from outside this ` +
              `ScadPub checkout (${srcAbs}).\n` +
              `  This copy is transient: the next build against THIS checkout's own config ` +
              `removes it again (M8 reconciliation). Do not \`git add\`/commit it in the ` +
              `meantime — if you want it gone right now, rebuild against your own config ` +
              `instead of hand-deleting it.`
          );
        }
      } else if (existsSync(join(outPublicDir, "fonts", name))) {
        // An already-bundled font (e.g. the Liberation fallbacks tracked under
        // public/fonts): read it in place; it isn't rewritten, so no staging.
        fontPaths[name] = join(outPublicDir, "fonts", name);
      } else {
        // Neither a source-tree path nor an already-bundled font. A silent skip
        // here would ship an app whose `// @font` selector lists a face that can
        // never load.
        throw new Error(
          `gen-schema: font '${entry}' not found:\n  ${srcAbs}\n` +
            `  (and not already present in public/fonts/${name})\n` +
            `  (referenced from ${configPath} — check its 'render.fonts')`
        );
      }
    }
    return name;
  });
  const FONT_FALLBACK = parseFontFallback(config.render?.fontFallback, "render.fontFallback");
  const fontsConf = outPublicDir ? renderFontsConf(FONT_FALLBACK) : null;
  // The bundled fonts' real embedded family names, so the app can decide font
  // availability by family rather than filename, plus their face descriptions
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
    // docs/config.md states the rule ("must name one of the bundled families")
    // but nothing enforced it: a typo pinned fonts.conf's last-resort family to
    // a name Fontconfig cannot resolve, which is precisely the state the pin
    // exists to prevent. The sibling font-file check already fails this way.
    if (
      FONT_FALLBACK !== null &&
      !FONT_FAMILIES.some((f) => f.toLowerCase() === FONT_FALLBACK.toLowerCase())
    ) {
      throw new Error(
        `gen-schema: 'render.fontFallback' names ${JSON.stringify(FONT_FALLBACK)}, ` +
          `which is not one of the bundled font families.\n` +
          `  Bundled: ${FONT_FAMILIES.map((f) => JSON.stringify(f)).join(", ") || "(none)"}\n` +
          `  (check 'render.fonts' — the fallback must name a family this build ships)`
      );
    }
    FONT_FACES.sort(
      (a, b) => a.family.localeCompare(b.family) || a.style.localeCompare(b.style)
    );
  }
  return { FONTS, FONT_FAMILIES, FONT_FACES, fontPaths, fontsConf, fontWrites };
}

// Copy a BROWSER-FACING file (logo, design picker icon/image, bundled-preset
// thumbnail, PWA icon, always rendered in an <img>/<use>/CSS context, never fed
// to OpenSCAD) from `src` to `dest`. Every caller below writes `dest` under
// public/art/, not public/scad/: this is generated artwork, not render input,
// so public/sw.js's stale-while-revalidate branch (network-first only applies
// to scad/) can serve it cache-first. An .svg source is run through
// sanitizeSvg() first (M13, see docs/config.md "SVG asset trust model" and
// scripts/lib/svg-sanitize.mjs): cheap defense-in-depth so a served SVG can't
// execute as an active document if it's ever navigated to directly, without
// needing to trust every byte of operator-supplied markup. Anything else (PNG,
// …) copies verbatim. Deliberately NOT used for render-input assets (copyAsset,
// below): those are geometry OpenSCAD's import()/surface() reads, not display
// markup, and are covered by the operator-input trust boundary + public/_headers
// instead.
function copyBrowserFacing(src, dest) {
  if (/\.svg$/i.test(src)) {
    writeFileSync(dest, sanitizeBrowserFacingSvg(readFileSync(src, "utf-8"), { src }));
  } else {
    copyFileSync(src, dest);
  }
}

// Optional header logo, per theme. `logo` may be a string (used for both
// themes) or { light, dark } (either may be omitted -> the other is used).
// Each referenced file is copied into the served tree; returns the resolved
// { light, dark } URLs, or null when no logo is configured.
function copyLogoAssets(config, CONFIG_DIR, outArtDir, mustExist, register) {
  if (!config.logo) return null;
  // Map each resolved source to the URL it was copied to, so a single source
  // used for both themes is copied once and two distinct sources never clobber
  // each other, even when they share a basename (light/logo.svg vs
  // dark/logo.svg), which a flat basename would silently overwrite. `register`
  // (H6) additionally catches a logo basename colliding with some other
  // generated output class (a design icon/image/preset thumbnail) sharing the
  // same flat public/art/ namespace.
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
    const dest = join(outArtDir, name);
    register(dest, `logo '${src}'`);
    copyBrowserFacing(abs, dest);
    const url = `art/${name}`;
    copiedByAbs.set(abs, url);
    return url;
  };
  const entry = config.logo;
  const lightSrc = typeof entry === "string" ? entry : entry.light ?? entry.dark;
  const darkSrc = typeof entry === "string" ? entry : entry.dark ?? entry.light;
  return { light: copyLogo(lightSrc), dark: copyLogo(darkSrc) };
}

// A design's root source must be a .scad file. Anything else is parsed as
// OpenSCAD anyway AND has its `<name>.json` sibling read as a parameterSets
// file, so a config naming `plate.json` would try to parse the presets as a
// design and the design as presets.
const checkScadFile = (file, id) => {
  if (typeof file !== "string" || !/\.scad$/i.test(file.trim()))
    throw new Error(
      `gen-schema: design '${id}' 'file' must be a .scad path (got ${JSON.stringify(file)})`
    );
  return file.trim();
};

// The design list from the config, or auto-discovered root .scad files.
// `group`'s pre-LocalizableText behaviour was permissive by design: any
// non-string value (or a blank/whitespace-only string) silently collapsed to
// `null` (unset) rather than failing the build — the same "a malformed
// optional value quietly becomes absent" leniency `collapseEmptyToNull`
// gives an empty tuning object elsewhere in this config (see
// config-spec.mjs's file-top comment). Restored here for the plain-string
// form specifically, so an existing config's `group` still behaves
// identically. The new OBJECT (LocalizableText map) form has no back-compat
// history to preserve — it's validated strictly through
// `parseLocalizableText`, same as every other localizable field, so a
// genuinely malformed map (a locale outside `languages`, a missing default
// tag, a non-string entry) still fails the build rather than silently
// disappearing.
function parseGroupLocalizable(raw, id, languages, defaultTag) {
  if (raw == null) return null;
  if (typeof raw === "string") return raw.trim() ? raw.trim() : null;
  if (typeof raw === "object" && !Array.isArray(raw))
    return parseLocalizableText(raw, `designs[${id}].group`, languages, defaultTag);
  return null;
}

function resolveDesignList(config, SOURCE, languages, defaultTag) {
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
  // `designs[].presets.images` alone additionally accepts a plain STRING: a
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
  // Absent means "auto-discover"; present-but-not-a-non-empty-array is a
  // mistake. Falling through to auto-discovery for both inverted the fail-fast
  // convention every other key follows: `"designs": {}` built green, silently
  // ignoring the list its author wrote.
  if (config.designs != null && (!Array.isArray(config.designs) || !config.designs.length))
    throw new Error(
      "gen-schema: 'designs', when set, must be a non-empty array of design objects.\n" +
        "  Omit the key entirely to auto-discover *.scad in 'source'."
    );
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
      // has: a stale or mistyped key (a flat 'icon', or a leftover
      // 'description'/'media'/'review' from before a design's own metadata
      // became the sole source, see docs/annotations.md) was silently
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
      // gives it unknown-key rejection for free, see config-spec.mjs's
      // DESIGN_PRESETS_SPEC comment. `presets.images` is `custom: true` (its
      // value needs a cross-reference against parse results only
      // buildDesigns has), so this only validates the surrounding object's
      // shape/unknown keys; `checkPresetImages` below does the per-key check.
      applyGroupSpec(d.presets ?? {}, CONFIG_SPEC.designs.items.properties.presets, `designs[${id}].presets`);
      return {
        id,
        label: d.label != null ? parseLocalizableText(d.label, `designs[${id}].label`, languages, defaultTag) : humanize(d.id),
        file: checkScadFile(d.file ?? `${d.id}.scad`, id),
        // Heavy designs skip the debounced auto-render (the user renders on demand).
        heavy: d.heavy ?? false,
        // Optional dropdown grouping header (designs sharing a group cluster).
        group: parseGroupLocalizable(d.group, id, languages, defaultTag),
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

// The named parameter sets in a design's sibling parameterSets file. A syntax
// error there is the author's typo, not a crash site: JSON.parse's own message
// names neither the file nor the design.
function readPresetNames(presetAbs, presetRel, id) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(presetAbs, "utf-8"));
  } catch (e) {
    throw new Error(
      `gen-schema: design '${id}' parameterSets file '${presetRel}' is not valid JSON:\n` +
        `  ${e.message}`,
      { cause: e }
    );
  }
  return Object.keys(parsed?.parameterSets ?? {});
}

function resolvePresetImages({
  presetImagesSrc,
  presetNames,
  presetRel,
  d,
  CONFIG_DIR,
  outArtDir,
  mustExist,
  register,
}) {
  // Bundled-preset thumbnails (`designs[].presets.images`), either form:
  //   - MAP: each key must name an actual preset in the sibling
  //     parameterSets file. The same typo-protection stance as the rest of
  //     the config, so a stale/misspelled preset name fails the build
  //     instead of silently rendering a text-only card forever. Each value
  //     is a config-relative image path, copied under a deterministic
  //     `<id>-preset-<n>.<ext>` name (n = insertion order: the preset NAME
  //     itself, not the filename, is what the UI keys off of).
  //   - DIRECTORY: every bundled preset's image is looked up by slugifying
  //     its name (scripts/lib/preset-slug.mjs) and trying the supported
  //     extensions in turn. A preset with no matching file has no
  //     image (preset images are optional per preset either way) but the
  //     directory itself must exist, and the match count is logged so a
  //     wrong-but-existing directory (e.g. every name misspelled) is
  //     visible in the build log rather than silently yielding zero images.
  let presetImages;
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
      const dest = join(outArtDir, outName);
      register(dest, `design '${d.id}' presets.images["${presetName}"]`);
      copyBrowserFacing(src, dest);
      presetImages[presetName] = `art/${outName}`;
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
      const dest = join(outArtDir, outName);
      register(dest, `design '${d.id}' presets.images["${presetName}"]`);
      copyBrowserFacing(join(dirAbs, fileName), dest);
      presetImages[presetName] = `art/${outName}`;
      matched++;
    }
    console.log(
      `gen-schema: design '${d.id}' presets.images: ${matched}/${presetNames.length} preset(s) ` +
        `matched an image in '${dirRel}'`
    );
    if (!Object.keys(presetImages).length) presetImages = undefined;
  }
  return presetImages;
}

// Parse each design's Customizer parameters and copy its .scad, sibling
// parameterSets .json, and picker icon into the served tree.
function buildDesigns({ config, SOURCE, CONFIG_DIR, outScadDir, outArtDir, mustExist, checkContained, relPosix, copyAsset, register, languages, defaultTag }) {
  // designDir -> Set of every design's sidecar base seen in that directory,
  // collected below as each design is processed; used after the .map() to
  // find sidecar-SHAPED files that match no design at all (see the orphan
  // scan below).
  const sidecarBasesByDir = new Map();
  // Every directory that currently holds at least one design's '// @doc'
  // target, collected below as each design is processed; scoped just like
  // sidecarBasesByDir's directories, but doc's own orphan scan (below) can't
  // reuse that Map's "matches no known BASE" test — a doc translation carries
  // no infix distinguishing it from an unrelated multi-dot Markdown file
  // (this repo's own `help-printing.de.md` sits right beside a live doc and
  // must never be misread as one of ITS translations), so it instead checks
  // each candidate's OWN base file for physical presence in the directory.
  const docDirs = new Set();
  const designs = resolveDesignList(config, SOURCE, languages, defaultTag).map(({ presetImagesSrc, ...d }) => {
    const abs = mustExist(join(SOURCE, d.file), `design '${d.id}' source file '${d.file}'`);
    checkContained(abs, `design '${d.id}' source file '${d.file}'`, `design '${d.id}' config entry`);
    const { params, sections, collapsedSections, meta } = parseParams(abs);
    copyAsset(d.file);
    // Auto-detect a sibling OpenSCAD parameterSets file: <name>.scad -> <name>.json
    // next to it. One file can hold multiple named sets; absent -> no bundled presets.
    const presetRel = d.file.replace(/\.scad$/, ".json");
    const presetAbs = join(SOURCE, presetRel);
    // H5: the sibling parameterSets file is copied into the served tree like the
    // .scad above, so it must clear the same symlink-containment check first.
    // Otherwise a <name>.json symlinked outside SOURCE would be followed and its
    // target copied into public/scad/ (exactly the escape checkContained refuses
    // for the design's own source). checkContained throws on an escape.
    const presets = existsSync(presetAbs) ? [presetRel] : [];
    if (presets.length) {
      checkContained(presetAbs, `design '${d.id}' parameterSets file '${presetRel}'`, `design '${d.id}'`);
      copyAsset(presetRel);
    }
    // Description/icon/image/doc come ONLY from the design's own annotations
    // now: `// @description`/`// @icon`/`// @image`/`// @doc` (see
    // docs/annotations.md); there is no config-level override left. Each
    // path resolves relative to the design's own .scad file, i.e. within
    // SOURCE, so each is also checked to stay contained in it. Copy icon/
    // image into public/art/ (not public/scad/: browser-facing artwork the
    // service worker can serve cache-first, not a build-volatile render
    // input) under a deterministic `<id>-icon.<ext>` / `<id>-image.<ext>`
    // name so distinct designs never clobber each other; the id charset is
    // already URL-safe.
    const description = meta.description;
    let icon = null;
    if (meta.icon) {
      const src = mustExist(resolve(dirname(abs), meta.icon), `design '${d.id}' icon '${meta.icon}'`);
      checkContained(src, `design '${d.id}' icon '${meta.icon}'`, relPosix(abs));
      const ext = extOf(meta.icon);
      const name = `${d.id}-icon${ext}`;
      const dest = join(outArtDir, name);
      register(dest, `design '${d.id}' icon`);
      copyBrowserFacing(src, dest);
      icon = `art/${name}`;
    }
    // Larger card artwork for the optional visual picker.
    let image = null;
    if (meta.image) {
      const src = mustExist(resolve(dirname(abs), meta.image), `design '${d.id}' image '${meta.image}'`);
      checkContained(src, `design '${d.id}' image '${meta.image}'`, relPosix(abs));
      const ext = extOf(meta.image);
      const name = `${d.id}-image${ext}`;
      const dest = join(outArtDir, name);
      register(dest, `design '${d.id}' image`);
      copyBrowserFacing(src, dest);
      image = `art/${name}`;
    }
    // User documentation, same base/containment rule as icon/image. The
    // Markdown file is copied verbatim under a deterministic `<id>-doc.md`
    // name; its served URL is fetched on demand and rendered by the doc
    // modal. Pure prose, so it's excluded from renderHash (it can't affect
    // geometry).
    let doc = null;
    let docAbs = null;
    // Directory/basename/extension of the doc file itself, e.g.
    // 'docs/guides/nameplate.md' -> ('docs/guides', 'nameplate', '.md').
    // Per-locale doc translations (below) are named from these, not from the
    // design's own basename, since the doc can live anywhere the '// @doc'
    // path points it.
    let docDir = null;
    let docBase = null;
    let docExt = null;
    if (meta.doc) {
      docAbs = mustExist(resolve(dirname(abs), meta.doc), `design '${d.id}' doc '${meta.doc}'`);
      checkContained(docAbs, `design '${d.id}' doc '${meta.doc}'`, relPosix(abs));
      docDir = dirname(docAbs);
      docExt = extname(docAbs);
      docBase = basename(docAbs, docExt);
      const name = `${d.id}-doc.md`;
      const dest = join(outScadDir, name);
      register(dest, `design '${d.id}' doc`);
      copyFileSync(docAbs, dest);
      doc = `scad/${name}`;
    }
    const presetNames = presets.length ? readPresetNames(presetAbs, presetRel, d.id) : [];
    const presetImages = resolvePresetImages({
      presetImagesSrc,
      presetNames,
      presetRel,
      d,
      CONFIG_DIR,
      outArtDir,
      mustExist,
      register,
    });
    // `reviewLabels`: each declared parameter's own `// @review "<label>"`
    // annotation (see scripts/lib/params.mjs and docs/annotations.md). The
    // sole source, with no config-level override. A label can only ever be
    // declared on a real parameter in the first place, so there's no separate
    // cross-reference to run here.
    const reviewLabels = {};
    for (const p of params) {
      if (p.reviewLabel) reviewLabels[p.name] = p.reviewLabel;
    }
    // `reviewNote`: the design's own file-level `// @reviewNote "<text>"`
    // annotation. The sole source now, with no config-level override left.
    const reviewNote = meta.reviewNote ?? null;

    // Design-translation sidecars: `<design>.strings.<tag>.json` beside the
    // design's own .scad (docs/config.md "Design translations"), the same
    // sibling-file idiom as the parameterSets `.json` above. Two passes: probe
    // each REGISTRY tag's exact filename directly (the file a translation for
    // a locale ScadPub actually ships would be named), then separately scan
    // the whole directory for anything else shaped like a sidecar — a typo'd
    // tag (`widget.strings.dee.json`) matches no registry probe and would
    // otherwise sit there silently forever, translating nothing and telling no
    // one. Never copyAsset/register'd: a sidecar must never reach
    // public/scad/ or renderHash, so parsing is the only thing that happens
    // to it here; `stringsByTag` is a transient field generate() reads to
    // build src/generated/i18n/<tag>.json, then strips before assembleSchema
    // (see its own `designs.map` at the end of this file).
    const designDir = dirname(abs);
    const sidecarBase = basename(d.file).replace(/\.scad$/, "");
    if (!sidecarBasesByDir.has(designDir)) sidecarBasesByDir.set(designDir, new Set());
    sidecarBasesByDir.get(designDir).add(sidecarBase);
    // Case-insensitive: a macOS/Windows filesystem resolves `widget.strings.de.json`
    // and `widget.Strings.DE.json` to the same file, so the exact-case probe
    // below (`sidecarAbs`) would happily load a wrongly-cased sidecar on those
    // filesystems while this scan, if case-sensitive, stayed blind to it —
    // the file would silently take effect without ever being caught as
    // misnamed. Matching case-insensitively here means every such file is at
    // least SEEN; the tag-case check right below decides whether to accept or
    // reject it.
    const sidecarRe = new RegExp(`^${escapeRegExp(sidecarBase)}\\.(strings)\\.([A-Za-z0-9-]+)\\.json$`, "i");
    for (const name of readdirSync(designDir)) {
      const m = name.match(sidecarRe);
      if (!m) continue;
      const [, infix, tag] = m;
      // The `i` flag above catches the file at all regardless of case; a
      // wrongly-cased `strings` infix (`.Strings.`/`.STRINGS.`) would
      // otherwise pass every check below unnoticed — matched here, but
      // loaded by the per-tag probe further down via an exact-case path
      // that only a case-INsensitive filesystem (macOS) resolves to it. On
      // Linux it stays silently inert instead. Reject it the same way as a
      // wrongly-cased tag.
      if (infix !== "strings")
        throw new Error(
          `gen-schema: design '${d.id}' translation sidecar '${relPosix(join(designDir, name))}' has the ` +
            `wrong case for 'strings' in its filename, but sidecar filenames are matched case-sensitively. ` +
            `Rename it to '${sidecarBase}.strings.${tag}.json'.`
        );
      // `<base>.strings.stamps.json` (the i18n:status freshness-stamp file,
      // see scripts/i18n-status.mjs) is sidecar-SHAPED but not a locale
      // sidecar at all: "stamps" would otherwise match this loop's tag
      // capture and get rejected as an unshipped locale. It's handled
      // (parsed for drift warnings) separately below, never through this scan
      // — but a wrongly-cased 'stamps' is caught here for the same reason as
      // the 'strings' infix above.
      if (tag.toLowerCase() === "stamps") {
        if (tag !== "stamps")
          throw new Error(
            `gen-schema: design '${d.id}' translation sidecar '${relPosix(join(designDir, name))}' has the ` +
              `wrong case for 'stamps' in its filename, but sidecar filenames are matched case-sensitively. ` +
              `Rename it to '${sidecarBase}.strings.stamps.json'.`
          );
        continue;
      }
      if (LOCALE_TAGS.includes(tag)) continue;
      const lower = tag.toLowerCase();
      if (LOCALE_TAGS.includes(lower))
        throw new Error(
          `gen-schema: design '${d.id}' translation sidecar '${relPosix(join(designDir, name))}' names ` +
            `locale tag '${tag}', but sidecar tags are matched case-sensitively. Rename it to ` +
            `'${sidecarBase}.strings.${lower}.json'.`
        );
      throw new Error(
        `gen-schema: design '${d.id}' translation sidecar '${relPosix(join(designDir, name))}' names ` +
          `an unshipped locale tag '${tag}'.\n  Valid tags: ${LOCALE_TAGS.join(", ")}`
      );
    }
    const sidecarCtxParams = params.map((p) => ({
      name: p.name,
      choices: p.type === "enum" ? p.choices.map((c) => c.value) : null,
      hasInfo: p.info != null,
    }));
    const stringsByTag = {};
    for (const tag of LOCALE_TAGS) {
      const sidecarRel = d.file.replace(/\.scad$/, `.strings.${tag}.json`);
      const sidecarAbs = join(SOURCE, sidecarRel);
      if (!existsSync(sidecarAbs)) continue;
      checkContained(sidecarAbs, `design '${d.id}' translation sidecar '${sidecarRel}'`, relPosix(abs));
      let json;
      try {
        json = JSON.parse(readFileSync(sidecarAbs, "utf-8"));
      } catch (err) {
        throw new Error(
          `gen-schema: '${sidecarRel}' is not valid JSON:\n  ${err.message}`,
          { cause: err }
        );
      }
      stringsByTag[tag] = parseDesignStrings(json, {
        file: sidecarRel,
        designId: d.id,
        params: sidecarCtxParams,
        sections,
        hasDescription: meta.description != null,
        reviewLabels: new Set(Object.keys(reviewLabels)),
        hasReviewNote: reviewNote != null,
        presetNames,
      });
    }

    // Migration guard for the RETIRED '<design>.doc.<tag>.md' naming: a doc
    // translation used to sit beside the .scad regardless of where '// @doc'
    // pointed the doc itself; it now sits beside the DOC file (below), so a
    // leftover old-style file must fail loudly with exactly where it belongs
    // now, rather than silently translating nothing.
    const oldDocSidecarRe = new RegExp(`^${escapeRegExp(sidecarBase)}\\.doc\\.([A-Za-z0-9-]+)\\.md$`, "i");
    for (const name of readdirSync(designDir)) {
      const m = name.match(oldDocSidecarRe);
      if (!m) continue;
      const [, tag] = m;
      const oldRel = relPosix(join(designDir, name));
      if (!doc)
        throw new Error(
          `gen-schema: '${oldRel}' is named like a doc translation, but design '${d.id}' has no '// @doc' to translate`
        );
      const newRel = relPosix(join(docDir, `${docBase}.${tag}${docExt}`));
      throw new Error(
        `gen-schema: design '${d.id}' doc translation '${oldRel}' uses the retired '<design>.doc.<tag>.md' ` +
          `naming. A doc translation now lives beside the doc file it translates — move it to '${newRel}'.`
      );
    }

    // Per-locale `@doc` translations: `<docbase><tag><ext>` beside the DOC
    // file itself (not the design's .scad, which may sit elsewhere), the
    // same tag inserted before the extension that `.strings.<tag>.json` uses
    // for the .scad and per-locale help Markdown uses for a help tab file —
    // probe per REGISTRY tag, plus a directory scan for anything shaped like
    // this design's own doc translation that isn't (wrong case, or an
    // unshipped tag). No field-level structure to validate (a doc
    // translation is a whole alternate FILE, not a JSON field). Copied via
    // register+copyFileSync exactly like the base `doc` above and NEVER
    // copyAsset, so it stays out of renderHash the same way (pure prose,
    // cannot affect geometry).
    let docLocales = [];
    if (doc) {
      const docSidecarRe = new RegExp(`^${escapeRegExp(docBase)}\\.([A-Za-z0-9-]+)${escapeRegExp(docExt)}$`, "i");
      for (const name of readdirSync(docDir)) {
        const m = name.match(docSidecarRe);
        if (!m) continue;
        const [, tag] = m;
        if (LOCALE_TAGS.includes(tag)) continue;
        const lower = tag.toLowerCase();
        if (LOCALE_TAGS.includes(lower))
          throw new Error(
            `gen-schema: design '${d.id}' doc translation '${relPosix(join(docDir, name))}' names locale tag ` +
              `'${tag}', but doc translation tags are matched case-sensitively. Rename it to ` +
              `'${docBase}.${lower}${docExt}'.`
          );
        throw new Error(
          `gen-schema: design '${d.id}' doc translation '${relPosix(join(docDir, name))}' names an unshipped ` +
            `locale tag '${tag}'.\n  Valid tags: ${LOCALE_TAGS.join(", ")}`
        );
      }
      for (const tag of LOCALE_TAGS) {
        const docSidecarAbs = join(docDir, `${docBase}.${tag}${docExt}`);
        if (!existsSync(docSidecarAbs)) continue;
        checkContained(
          docSidecarAbs,
          `design '${d.id}' doc translation '${relPosix(docSidecarAbs)}'`,
          relPosix(abs)
        );
        const name = `${d.id}-doc.${tag}.md`;
        const dest = join(outScadDir, name);
        register(dest, `design '${d.id}' doc translation (${tag})`);
        copyFileSync(docSidecarAbs, dest);
        docLocales.push(tag);
      }
      docLocales.sort();
      docDirs.add(docDir);
    }

    // Content-drift WARNING (never an error — see docs/config.md "Keeping
    // translations up to date"): when this design carries a
    // `<base>.strings.stamps.json` (written by `npm run i18n:status --
    // stamp`, never by hand), compare each stamped field's recorded hash
    // against its CURRENT authored-source hash. A mismatch means the source
    // text moved since the translation was stamped, so the existing
    // translation may no longer match it. No stamps file -> no opinion.
    const stampsAbs = join(designDir, `${sidecarBase}.strings.stamps.json`);
    if (existsSync(stampsAbs)) {
      let stampsJson;
      try {
        stampsJson = JSON.parse(readFileSync(stampsAbs, "utf-8"));
      } catch (err) {
        throw new Error(
          `gen-schema: '${relPosix(stampsAbs)}' is not valid JSON:\n  ${err.message}`,
          { cause: err }
        );
      }
      const docHash = docAbs ? sha256Hex(readFileSync(docAbs, "utf-8")) : undefined;
      const fields = translatableFields({
        description,
        sections,
        params,
        reviewLabels,
        reviewNote,
        presetNames,
        docSourceText: docAbs ? readFileSync(docAbs, "utf-8") : null,
      });
      for (const [tag, tagStamps] of Object.entries(stampsJson)) {
        for (const path of driftFields(fields, tagStamps, docHash)) {
          console.warn(
            `gen-schema: ${tag} translation of ${path} may be stale (source changed since it was stamped)`
          );
        }
      }
    }

    // Strip the transient `reviewLabel` annotation flag off each param before
    // it reaches designs.json: it's already folded into `reviewLabels` above,
    // and src/openscad/types.ts's ParamBase carries no such field, matching
    // protocol.ts (the message shapes actually in worker.ts's hashed import
    // closure, per scripts/lib/worker-deps.mjs) which carries none either —
    // adding one there would change renderHash and evict every deployment's
    // persisted render cache for a field that can't affect a triangle.
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
      // Only present when at least one per-locale doc translation exists
      // (beside the doc file itself, see above), sorted for a deterministic
      // designs.json. Unlike `stringsByTag` below, this ships INTO
      // designs.json (src/openscad/types.ts's `Design.docLocales`):
      // DesignDocModal reads it directly to pick the active locale's doc
      // URL, so it isn't transient the way a sidecar's parsed CONTENT is.
      ...(docLocales.length ? { docLocales } : {}),
      // Transient (see the sidecar-discovery comment above): read by generate()
      // to build src/generated/i18n/<tag>.json, then stripped before
      // assembleSchema — never reaches designs.json.
      ...(Object.keys(stringsByTag).length ? { stringsByTag } : {}),
      // Transient, like `stringsByTag`: this design's bundled-preset NAMES and
      // its base `@doc` file's absolute path (or null), read by
      // scripts/i18n-status.mjs (via this same `buildDesigns`) to compute
      // translation coverage/drift without re-deriving either. Never reaches
      // designs.json.
      presetNames,
      docAbs,
    };
  });

  // Orphaned strings-sidecar files: a `<base>.strings.<tag>.json` (a stamps
  // file's literal "stamps" tag matches the same pattern, see the loop's own
  // comment above) whose base matches no design in its own directory — most
  // often a design renamed (or removed) without its old translation
  // following it — is invisible to the per-design scan above, which only
  // ever looks for ITS OWN design's base. Left alone it translates nothing
  // and fails nothing, silently rotting forever; warn instead so it gets
  // noticed.
  const GENERIC_SIDECAR_RE = /^(.+)\.strings\.[A-Za-z0-9-]+\.json$/i;
  const orphaned = [];
  for (const [dir, bases] of sidecarBasesByDir) {
    for (const name of readdirSync(dir)) {
      const m = name.match(GENERIC_SIDECAR_RE);
      if (!m || bases.has(m[1])) continue;
      orphaned.push(relPosix(join(dir, name)));
    }
  }
  if (orphaned.length)
    console.warn(
      `gen-schema: ${orphaned.length} design-translation sidecar file(s) match no design in their ` +
        `directory (an orphan left behind by a design rename?), so they translate nothing: ${orphaned.join(", ")}`
    );

  // Orphaned doc translations: unlike a strings sidecar, `<docbase>.<tag>.md`
  // carries no infix marking it as translation-shaped, so candidacy is
  // restricted to a locale-tag-shaped middle segment (case-insensitive
  // against the registry) — but even that isn't enough on its own: an
  // unrelated Markdown file can still coincidentally end in `.<tag>.md`
  // (this repo's own `help-printing.de.md`, an explicit help-tab file, sits
  // right beside `panel.md`'s live doc). What makes a candidate a genuine
  // ORPHAN rather than a false hit is that its own base file no longer
  // exists at all — a doc renamed (or removed) without its translations
  // following it — so the test is physical presence of `<base>.md` in the
  // SAME directory listing, not whether any design's '// @doc' currently
  // points at it (a translation for a base that still exists, live or not,
  // is never flagged: at worst it's unreferenced, not provably orphaned).
  const docOrphanRe = new RegExp(`^(.+)\\.(${LOCALE_TAGS.map(escapeRegExp).join("|")})\\.md$`, "i");
  const orphanedDocs = [];
  for (const dir of docDirs) {
    const entries = new Set(readdirSync(dir));
    for (const name of entries) {
      const m = name.match(docOrphanRe);
      if (!m) continue;
      const [, base] = m;
      if (entries.has(`${base}.md`)) continue;
      orphanedDocs.push(relPosix(join(dir, name)));
    }
  }
  if (orphanedDocs.length)
    console.warn(
      `gen-schema: ${orphanedDocs.length} doc translation file(s) match no design's current '// @doc' in ` +
        `their directory (an orphan left behind by a doc rename?), so they translate nothing: ${orphanedDocs.join(", ")}`
    );

  return designs;
}

// Optional default design shown when a visit carries no `#d=` deep link. Must
// be a string (checked against CONFIG_SPEC, like every other top-level scalar)
// and must name one of the configured designs.
function resolveDefaultDesign(config, designs) {
  const { defaultDesign } = applyTopLevelScalars(config, ["defaultDesign"]);
  if (defaultDesign === undefined) return null;
  if (!designs.some((d) => d.id === defaultDesign))
    throw new Error(
      `gen-schema: 'defaultDesign' ${JSON.stringify(defaultDesign)} ` +
        `is not one of the configured design ids (${designs.map((d) => d.id).join(", ")})`
    );
  return defaultDesign;
}

// `popup.mode: "picker"` means one thing: the popup IS the design chooser, the
// app's first screen (PopupModal renders the gallery from it, App parks the
// render path behind it, and a link naming a design skips it). A deployment with
// nothing to choose between cannot have that screen, so the config is wrong
// rather than quietly meaning something else.
//
// It used to mean something else: below two designs the popup silently fell
// back to a plain notice, and src/lib/popup.ts's `isDesignChooser` records what
// that cost. Enforcing the invariant here, once, where every other config
// mistake is caught, is what lets every consumer go back to reading the mode.
function checkPopupMode(popup, designs) {
  if (popup?.mode !== "picker" || designs.length > 1) return;
  throw new Error(
    `gen-schema: 'popup.mode: "picker"' is the design chooser, so it needs at least two ` +
      `designs to choose between — this config has ${designs.length}.\n` +
      `  Use 'popup.mode: "once"' (or "dismissible"/"always") for a plain notice.`
  );
}

// The use/include walk (collectDeps) always runs, even when `assets` is
// explicit, because a configured set trusted without that cross-check is never
// verified against what a design's `use`/`include` graph actually reaches.
// That let a design whose graph goes further than `assets` (an entry the
// operator forgot to add, or one they trimmed on purpose expecting a
// narrower dependency set than the design actually has) build green and fail
// only once the OpenSCAD-WASM worker tries to mount it in someone's browser
// — the render sandbox mounts exactly `assets` (plus each design's own
// file), nothing more. generate() now runs collectDeps unconditionally (see
// its own comment) so this can be checked at build time instead, matching
// gen-schema's fail-fast stance everywhere else: a warning here would only be
// a slower version of the same runtime failure.
//
// `walkedByDesign` is `[{ id, deps: Set<relPosixPath> }]`, one entry per
// design, from generate()'s unconditional collectDeps pass. `assets` is the
// already-expanded configured set (expandConfiguredAssets' return value,
// turned into the accumulating Set generate() builds). Deliberately a
// DISTINCT error from collectDeps' own "dependency ... not found": that one
// already fired, with its own message, for any walked target missing from
// disk entirely (collectDeps' existence check runs during the walk itself,
// before this function ever sees the result) — so every `dep` reaching this
// point is known to exist on disk. This is the other failure mode: it exists,
// but isn't in the set gen-schema was told to bundle.
function checkAssetCoverage(designs, walkedByDesign, assets) {
  // A design's use/include graph may legitimately reach another design's own
  // .scad file: buildDesigns/copyAsset already stages every design file
  // regardless of `assets`, so that's covered too, not only the configured set.
  const designFiles = new Set(designs.map((d) => d.file));
  const uncovered = walkedByDesign
    .map(({ id, deps }) => ({
      id,
      missing: [...deps].filter((dep) => !assets.has(dep) && !designFiles.has(dep)),
    }))
    .filter(({ missing }) => missing.length);
  if (!uncovered.length) return;
  throw new Error(
    `gen-schema: design use/include dependencies not covered by 'assets':\n` +
      uncovered.map(({ id, missing }) => `  design '${id}': ${missing.join(", ")}`).join("\n") +
      `\n  (each is reached by a use/include but missing from the configured 'assets' — add it, ` +
      `a directory/glob that matches it, or remove the use/include)\n` +
      `  (a dependency missing from disk entirely fails earlier, during the walk itself, with its own ` +
      `"dependency ... not found" error — this one only ever names a file that DOES exist)`
  );
}

// Resolve one help "pane": the top-level `help` object itself, or a single
// `help.tabs[]` entry. Against its optional `file` key (see docs/config.md
// "Sourcing help from Markdown files" and scripts/lib/help-file.mjs). `file`
// is an alternative to writing `sections` (and `intro`) inline: the
// referenced Markdown file's content before the first `##` heading becomes
// `intro`, and each `##` heading after that becomes a `{ title, body }`
// section. Setting `file` alongside `sections` or `intro` fails the build,
// naming both keys. A pane with no `file` passes through unchanged.
//
// `file` also accepts an object of locale tag -> path (when `languages` is
// passed): each locale's file is split independently, then stitched into
// `LocalizableText` `intro`/`sections[].title`/`sections[].body` values — one
// map entry per locale that supplied a file. Every locale's file must split
// into the SAME NUMBER of `##` sections, in the same order, so a section's
// per-locale title/body line up positionally; a locale's own missing intro
// (nothing before its first `##`) only survives into the map when the
// DEFAULT locale's file has one too (see the comment at that check) — the
// simplest rule that keeps `intro`'s object form satisfying
// `parseLocalizableText`'s own "must include defaultTag" invariant without
// forcing every locale to write introductory prose.
function resolveHelpPane(raw, CONFIG_DIR, mustExist, what, languages, defaultTag) {
  if (raw?.file == null) return raw;
  const fileVal = raw.file;
  if (raw.sections != null)
    throw new Error(`gen-schema: both '${what}.sections' and '${what}.file' are set — remove one.`);
  if (raw.intro != null)
    throw new Error(`gen-schema: both '${what}.intro' and '${what}.file' are set — remove one.`);

  const readAndSplit = (rel, errPath) => {
    // Validate BEFORE resolving: same shape as prose-files.mjs's
    // resolveFileField. A non-string or blank value must fail with the usual
    // optional-string message, not escape as a raw Node TypeError out of
    // node:path's resolve() below.
    if (typeof rel !== "string" || !rel.trim()) throw optionalStringFieldError(errPath);
    const file = rel.trim();
    const abs = mustExist(resolve(CONFIG_DIR, file), `${errPath} '${file}'`);
    return splitHelpMarkdown(readFileSync(abs, "utf-8"));
  };

  const { file: _file, ...rest } = raw;

  if (typeof fileVal === "string") {
    const { intro, sections } = readAndSplit(fileVal, `${what}.file`);
    return { ...rest, ...(intro ? { intro } : {}), sections };
  }
  if (fileVal && typeof fileVal === "object" && !Array.isArray(fileVal)) {
    if (!languages)
      throw new Error(
        `gen-schema: '${what}.file' must be a file path (this field doesn't support per-locale forms)`
      );
    const entries = Object.entries(fileVal);
    if (entries.length === 0)
      throw new Error(`gen-schema: '${what}.file' must have at least one locale entry`);
    const tags = new Set(languages);
    const perTag = {};
    for (const [tag, rel] of entries) {
      if (!tags.has(tag))
        throw new Error(
          `gen-schema: '${what}.file' has an entry for locale "${tag}", which isn't one of this ` +
            `deployment's enabled locales.\n  Valid tags: ${[...tags].join(", ")}`
        );
      perTag[tag] = readAndSplit(rel, `${what}.file.${tag}`);
    }
    if (!(defaultTag in perTag))
      throw new Error(
        `gen-schema: '${what}.file' must include an entry for "${defaultTag}", this deployment's default locale`
      );
    const tagList = Object.keys(perTag);
    const sectionCount = perTag[defaultTag].sections.length;
    for (const tag of tagList) {
      if (perTag[tag].sections.length !== sectionCount)
        throw new Error(
          `gen-schema: '${what}.file' locale "${tag}" splits into ${perTag[tag].sections.length} section(s) ` +
            `from its '##' headings, but "${defaultTag}" splits into ${sectionCount} — every locale's file ` +
            `must split into the same number of sections, in the same order`
        );
    }
    const intro = perTag[defaultTag].intro
      ? Object.fromEntries(tagList.filter((tag) => perTag[tag].intro).map((tag) => [tag, perTag[tag].intro]))
      : null;
    const sections = Array.from({ length: sectionCount }, (_, i) => ({
      title: Object.fromEntries(tagList.map((tag) => [tag, perTag[tag].sections[i].title])),
      body: Object.fromEntries(tagList.map((tag) => [tag, perTag[tag].sections[i].body])),
    }));
    return { ...rest, ...(intro ? { intro } : {}), sections };
  }
  throw optionalStringFieldError(`${what}.file`);
}

// Apply the build-only `LocalizableText` invariants (an object-form value's
// tags must be ⊆ `languages` and include `defaultTag`; see
// `parseLocalizableText`) to every leaf `resolveHelp`'s loose `checkHelpShape`
// pass already confirmed is string-or-locale-map-shaped, and trims each. Runs
// AFTER checkHelpShape (see `resolveHelp`) so a structurally malformed `help`
// (missing sections, a non-object tab, …) still gets checkHelpShape's own
// message rather than a confusing one from here.
function localizeHelpSection(s, what, languages, defaultTag) {
  return {
    title: parseLocalizableText(s.title, `${what}.title`, languages, defaultTag, { required: true }),
    body: parseLocalizableText(s.body, `${what}.body`, languages, defaultTag, { required: true }),
  };
}

function localizeHelpContent(help, languages, defaultTag) {
  const out = { ...help };
  if (out.title !== undefined) out.title = parseLocalizableText(out.title, "help.title", languages, defaultTag);
  if (out.intro !== undefined) out.intro = parseLocalizableText(out.intro, "help.intro", languages, defaultTag);
  if (Array.isArray(out.sections))
    out.sections = out.sections.map((s, i) =>
      localizeHelpSection(s, `help.sections[${i}]`, languages, defaultTag)
    );
  if (Array.isArray(out.tabs))
    out.tabs = out.tabs.map((tab, i) => {
      const what = `help.tabs[${i}]`;
      const t = {
        ...tab,
        label: parseLocalizableText(tab.label, `${what}.label`, languages, defaultTag, { required: true }),
      };
      if (t.intro !== undefined) t.intro = parseLocalizableText(t.intro, `${what}.intro`, languages, defaultTag);
      t.sections = t.sections.map((s, j) => localizeHelpSection(s, `${what}.sections[${j}]`, languages, defaultTag));
      return t;
    });
  return out;
}

// Optional `help` config block, with any `file` (top-level, or per-tab)
// resolved to its derived `intro`/`sections` first, see resolveHelpPane
// above. Everything else about `help` is passed through verbatim (see
// CONFIG_SPEC.help's comment) apart from the `LocalizableText` normalisation
// `localizeHelpContent` applies at the end.
export function resolveHelp(raw, CONFIG_DIR, mustExist, languages, defaultTag) {
  if (raw == null) return null;
  // `help`'s contents are passed through verbatim (see CONFIG_SPEC.help's
  // comment), but its SHAPE is checked here like every other block: a
  // non-object used to reach the browser untouched and fail in
  // src/lib/schema.ts at runtime, so `"help": 42` built green and broke the
  // deployed app.
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new Error(
      `gen-schema: 'help', when set, must be an object (got ${JSON.stringify(raw)})`
    );
  const help = resolveHelpPane(raw, CONFIG_DIR, mustExist, "help", languages, defaultTag);
  const resolved = Array.isArray(help.tabs)
    ? {
        ...help,
        tabs: help.tabs.map((tab, i) => {
          if (!tab || typeof tab !== "object" || Array.isArray(tab))
            throw new Error(
              `gen-schema: 'help.tabs[${i}]' must be an object (got ${JSON.stringify(tab)})`
            );
          return resolveHelpPane(tab, CONFIG_DIR, mustExist, `help.tabs[${i}]`, languages, defaultTag);
        }),
      }
    : help;
  // The full contract, on what the app will actually receive — AFTER the
  // `file` panes have been resolved into `intro`/`sections`, since that is what
  // reaches designs.json and what the runtime validator will judge. The same
  // module states it for both (src/lib/helpShape.mjs), so "malformed help fails
  // the build" is now true of every shape the runtime rejects rather than of
  // the two this function happened to check.
  checkHelpShape(resolved, (msg) => {
    throw new Error(
      `gen-schema: ${msg}\n  (the app rejects this at startup, so it would fail the deployed site)`
    );
  });
  return localizeHelpContent(resolved, languages, defaultTag);
}

// Optional raw-CSS escape hatch. Unlike `colors` — a safe, validated token map
// — this is a stylesheet the consumer fully controls, copied verbatim into the
// served tree and (see vite.config.ts) loaded *after* the app's own styles so
// it can override anything. It targets internal class names at the consumer's
// own risk: not a stable API, and not covered by the accessibility guarantees.
// Lives under the (gitignored, auto-wiped) scad output dir, so it never goes
// stale or gets committed. Returns its served URL, or null.
function copyExtraCss(config, CONFIG_DIR, outScadDir, mustExist, register) {
  const { extraCss: EXTRA_CSS } = applyTopLevelScalars(config, ["extraCss"]);
  if (!EXTRA_CSS) return null;
  const abs = mustExist(
    resolve(CONFIG_DIR, EXTRA_CSS),
    `extraCss '${EXTRA_CSS}'`
  );
  const name = abs.split(/[\\/]/).pop();
  // H6: an extraCss basename equal to a design's would silently overwrite that
  // design file, so register() fails the build naming both owners.
  const dest = join(outScadDir, name);
  register(dest, `extraCss '${EXTRA_CSS}'`);
  copyFileSync(abs, dest);
  return `scad/${name}`;
}

// v2 precache manifest, read by public/sw.js at install:
//   shell. Small runtime assets cached into the per-build shell cache;
//   bin. The big version-pinned binaries (the ~10 MB WASM + fonts),
//           warmed into the render worker's own BIN_CACHE (same cache,
//           same keys: no double store) so offline rendering works even
//           before the first render.
// H4: append a `?v=<digest>` query to a binary asset's served path so its
// fetch/Cache-Storage identity is content-addressed. Mirrors
// src/lib/assetUrl.ts's versionedAssetUrl exactly (that file is TypeScript,
// loaded by the worker/main-thread runtime; this one is the same one-line
// scheme applied where gen-schema writes the SW's warm-up URL list: both
// sides must compute byte-identical strings for a given (path, digest) so a
// Cache Storage entry worker.ts writes is the exact one the service worker's
// warm-up either finds already present or writes itself).
function versionedPath(path, digest) {
  return digest ? `${path}?v=${digest}` : path;
}

function writePrecacheManifest({ outPublicDir, schema, appleSplash, assets, logo, extraCss, iconFiles }) {
  // M8: precache only the icon files the PWA-asset step actually wrote
  // (`iconFiles`), not a fixed assumed set. Otherwise a missing rasterizer
  // (or one that failed, though that now fails the build outright, see
  // pwa-assets.mjs) would have the service worker try to precache PNGs that
  // were never generated.
  const shell = new Set([
    ...iconFiles,
    "manifest.webmanifest",
    // H3: the render worker fetches the WASM glue and fonts.conf content-
    // addressed (versionedAssetUrl in worker.ts), so precache the SAME
    // ?v=<digest> URLs here. Cache Storage matches the query string, so an
    // unversioned shell entry is a miss for the worker's versioned request:
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
    // Per-locale `@doc` translations (docLocales), same offline reasoning as
    // the base doc above: DesignDocModal fetches `<id>-doc.<tag>.md` on
    // demand, so a visitor who installed the app before opening it in that
    // locale would otherwise see it fail offline.
    for (const tag of d.docLocales ?? []) shell.add(`scad/${d.id}-doc.${tag}.md`);
    // The gallery's artwork and the preset cards' thumbnails: a deployment
    // using either renders a broken screen offline without them, exactly like
    // a missing icon.
    if (d.image) shell.add(d.image);
    for (const url of Object.values(d.presetImages ?? {})) shell.add(url);
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
      // H4: content-addressed via versionedPath, see its comment. Must match
      // exactly what worker.ts fetches for the same file (resolveWasmModule
      // for the wasm, cachedBuffer for the fonts: both derive the query from
      // schema.binAssets), so the service worker's
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
// here when the app shares the concept (as `viewer` does, see
// src/openscad/types.ts's Schema comment); keep this file's existing flat
// shape when it doesn't. `render.features`/`.format`/`.fonts` land as this
// schema's own flat `features`/`format`/`fonts` keys, while
// `render.fontFallback` lands in no schema key at all — it is rendered into the
// generated `fonts.conf` and reaches renderHash from there
// (the app already reads those flat; only `render.heavyMs`/`.cache` nest,
// under `render`, since that pairing IS its own build-time-tuning concept).
// `pwa` (shortName/icon/iconMaskable/backgroundColor/categories/screenshots/
// shortcuts/themeColor/install) doesn't appear here at all: every one of its
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
 * @param {string} [opts.outArtDir]  Where generated browser-facing artwork
 *   (design icon/image, bundled-preset thumbnails, the header logo) is
 *   written — served cache-first, unlike outScadDir's build-volatile sources.
 *   Defaults to outScadDir's own sibling `art` directory.
 * @param {string} [opts.version]  ScadPub version stamp for this build; defaults
 *   to this checkout's `git describe` (see scripts/lib/version.mjs). Any falsy
 *   value (no git metadata and no override, or an explicit "") leaves the stamp
 *   out of the schema entirely.
 * @param {Record<string,string>} [opts.components]  Installed versions of the
 *   bundled npm packages for the licenses modal; defaults to reading this
 *   checkout's node_modules (see scripts/lib/dep-versions.mjs).
 * @returns {object} the schema (also written to outSchemaDir/designs.json).
 */
// popup.body / fileImport.note / licenses[].text may each be written inline OR
// sourced from a config-relative file (the sibling '<field>File' key), see
// scripts/lib/prose-files.mjs. Resolved BEFORE parsePopup/parseFileImport/
// parseLicenses run, so each sees its field already populated exactly as if it
// had been written inline; this content is inlined into designs.json and never
// reaches the browser as its own fetch (contrast a design's `// @doc`
// annotation, whose resolved Markdown IS served as a file).
//
// Mutates `config` in place, which is what the parsers downstream read.
// `languages`/`defaultTag` (this deployment's resolved locale set — see
// parseIdentity, which MUST run before this: that's why generate() resolves
// identity first) let `popup.bodyFile`/`fileImport.noteFile` accept the
// per-locale map form (resolveFileField, above); `licenses[].textFile` is
// deliberately NOT passed them — license text stays single-language (see
// SoftwareLicense's own comment).
function resolveProseFields(config, CONFIG_DIR, mustExist, languages, defaultTag) {
  if (config.popup)
    config.popup = resolveFileField({
      obj: config.popup,
      field: "body",
      fileField: "bodyFile",
      CONFIG_DIR,
      mustExist,
      path: "popup",
      languages,
      defaultTag,
    });
  if (config.fileImport && typeof config.fileImport === "object" && !Array.isArray(config.fileImport))
    config.fileImport = resolveFileField({
      obj: config.fileImport,
      field: "note",
      fileField: "noteFile",
      CONFIG_DIR,
      mustExist,
      path: "fileImport",
      languages,
      defaultTag,
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
}

// `ui.afterExport.helpTab`, when set, must name a Help tab that actually
// exists. Cross-field, so it can't live in parseUi (config-parsers.mjs): it
// needs HELP, which is only resolved once the whole config is parsed. Mirrors
// HelpModal's own tab-list logic — top-level `help.sections` synthesize a
// leading "Overview" tab (id `OVERVIEW_TAB_ID`) when `help.tabs` are also
// present — so a value that passes here is guaranteed to match a tab the
// modal renders.
//
// Resolves id-first, then falls back to a plain-string label (back-compat
// with a config written before tab ids existed): `HelpModal`'s own matching
// (HelpTabs' `initialTab` handling) follows the same order. A tab whose label
// is a per-locale map (see docs/config.md's "Localizing config text") can
// never equal a plain-string reference, so a reference that only matches by
// label is unreachable once any tab's label stops being a plain string —
// the error below calls that out and points at `id` instead of leaving the
// author to guess.
function checkAfterExportHelpTab(UI, HELP) {
  if (!UI.afterExport?.helpTab) return;
  const ref = UI.afterExport.helpTab;
  const tabs = HELP?.tabs?.length
    ? [...(HELP.sections?.length ? [{ id: OVERVIEW_TAB_ID, label: "Overview" }] : []), ...HELP.tabs]
    : [];
  if (tabs.some((t) => t.id === ref)) return;
  if (tabs.some((t) => typeof t.label === "string" && t.label === ref)) return;
  const hasLocalizedLabel = tabs.some((t) => t.label && typeof t.label === "object");
  const names = tabs.map((t) => t.id ?? t.label);
  throw new Error(
    `gen-schema: 'ui.afterExport.helpTab' is ${JSON.stringify(ref)}, but no 'help' tab has that id or label.\n` +
      (names.length
        ? `  Available: ${names.map((n) => JSON.stringify(n)).join(", ")}`
        : `  This config's 'help' has no tabs defined.`) +
      (hasLocalizedLabel
        ? `\n  This help has per-locale tab labels — reference the tab by its 'id' instead.`
        : "")
  );
}

// Every purely declarative block of the config, parsed and validated in one
// place: nothing here touches the filesystem beyond resolving a configured
// path, and nothing depends on the designs or the staged output tree. Split
// out of generate() because it was 90 uninterrupted lines of `const X =
// parseX(config.x)` between two steps that genuinely do sequence.
//
// `TITLE` is only here for `shortName`'s documented fallback. `LANGUAGES` is
// this deployment's resolved `languages` (parseIdentity, above): STRINGS'
// per-locale object values are validated against it.
function parseConfigBlocks(config, CONFIG_DIR, mustExist, TITLE, LANGUAGES) {
  // The deployment's resolved default locale (parseLanguages always puts it
  // first, see its own comment): every `LocalizableText` field below
  // (popup/fileImport.note/notices[].label/licenses[].note/help) requires an
  // object-form value to carry this tag's entry, see `parseLocalizableText`.
  const DEFAULT_TAG = LANGUAGES[0];
  // `features`/`format`/`fonts`/`fontFallback` now live under `render` (moved
  // in from the top level): they're genuine render inputs, so they stay
  // folded into renderHash below exactly as before; only their config PATH
  // moved. `render.heavyMs`/`render.cache` are display/perf tuning and stay
  // OUT of renderHash, see CONFIG_SPEC.render's comment and RENDER below.
  const FEATURES = parseStringArray(config.render?.features, "render.features");
  const FORMAT = parseFormat(config.render?.format, "render.format");
  // The 3D viewer's presentation, framing (restOnGrid) and per-control
  // visibility: all display-only, so VIEWER reaches the schema without
  // touching renderHash.
  const VIEWER = parseViewer(config.viewer);
  // Optional build-time render tuning (heavy-render threshold + cache
  // sizing), NOT features/format/fonts/fontFallback, which parseRender
  // deliberately ignores (see its own comment); those are computed above/
  // below instead. Validated; absent -> null -> the app keeps its built-in
  // defaults.
  const RENDER = parseRender(config.render);
  // Optional per-theme colour-scheme overrides. Validated against the known CSS
  // tokens; emitted by vite.config.ts as a <style> block so a consumer project
  // can restyle the app entirely from its config. Absent -> null.
  const COLORS = parseColors(config.colors);
  // Build-time UI behaviour config (panel side, default state, etc.). `install`
  // moved to `pwa.install` (see PWA below): it's spliced back onto UI
  // immediately below so `schema.ui.install` still carries it, unmoved: App.tsx reads
  // `schema.ui?.install`: the config surface groups these under `pwa`, not
  // designs.json's shape (see gen-schema.mjs's schema-assembly comment).
  const UI = { ...parseUi(config.ui) };
  // Manifest-only PWA chrome (install metadata, icons, theming), see
  // CONFIG_SPEC.pwa's comment for why none of this is mirrored into
  // designs.json as its own "pwa" object. Always resolves (like parseUi/
  // parseViewer), defaults throughout when `config.pwa` is entirely absent.
  const PWA = parsePwa(config.pwa);
  UI.install = PWA.install;
  // `shortName` moved to `pwa.shortName`, still falling back to `title`:
  // matches designs.json's existing flat `shortName` field exactly.
  const SHORT_NAME = PWA.shortName ?? TITLE;
  // Optional generic file-import button (fonts, SVGs, data files, …). Validated.
  // Absent -> null -> no import button.
  const FILE_IMPORT = parseFileImport(config.fileImport, LANGUAGES, DEFAULT_TAG);

  // Optional one-off notice dialog shown over the app on load. Validated; absent
  // -> null -> no popup.
  const POPUP = parsePopup(config.popup, LANGUAGES, DEFAULT_TAG);
  // Optional help content; passed through verbatim (any `file` resolved to
  // its derived intro/sections first, see resolveHelp). Absent -> null ->
  // the app falls back to its generic, project-agnostic default help.
  const HELP = resolveHelp(config.help, CONFIG_DIR, mustExist, LANGUAGES, DEFAULT_TAG);
  // Config-driven notice categories surfaced on the OpenSCAD output panel.
  // Validated; off by default (omitted -> none).
  const NOTICES = parseNotices(config.notices, LANGUAGES, DEFAULT_TAG);
  // Optional extra third-party software / license notices. Validated and
  // appended (never replacing the built-ins) by the in-app licenses modal.
  const LICENSES_EXTRA = parseLicenses(config.licenses, LANGUAGES, DEFAULT_TAG);
  // Optional per-deployment UI text overrides (config's `strings` key),
  // validated against the bundled English catalogue's key set and (for a
  // per-locale object value) this deployment's own LANGUAGES, see
  // src/lib/i18n.ts and docs/config.md's `strings` section. Absent -> {}.
  const STRINGS = parseStrings(config.strings, enCatalogKeys(), LANGUAGES);

  checkAfterExportHelpTab(UI, HELP);
  return {
    FEATURES,
    FORMAT,
    VIEWER,
    RENDER,
    COLORS,
    UI,
    PWA,
    SHORT_NAME,
    FILE_IMPORT,
    POPUP,
    HELP,
    NOTICES,
    LICENSES_EXTRA,
    STRINGS,
  };
}

// designs.json, assembled from everything generate() has resolved. Its shape
// is the APP's, not the config's: see docs/config-pipeline.md for where the
// two deliberately diverge (`render`, `pwa`).
function assembleSchema(parts) {
  const {
    SOURCE, relPosix, renderHash, version, components, BIN_ASSETS, TITLE, SHORT_NAME,
    ID, DESCRIPTION, LANG, DIR, LANGUAGES, STRINGS, PWA, appleSplash, COLORS, extraCss, logo,
    FORMAT, VIEWER, FEATURES, RENDER, FONTS, FONT_FAMILIES, FONT_FACES, FILE_IMPORT,
    POPUP, NOTICES, HELP, LICENSES_EXTRA, UI, defaultDesign, assets, designs,
  } = parts;
  return {
    generatedFrom: relPosix(SOURCE) || ".",
    renderHash,
    // Names the render worker's binary Cache Storage entry (and the service
    // worker's warm-up target). Single-sourced from scripts/wasm-version.mjs.
    wasmVersion: WASM_VERSION,
    // Which ScadPub built this site (`git describe` of the ScadPub checkout, or
    // $SCADPUB_VERSION). Shown in the open-source licenses modal; omitted from
    // the JSON entirely when the build tree carries no git metadata. Display
    // only: deliberately NOT part of renderHash, since it can't affect geometry
    // (a code change that can already hashes the renderer's own sources).
    ...(version ? { scadpubVersion: version } : {}),
    // Versions of the bundled third-party packages, read from the node_modules
    // this build bundles from (scripts/lib/dep-versions.mjs). The licenses modal
    // reads them instead of carrying literals that drift from the dependency.
    // Display-only, like the stamp above: kept out of renderHash.
    componentVersions: components,
    // H4: per-file digests for wasm/glue/fonts/fonts.conf, see BIN_ASSETS above.
    binAssets: BIN_ASSETS,
    title: TITLE,
    shortName: SHORT_NAME,
    id: ID,
    description: DESCRIPTION,
    lang: LANG,
    dir: DIR,
    // Always a non-empty array (parseLanguages' own contract, see
    // parseIdentity): a single-locale deployment still emits its one tag
    // rather than omitting the key, so src/lib/localeStore.ts never has to
    // special-case an absent value from a build that predates this field.
    languages: LANGUAGES,
    strings: STRINGS,
    // `pwa.themeColor.{dark,light}` in the config, still flat here, see the
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
    // `stringsByTag`/`presetNames`/`docAbs` (buildDesigns' transient fields,
    // see their own comments) are read by generate()/scripts/i18n-status.mjs
    // BEFORE this function runs, so they're stripped here alongside `abs`:
    // none of the four belongs in designs.json.
    designs: designs.map(({ abs, stringsByTag, presetNames, docAbs, ...d }) => d),
  };
}

// The commit point (H6/M8). Everything fallible — design parsing, containment
// checks, PWA rasterization — has succeeded and the schema is in hand, so the
// staged scad tree is swapped into place and every deferred write is flushed.
// Split out of generate() so the boundary is a function call rather than a
// comment banner halfway down a 400-line body: nothing below this line may
// throw for a reason the config could have caused.
function commitOutputs({
  outScadDir,
  stageScadDir,
  outArtDir,
  stageArtDir,
  outSchemaDir,
  outPublicDir,
  schema,
  i18nByTag,
  designCount,
  fontWrites,
  fontsConf,
  fontCopies,
  pwaBatch,
  appleSplash,
  assets,
  logo,
  extraCss,
  iconFiles,
}) {
  // COMMIT POINT (H6/M8): every fallible step. Design parsing, containment
  // checks, PWA rasterization. Has now succeeded and the schema is in hand, so
  // atomically swap the staged scad and art trees into the live location.
  // Everything past here (font copies, precache manifest, reconciliation,
  // designs.json) is a plain non-fallible write, so scad sources, artwork,
  // PWA/font assets, and the schema all land together: a failure earlier left
  // the entire previous output intact and internally consistent.
  rmSync(outScadDir, { recursive: true, force: true });
  renameSync(stageScadDir, outScadDir);
  // outArtDir gets the identical wholesale swap, not M8 manifest
  // reconciliation: like outScadDir (and unlike public/fonts or the public
  // root), it holds ONLY generated files, nothing tracked ever lives there, so
  // there's nothing reconciliation's mixed-ownership handling buys over a
  // clean replace — see scripts/lib/destinations.mjs's module comment.
  rmSync(outArtDir, { recursive: true, force: true });
  renameSync(stageArtDir, outArtDir);

  // The generated font tree AND the PWA icon/splash/screenshot/manifest batch
  // are committed here too (deferred from bundleFonts and generatePwaAssets
  // respectively): copy the source-referenced fonts into public/fonts, write
  // fonts.conf, and flush every entry generatePwaAssets queued instead of
  // writing directly (commitPwaBatch, see pwa-assets.mjs). Now that all
  // fallible work (design parsing, PWA rasterization, the screenshot
  // existence check) has already succeeded. A source font overwriting a
  // same-named previous one, a rewritten fonts.conf, and a replaced icon/
  // splash/manifest set therefore never outlive a build that later failed.
  //
  // Honest about the window this does NOT close: the commit itself is a
  // sequence of ordinary writes, not an atomic swap. The scad tree IS swapped
  // atomically (rename above), but the font copies, fonts.conf and the PWA
  // batch are written one after another, so a crash or a full disk between
  // them can still leave the font tree from this build beside the PWA assets
  // from the last. Staging everything into one temp tree and renaming it into
  // place would close that too; it has not been done, because these outputs
  // live at several fixed paths under public/ rather than in one directory a
  // rename could cover. What deferring buys is the far likelier failure —
  // a design that doesn't parse, an icon that won't rasterize — leaving the
  // previous build wholly intact.
  if (outPublicDir) {
    mkdirSync(join(outPublicDir, "fonts"), { recursive: true });
    for (const { src, dest } of fontWrites) {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }
    if (fontsConf != null) writeFileSync(join(outPublicDir, "fonts", "fonts.conf"), fontsConf);
    commitPwaBatch(pwaBatch);
  }

  if (outPublicDir) {
    writePrecacheManifest({ outPublicDir, schema, appleSplash, assets, logo, extraCss, iconFiles });
    // M8: reconcile the generated files this run wrote OUTSIDE outScadDir
    // (which was fully replaced as a unit immediately above). Source-copied fonts under
    // public/fonts, plus the PWA root assets (icons, splashes, manifest,
    // screenshots). Against what a previous run generated, so removing or
    // renaming a config entry (a dropped font, a renamed screenshot) doesn't
    // leave a stale, still-deployable file behind. Scoped to paths THIS tool
    // recorded writing previously; a tracked bundled .ttf or an unrelated
    // file a contributor placed under public/ can never be in that manifest
    // (bundleFonts refuses to stage a copy over a tracked destination), and an
    // entry whose bytes changed since is left alone. See
    // scripts/lib/destinations.mjs.
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
      [...fontCopies, ...pwaBatch.map((e) => e.dest)],
      isTrackedFile
    );
  }
  writeFileSync(
    join(outSchemaDir, "designs.json"),
    JSON.stringify(schema, null, 2) + "\n"
  );

  // One file PER REGISTRY TAG (i18nByTag already covers every tag, see
  // generate()'s own comment), wiped and rewritten wholesale so a tag a
  // previous run wrote for (now unshipped, or its last sidecar removed) never
  // lingers as a stale file src/lib/localeStore.ts's static import map would
  // otherwise still be able to reach. src/generated/ is gitignored (see
  // CLAUDE.md), so — unlike outPublicDir's mixed-ownership tree — nothing
  // here needs M8's reconciliation dance: the whole directory is this tool's
  // alone, safe to wipe and repopulate outright.
  const outI18nDir = join(outSchemaDir, "i18n");
  rmSync(outI18nDir, { recursive: true, force: true });
  mkdirSync(outI18nDir, { recursive: true });
  for (const tag of Object.keys(i18nByTag)) {
    const covered = Object.keys(i18nByTag[tag].designs).length;
    writeFileSync(
      join(outI18nDir, `${tag}.json`),
      JSON.stringify(i18nByTag[tag], null, 2) + "\n"
    );
    console.log(`gen-schema: design strings ${tag}: ${covered}/${designCount} designs`);
  }
}

// The whole build, in phases. Each is a function above rather than a labelled
// stretch of one body, so the sequencing that IS load-bearing is visible:
//
//   parse        loadConfig -> resolveProseFields -> parseIdentity ->
//                parseConfigBlocks. Pure validation; a config error must
//                surface here, before a single byte is staged.
//   stage        bundleFonts, buildDesigns, the asset walk and generatePwaAssets
//                all write into a staging tree or a queued batch, never into the
//                live output. Everything fallible happens in this phase.
//   assemble     computeRenderHash + assembleSchema. designs.json in memory.
//   commit       commitOutputs. The staged tree is swapped in and every deferred
//                write is flushed. Nothing past this point may throw for a
//                reason the config could have caused.
//
// The payoff is the failure mode: a config that doesn't parse, a design that
// doesn't exist, an icon that won't rasterize — none of them can leave a
// half-written site behind, because none of them reach the commit phase.
export function generate({
  configPath,
  outSchemaDir,
  outScadDir,
  // Defaults to outScadDir's own sibling: every real caller (main() below)
  // already puts the two side by side under public/, and defaulting here
  // means a test (or other caller) that only cares about outScadDir doesn't
  // also have to name outArtDir.
  outArtDir = join(dirname(outScadDir), "art"),
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

  // Identity FIRST, prose fields SECOND: resolveProseFields' `bodyFile`/
  // `noteFile` pre-pass now accepts a per-locale map (see prose-files.mjs's
  // resolveFileField), which needs this deployment's resolved `languages`/
  // default tag — LANGUAGES only exists once parseIdentity has run. Every
  // downstream localizable field (popup/fileImport.note/notices[].label/
  // licenses[].note/designs[].label,group/help) is threaded the same
  // DEFAULT_TAG (LANGUAGES[0], see parseConfigBlocks) from here on.
  const { TITLE, ID, DESCRIPTION, LANG, DIR, LANGUAGES } = parseIdentity(config);
  const DEFAULT_TAG = LANGUAGES[0];

  // Config text mode (scripts/lib/config-text.mjs, docs/config.md
  // "Localizing config text"): an opt-in pre-pass that folds every locale's
  // text file into `config`'s own LocalizableText-shaped fields BEFORE
  // resolveProseFields/parseConfigBlocks/buildDesigns ever see them, so the
  // rest of the pipeline runs unchanged — a config expressed this way and one
  // with the same prose written inline produce a deep-equal designs.json.
  const TEXT_PATHS = parseTextKey(config.text, LANGUAGES, DEFAULT_TAG, CONFIG_DIR, mustExist);
  if (TEXT_PATHS) {
    const textByTag = loadTextFiles(TEXT_PATHS);
    foldConfigText(config, textByTag, TEXT_PATHS, { languages: LANGUAGES, defaultTag: DEFAULT_TAG });

    // Content-drift WARNING (never an error, same contract as a design's own
    // `<design>.strings.stamps.json`, see buildDesigns): a tracked
    // `<config-basename>.text.stamps.json` beside the config (written by
    // `npm run i18n:status -- --stamp`, never by hand) records what the
    // DEFAULT locale's text looked like when translations were last stamped.
    // No stamps file -> no opinion.
    const stampsPath = textStampsPath(configPath, CONFIG_DIR);
    if (existsSync(stampsPath)) {
      let stamps;
      try {
        stamps = JSON.parse(readFileSync(stampsPath, "utf-8"));
      } catch (err) {
        throw new Error(`gen-schema: '${stampsPath}' is not valid JSON:\n  ${err.message}`, { cause: err });
      }
      for (const path of textDrift(textByTag, DEFAULT_TAG, stamps)) {
        console.warn(
          `gen-schema: config text may be stale: '${path}' changed in the default locale's text ` +
            `file since it was stamped`
        );
      }
    }
  }

  resolveProseFields(config, CONFIG_DIR, mustExist, LANGUAGES, DEFAULT_TAG);

  // `source` defaults to "." (designs live beside the config); set it to point
  // elsewhere (e.g. "examples", a sibling checkout, or an absolute path).
  const { source: SOURCE_REL } = applyTopLevelScalars(config, ["source"]);
  const SOURCE = resolve(CONFIG_DIR, SOURCE_REL);
  mustExist(SOURCE, `source directory '${config.source ?? "."}'`);

  // SOURCE-bound asset resolution (source-relative paths, config `assets`
  // expansion, the use/include dep-graph walk) plus the symlink-containment
  // policy (H5), see scripts/lib/assets.mjs. Created early so bundleFonts
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
  // ones bundleFonts leaves untouched): reconciled against the previous
  // run's manifest below (M8).
  const fontCopies = [];

  const {
    FEATURES,
    FORMAT,
    VIEWER,
    RENDER,
    COLORS,
    UI,
    PWA,
    SHORT_NAME,
    FILE_IMPORT,
    POPUP,
    HELP,
    NOTICES,
    LICENSES_EXTRA,
    STRINGS,
  } = parseConfigBlocks(config, CONFIG_DIR, mustExist, TITLE, LANGUAGES);
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

  // outScadDir and outArtDir are entirely generated. H6/M8: build each
  // complete new tree in its own staging directory first, and only replace
  // the live directory once every fallible step below (design parsing,
  // containment checks, PWA icon generation, …) has succeeded, so a build
  // that fails partway leaves the previous complete output rather than a
  // wiped-and-half-repopulated (or, per H6, silently cross-clobbered)
  // outScadDir/outArtDir. A stage left over from a previous crashed run is
  // wiped before use.
  const stageScadDir = `${outScadDir}.staging`;
  rmSync(stageScadDir, { recursive: true, force: true });
  mkdirSync(stageScadDir, { recursive: true });
  const stageArtDir = `${outArtDir}.staging`;
  rmSync(stageArtDir, { recursive: true, force: true });
  mkdirSync(stageArtDir, { recursive: true });

  const logo = copyLogoAssets(config, CONFIG_DIR, stageArtDir, mustExist, registry.register);

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
    outArtDir: stageArtDir,
    mustExist,
    checkContained,
    relPosix,
    copyAsset,
    register: registry.register,
    languages: LANGUAGES,
    defaultTag: DEFAULT_TAG,
  });
  const defaultDesign = resolveDefaultDesign(config, designs);
  checkPopupMode(POPUP, designs);

  // Shared dependency files: from the config's `assets` (files/directories) when
  // given, otherwise discovered by following each design's use/include graph.
  //
  // Either way, the use/include graph is now ALWAYS walked (collectDeps),
  // even when `assets` is explicit: purely to check it against the
  // configured set below (checkAssetCoverage); explicit `assets` still wins
  // as the actual set of files copied. See checkAssetCoverage's own comment
  // for why this closes a real silent-failure gap, and for how its error
  // stays distinct from collectDeps' own "not found" (a dependency missing
  // from disk, not merely missing from `assets`), that one can still throw
  // right here, unchanged, since collectDeps runs its existence check
  // regardless of which branch below ends up using the result.
  const assets = new Set();
  const walkedByDesign = designs.map((d) => ({ id: d.id, deps: collectDeps(d.abs) }));
  if (config.assets != null && (!Array.isArray(config.assets) || !config.assets.length))
    throw new Error(
      "gen-schema: 'assets', when set, must be a non-empty array of paths/globs.\n" +
        "  Omit the key entirely to follow each design's use/include graph."
    );
  if (Array.isArray(config.assets) && config.assets.length) {
    for (const a of expandConfiguredAssets(config.assets)) assets.add(a);
    checkAssetCoverage(designs, walkedByDesign, assets);
  } else {
    for (const { deps } of walkedByDesign) for (const dep of deps) assets.add(dep);
  }
  for (const a of assets) copyAsset(a);

  const extraCss = copyExtraCss(config, CONFIG_DIR, stageScadDir, mustExist, registry.register);

  // The staged scad tree is complete, but it is NOT committed to the live
  // outScadDir yet: the swap is deferred to the end (below), after the
  // fallible PWA generation and once the schema is in hand, so the whole
  // output (render sources, PWA/font assets, and designs.json) commits as
  // one unit. generatePwaAssets() itself never writes a byte: every icon,
  // splash, screenshot copy and manifest.webmanifest it would produce is
  // QUEUED into the `batch` it returns (see pwa-assets.mjs's write()/copy()
  // helpers and its module comment) instead of touching outPublicDir
  // directly. The queue is only flushed (via commitPwaBatch) at the commit
  // point below, in the same breath as the scad-tree rename and the font-tree
  // copy. So a throw anywhere in generatePwaAssets (a malformed configured
  // icon, or a `pwa.screenshots[].src` that doesn't exist, validated well
  // after the icon/splash rasterization already succeeded) leaves
  // outPublicDir completely untouched, not merely the scad tree: the old
  // icons/splashes/manifest, the old scad tree, and the old schema all still
  // match, exactly as if this run had never happened. Writing icons/splashes
  // to outPublicDir as soon as they rasterize would break that: a LATER failure
  // in the same call (e.g. the screenshot existence check) would leave fresh
  // icons paired with the stale scad tree/schema the swap below never reached.

  // Generate the PWA icon set, iOS splash images and manifest.webmanifest
  // (skipped for the fixture-driven unit tests, which pass no outPublicDir).
  // Nothing is written here, see the commit-point comment above. Returns the
  // iOS splash <link> descriptors vite injects into index.html, the icon
  // files that will be written (M8), and the pending write batch itself:
  // flushed below, and also the source of the written-path list the M8
  // lifecycle reconciliation below derives from it. It reads design
  // picker-icon dimensions from the STAGING art dir (artDir), since the
  // live swap hasn't happened yet.
  let appleSplash = [];
  let iconFiles = ["icon.svg"];
  let pwaBatch = [];
  if (outPublicDir) {
    ({ appleSplash, iconFiles, batch: pwaBatch } = generatePwaAssets({
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
      defaultTag: DEFAULT_TAG,
      mustExist,
      register: registry.register,
      isTracked: isTrackedFile,
      artDir: stageArtDir,
    }));
  }

  const renderHash = computeRenderHash({
    SOURCE,
    scadFiles: [...designs.map((d) => d.file), ...assets],
    features: FEATURES,
    format: FORMAT,
    fontPaths,
    fontsConf,
    // H3: the id -> file routing map is part of the render contract. Two
    // designs swapping files preserves the mounted file set but changes which
    // model a cache keyed by design id should render.
    designRouting: designs.map((d) => ({ id: d.id, file: d.file })),
    rendererFiles,
    outPublicDir,
  });

  // H4: per-file content digests for the big binary assets (wasm, glue, fonts,
  // fonts.conf). Appended as a `?v=<digest>` query on their fetch URLs (worker.ts
  // AND the precache-manifest `bin.urls` below use the identical scheme, see
  // src/lib/assetUrl.ts's versionedAssetUrl) so the fetch/Cache-Storage identity
  // is content-addressed, not only the combined renderHash used for L2 geometry.
  const BIN_ASSETS = outPublicDir
    ? computeBinAssetVersions({ fontPaths, fontsConf, outPublicDir })
    : {};

  // Fold every design's `stringsByTag` (buildDesigns' transient sidecar
  // bundle) into one file PER REGISTRY TAG, keyed by design id — computed
  // here, while `designs` still carries it, since assembleSchema strips it
  // before designs.json is built (see that call's own comment). Written for
  // EVERY tag (even one no design translated), so
  // src/lib/localeStore.ts's static per-tag import map never dangles.
  const i18nByTag = {};
  for (const tag of LOCALE_TAGS) {
    const byDesign = {};
    for (const d of designs) if (d.stringsByTag?.[tag]) byDesign[d.id] = d.stringsByTag[tag];
    i18nByTag[tag] = { designs: byDesign };
  }

  const schema = assembleSchema({
    SOURCE,
    relPosix,
    renderHash,
    version,
    components,
    BIN_ASSETS,
    TITLE,
    SHORT_NAME,
    ID,
    DESCRIPTION,
    LANG,
    DIR,
    LANGUAGES,
    STRINGS,
    PWA,
    appleSplash,
    COLORS,
    extraCss,
    logo,
    FORMAT,
    VIEWER,
    FEATURES,
    RENDER,
    FONTS,
    FONT_FAMILIES,
    FONT_FACES,
    FILE_IMPORT,
    POPUP,
    NOTICES,
    HELP,
    LICENSES_EXTRA,
    UI,
    defaultDesign,
    assets,
    designs,
  });

  // The last thing before the commit phase, and the reason the phases are
  // ordered this way: designs.json is written by an ordinary write that cannot
  // fail for a config reason, so "would the app accept this?" has to be asked
  // while failing is still free. THE app's validator, not a build-side
  // paraphrase of it — a paraphrase is a second contract, and the one that
  // used to live in read-schema.mjs drifted from this one immediately.
  validateSchema(schema);

  commitOutputs({
    outScadDir,
    stageScadDir,
    outArtDir,
    stageArtDir,
    outSchemaDir,
    outPublicDir,
    schema,
    i18nByTag,
    designCount: designs.length,
    fontWrites,
    fontsConf,
    fontCopies,
    pwaBatch,
    appleSplash,
    assets,
    logo,
    extraCss,
    iconFiles,
  });
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
    outArtDir: join(WEB, "public", "art"),
    outPublicDir: join(WEB, "public"),
    // H3: the renderer's source fixes the OpenSCAD CLI contract (flags,
    // mounting), so its bytes belong in renderHash. A worker change
    // invalidates the cache. Derived (not hand-listed) as worker.ts's full
    // local-import closure, so a new helper worker.ts starts importing is
    // automatically covered, see scripts/lib/worker-deps.mjs.
    rendererFiles: resolveWorkerDependencyClosure(join(WEB, "src", "openscad", "worker.ts")),
  });
  console.log(
    `gen-schema: ${schema.designs.length} designs, ${schema.assets.length} ` +
      `dependency files, ${schema.features.length} feature(s) -> ` +
      `src/generated/designs.json, public/scad/, public/art/` +
      // Surfaced here too so a deploy log records which ScadPub produced the
      // bundle (and shows when the stamp is missing, e.g. a git-less tree).
      ` [ScadPub ${schema.scadpubVersion ?? "version unknown"}]`
  );
}

// Run only when executed directly (not when imported by the tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
