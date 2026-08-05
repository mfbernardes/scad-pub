// config-text.mjs: the opt-in `text` config key (docs/config.md "Localizing
// config text") that moves ALL config-authored prose — English included —
// out of scadpub.config.json into per-locale JSON files. Two halves:
//
//   parseTextKey    validates the `text` map itself (locale tag -> config-
//                   relative file path): default locale required, every tag
//                   ⊆ this deployment's enabled `languages`, every path exists.
//   foldConfigText  the pure fold: reads each locale's already-loaded text
//                   file, cross-checks it against the config's OWN structure
//                   (a tab id, a notice marker, a license name, a design id —
//                   the join keys), and MUTATES `config` so every covered
//                   field already carries the `LocalizableText` object shape
//                   (`{ tag: value, … }`) the existing parsers
//                   (parseLocalizableText, parseNoticeLabel, resolveHelpPane,
//                   …) already validate. The fold never re-implements that
//                   validation itself — a field's real invariants (non-empty
//                   string, must include the default tag) are enforced once,
//                   downstream, exactly as for an inline config's own prose.
//
// Run as a pre-pass in gen-schema.mjs's generate(), between parseIdentity
// (LANGUAGES/DEFAULT_TAG resolved) and resolveProseFields — see that file's
// own comment on why the ordering matters. Every error names the offending
// text file (and, where useful, the dotted path inside it), the same
// "gen-schema: '<file>' <problem>" shape scripts/lib/design-strings.mjs uses
// for its own sidecar validation, since a config text file is the same idea
// (a translator-facing JSON sidecar, validated against the thing it
// translates) one level up.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { optionalStringFieldError } from "./config-parsers.mjs";

// The text file's own recognised top-level keys — one per config surface a
// LocalizableText field lives under. `$schema` is allowed (editor tooling
// only, like the main config's own) and ignored.
const TEXT_TOP_KEYS = new Set(["$schema", "popup", "help", "fileImport", "notices", "licenses", "designs", "strings"]);

/**
 * Validate the `text` config key: an object of locale tag -> config-relative
 * text-file path. `null`/absent -> not in text mode (returns null). Every tag
 * must be one of `enabledTags` (this deployment's resolved `languages`), the
 * default tag's entry is required (its file carries the deployment's
 * complete base text — see foldConfigText), and every path must exist.
 * @returns {Record<string,string> | null} tag -> absolute path, or null.
 */
export function parseTextKey(raw, enabledTags, defaultTag, configDir, mustExist) {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new Error("gen-schema: 'text' must be an object of locale tag: text-file-path pairs");
  const entries = Object.entries(raw);
  if (!entries.length) throw new Error("gen-schema: 'text' must have at least one locale entry");
  const tags = new Set(enabledTags);
  const out = {};
  for (const [tag, rel] of entries) {
    if (!tags.has(tag))
      throw new Error(
        `gen-schema: 'text' has an entry for locale "${tag}", which isn't one of this deployment's ` +
          `enabled locales.\n  Valid tags: ${[...tags].join(", ")}`
      );
    if (typeof rel !== "string" || !rel.trim()) throw optionalStringFieldError(`text.${tag}`);
    out[tag] = mustExist(resolve(configDir, rel.trim()), `text file for locale "${tag}"`);
  }
  if (!(defaultTag in out))
    throw new Error(
      `gen-schema: 'text' must include an entry for "${defaultTag}", this deployment's default locale ` +
        `— its text file is required and must carry the complete base text (see docs/config.md)`
    );
  return out;
}

function loadOneTextFile(abs) {
  let json;
  try {
    json = JSON.parse(readFileSync(abs, "utf-8"));
  } catch (err) {
    throw new Error(`gen-schema: '${abs}' is not valid JSON:\n  ${err.message}`, { cause: err });
  }
  if (json === null || typeof json !== "object" || Array.isArray(json))
    throw new Error(`gen-schema: '${abs}' must be a JSON object`);
  for (const key of Object.keys(json))
    if (!TEXT_TOP_KEYS.has(key))
      throw new Error(
        `gen-schema: '${abs}' has unknown key '${key}'.\n` +
          `  Valid keys: ${[...TEXT_TOP_KEYS].filter((k) => k !== "$schema").join(", ")}`
      );
  return json;
}

/** Load + shape-check every text file named by `parseTextKey`'s result.
 * @param {Record<string,string>} pathsByTag
 * @returns {Record<string,object>} tag -> parsed text file
 */
