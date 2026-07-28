// Unit tests for scripts/lib/config-spec.mjs and the two things it feeds:
// the committed scadpub.config.schema.json (scripts/gen-config-schema.mjs)
// and docs/config.md's key coverage. These are the drift guards the previous
// hand-maintained-in-five-places setup didn't have — see CONFIG_SPEC's
// file-top comment and the commit that introduced it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_SPEC } from "../scripts/lib/config-spec.mjs";
import { buildConfigSchema } from "../scripts/gen-config-schema.mjs";
import {
  POPUP_MODES,
  TEXT_DIRECTIONS,
  FORMATS,
  PANEL_SIDES,
  PANEL_DEFAULTS,
  OUTPUT_DEFAULTS,
  VIEWER_STYLES,
  VIEWER_GRID_DEFAULTS,
  INSTALL_MODES,
} from "../src/lib/schema.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

test("scadpub.config.schema.json is up to date with config-spec.mjs", () => {
  const committed = JSON.parse(
    readFileSync(join(ROOT, "scadpub.config.schema.json"), "utf-8")
  );
  const fresh = buildConfigSchema();
  assert.deepEqual(
    committed,
    fresh,
    "scadpub.config.schema.json is stale — run `npm run gen` (or " +
      "`node scripts/gen-config-schema.mjs`) and commit the result."
  );
});

// Every key CONFIG_SPEC knows about, flattened to bare names (not paths) —
// the same name reused at different nesting levels (e.g. `id` on the config
// itself and on a `designs[]` entry) only needs to be documented once.
function flattenSpecKeys(spec) {
  const names = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.properties) {
      for (const [key, field] of Object.entries(node.properties)) {
        names.add(key);
        walk(field);
      }
    }
    if (node.items) walk(node.items);
  };
  for (const [key, node] of Object.entries(spec)) {
    names.add(key);
    walk(node);
  }
  return names;
}

// docs/config.md documents most keys as `**\`key\`**` (a bold reference
// bullet) and the CSS colour tokens as `` `--token` `` (the custom-property
// name a `colors.<theme>.<token>` value ultimately sets) — both conventions
// wrap the bare name in single backticks, so a plain `` `name` ``/`` `--name`
// `` substring search catches either.
function docMentionsKey(doc, key) {
  return doc.includes(`\`${key}\``) || doc.includes(`\`--${key}\``);
}

// Keys config-spec.mjs carries that genuinely aren't given a standalone
// `` `key` `` mention in docs/config.md — each is documented, just not in a
// form this mechanical scan can find (see the comment at each entry).
const SPEC_KEYS_NOT_MECHANICALLY_IN_DOCS = new Set([
  // Mentioned as `"$schema"` (with the quotes inside the backticks, since
  // it's illustrating a JSON key-value pair), not bare `$schema`.
  "$schema",
  // Mentioned as `"heavy": true` (the whole key:value pair inside one
  // backtick span), not bare `heavy`.
  "heavy",
  // `licenses[].version` is only covered by prose ("the rest are optional")
  // alongside `text`/`sourceUrl`/`note`, which — unlike `version` — do get
  // their own standalone mention elsewhere in the file.
  "version",
]);

// docs/config.md also uses the `**\`key\`**` bullet convention for four
// popup.mode ENUM VALUES ("shown on every visit"), not key names — same
// markdown shape, different meaning, so the scan below has to know about
// them explicitly rather than mistaking them for undocumented keys.
const DOC_BOLD_CODE_NOT_A_KEY = new Set(["always", "once", "dismissible", "picker"]);

test("every config-spec.mjs key is documented in docs/config.md, and vice versa", () => {
  const doc = readFileSync(join(ROOT, "docs", "config.md"), "utf-8");
  const specKeys = flattenSpecKeys(CONFIG_SPEC);

  const undocumented = [...specKeys].filter(
    (key) => !SPEC_KEYS_NOT_MECHANICALLY_IN_DOCS.has(key) && !docMentionsKey(doc, key)
  );
  assert.deepEqual(
    undocumented,
    [],
    "config-spec.mjs key(s) with no `key`/`--key` mention in docs/config.md " +
      "(add documentation, or — if it genuinely can't be phrased that way — " +
      "extend SPEC_KEYS_NOT_MECHANICALLY_IN_DOCS with a comment explaining why)"
  );

  const boldDocKeys = new Set(
    [...doc.matchAll(/\*\*`([^`]*)`\*\*/g)].map((m) => m[1])
  );
  const staleDocKeys = [...boldDocKeys].filter(
    (key) => !DOC_BOLD_CODE_NOT_A_KEY.has(key) && !specKeys.has(key)
  );
  assert.deepEqual(
    staleDocKeys,
    [],
    "docs/config.md bold-codes a key config-spec.mjs doesn't know about " +
      "(stale documentation, or config-spec.mjs is missing this key)"
  );
});

// src/lib/schema.ts re-types several CONFIG_SPEC enums by hand as
// string-literal arrays for validateSchema's own runtime checks against
// designs.json (which carries the resolved value, not the spec node). Each
// pair below is the same enum's data-side (CONFIG_SPEC) and app-side
// (src/lib/schema.ts) declaration; asserting they're equal is the drift guard
// a third value could otherwise slip past every other test and only fail at
// runtime in the browser.
const ENUM_CROSS_CHECKS = [
  ["popup.mode", POPUP_MODES, CONFIG_SPEC.popup.properties.mode.values],
  ["dir", TEXT_DIRECTIONS, CONFIG_SPEC.dir.values],
  ["render.format", FORMATS, CONFIG_SPEC.render.properties.format.values],
  ["ui.panelSide", PANEL_SIDES, CONFIG_SPEC.ui.properties.panelSide.values],
  ["ui.panelDefault", PANEL_DEFAULTS, CONFIG_SPEC.ui.properties.panelDefault.values],
  ["ui.outputDefault", OUTPUT_DEFAULTS, CONFIG_SPEC.ui.properties.outputDefault.values],
  ["viewer.style", VIEWER_STYLES, CONFIG_SPEC.viewer.properties.style.values],
  ["viewer.grid", VIEWER_GRID_DEFAULTS, CONFIG_SPEC.viewer.properties.grid.values],
  ["pwa.install", INSTALL_MODES, CONFIG_SPEC.pwa.properties.install.values],
];

test("src/lib/schema.ts's hand-typed enum lists match config-spec.mjs", () => {
  for (const [key, schemaTs, configSpec] of ENUM_CROSS_CHECKS) {
    assert.deepEqual(
      schemaTs,
      configSpec,
      `'${key}': src/lib/schema.ts's enum list has drifted from CONFIG_SPEC's ` +
        `(config-spec.mjs is the source of truth — update src/lib/schema.ts's ` +
        `matching const to match)`
    );
  }
});
