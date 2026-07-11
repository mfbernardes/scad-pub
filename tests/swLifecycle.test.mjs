// Executable service-worker lifecycle tests (docs/architecture-review.md M2).
// public/sw.js is plain JS (hand-written, tracked — see CLAUDE.md), so it can
// be loaded and actually exercised, unlike the app's TypeScript sources.
// This builds a minimal ServiceWorkerGlobalScope in a vm context — real
// `caches`/`fetch` behavior faked, everything else (event dispatch, install/
// activate/fetch handling) is the genuine sw.js code — and asserts the
// transactional-install/scoped-shell-key/awaited-write behavior the review
// called for, not just source-text pattern matching (see tests/swUpdate.test.mjs
// for the lighter-weight text assertions that remain useful alongside this).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const swSource = readFileSync(
  fileURLToPath(new URL("../public/sw.js", import.meta.url)),
  "utf-8"
);

const NS = "testapp";
const SCOPE_URL = `https://example.test/${NS}/`;
const ENTRY_JS = `https://example.test/${NS}/assets/index.js`;
const ENTRY_CSS = `https://example.test/${NS}/assets/index.css`;
const OTHER_PAGE = `https://example.test/${NS}/docs/readme.md`;
const INDEX_HTML = `<!doctype html><html><head>
<link rel="stylesheet" href="/${NS}/assets/index.css">
</head><body><script type="module" src="/${NS}/assets/index.js"></script></body></html>`;

// --- Minimal fake Cache Storage -------------------------------------------
class FakeCache {
  store = new Map();
  async match(req) {
    // Clone on read: a real Cache Storage match() returns an independent
    // Response each call. Returning the same stored instance would let one
    // .text()/.clone() read exhaust the body for every later match() of the
    // same key, which real Cache Storage does not do.
    const res = this.store.get(typeof req === "string" ? req : req.url);
    return res ? res.clone() : undefined;
  }
  async put(req, res) {
    this.store.set(typeof req === "string" ? req : req.url, res);
  }
}
class FakeCacheStorage {
  caches = new Map();
  async open(name) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
    return this.caches.get(name);
  }
  async keys() {
    return [...this.caches.keys()];
  }
  async delete(name) {
    return this.caches.delete(name);
  }
}

// --- Minimal fake fetch, keyed by exact URL -------------------------------
// route(url) -> { status, body } | { fail: true }. Unregistered URLs 404.
function makeFetch(routes) {
  return async (req) => {
    const url = typeof req === "string" ? req : req.url;
    const route = routes.get(url);
    if (!route) return new Response("not found", { status: 404 });
    if (route.fail) throw new TypeError("network error");
    return new Response(route.body ?? "", { status: route.status ?? 200 });
  };
}

// --- Load sw.js into a vm context with the fakes wired in -----------------
function loadSw({ routes, existingCaches } = {}) {
  const fakeCaches = new FakeCacheStorage();
  for (const [name, cache] of Object.entries(existingCaches ?? {})) {
    fakeCaches.caches.set(name, cache);
  }
  const listeners = {};
  const sandbox = {
    URL,
    URLSearchParams,
    Request,
    Response,
    Promise,
    JSON,
    console,
    Set,
    Map,
    Error,
    TypeError,
    caches: fakeCaches,
    fetch: makeFetch(routes ?? new Map()),
  };
  sandbox.self = {
    location: new URL(`${SCOPE_URL}sw.js?ns=${NS}`),
    registration: { scope: SCOPE_URL },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
  };
  vm.createContext(sandbox);
  new vm.Script(swSource, { filename: "sw.js" }).runInContext(sandbox);
  return { listeners, fakeCaches, sandbox };
}

function makeEvent(request) {
  const waits = [];
  let responded;
  return {
    request,
    waitUntil(p) {
      waits.push(Promise.resolve(p));
    },
    respondWith(p) {
      responded = Promise.resolve(p);
    },
    _waits: waits,
    async settle() {
      const [response] = await Promise.all([
        responded,
        Promise.allSettled(waits),
      ]);
      return response;
    },
  };
}

async function fireInstall(listeners) {
  const waits = [];
  const event = { waitUntil: (p) => waits.push(p) };
  listeners.install(event);
  // Propagate a rejection the way the real browser would treat it: install
  // fails if the waitUntil promise rejects.
  await Promise.all(waits);
}