export function loadTextFiles(pathsByTag) {
  const out = {};
  for (const [tag, abs] of Object.entries(pathsByTag)) out[tag] = loadOneTextFile(abs);
  return out;
}

function fail(file, msg) {
  throw new Error(`gen-schema: '${file}' ${msg}`);
}

function requireObject(file, value, what) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(file, `'${what}' must be an object (got ${JSON.stringify(value)})`);
}

function requireNonEmptyString(file, value, what) {
  if (typeof value !== "string" || value.trim() === "")
    fail(file, `'${what}' must be a non-empty string (got ${JSON.stringify(value)})`);
}

// Build a `{ tag: value }` map from `getter(textFile)` across every tag whose
// text file actually sets something at that leaf; a tag with nothing there is
// simply absent from the map — sparse-locale fallback, not an error (see
// docs/config.md).
function buildMap(textByTag, languages, getter) {
  const out = {};
  for (const tag of languages) {
    const t = textByTag[tag];
    if (t === undefined) continue;
    const v = getter(t);
    if (v !== undefined && v !== null) out[tag] = v;
  }
  return out;
}

// A field this deployment's text file(s) cover must not ALSO be written
// inline in scadpub.config.json — "config has no text at all" is meant
// literally. `configPath` is the field's dotted path in the config (for the
// message); `defaultFile` is where it belongs instead.
function inlineConflict(value, configPath, defaultFile) {
  if (value != null)
    throw new Error(
      `gen-schema: config text mode: '${configPath}' is set inline in scadpub.config.json, but this ` +
        `deployment has 'text' configured — move it to '${defaultFile}' and remove the inline value.`
    );
}

function foldPopup(config, textByTag, pathsByTag, languages, defaultTag) {
  const defaultFile = pathsByTag[defaultTag];
  const anyText = languages.some((tag) => textByTag[tag]?.popup !== undefined);
  if (!config.popup || typeof config.popup !== "object") {
    if (anyText) fail(defaultFile, `sets 'popup', but this config has no 'popup' block`);
    return;
  }
  inlineConflict(config.popup.header, "popup.header", defaultFile);
  inlineConflict(config.popup.body, "popup.body", defaultFile);
  inlineConflict(config.popup.bodyFile, "popup.bodyFile", defaultFile);
  inlineConflict(config.popup.button, "popup.button", defaultFile);
  inlineConflict(config.popup.footnote, "popup.footnote", defaultFile);

  for (const tag of languages) {
    const p = textByTag[tag]?.popup;
    if (p !== undefined) requireObject(pathsByTag[tag], p, "popup");
  }
  const header = buildMap(textByTag, languages, (t) => t.popup?.header);
  const body = buildMap(textByTag, languages, (t) => t.popup?.body);
  if (!(defaultTag in header)) fail(defaultFile, `must set 'popup.header' — this deployment's 'popup' block requires it`);
  if (!(defaultTag in body)) fail(defaultFile, `must set 'popup.body' — this deployment's 'popup' block requires it`);
  requireNonEmptyString(defaultFile, header[defaultTag], "popup.header");
  requireNonEmptyString(defaultFile, body[defaultTag], "popup.body");
  config.popup.header = header;
  config.popup.body = body;
  const button = buildMap(textByTag, languages, (t) => t.popup?.button);
  if (Object.keys(button).length) config.popup.button = button;
  const footnote = buildMap(textByTag, languages, (t) => t.popup?.footnote);
  if (Object.keys(footnote).length) config.popup.footnote = footnote;
}

function foldFileImport(config, textByTag, pathsByTag, languages, defaultTag) {
  const defaultFile = pathsByTag[defaultTag];
  const anyText = languages.some((tag) => textByTag[tag]?.fileImport !== undefined);
  if (!config.fileImport) {
    if (anyText) fail(defaultFile, `sets 'fileImport', but this config has no 'fileImport' block`);
    return;
  }
  const note = buildMap(textByTag, languages, (t) => t.fileImport?.note);
  if (config.fileImport === true) {
    if (!Object.keys(note).length) return;
    config.fileImport = {}; // upgrade the boolean shorthand so 'note' has somewhere to land
  }
  if (typeof config.fileImport !== "object" || Array.isArray(config.fileImport)) return; // malformed; the real parser reports it
  inlineConflict(config.fileImport.note, "fileImport.note", defaultFile);
  inlineConflict(config.fileImport.noteFile, "fileImport.noteFile", defaultFile);
  if (Object.keys(note).length) config.fileImport.note = note;
}

