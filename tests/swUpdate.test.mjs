// Unit tests for the service-worker update decision. The hook itself is
// browser-bound, but the "is this an update or the first install?" rule is pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isWaitingUpdate, forceReload, warmDelayMs, warmTargets } from "../src/lib/swUpdate.ts";

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
  assert.match(text, /precacheEssential/);
  assert.match(text, /asset-manifest\.json/);
  assert.match(text, /precache-manifest\.json/);
  assert.doesNotMatch(text, /install[\s\S]{0,200}skipWaiting/);
});

test("service worker keeps the big binaries out of the shell cache and warms BIN_CACHE", () => {
  const text = swText();
  // The wasm + font binaries live in the render worker's own versioned cache…
  assert.match(text, /BIN_RE\s*=\s*\/\\\.\(wasm\|ttf\|otf\|ttc\)\$\/i/);
  assert.doesNotMatch(text, /pathname\.includes\(["']\/wasm\/["']\)/);
  // …which the WARM message warms from the precache manifest's `bin` section,
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
// THIS app's own registration/scope and shell caches, never every worker or
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
  assert.equal(getRegistrationCalled, false); // short-circuited: reg was already supplied
  assert.equal(reloaded, true);
});

test("forceReload deletes only this app's own shell caches — two ScadPub scopes plus an unrelated cache on one origin", async () => {
  const existing = new Set([
    "scadpub-shell-v1", // this app's own (default APP_ID outside a build)
    "otherapp-shell-v1", // a different ScadPub config on the same origin
    "openscad-wasm-bin-123.4.0", // the shared binary cache, never touched by force-update
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

// --- Offline warm-up policy (src/lib/swUpdate.ts's warmDelayMs) ------------
// The bundle is ~11 MB, so it may only download when nothing is competing for
// the connection. Pure policy, tested without a browser.
test("warmDelayMs waits for an uncontended moment, and an installed app never waits", () => {
  const base = { holdBoot: false, ready: false, committed: false, hidden: false };
  // Nothing has happened yet: a visitor still reading the first screen.
  assert.equal(warmDelayMs(base), null);
  // The render worker's own bootstrap landed: the heavy download the app
  // actually needed is done, so follow it after a short settle.
  assert.equal(warmDelayMs({ ...base, ready: true }), 2000);
  // Installed, or launched as the installed app: offline completeness is the
  // point, and it must not depend on the user having rendered anything.
  assert.equal(warmDelayMs({ ...base, committed: true }), 0);
  // Looked away: free bandwidth.
  assert.equal(warmDelayMs({ ...base, hidden: true }), 0);
  // The design chooser holds back the `ready` trigger: its thumbnails own the
  // connection while someone is choosing.
  assert.equal(warmDelayMs({ ...base, holdBoot: true, ready: true }), null);
  // …but it must not veto the other two. Someone who installs from the chooser
  // and never picks would otherwise never warm, on this launch or any later
  // one (the chooser they never dismissed returns every time), leaving an
  // installed app permanently unable to render offline.
  assert.equal(warmDelayMs({ ...base, holdBoot: true, committed: true }), 0);
  assert.equal(warmDelayMs({ ...base, holdBoot: true, hidden: true }), 0);
});

test("a WARM reaches the waiting worker too, so an update never activates cold", () => {
  const active = { id: "active" };
  const waiting = { id: "waiting" };

  // First install: one worker, nothing waiting.
  assert.deepEqual(warmTargets({ active, waiting: null }, active), [active]);

  // An update has installed behind the active one. Each build's shell cache is
  // named after its own version and an update's install fills only the boot
  // shell, so the waiting worker owns an almost-empty cache. The browser
  // activates it as soon as the last tab closes, and `activate` retires the old
  // cache: leaving an installed app unable to render offline unless the
  // waiting worker was filled first.
  assert.deepEqual(warmTargets({ active, waiting }, active), [waiting, active]);

  // Before this page is controlled (first-ever load), the controller is the
  // only handle there is.
  assert.deepEqual(warmTargets(undefined, active), [active]);
  assert.deepEqual(warmTargets({ active: null, waiting: null }, active), [active]);
  // Nothing to talk to at all.
  assert.deepEqual(warmTargets(undefined, null), []);
  // active and controller are normally the same object: message it once.
  assert.deepEqual(warmTargets({ active, waiting: null }, active).length, 1);
});
