// Tests the parser that turns OpenSCAD's `echo("@review", param, value)`
// convention into a param-name -> rendered-value override map for a curated
// review summary (see src/lib/reviewSummary.ts). The shared log-line parsing
// (quote stripping, [out]/[err] matching, non-matching lines, embedded
// commas) is covered one layer down in tests/echoTags.test.mjs; what follows
// only exercises what this wrapper adds on top.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReviewOverrides } from "../src/lib/reviewOverrides.ts";

test("extracts a basic override, keyed by param name", () => {
  const out = parseReviewOverrides(['[out] ECHO: "@review", "label", "GATE 12"']);
  assert.deepEqual(out, new Map([["label", "GATE 12"]]));
});

test("multiple params each get their own entry", () => {
  const out = parseReviewOverrides([
    '[out] ECHO: "@review", "label", "GATE 12"',
    '[out] ECHO: "@review", "font", "Liberation Sans"',
  ]);
  assert.deepEqual(
    out,
    new Map([
      ["label", "GATE 12"],
      ["font", "Liberation Sans"],
    ])
  );
});

test("a later echo for the same param overwrites an earlier one (last write wins)", () => {
  const out = parseReviewOverrides([
    '[out] ECHO: "@review", "label", "gate 12"',
    '[out] ECHO: "@review", "label", "GATE 12"',
  ]);
  assert.deepEqual(out, new Map([["label", "GATE 12"]]));
});
