// Unit tests for the service-worker update decision. The hook itself is
// browser-bound, but the "is this an update or the first install?" rule is pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isWaitingUpdate, forceReload } from "../src/lib/swUpdate.ts";

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

// Node 22 ships a built-in read-only global `navigator`; plain assignment
// throws ("has only a getter"), so stub it with defineProperty instead.
function setNavigator(value) {
  Object.defineProperty(globalThis, "navigator", {
    value,
    configurable: true,
    writable: true,
  });
}

// M3: forceReload (the "force update" nuclear escape hatch) must touch only
// THIS app's own registration/scope and shell caches — never every worker or
// cache on the origin, which would also wipe an unrelated ScadPub config (or
// any other app) sharing the origin. `APP_ID` defaults to "scadpub" outside a
// Vite build (see src/lib/appId.ts), so the fixtures below use that.

test("forceReload unregisters only the given registration, never looks up others when one is provided", async () => {
  let unregistered = 0;
  let getRegistrationCalled = false;
  setNavigator({
    serviceWorker: {
      getRegistration: async () => {
        getRegistrationCalled = true;
        return undefined;
      },
    },
  });
  globalThis.caches = { keys: async () => [], delete: async () => true };
  let reloaded = false;
  globalThis.location = { reload: () => { reloaded = true; } };

  const reg = { unregister: async () => { unregistered++; return true; } };
  await forceReload(reg);

  assert.equal(unregistered, 1);
  assert.equal(getRegistrationCalled, false); // short-circuited — reg was already supplied
  assert.equal(reloaded, true);
});

test("forceReload deletes only this app's own shell caches — two ScadPub scopes plus an unrelated cache on one origin", async () => {
  const existing = new Set([
    "scadpub-shell-v1", // this app's own (default APP_ID outside a build)
    "otherapp-shell-v1", // a different ScadPub config on the same origin
    "openscad-wasm-bin-123.4.0", // the shared binary cache — never touched by force-update
    "some-unrelated-service-worker-cache-shell-thing", // an unrelated worker's cache that happens to contain "-shell-"
  ]);
  const deleted = [];
  setNavigator({ serviceWorker: {} }); // getRegistration unused (reg supplied)
  globalThis.caches = {
    keys: async () => [...existing],
    delete: async (k) => { deleted.push(k); return existing.delete(k); },
  };
  globalThis.location = { reload: () => {} };

  await forceReload({ unregister: async () => true });

  assert.deepEqual(deleted, ["scadpub-shell-v1"]);
  assert.ok(existing.has("otherapp-shell-v1"));
  assert.ok(existing.has("openscad-wasm-bin-123.4.0"));
  assert.ok(existing.has("some-unrelated-service-worker-cache-shell-thing"));
});

test("forceReload reloads regardless of failures along the way (best-effort)", async () => {
  setNavigator({ serviceWorker: {} });
  globalThis.caches = {
    keys: async () => { throw new Error("boom"); },
    delete: async () => true,
  };
  let reloaded = false;
  globalThis.location = { reload: () => { reloaded = true; } };

  await forceReload({ unregister: async () => { throw new Error("also boom"); } });
  assert.equal(reloaded, true);
});

test("service worker carries a build-stamped version so updates are detectable", () => {
  // The `sw-version` Vite plugin replaces this placeholder per build, changing
  // sw.js's bytes each deploy so the browser installs a new worker and the
  // "update available" prompt can fire. A static sw.js would never trigger it.
  const text = swText();
  assert.match(text, /__SW_VERSION__/);
  assert.match(text, /shell-\$\{VERSION\}/);
});