// One `help.tabs[]` entry, joined by its (config-text-mode-required) `id`.
function foldHelpTab(tabConfig, tabId, textByTag, pathsByTag, languages, defaultTag) {
  const defaultFile = pathsByTag[defaultTag];
  const path = `help.tabs.${tabId}`;
  inlineConflict(tabConfig.label, `${path}.label`, defaultFile);
  inlineConflict(tabConfig.intro, `${path}.intro`, defaultFile);
  inlineConflict(tabConfig.sections, `${path}.sections`, defaultFile);
  inlineConflict(tabConfig.file, `${path}.file`, defaultFile);

  const defaultEntry = textByTag[defaultTag]?.help?.tabs?.[tabId];
  if (defaultEntry === undefined)
    fail(defaultFile, `is missing '${path}' — this deployment declares a help tab '${tabId}'`);
  requireObject(defaultFile, defaultEntry, path);
  requireNonEmptyString(defaultFile, defaultEntry.label, `${path}.label`);

  const label = buildMap(textByTag, languages, (t) => t.help?.tabs?.[tabId]?.label);
  const intro = buildMap(textByTag, languages, (t) => t.help?.tabs?.[tabId]?.intro);
  tabConfig.label = label;
  if (Object.keys(intro).length) tabConfig.intro = intro;

  if (defaultEntry.file !== undefined) {
    requireNonEmptyString(defaultFile, defaultEntry.file, `${path}.file`);
    const fileMap = {};
    for (const tag of languages) {
      const entry = textByTag[tag]?.help?.tabs?.[tabId];
      if (entry === undefined) continue;
      if (entry.file === undefined)
        fail(
          pathsByTag[tag],
          `'${path}' must set 'file' — locale "${defaultTag}" uses 'file' for this tab, so every ` +
            `locale that translates it must too`
        );
      if (entry.sections !== undefined) fail(pathsByTag[tag], `'${path}' sets both 'file' and 'sections' — remove one`);
      requireNonEmptyString(pathsByTag[tag], entry.file, `${path}.file`);
      fileMap[tag] = entry.file;
    }
    // Per-locale path map, resolved (and section-count-checked) by
    // resolveHelpPane later, same as an inline config's own 'help.tabs[].file'
    // object form — see docs/config.md.
    tabConfig.file = fileMap;
    return;
  }

  const defaultSections = defaultEntry.sections ?? [];
  if (!Array.isArray(defaultSections)) fail(defaultFile, `'${path}.sections' must be an array`);
  const perTag = {};
  for (const tag of languages) {
    const entry = textByTag[tag]?.help?.tabs?.[tabId];
    if (entry === undefined) continue;
    if (entry.file !== undefined)
      fail(
        pathsByTag[tag],
        `'${path}' sets 'file', but locale "${defaultTag}" uses inline 'sections' for this tab — ` +
          `every locale must use the same form`
      );
    const sections = entry.sections ?? [];
    if (!Array.isArray(sections)) fail(pathsByTag[tag], `'${path}.sections' must be an array`);
    if (sections.length !== defaultSections.length)
      fail(
        pathsByTag[tag],
        `'${path}.sections' has ${sections.length} section(s), but locale "${defaultTag}" has ` +
          `${defaultSections.length} — every locale must split into the same number of sections, in the same order`
      );
    sections.forEach((s, i) => {
      requireObject(pathsByTag[tag], s, `${path}.sections[${i}]`);
      requireNonEmptyString(pathsByTag[tag], s.title, `${path}.sections[${i}].title`);
      requireNonEmptyString(pathsByTag[tag], s.body, `${path}.sections[${i}].body`);
    });
    perTag[tag] = sections;
  }
  tabConfig.sections = defaultSections.map((_, i) => {
    const title = {};
    const body = {};
    for (const tag of Object.keys(perTag)) {
      title[tag] = perTag[tag][i].title;
      body[tag] = perTag[tag][i].body;
    }
    return { title, body };
  });
}

