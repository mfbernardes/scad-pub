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

test("service worker keeps the big binaries out of the shell cache and warms BIN_CACHE", () => {
  const text = swText();
  // The wasm + font binaries live in the render worker's own versioned cache…
  assert.match(text, /BIN_RE\s*=\s*\/\\\.\(wasm\|ttf\|otf\|ttc\)\$\/i/);
  assert.doesNotMatch(text, /pathname\.includes\(["']\/wasm\/["']\)/);
  // …which the install step warms from the precache manifest's `bin` section,
  // so offline rendering works even before the first render.
  assert.match(text, /precacheBin/);
  assert.match(text, /bin\.cache/);
});

test("service worker carries a build-stamped version so updates are detectable", () => {
  // The `sw-version` Vite plugin replaces this placeholder per build, changing
  // sw.js's bytes each deploy so the browser installs a new worker and the
  // "update available" prompt can fire. A static sw.js would never trigger it.
  const text = swText();
  assert.match(text, /__SW_VERSION__/);
  assert.match(text, /shell-\$\{VERSION\}/);
});
