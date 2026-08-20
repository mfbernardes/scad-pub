// tests/svgPrepText.test.mjs — the display layer over src/lib/svgPrep's coded
// Finding/Change/SvgPrepError (src/lib/svgPrepText.ts). The engine itself is
// tested code-only (tests/svgPrep*.test.mjs); this file is the one place that
// exercises the text those codes resolve to: every code the engine can
// produce round-trips to a real (non-key) string, a hint appears only where
// the finding declares one, plural forms genuinely select, and resolution
// goes through the ACTIVE i18n binding (not a hardcoded English closure).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rebind, defaultTag, overridesForLocale } from "../src/lib/i18n.ts";
import {
  findingText,
  changeText,
  prepErrorText,
  FIND_KEY,
  FIND_KEY_PLAIN,
  HINT_KEY,
  CHANGE_KEY,
  CHANGE_KEY_PLAIN,
  GROUP_KEY,
} from "../src/lib/svgPrepText.ts";
import {
  SvgPrepError,
  FIND_CODES as ENGINE_FIND_CODES,
  CHANGE_CODES as ENGINE_CHANGE_CODES,
  GROUP_BY_COLOR_ERROR_CODES,
  GROUP_BY_COLOR_CHANGE_CODES,
} from "../src/lib/svgPrep/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, "..", "src", "locales");
const de = JSON.parse(readFileSync(join(LOCALES, "de.json"), "utf-8"));
const generatedSchema = JSON.parse(
  readFileSync(join(HERE, "..", "src", "generated", "designs.json"), "utf-8")
);

// Mirrors tests/i18n.test.mjs's own helper: restores i18n.ts's module-scope
// binding to exactly what its own init produced, so a test that rebinds away
// from it doesn't leak into a later test (in this file or a differently
// ordered run).
function restoreDefaultBinding() {
  rebind(defaultTag, null, overridesForLocale(generatedSchema.strings, defaultTag, defaultTag));
}

// The engine's codes that are ACTUALLY reachable ("already-grouped"/
// "one-colour" are swallowed by autoGroupByColor before a Change is ever
// minted — see src/lib/svgPrep/index.ts) — the set svgPrepText.ts's GROUP_KEY
// table is measured against below.
const SURFACED_GROUP_CODES = [...GROUP_BY_COLOR_ERROR_CODES].filter(
  (c) => c !== "already-grouped" && c !== "one-colour",
);

test("svgPrepText's finding tables cover exactly check.ts's FIND_CODES — no more, no less", () => {
  const covered = [...Object.keys(FIND_KEY), ...Object.keys(FIND_KEY_PLAIN)];
  assert.deepEqual(covered.sort(), [...ENGINE_FIND_CODES].sort());
  // No code appears in both the pluralised and plain tables.
  assert.deepEqual(
    Object.keys(FIND_KEY).filter((c) => c in FIND_KEY_PLAIN),
    [],
  );
});

test("svgPrepText's hint table covers every finding code except regions-available", () => {
  const withoutHint = [...ENGINE_FIND_CODES].filter((c) => !(c in HINT_KEY));
  assert.deepEqual(withoutHint, ["regions-available"]);
});

test("svgPrepText's change tables cover exactly fixes.ts's + groupByColor.ts's Change codes", () => {
  const covered = [...Object.keys(CHANGE_KEY), ...Object.keys(CHANGE_KEY_PLAIN)];
  assert.deepEqual(
    covered.sort(),
    [...ENGINE_CHANGE_CODES, ...GROUP_BY_COLOR_CHANGE_CODES].sort(),
  );
  assert.deepEqual(
    Object.keys(CHANGE_KEY).filter((c) => c in CHANGE_KEY_PLAIN),
    [],
  );
});

test("svgPrepText's group table covers exactly the codes autoGroupByColor actually surfaces", () => {
  assert.deepEqual(Object.keys(GROUP_KEY).sort(), [...SURFACED_GROUP_CODES].sort());
});

// Representative vars per code, for the "resolves to real text" round-trip
// below — not the source of truth for WHICH codes exist (the tests above,
// against the engine's own exports, are); this list is asserted to cover the
// exact same codes so a code added to the engine also gets exercised here.
const FIND_VARS = {
  "no-viewbox": {},
  "viewbox-origin": {},
  "no-geometry": {},
  "text": { count: 1 },
  "stroke-only": { count: 2 },
  "open-paths": { count: 1 },
  "covers-canvas": { count: 3 },
  "active-content": { count: 2, names: ["<script>", "<style>"] },
  "ignored": { tag: "use", count: 1 },
  "styled-fill": { count: 2 },
  "inkscape-trap": { count: 1, names: ['"walls" (id=layer1)'] },
  "regions-available": { regions: ["rooms", "walls"] },
  "too-many-regions": { count: 12, max: 8 },
  "shapes-outside-regions": { count: 1 },
  "region-is-label": { name: "walls" },
  "region-missing": { name: "roof", regions: ["rooms", "walls"] },
  "content-outside-viewbox": {},
  "undersized": {},
};
// Every finding code pairs its message with a hint except this one.
const NO_HINT_CODE = "regions-available";

const CHANGE_VARS = {
  "layer-kept": { label: "walls" },
  "layer-usable": { label: "walls" },
  "layer-renamed": { label: "Ground floor, walls", target: "Ground_floor__walls" },
  "recentred": {},
  "removed-background": { count: 1 },
  "removed-active": { count: 2 },
  "removed-external": { count: 1 },
  "removed-unsafe-attrs": { count: 2 },
  "removed-unsafe-style": { count: 1 },
  "style-fills": { count: 3 },
  "grouped-colour": { count: 2, color: "red" },
  // autoGroupByColor's surfaced errors (see src/lib/svgPrep/index.ts): coded
  // the same as any other Change, resolved through a different key family
  // ("svgPrep.group.<code>", not "svgPrep.change.<code>").
  "no-shapes": {},
  "transformed": {},
};