function foldHelp(config, textByTag, pathsByTag, languages, defaultTag) {
  const defaultFile = pathsByTag[defaultTag];
  const anyText = languages.some((tag) => textByTag[tag]?.help !== undefined);
  if (!config.help || typeof config.help !== "object") {
    if (anyText) fail(defaultFile, `sets 'help', but this config has no 'help' block`);
    return;
  }
  inlineConflict(config.help.intro, "help.intro", defaultFile);
  const hasTabs = Array.isArray(config.help.tabs);
  if (!hasTabs) {
    inlineConflict(config.help.sections, "help.sections", defaultFile);
    inlineConflict(config.help.file, "help.file", defaultFile);
  }

  const intro = buildMap(textByTag, languages, (t) => t.help?.intro);
  if (Object.keys(intro).length) config.help.intro = intro;

  if (hasTabs) {
    for (const tab of config.help.tabs)
      if (typeof tab?.id !== "string" || !tab.id.trim())
        throw new Error(
          "gen-schema: config text mode requires every 'help.tabs[]' entry to have an 'id' " +
            "(it's the join key against the text files) — add one."
        );
    const knownIds = new Set(config.help.tabs.map((t) => t.id));
    for (const tag of languages) {
      const tabsText = textByTag[tag]?.help?.tabs;
      if (tabsText === undefined) continue;
      requireObject(pathsByTag[tag], tabsText, "help.tabs");
      for (const id of Object.keys(tabsText))
        if (!knownIds.has(id)) fail(pathsByTag[tag], `'help.tabs.${id}' does not match any help tab id in this config`);
    }
    for (const tab of config.help.tabs) foldHelpTab(tab, tab.id, textByTag, pathsByTag, languages, defaultTag);
    return;
  }

  // Single-pane help: `file` OR `sections`, decided by the DEFAULT locale's entry.
  const defaultHelp = textByTag[defaultTag]?.help;
  if (defaultHelp === undefined) fail(defaultFile, `is missing 'help' — this config's 'help' block requires it`);
  requireObject(defaultFile, defaultHelp, "help");
  if (defaultHelp.file !== undefined) {
    requireNonEmptyString(defaultFile, defaultHelp.file, "help.file");
    const fileMap = {};
    for (const tag of languages) {
      const h = textByTag[tag]?.help;
      if (h === undefined || h.file === undefined) continue;
      requireNonEmptyString(pathsByTag[tag], h.file, "help.file");
      fileMap[tag] = h.file;
    }
    config.help.file = fileMap;
    return;
  }
  const defaultSections = defaultHelp.sections;
  if (!Array.isArray(defaultSections))
    fail(defaultFile, `must set 'help.sections' (an array) or 'help.file' — this config's 'help' has no 'tabs'`);
  const perTag = {};
  for (const tag of languages) {
    const h = textByTag[tag]?.help;
    if (h === undefined || h.sections === undefined) continue;
    const sections = h.sections;
    if (!Array.isArray(sections) || sections.length !== defaultSections.length)
      fail(
        pathsByTag[tag],
        `'help.sections' must match locale "${defaultTag}"'s section count (${defaultSections.length})`
      );
    sections.forEach((s, i) => {
      requireObject(pathsByTag[tag], s, `help.sections[${i}]`);
      requireNonEmptyString(pathsByTag[tag], s.title, `help.sections[${i}].title`);
      requireNonEmptyString(pathsByTag[tag], s.body, `help.sections[${i}].body`);
    });
    perTag[tag] = sections;
  }
  config.help.sections = defaultSections.map((_, i) => {
    const title = {};
    const body = {};
    for (const tag of Object.keys(perTag)) {
      title[tag] = perTag[tag][i].title;
      body[tag] = perTag[tag][i].body;
    }
    return { title, body };
  });
}

function foldNotices(config, textByTag, pathsByTag, languages, defaultTag) {
  const defaultFile = pathsByTag[defaultTag];
  const notices = Array.isArray(config.notices) ? config.notices : [];
  const knownMarkers = new Set(notices.map((n) => (typeof n?.marker === "string" ? n.marker : null)).filter(Boolean));
  for (const tag of languages) {
    const noticesText = textByTag[tag]?.notices;
    if (noticesText === undefined) continue;
    requireObject(pathsByTag[tag], noticesText, "notices");
    for (const marker of Object.keys(noticesText))
      if (!knownMarkers.has(marker))
        fail(pathsByTag[tag], `'notices.${marker}' does not match any 'notices[].marker' in this config`);
  }
  for (const entry of notices) {
    if (typeof entry.marker !== "string" || !entry.marker.trim()) continue; // the real parser reports this
    inlineConflict(entry.label, `notices[marker=${entry.marker}].label`, defaultFile);
    const other = {};
    const one = {};
    for (const tag of languages) {
      const raw = textByTag[tag]?.notices?.[entry.marker];
      if (raw === undefined) continue;
      const file = pathsByTag[tag];
      if (typeof raw === "string") {
        requireNonEmptyString(file, raw, `notices.${entry.marker}`);
        other[tag] = raw.trim();
        one[tag] = raw.trim();
        continue;
      }
      requireObject(file, raw, `notices.${entry.marker}`);
      requireNonEmptyString(file, raw.other, `notices.${entry.marker}.other`);
      other[tag] = raw.other;
      one[tag] = raw.one ?? raw.other;
    }
    if (Object.keys(other).length) entry.label = { other, one };
  }
}

