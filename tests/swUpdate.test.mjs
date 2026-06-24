// Unit tests for the service-worker update decision. The hook itself is
// browser-bound, but the "is this an update or the first install?" rule is pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isWaitingUpdate } from "../src/lib/swUpdate.ts";

const swText = () =>
  readFileSync(fileURLToPath(new URL("../public/sw.js", import.meta.url)), "utf-8");

test("a freshly-installed worker is an update only when a controller exists", () => {
  // installed + an existing controller => a real update (old worker is live)
  assert.equal(isWaitingUpdate("installed", true), true);
  // installed but no controller => the very first install, not an update
  assert.equal(isWaitingUpdate("installed", false), false);
  // any other lifecycle state is never an update prompt
  assert.equal(isWaitingUpdate("installing", true), false);
  assert.equal(isWaitingUpdate("activated", true), false);
  assert.equal(isWaitingUpdate("redundant", true), false);
});

test("service worker precaches the app shell without auto-activating updates", () => {
  const text = swText();
  assert.match(text, /addEventListener\(\s*["']install["']/);
  assert.match(text, /precacheShell/);
  assert.match(text, /asset-manifest\.json/);
  assert.match(text, /precache-manifest\.json/);
  assert.doesNotMatch(text, /install[\s\S]{0,200}skipWaiting/);
});

test("service worker only excludes wasm binaries from shell caching", () => {
  const text = swText();
  assert.match(text, /pathname\.endsWith\(["']\.wasm["']\)/);
  assert.doesNotMatch(text, /pathname\.includes\(["']\/wasm\/["']\)/);
});