const PREP_ERROR_CODES = ["not-svg", "spec-separator"];

test("FIND_VARS exercises exactly the engine's FIND_CODES", () => {
  assert.deepEqual(Object.keys(FIND_VARS).sort(), [...ENGINE_FIND_CODES].sort());
});

test("CHANGE_VARS exercises exactly the engine's CHANGE_CODES plus grouped-colour plus the surfaced group codes", () => {
  assert.deepEqual(
    Object.keys(CHANGE_VARS).sort(),
    [...ENGINE_CHANGE_CODES, ...GROUP_BY_COLOR_CHANGE_CODES, ...SURFACED_GROUP_CODES].sort(),
  );
});

test("every finding code resolves to real text, with a hint iff declared", () => {
  for (const [code, vars] of Object.entries(FIND_VARS)) {
    const { message, hint } = findingText({ level: "WARN", code, vars });
    assert.equal(typeof message, "string", `${code}: message must be a string`);
    assert.ok(message.length > 0, `${code}: message must not be empty`);
    assert.ok(!message.startsWith("svgPrep."), `${code}: message must not leak a catalogue key`);
    assert.ok(!/\{[a-zA-Z]+\}/.test(message), `${code}: message must not leave a var uninterpolated`);
    if (code === NO_HINT_CODE) {
      assert.equal(hint, undefined, `${code}: must have no hint`);
    } else {
      assert.equal(typeof hint, "string", `${code}: hint must be a string`);
      assert.ok(hint.length > 0, `${code}: hint must not be empty`);
    }
  }
});

test("every change/group code resolves to real text", () => {
  for (const [code, vars] of Object.entries(CHANGE_VARS)) {
    const text = changeText({ code, vars });
    assert.equal(typeof text, "string", `${code}: must be a string`);
    assert.ok(text.length > 0, `${code}: must not be empty`);
    assert.ok(!text.startsWith("svgPrep."), `${code}: must not leak a catalogue key`);
    assert.ok(!/\{[a-zA-Z]+\}/.test(text), `${code}: must not leave a var uninterpolated`);
  }
});

test("group codes read as an aside prefixed \"Group by colour: \", distinct from a plain Change", () => {
  assert.match(changeText({ code: "no-shapes" }), /^Group by colour: /);
  assert.match(changeText({ code: "transformed" }), /^Group by colour: /);
});

test("a coded SvgPrepError resolves through its template; an uncoded one falls back to .message", () => {
  for (const code of PREP_ERROR_CODES) {
    const text = prepErrorText(new SvgPrepError(code, "raw detail", { name: "x", field: "id", value: "a,b" }));
    assert.equal(typeof text, "string");
    assert.ok(text.length > 0);
    assert.ok(!text.startsWith("svgPrep."));
  }
  // "not-xml" carries no catalogue entry on purpose: its .message is either
  // the DOMParser's own untranslatable detail, or index.ts's fixed English
  // fallback — see svgPrepText.ts's PREP_ERROR_KEY comment.
  const raw = new SvgPrepError("not-xml", "line 1: mismatched tag");
  assert.equal(prepErrorText(raw), "line 1: mismatched tag");
});

test("plural forms genuinely select: singular and plural read differently", () => {
  const one = findingText({ level: "WARN", code: "text", vars: { count: 1 } }).message;
  const other = findingText({ level: "WARN", code: "text", vars: { count: 5 } }).message;
  assert.notEqual(one, other);
  assert.match(one, /^1 /);
  assert.match(other, /^5 /);

  const changeOne = changeText({ code: "grouped-colour", vars: { count: 1, color: "red" } });
  const changeOther = changeText({ code: "grouped-colour", vars: { count: 4, color: "red" } });
  assert.notEqual(changeOne, changeOther);
});

test("list vars are joined through Intl.ListFormat before interpolation", () => {
  const { message } = findingText({
    level: "INFO",
    code: "regions-available",
    vars: { regions: ["rooms", "walls"] },
  });
  assert.match(message, /rooms.*walls/);
});

test("region-missing falls back to svgPrep.noneAvailable when no region is available — a display concern, not check.ts's", () => {
  const { message } = findingText({
    level: "ERROR",
    code: "region-missing",
    vars: { name: "roof", regions: [] },
  });
  assert.match(message, /\(none\)/);
});

// A pseudo-locale rebind (mirrors tests/i18n.test.mjs's own convention):
// proves resolution goes through the ACTIVE binding rather than a closure
// captured at import time — with the real German catalogue (already parity-
// checked against en.json by tests/i18nParity.test.mjs) so this doubles as a
// sanity check that the de.json entries this phase added are wired up, not
// just present.
test("resolution follows a locale switch (German)", () => {
  try {
    rebind("de", de, {});
    const enText = (() => {
      restoreDefaultBinding();
      return findingText({ level: "WARN", code: "no-geometry" }).message;
    })();
    rebind("de", de, {});
    const deText = findingText({ level: "WARN", code: "no-geometry" }).message;
    assert.notEqual(deText, enText, "German text must differ from the English default");
    assert.equal(deText, de["svgPrep.find.no-geometry"]);
  } finally {
    restoreDefaultBinding();
  }
});