function foldLicenses(config, textByTag, pathsByTag, languages, defaultFile) {
  const licenses = Array.isArray(config.licenses) ? config.licenses : [];
  const knownNames = new Set(licenses.map((l) => l?.name).filter((n) => typeof n === "string"));
  for (const tag of languages) {
    const licensesText = textByTag[tag]?.licenses;
    if (licensesText === undefined) continue;
    requireObject(pathsByTag[tag], licensesText, "licenses");
    for (const name of Object.keys(licensesText))
      if (!knownNames.has(name))
        fail(pathsByTag[tag], `'licenses.${JSON.stringify(name)}' does not match any 'licenses[].name' in this config`);
  }
  for (const entry of licenses) {
    if (typeof entry.name !== "string") continue; // the real parser reports this
    inlineConflict(entry.note, `licenses[name=${JSON.stringify(entry.name)}].note`, defaultFile);
    const note = buildMap(textByTag, languages, (t) => t.licenses?.[entry.name]?.note);
    if (Object.keys(note).length) entry.note = note;
  }
}

function foldDesigns(config, textByTag, pathsByTag, languages, defaultFile) {
  const designs = Array.isArray(config.designs) ? config.designs : [];
  const knownIds = new Set(designs.map((d) => d?.id).filter((id) => typeof id === "string"));
  for (const tag of languages) {
    const designsText = textByTag[tag]?.designs;
    if (designsText === undefined) continue;
    requireObject(pathsByTag[tag], designsText, "designs");
    for (const id of Object.keys(designsText))
      if (!knownIds.has(id)) fail(pathsByTag[tag], `'designs.${id}' does not match any 'designs[].id' in this config`);
  }
  for (const entry of designs) {
    if (typeof entry.id !== "string") continue; // the real parser reports this
    inlineConflict(entry.label, `designs[id=${entry.id}].label`, defaultFile);
    inlineConflict(entry.group, `designs[id=${entry.id}].group`, defaultFile);
    const label = buildMap(textByTag, languages, (t) => t.designs?.[entry.id]?.label);
    if (Object.keys(label).length) entry.label = label;
    const group = buildMap(textByTag, languages, (t) => t.designs?.[entry.id]?.group);
    if (Object.keys(group).length) entry.group = group;
  }
}

function foldStrings(config, textByTag, pathsByTag, languages) {
  if (config.strings != null && typeof config.strings === "object" && Object.keys(config.strings).length)
    throw new Error(
      "gen-schema: config text mode: 'strings' is set inline in scadpub.config.json, but this deployment " +
        "has 'text' configured — move every override into the text files' 'strings' block instead."
    );
  const keys = new Set();
  for (const tag of languages) {
    const s = textByTag[tag]?.strings;
    if (s === undefined) continue;
    requireObject(pathsByTag[tag], s, "strings");
    for (const key of Object.keys(s)) keys.add(key);
  }
  if (!keys.size) return;
  const out = {};
  for (const key of keys) {
    const map = {};
    for (const tag of languages) {
      const v = textByTag[tag]?.strings?.[key];
      if (v === undefined) continue;
      if (typeof v !== "string") fail(pathsByTag[tag], `'strings.${key}' must be a string (got ${JSON.stringify(v)})`);
      map[tag] = v;
    }
    out[key] = map;
  }
  config.strings = out;
}

/**
 * The build-time pre-pass: fold every locale's text file into `config`'s own
 * `LocalizableText`-shaped fields, in place, then leave `config` for the
 * ordinary (unchanged) parser pipeline to validate exactly as if every field
 * had been written inline. See this module's own top comment for the
 * contract; docs/config.md "Localizing config text" is the human reference.
 * @param {object} config  the raw config object (mutated)
 * @param {Record<string,object>} textByTag  tag -> parsed text file (loadTextFiles)
 * @param {Record<string,string>} pathsByTag  tag -> text file path (parseTextKey), for error messages
 * @param {{languages: string[], defaultTag: string}} ctx
 */
