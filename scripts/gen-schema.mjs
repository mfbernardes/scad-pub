// gen-schema.mjs — derive the configurator's parameter schema from a directory
// of OpenSCAD designs, parsing OpenSCAD's own Customizer syntax
// (SECTION_RE / PARAM_RE, skipping the [Hidden] section). Generic: the source
// directory, the design list, the always-on OpenSCAD features and the bundled
// fonts all come from scadpub.config.json (override with SCADPUB_CONFIG).
//
// For each design it parses the Customizer parameters and gathers the shared
// .scad the renderer needs, copying them (preserving their relative paths) into
// public/scad/ so the in-browser renderer can mount them. Dependencies come from
// the config's `assets` list (files or whole directories, e.g. "lib"); when that
// is omitted it falls back to following each design's `use`/`include` graph. Run
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
import { dirname, join, resolve, relative, sep } from "node:path";

// A content hash over everything that determines a render's STL output — the
// mounted .scad sources, the bundled fonts (glyph outlines drive text geometry),
// the always-on render features, the OpenSCAD wasm build, and the renderer's own
// source (worker.ts, which fixes the OpenSCAD CLI flags — backend, export
// format, etc.). Folded into the render cache key (schema.renderHash) so any of
// these changing in a deploy invalidates persisted geometry automatically,
// rather than relying on a manual CACHE_VERSION bump for renderer-code changes.
// Fonts/wasm/renderer are hashed only when outPublicDir is given (the real
// build); the fixture tests omit it and hash just the sources + features.
function computeRenderHash({ SOURCE, scadFiles, features, fonts, rendererFiles, outPublicDir }) {
  const h = createHash("sha256");
  h.update("renderhash-v2\n"); // version of this recipe itself
  for (const rel of [...scadFiles].sort()) {
    h.update(`scad\0${rel}\0`);
    try {
      h.update(readFileSync(join(SOURCE, rel)));
    } catch {
      /* unreadable source — its absence is itself part of the hash */
    }
  }
  h.update(`features\0${[...features].sort().join(",")}\0`);
  if (outPublicDir) {
    // The render contract lives in app code, not the schema: hashing the worker
    // source means a change to its OpenSCAD flags or mounting logic invalidates
    // stale geometry without a manual cache-version bump.
    for (const abs of [...(rendererFiles ?? [])].sort()) {
      h.update(`renderer\0${abs.split(/[\\/]/).pop()}\0`);
      try {
        h.update(readFileSync(abs));
      } catch {
        /* renderer source unavailable in this build context */
      }
    }
    for (const name of [...fonts].sort()) {
      h.update(`font\0${name}\0`);
      try {
        h.update(readFileSync(join(outPublicDir, "fonts", name)));
      } catch {
        /* font not bundled here */
      }
    }
    // fontconfig matching rules — they steer which glyphs the text() geometry uses.
    try {
      h.update("fonts.conf\0");
      h.update(readFileSync(join(outPublicDir, "fonts", "fonts.conf")));
    } catch {
      /* no bundled fonts.conf */
    }
    try {
      h.update(readFileSync(join(outPublicDir, "wasm", "openscad.wasm")));
    } catch {
      /* wasm fetched separately; absent during some builds */
    }
  }
  return h.digest("hex").slice(0, 16);
}

const SECTION_RE = /\/\*\s*\[([^\]]+)\]\s*\*\//;
// name = default; // [hint]
// The name uses OpenSCAD's identifier grammar — a letter or underscore, then
// letters/digits/underscores — so camelCase (wallThickness), PascalCase
// (FontSize) and leading-underscore (_offset) params are all captured, not just
// lowercase ones. ($-prefixed special variables aren't Customizer params.)
const PARAM_RE =
  /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?);\s*(?:\/\/\s*\[([^\]]*)\])?\s*$/;