async function fireActivate(listeners) {
  const waits = [];
  listeners.activate({ waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
}

const goodRoutes = () =>
  new Map([
    [SCOPE_URL, { body: INDEX_HTML }],
    [ENTRY_JS, { body: "console.log(1)" }],
    [ENTRY_CSS, { body: "body{}" }],
    // Supplementary/best-effort manifests: absent here, tolerated (404).
  ]);

test("install rejects when an essential shell asset (referenced by index.html) fails to fetch", async () => {
  const routes = goodRoutes();
  routes.set(ENTRY_JS, { fail: true }); // the app's own JS bundle can't be fetched
  const { listeners } = loadSw({ routes });
  await assert.rejects(() => fireInstall(listeners));
});

test("install rejects when the entry document itself can't be fetched", async () => {
  const routes = goodRoutes();
  routes.set(SCOPE_URL, { fail: true });
  const { listeners } = loadSw({ routes });
  await assert.rejects(() => fireInstall(listeners));
});

test("install rejects on a non-ok entry document response (not just a network error)", async () => {
  const routes = goodRoutes();
  routes.set(SCOPE_URL, { status: 500, body: "oops" });
  const { listeners } = loadSw({ routes });
  await assert.rejects(() => fireInstall(listeners));
});

test("install succeeds and caches the shell when all essential assets are available", async () => {
  const routes = goodRoutes();
  const { listeners, fakeCaches } = loadSw({ routes });
  await fireInstall(listeners);

  const cache = await fakeCaches.open(`${NS}-shell-__SW_VERSION__`);
  assert.ok(await cache.match("app-shell"), "SHELL_KEY was populated");
  assert.ok(await cache.match(ENTRY_JS), "essential JS asset was cached");
  assert.ok(await cache.match(ENTRY_CSS), "essential CSS asset was cached");
});

test("a failing best-effort supplementary asset does not block install", async () => {
  const routes = goodRoutes();
  routes.set(new URL("asset-manifest.json", SCOPE_URL).href, { fail: true });
  routes.set(new URL("precache-manifest.json", SCOPE_URL).href, { fail: true });
  const { listeners, fakeCaches } = loadSw({ routes });
  await fireInstall(listeners); // must not reject

  const cache = await fakeCaches.open(`${NS}-shell-__SW_VERSION__`);
  assert.ok(await cache.match("app-shell"));
});

test("activate retains the old cache until the new shell validates, then deletes it", async () => {
  // Case 1: CACHE has no validated shell yet (e.g. evicted between install and
  // activate) — the old cache must survive activation.
  const oldCache = new FakeCache();
  oldCache.store.set("app-shell", new Response("old shell"));
  {
    const { listeners, fakeCaches } = loadSw({
      existingCaches: { [`${NS}-shell-old`]: oldCache },
    });
    await fireActivate(listeners);
    assert.ok(fakeCaches.caches.has(`${NS}-shell-old`), "old cache retained — new shell never validated");
  }

  // Case 2: CACHE already holds a validated shell (the normal post-install
  // path) — now the old cache is safe to retire.
  {
    const newCache = new FakeCache();
    newCache.store.set("app-shell", new Response("new shell"));
    const { listeners, fakeCaches } = loadSw({
      existingCaches: {
        [`${NS}-shell-old`]: oldCache,
        [`${NS}-shell-__SW_VERSION__`]: newCache,
      },
    });
    await fireActivate(listeners);
    assert.ok(!fakeCaches.caches.has(`${NS}-shell-old`), "old cache retired once the replacement validated");
    assert.ok(fakeCaches.caches.has(`${NS}-shell-__SW_VERSION__`));
  }
});

test("SHELL_KEY is refreshed only by a navigation to the canonical app entry, never an arbitrary in-scope page", async () => {
  const routes = goodRoutes();
  routes.set(OTHER_PAGE, { body: "<html>some markdown page</html>" });
  const { listeners, fakeCaches } = loadSw({ routes });
  await fireInstall(listeners);

  const cache = await fakeCaches.open(`${NS}-shell-__SW_VERSION__`);
  const originalShell = await (await cache.match("app-shell")).text();

  // A direct navigation to an unrelated in-scope page must not overwrite the
  // offline app fallback.
  const req = new Request(OTHER_PAGE);
  Object.defineProperty(req, "mode", { value: "navigate" });
  const event = makeEvent(req);
  listeners.fetch(event);
  const res = await event.settle();
  assert.equal(await res.text(), "<html>some markdown page</html>");

  const shellAfter = await (await cache.match("app-shell")).text();
  assert.equal(shellAfter, originalShell, "SHELL_KEY unchanged by the non-entry navigation");

  // A navigation to the canonical entry, with different bytes than install
  // time, DOES refresh SHELL_KEY.
  routes.set(SCOPE_URL, { body: "<html>updated shell</html>" });
  const entryReq = new Request(SCOPE_URL);
  Object.defineProperty(entryReq, "mode", { value: "navigate" });
  const entryEvent = makeEvent(entryReq);
  listeners.fetch(entryEvent);
  await entryEvent.settle();

  const shellAfterEntry = await (await cache.match("app-shell")).text();
  assert.equal(shellAfterEntry, "<html>updated shell</html>");
});

test("navigation and volatile-source runtime cache writes are awaited within the fetch event's lifetime", async () => {
  const routes = goodRoutes();
  const { listeners, fakeCaches } = loadSw({ routes });
  await fireInstall(listeners);
  const cache = await fakeCaches.open(`${NS}-shell-__SW_VERSION__`);

  // Navigate to the entry: respondWith resolves as soon as the network
  // response is available, but the cache.put is only reachable via
  // event.waitUntil — settle() (which awaits both) must observe the write.
  const navReq = new Request(SCOPE_URL);
  Object.defineProperty(navReq, "mode", { value: "navigate" });
  const navEvent = makeEvent(navReq);
  listeners.fetch(navEvent);
  await navEvent.settle();
  assert.ok(navEvent._waits.length > 0, "the SHELL_KEY write was registered via event.waitUntil");
  assert.ok(await cache.match("app-shell"));

  // A build-volatile source (under /scad/) is network-first with the write
  // likewise tied to waitUntil.
  const scadUrl = `${SCOPE_URL}scad/plate.scad`;
  routes.set(scadUrl, { body: "cube(1);" });
  const scadReq = new Request(scadUrl);
  const scadEvent = makeEvent(scadReq);
  listeners.fetch(scadEvent);
  const scadRes = await scadEvent.settle();
  assert.equal(await scadRes.text(), "cube(1);");
  assert.ok(scadEvent._waits.length > 0, "the volatile-source write was registered via event.waitUntil");
  assert.ok(await cache.match(scadReq));
});