export function foldConfigText(config, textByTag, pathsByTag, { languages, defaultTag }) {
  const defaultFile = pathsByTag[defaultTag];
  foldPopup(config, textByTag, pathsByTag, languages, defaultTag);
  foldFileImport(config, textByTag, pathsByTag, languages, defaultTag);
  foldHelp(config, textByTag, pathsByTag, languages, defaultTag);
  foldNotices(config, textByTag, pathsByTag, languages, defaultTag);
  foldLicenses(config, textByTag, pathsByTag, languages, defaultFile);
  foldDesigns(config, textByTag, pathsByTag, languages, defaultFile);
  foldStrings(config, textByTag, pathsByTag, languages);
}

// ── Coverage + drift (scripts/i18n-status.mjs, and gen-schema's own warn-only
// drift check) — the config-text counterpart of scripts/lib/i18n-coverage.mjs,
// one level up: instead of a design's fields, this walks a text FILE's own
// leaves. ────────────────────────────────────────────────────────────────

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Every string leaf of a parsed text file, as `{ path, value }`, dotted for
 *  an object key and bracketed for an array index (`help.tabs.walkthrough.
 *  sections[0].title`) — stable regardless of a locale's own key order, and
 *  matching how scripts/lib/config-text.mjs's own error messages name a leaf.
 *  `$schema` is skipped: editor-tooling metadata, not translatable content. */
export function flattenTextLeaves(obj, prefix = "") {
  const leaves = [];
  if (obj === null || obj === undefined) return leaves;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => leaves.push(...flattenTextLeaves(v, `${prefix}[${i}]`)));
    return leaves;
  }
  if (typeof obj === "object") {
    for (const [key, value] of Object.entries(obj)) {
      if (prefix === "" && key === "$schema") continue;
      leaves.push(...flattenTextLeaves(value, prefix ? `${prefix}.${key}` : key));
    }
    return leaves;
  }
  if (typeof obj === "string") leaves.push({ path: prefix, value: obj });
  return leaves;
}

/** Per enabled non-default locale: how many of the DEFAULT locale's text-file
 *  leaves that locale's own text file also sets, at the same path — the
 *  default file is the reference set, matching docs/config.md's "the default
 *  locale's file is required and must be complete" rule. */
export function configTextCoverage(textByTag, languages, defaultTag) {
  const defaultLeaves = flattenTextLeaves(textByTag[defaultTag]);
  const out = {};
  for (const tag of languages) {
    if (tag === defaultTag) continue;
    const tagPaths = new Set(flattenTextLeaves(textByTag[tag]).map((l) => l.path));
    let translated = 0;
    for (const l of defaultLeaves) if (tagPaths.has(l.path)) translated++;
    out[tag] = { translated, total: defaultLeaves.length };
  }
  return out;
}

/** The stamp map `npm run i18n:status -- --stamp` writes to
 *  `<config-basename>.text.stamps.json`: sha256 of every leaf of the
 *  DEFAULT locale's text file (what every translation was made against),
 *  keyed by the same dotted/bracketed path `flattenTextLeaves` produces. */
export function computeTextStamps(textByTag, defaultTag) {
  const out = {};
  for (const { path, value } of flattenTextLeaves(textByTag[defaultTag])) out[path] = sha256Hex(value);
  return out;
}

/** Stamped paths whose recorded hash no longer matches the CURRENT default
 *  locale's text — the source moved since a translation was stamped against
 *  it (same "warn, never fail" contract as design-translation drift, see
 *  scripts/lib/i18n-coverage.mjs's `driftFields`). A path the stamps object
 *  doesn't mention (a field added since, or a stamps file predating a text
 *  restructure) is silently skipped: no stamp -> no drift opinion. */
export function textDrift(textByTag, defaultTag, stamps) {
  if (!stamps) return [];
  const current = computeTextStamps(textByTag, defaultTag);
  const stale = [];
  for (const [path, hash] of Object.entries(stamps)) {
    if (current[path] !== undefined && current[path] !== hash) stale.push(path);
  }
  return stale;
}

/** `<config-basename>.text.stamps.json`'s path, beside the config file:
 *  `scadpub.config.json` -> `scadpub.config.text.stamps.json`, the same
 *  "strip only the JSON extension" rule a design's own
 *  `<design>.strings.stamps.json` uses (basename of the .scad, unstripped of
 *  everything else). */
export function textStampsPath(configPath, configDir) {
  const base = basename(configPath).replace(/\.json$/i, "");
  return resolve(configDir, `${base}.text.stamps.json`);
}