// A leading line comment that documents the next parameter.
const DOC_RE = /^\s*\/\/\s?(.*)$/;
// A `use <path>` / `include <path>` dependency directive.
const DEP_RE = /^\s*(?:use|include)\s*<([^>]+)>/;
// `@showIf <expr>` directive inside a param's doc block (conditional visibility).
const SHOWIF_RE = /^@show-?if\s+(.+)$/i;
// `// @collapsed` on its own line, marking the NEXT section folded by default.
const COLLAPSE_RE = /^\s*\/\/\s*@collapsed?\s*$/i;

// The CSS custom-property tokens a consumer config may override via `colors`
// (see src/index.css), listed without the leading `--`. Overriding a token
// outside this set is almost always a typo, so we fail the build rather than
// silently emit a no-op rule.
export const COLOR_TOKENS = [
  "bg",
  "panel",
  "panel-2",
  "line",
  "text",
  "muted",
  "accent",
  "accent-solid",
  "on-accent",
  "focus",
  "link",
  "warn",
  "code-bg",
  "overlay",
  "viewer-bg",
  "viewer-grid",
  "viewer-grid-2",
  "viewer-model",
];

// A deliberately strict CSS-colour value: hex, rgb()/rgba()/hsl()/hsla(), or a
// named colour. Forbids `;`, `{`, `}` and comment markers so a value can't break
// out of the generated `<style>` rule it gets interpolated into.
const COLOR_VALUE_RE = /^[#a-zA-Z0-9 ,.()%/-]+$/;

// Validate and normalise the optional `colors` config block into
// { light?: {token: value}, dark?: {token: value} }. Unknown tokens and unsafe
// values fail the build with a clear message (consistent with gen-schema's other
// fail-fast checks). Colours don't affect geometry, so they're absent from
// renderHash. Returns null when nothing valid is configured.
export function parseColors(raw) {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new Error(
      "gen-schema: 'colors' must be an object with optional 'light' and 'dark' keys"
    );
  const out = {};
  for (const theme of ["light", "dark"]) {
    const tokens = raw[theme];
    if (tokens == null) continue;
    if (typeof tokens !== "object" || Array.isArray(tokens))
      throw new Error(
        `gen-schema: 'colors.${theme}' must be an object of token: colour pairs`
      );
    const cleaned = {};
    for (const [token, value] of Object.entries(tokens)) {
      if (!COLOR_TOKENS.includes(token))
        throw new Error(
          `gen-schema: unknown colour token 'colors.${theme}.${token}'.\n` +
            `  Valid tokens: ${COLOR_TOKENS.join(", ")}`
        );
      if (typeof value !== "string" || !COLOR_VALUE_RE.test(value.trim()))
        throw new Error(
          `gen-schema: 'colors.${theme}.${token}' must be a plain CSS colour ` +
            `(got ${JSON.stringify(value)})`
        );
      cleaned[token] = value.trim();
    }
    if (Object.keys(cleaned).length) out[theme] = cleaned;
  }
  return Object.keys(out).length ? out : null;
}

// The concise label is the first sentence of the doc block; the rest is help.
// Split on sentence-ending .!? + whitespace + a capital/opening paren, so we
// don't break on decimals (1.5 mm) or lowercase abbreviations (e.g., i.e.).
export function firstSentence(text) {
  if (!text) return "";
  return text.split(/(?<=[.!?])\s+(?=[A-Z(])/)[0];
}

// Turn a file stem into a human label ("learning_tile" -> "Learning tile").
function humanize(stem) {
  const s = stem.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseNumberHint(hint) {
  // "min:step:max" or "min:max"
  const parts = hint.split(":").map((p) => Number(p.trim()));
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) return { min: parts[0], step: parts[1], max: parts[2] };
  if (parts.length === 2) return { min: parts[0], max: parts[1] };
  return null;
}

export function parseEnumHint(hint) {
  // "val:Label, val2:Label2"  OR  list of quoted strings: "a", "b"
  // OR a bare comma-separated value list: "left, right, up, down".
  const items = hint.split(",").map((s) => s.trim()).filter(Boolean);
  if (items.length < 2) return null;
  if (items.every((i) => /^".*"$/.test(i))) {
    // quoted-string enum (e.g. font choices)
    return items.map((i) => {
      const v = i.replace(/^"|"$/g, "");
      return { value: v, label: v };
    });
  }
  if (items.some((i) => i.includes(":"))) {
    return items.map((i) => {
      const [value, ...rest] = i.split(":");
      const label = rest.join(":").trim() || value.trim();
      return { value: value.trim(), label };
    });
  }
  // Bare value list: OpenSCAD's Customizer renders these as a dropdown whose
  // label is the value itself (e.g. signage's `arrow` directions).
  return items.map((v) => ({ value: v, label: v }));
}

function inferParam(name, rawDefault, hint, doc, help, section) {
  const base = { name, section, description: doc || "", help: help || "" };
  const def = rawDefault.trim();

  // boolean
  if (def === "true" || def === "false") {
    return { ...base, type: "boolean", default: def === "true" };
  }

  // string default
  const stringMatch = def.match(/^"([\s\S]*)"$/);
  const isString = stringMatch != null;

  if (hint) {
    const num = !isString ? parseNumberHint(hint) : null;
    if (num) {
      return { ...base, type: "number", default: Number(def), ...num };
    }
    const choices = parseEnumHint(hint);
    if (choices) {
      return {
        ...base,
        type: "enum",
        default: isString ? stringMatch[1] : def,
        choices,
      };
    }
  }

  if (isString) return { ...base, type: "string", default: stringMatch[1] };
  if (!Number.isNaN(Number(def)))
    return { ...base, type: "number", default: Number(def) };
  // Fallback: opaque expression — expose as raw text.
  return { ...base, type: "string", default: def, raw: true };
}

export function parseParams(absPath) {
  const text = readFileSync(absPath, "utf-8");
  const lines = text.split(/\r?\n/);
  let section = null;
  let pendingDoc = [];
  let pendingShowIf = null;
  // Set by a `// @collapsed` line; consumed by the next section header.
  let pendingSectionCollapsed = false;
  const params = [];
  const sections = [];
  const collapsedSections = [];
  const reset = () => {
    pendingDoc = [];
    pendingShowIf = null;
    pendingSectionCollapsed = false;
  };
  for (const line of lines) {
    // A section-collapse marker can precede the header even before the first
    // section, so handle it before the null-section guard below.
    if (COLLAPSE_RE.test(line)) {
      pendingSectionCollapsed = true;
      continue;
    }
    const sm = line.match(SECTION_RE);
    if (sm) {
      section = sm[1];
      if (section !== "Hidden" && !sections.includes(section))
        sections.push(section);
      if (pendingSectionCollapsed && section !== "Hidden" && !collapsedSections.includes(section))
        collapsedSections.push(section);
      reset();
      continue;
    }
    if (section === null || section === "Hidden") {
      reset();
      continue;
    }
    const pm = line.match(PARAM_RE);
    if (pm) {
      const [, name, def, hint] = pm;
      // OpenSCAD's Customizer documents a parameter with the comment block
      // directly above it. The first sentence is the label, the full block is help.
      const trimmed = pendingDoc.map((d) => d.trim()).filter(Boolean);
      const help = trimmed.join(" ");
      const p = inferParam(name, def, hint, firstSentence(help), help, section);
      if (pendingShowIf) p.showIf = pendingShowIf;
      params.push(p);
      reset();
      continue;
    }
    const dm = line.match(DOC_RE);
    if (dm && line.trim().startsWith("//")) {
      // Pull `@showIf <expr>` out of the doc block so it doesn't pollute the
      // label/help; it drives conditional visibility in the UI instead.
      const showIf = dm[1].trim().match(SHOWIF_RE);
      if (showIf) pendingShowIf = showIf[1].trim();
      else pendingDoc.push(dm[1]);
    } else if (line.trim() === "") {
      // keep doc across blank lines
    } else {
      reset();
    }
  }
  return { params, sections, collapsedSections };
}

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
  // Everything in the config is resolved relative to the config file's directory.
  // `source` defaults to "." (designs live beside the config); set it to point
  // elsewhere (e.g. "examples", a sibling checkout, or an absolute path).
  const CONFIG_DIR = dirname(configPath);
  const SOURCE = resolve(CONFIG_DIR, config.source ?? ".");
  mustExist(SOURCE, `source directory '${config.source ?? "."}'`);
  const FEATURES = config.features ?? [];
  const FONTS = config.fonts ?? [];
  const TITLE = config.title ?? "ScadPub";
  const ID = config.id ?? "scadpub";
  const DESCRIPTION =
    config.description ?? "Configure and export designs in your browser.";
  // PWA / browser chrome colours (default to the dark palette's chrome).
  const THEME_COLOR = config.themeColor ?? "#1f2229";
  const BG_COLOR = config.backgroundColor ?? "#15171c";
  // Optional nudge to upload an external (non-bundled) font; passed through
  // verbatim. Absent -> null -> no startup prompt.
  const FONT_PROMPT = config.fontPrompt ?? null;
  // Optional help content; passed through verbatim. Absent -> null -> the app
  // falls back to its generic, project-agnostic default help.
  const HELP = config.help ?? null;
  // Optional per-theme colour-scheme overrides. Validated against the known CSS
  // tokens; emitted by vite.config.ts as a <style> block so a consumer project
  // can restyle the app entirely from its config. Absent -> null.
  const COLORS = parseColors(config.colors);

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

  // A source-relative POSIX path (the key the renderer mounts files under).
  const relPosix = (absPath) => relative(SOURCE, absPath).split(sep).join("/");

  // Every .scad under a directory (recursively), as source-relative POSIX paths.
  const scadFilesUnder = (absDir) => {
    const out = [];
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) out.push(...scadFilesUnder(abs));
      else if (entry.name.endsWith(".scad")) out.push(relPosix(abs));
    }
    return out;
  };

  // Expand the config's `assets`: a directory contributes all the .scad under
  // it; a file is taken as-is. So listing "lib" bundles lib/*.scad.
  const expandConfiguredAssets = (entries) => {
    const set = new Set();
    for (const entry of entries) {
      const abs = mustExist(resolve(SOURCE, entry), `asset '${entry}'`);
      if (statSync(abs).isDirectory()) {
        for (const f of scadFilesUnder(abs)) set.add(f);
      } else {
        set.add(relPosix(abs));
      }
    }
    return set;
  };

  // Walk the use/include graph from a design, returning every dependency's
  // source-relative POSIX path. Each `<path>` is resolved relative to the file
  // that references it, matching OpenSCAD. Used only when `assets` is omitted.
  const collectDeps = (designAbs) => {
    const deps = new Set();
    const visited = new Set([designAbs]);
    const queue = [designAbs];
    while (queue.length) {
      const cur = queue.shift();
      const curDir = dirname(cur);
      const text = readFileSync(cur, "utf-8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(DEP_RE);
        if (!m) continue;
        const depAbs = resolve(curDir, m[1].trim());
        if (visited.has(depAbs)) continue;
        visited.add(depAbs);
        deps.add(relPosix(depAbs));
        queue.push(depAbs);
      }
    }
    return deps;
  };

  // The design list from the config, or auto-discovered root .scad files.
  const resolveDesigns = () => {
    if (Array.isArray(config.designs) && config.designs.length) {
      return config.designs.map((d) => ({
        id: d.id,
        label: d.label ?? humanize(d.id),
        file: d.file ?? `${d.id}.scad`,
        // Heavy designs skip the debounced auto-render (the user renders on demand).
        heavy: d.heavy ?? false,
      }));
    }
    return readdirSync(SOURCE)
      .filter((f) => f.endsWith(".scad"))
      .sort()
      .map((f) => {
        const id = f.replace(/\.scad$/, "");
        return { id, label: humanize(id), file: f, heavy: false };
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

  const designs = resolveDesigns().map((d) => {
    const abs = mustExist(join(SOURCE, d.file), `design '${d.id}' source file '${d.file}'`);
    const { params, sections, collapsedSections } = parseParams(abs);
    copyAsset(d.file);
    // Auto-detect a sibling OpenSCAD parameterSets file: <name>.scad -> <name>.json
    // next to it. One file can hold many named sets; absent -> no bundled presets.
    const presetRel = d.file.replace(/\.scad$/, ".json");
    const presets = existsSync(join(SOURCE, presetRel)) ? [presetRel] : [];
    if (presets.length) copyAsset(presetRel);
    return { ...d, presets, abs, sections, collapsedSections, params };
  });

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

  // Generate the PWA manifest + app icon from the config (skipped for the
  // fixture-driven unit tests, which don't pass outPublicDir).
  if (outPublicDir) {
    mkdirSync(outPublicDir, { recursive: true });
    if (config.icon) {
      copyFileSync(
        mustExist(resolve(CONFIG_DIR, config.icon), `icon '${config.icon}'`),
        join(outPublicDir, "icon.svg")
      );
    } else {
      // Neutral default icon when the config supplies none.
      writeFileSync(
        join(outPublicDir, "icon.svg"),
        `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="${TITLE}">\n` +
          `  <rect width="512" height="512" rx="96" fill="${THEME_COLOR}"/>\n` +
          `  <rect x="150" y="150" width="212" height="212" rx="28" fill="none" stroke="#86a9ff" stroke-width="30"/>\n` +
          `</svg>\n`
      );
    }
    writeFileSync(
      join(outPublicDir, "manifest.webmanifest"),
      JSON.stringify(
        {
          name: TITLE,
          short_name: config.shortName ?? TITLE,
          description: DESCRIPTION,
          start_url: ".",
          scope: ".",
          display: "standalone",
          background_color: BG_COLOR,
          theme_color: THEME_COLOR,
          icons: [
            { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
          ],
        },
        null,
        2
      ) + "\n"
    );
  }

  const renderHash = computeRenderHash({
    SOURCE,
    scadFiles: [...designs.map((d) => d.file), ...assets],
    features: FEATURES,
    fonts: FONTS,
    rendererFiles,
    outPublicDir,
  });

  const schema = {
    generatedFrom: relPosix(SOURCE) || ".",
    renderHash,
    title: TITLE,
    id: ID,
    description: DESCRIPTION,
    themeColor: THEME_COLOR,
    colors: COLORS,
    extraCss,
    logo,
    features: FEATURES,
    fonts: FONTS,
    fontPrompt: FONT_PROMPT,
    help: HELP,
    assets: [...assets].sort(),
    designs: designs.map(({ abs, ...d }) => d),
  };
  if (outPublicDir) {
    const precache = new Set([
      "icon.svg",
      "manifest.webmanifest",
      "wasm/openscad.js",
      "fonts/fonts.conf",
    ]);
    for (const font of FONTS) precache.add(`fonts/${font}`);
    for (const asset of assets) precache.add(`scad/${asset}`);
    for (const d of schema.designs) {
      precache.add(`scad/${d.file}`);
      for (const preset of d.presets) precache.add(`scad/${preset}`);
    }
    if (logo) {
      precache.add(logo.light);
      precache.add(logo.dark);
    }
    if (extraCss) precache.add(extraCss);
    writeFileSync(
      join(outPublicDir, "precache-manifest.json"),
      JSON.stringify([...precache].sort(), null, 2) + "\n"
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
