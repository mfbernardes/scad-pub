// Executable service-worker lifecycle tests (docs/architecture-review.md M2).
// public/sw.js is plain JS (hand-written, tracked, see CLAUDE.md), so it can
// be loaded and actually exercised, unlike the app's TypeScript sources.
// This builds a minimal ServiceWorkerGlobalScope in a vm context: real
// `caches`/`fetch` behavior faked, everything else (event dispatch, install/
// activate/fetch handling) is the genuine sw.js code, and asserts the
// transactional-install/scoped-shell-key/awaited-write behavior the review
// called for, not only source-text pattern matching (see tests/swUpdate.test.mjs
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
// The preload hints vite.config.ts's preloadLinks injects into the built HTML,
// carrying its `data-warm` marker. They belong in the fixture: without them the
// suite structurally could not tell install's attribute-aware classification
// from a plain extension test.
const WORKER_JS = `https://example.test/${NS}/assets/worker-abc.js`;
const VIEWER_JS = `https://example.test/${NS}/assets/Viewer-abc.js`;
// Vite's OWN modulepreload for a chunk the entry statically imports (its React
// runtime, its shared vendor chunk). Same `rel` as the Viewer hint above and the
// opposite classification, which is the whole reason the marker exists: the
// entry cannot execute without this one, so install must fetch it.
const VENDOR_JS = `https://example.test/${NS}/assets/vendor-abc.js`;
const INDEX_HTML = `<!doctype html><html><head>
<link rel="stylesheet" href="/${NS}/assets/index.css">
<link rel="modulepreload" crossorigin href="/${NS}/assets/vendor-abc.js">
<link rel="preload" as="worker" data-warm href="/${NS}/assets/worker-abc.js" />
<link rel="modulepreload" data-warm href="/${NS}/assets/Viewer-abc.js" />
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
function makeFetch(routes, calls = []) {
  return async (req) => {
    const url = typeof req === "string" ? req : req.url;
    calls.push(url);
    const route = routes.get(url);
    if (!route) return new Response("not found", { status: 404 });
    if (route.fail) throw new TypeError("network error");
    return new Response(route.body ?? "", { status: route.status ?? 200 });
  };
}

// --- Load sw.js into a vm context with the fakes wired in -----------------
function loadSw(opts = {}) {
  return loadSwAt(SCOPE_URL, opts);
}

// `scope` is a parameter so a test can exercise a subpath deployment whose own
// scope segment collides with a path the worker treats specially.
function loadSwAt(scope, { routes, existingCaches } = {}) {
  const fakeCaches = new FakeCacheStorage();
  // Every URL sw.js fetched, in order: lets a test assert what install did
  // NOT pull down, and that a repeated WARM doesn't refetch.
  const calls = [];
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
    fetch: makeFetch(routes ?? new Map(), calls),
    // precacheBin serializes binary downloads through Web Locks when the
    // platform has them; without `locks` it takes the unlocked path, which is
    // what we want under a single-threaded fake.
    navigator: {},
  };
  sandbox.self = {
    location: new URL(`${scope}sw.js?ns=${NS}`),
    registration: { scope },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
  };
  vm.createContext(sandbox);
  new vm.Script(swSource, { filename: "sw.js" }).runInContext(sandbox);
  return { listeners, fakeCaches, sandbox, calls };
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

async function fireMessage(listeners, data) {
  const waits = [];
  listeners.message({ data, waitUntil: (p) => waits.push(p) });
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
    [VENDOR_JS, { body: "export {}" }],
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
  assert.ok(
    await cache.match(VENDOR_JS),
    "the entry's own modulepreloaded chunk was cached — the app cannot boot without it"
  );
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

test("a failing PWA icon/splash/manifest linked from index.html does not block install", async () => {
  // The entry links boot-critical JS/CSS AND PWA metadata/artwork (manifest,
  // icons, an Apple splash image). Only the former is install-fatal: here the
  // manifest errors, the apple-touch-icon 404s, and the splash is absent, yet
  // install must still succeed because the app boots fine without them.
  const RICH_HTML = `<!doctype html><html><head>
<link rel="stylesheet" href="/${NS}/assets/index.css">
<link rel="manifest" href="/${NS}/manifest.webmanifest">
<link rel="icon" href="/${NS}/icon.svg">
<link rel="apple-touch-icon" href="/${NS}/icon-180.png">
<link rel="apple-touch-startup-image" href="/${NS}/apple-splash-1170x2532.png">
</head><body><script type="module" src="/${NS}/assets/index.js"></script></body></html>`;
  const routes = new Map([
    [SCOPE_URL, { body: RICH_HTML }],
    [ENTRY_JS, { body: "console.log(1)" }],
    [ENTRY_CSS, { body: "body{}" }],
    [new URL("manifest.webmanifest", SCOPE_URL).href, { fail: true }],
    [new URL("icon.svg", SCOPE_URL).href, { body: "<svg/>" }],
    [new URL("icon-180.png", SCOPE_URL).href, { status: 404 }],
    // apple-splash-1170x2532.png intentionally unregistered -> 404
  ]);
  const { listeners, fakeCaches } = loadSw({ routes });
  await fireInstall(listeners); // must NOT reject despite the failing metadata/artwork

  const cache = await fakeCaches.open(`${NS}-shell-__SW_VERSION__`);
  assert.ok(await cache.match(ENTRY_JS), "boot-critical JS still cached");
  assert.ok(await cache.match(ENTRY_CSS), "boot-critical CSS still cached");
});

test("install still rejects when boot-critical JS fails even if PWA metadata is present", async () => {
  const RICH_HTML = `<!doctype html><html><head>
<link rel="stylesheet" href="/${NS}/assets/index.css">
<link rel="manifest" href="/${NS}/manifest.webmanifest">
</head><body><script type="module" src="/${NS}/assets/index.js"></script></body></html>`;
  const routes = new Map([
    [SCOPE_URL, { body: RICH_HTML }],
    [ENTRY_JS, { fail: true }], // boot-critical -> install must fail
    [ENTRY_CSS, { body: "body{}" }],
    [new URL("manifest.webmanifest", SCOPE_URL).href, { body: "{}" }],
  ]);
  const { listeners } = loadSw({ routes });
  await assert.rejects(() => fireInstall(listeners));
});

test("activate retains the old cache until the new shell validates, then deletes it", async () => {
  // Case 1: CACHE has no validated shell yet (e.g. evicted between install and
  // activate). The old cache must survive activation.
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
  // path). Now the old cache is safe to retire.
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
  // event.waitUntil. Settle() (which awaits both) must observe the write.
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

// --- P1: install stays lean; the heavy warm-up waits for the page ---------
// A first visit's own content (the design gallery's thumbnails above all) was
// queueing behind the whole offline bundle, because install fires exactly when
// the app is fetching what the user is looking at. Install now caches only the
// boot-critical shell; everything else waits for the page's WARM message.

const LAZY_JS = `https://example.test/${NS}/assets/lazy.js`;
const SCAD_SRC = `https://example.test/${NS}/scad/plate.scad`;
const WASM_URL = `https://example.test/${NS}/wasm/openscad.wasm?v=abc`;
const BIN_CACHE = "openscad-wasm-bin-test";

const warmRoutes = () => {
  const routes = goodRoutes();
  routes.set(new URL("asset-manifest.json", SCOPE_URL).href, {
    body: JSON.stringify({ "index.html": { file: "assets/lazy.js" } }),
  });
  routes.set(new URL("precache-manifest.json", SCOPE_URL).href, {
    body: JSON.stringify({
      version: 2,
      shell: ["scad/plate.scad"],
      bin: { cache: BIN_CACHE, urls: ["wasm/openscad.wasm?v=abc"] },
    }),
  });
  routes.set(LAZY_JS, { body: "export {}" });
  routes.set(SCAD_SRC, { body: "cube(1);" });
  routes.set(WASM_URL, { body: "\0asm" });
  routes.set(WORKER_JS, { body: "self.onmessage=()=>{}" });
  routes.set(VIEWER_JS, { body: "export {}" });
  return routes;
};

test("install fetches only the boot-critical shell — no lazy chunks, sources or binaries", async () => {
  const { listeners, fakeCaches, calls } = loadSw({ routes: warmRoutes() });
  await fireInstall(listeners);

  assert.deepEqual([...calls].sort(), [SCOPE_URL, ENTRY_CSS, ENTRY_JS, VENDOR_JS].sort());
  assert.ok(!fakeCaches.caches.has(BIN_CACHE), "the ~10 MB binary cache was not opened at install");
});

test("two links with the same rel split on the marker, not on the tag", async () => {
  // VENDOR_JS and VIEWER_JS are both <link rel="modulepreload">. The entry
  // statically imports the first and cannot execute without it; the second is
  // preloadLinks' hint for a chunk loaded later. Classifying by `rel` puts them
  // on the same side whichever side that is, and one of the two answers ships
  // an install shell that cannot boot offline.
  const { listeners, fakeCaches, calls } = loadSw({ routes: warmRoutes() });
  await fireInstall(listeners);
  assert.ok(calls.includes(VENDOR_JS), "the entry's own import was fetched at install");
  assert.ok(!calls.includes(VIEWER_JS), "the marked hint was not");

  const cache = await fakeCaches.open(`${NS}-shell-__SW_VERSION__`);
  assert.ok(await cache.match(VENDOR_JS), "and it is in the offline shell");
});

test("install rejects when a chunk the entry statically imports fails to fetch", async () => {
  // The install brake's whole promise: a shell that is cached is a shell that
  // boots. A modulepreloaded entry import missing from it is as fatal as the
  // entry itself missing, so install must not report success without it.
  const routes = warmRoutes();
  routes.set(VENDOR_JS, { fail: true });
  const { listeners } = loadSw({ routes });
  await assert.rejects(() => fireInstall(listeners));
});

test("preload-hinted chunks are warmed, not installed", async () => {
  // preloadLinks injects <link rel="preload" as="worker"> and
  // <link rel="modulepreload"> for the render worker and the lazy Viewer.
  // Both are .js: an extension-based classifier calls them boot-critical and
  // install re-downloads them (with cache: "reload", so past the HTTP cache
  // the page just filled) while the first screen still needs the network.
  const { listeners, fakeCaches, calls } = loadSw({ routes: warmRoutes() });
  await fireInstall(listeners);
  assert.ok(!calls.includes(WORKER_JS), "the worker chunk was not fetched at install");
  assert.ok(!calls.includes(VIEWER_JS), "the Viewer chunk was not fetched at install");

  await fireMessage(listeners, { type: "WARM" });
  const cache = await fakeCaches.open(`${NS}-shell-__SW_VERSION__`);
  assert.ok(await cache.match(WORKER_JS), "the worker chunk was warmed");
  assert.ok(await cache.match(VIEWER_JS), "the Viewer chunk was warmed");
});

test("a failing preload-hinted chunk does not block install", async () => {
  const routes = warmRoutes();
  routes.set(WORKER_JS, { fail: true });
  routes.set(VIEWER_JS, { fail: true });
  const { listeners } = loadSw({ routes });
  await fireInstall(listeners); // must not reject
});

test("a WARM message pulls down the rest of the offline bundle, once", async () => {
  const { listeners, fakeCaches, calls } = loadSw({ routes: warmRoutes() });
  await fireInstall(listeners);
  calls.length = 0;

  await fireMessage(listeners, { type: "WARM" });
  const cache = await fakeCaches.open(`${NS}-shell-__SW_VERSION__`);
  assert.ok(await cache.match(LAZY_JS), "lazy build chunk cached");
  assert.ok(await cache.match(SCAD_SRC), "design source cached");
  const bin = await fakeCaches.open(BIN_CACHE);
  assert.ok(await bin.match(WASM_URL), "the pinned binary was warmed into BIN_CACHE");

  // The light assets land before the ~11 MB binaries, so a warm-up cut short
  // leaves an app that boots and switches designs offline rather than an
  // arbitrary subset of both.
  assert.ok(
    calls.indexOf(WASM_URL) > calls.indexOf(SCAD_SRC),
    "the pinned binary was fetched after the design source"
  );

  // Several tabs (or one that re-sends on a later screen) must not re-download
  // any of it. A repeat pass does re-read the two small manifests, since that is
  // how it works out what is still missing, but nothing it already holds.
  calls.length = 0;
  await fireMessage(listeners, { type: "WARM" });
  assert.deepEqual(
    calls.filter((u) => !u.endsWith("-manifest.json")),
    [],
    "a repeated WARM refetched no assets"
  );
});

test("WARM covers the entry's linked artwork, even at a worker that never ran install", async () => {
  // The artwork list is re-derived from the cached shell rather than carried
  // over from install in memory, so a worker revived after termination (or a
  // second tab's WARM) covers it the same way.
  const routes = warmRoutes();
  const ICON = `https://example.test/${NS}/icon.svg`;
  routes.set(SCOPE_URL, {
    body: INDEX_HTML.replace("</head>", `<link rel="icon" href="/${NS}/icon.svg"></head>`),
  });
  routes.set(ICON, { body: "<svg/>" });

  const first = loadSw({ routes });
  await fireInstall(first.listeners);
  const shellCache = first.fakeCaches.caches.get(`${NS}-shell-__SW_VERSION__`);

  // A fresh worker instance over the same Cache Storage: it has no
  // `pendingHtmlExtra`, exactly like one revived after termination.
  const revived = loadSw({ routes, existingCaches: { [`${NS}-shell-__SW_VERSION__`]: shellCache } });
  await fireMessage(revived.listeners, { type: "WARM" });
  assert.ok(await shellCache.match(ICON), "artwork linked from the cached shell was warmed");
});

test("everything under scad/ is served network-first, whatever it is called", async () => {
  // That tree mirrors the operator's source layout at its own relative paths, so
  // no name in it can be assumed to be ours: a stale `.scad` would be mounted
  // under the new build's renderHash and poison the persisted geometry, and a
  // `.png` there can be a surface() heightmap.
  const routes = goodRoutes();
  const { listeners } = loadSw({ routes });
  await fireInstall(listeners);

  for (const path of ["scad/widget.scad", "scad/nested/dep.scad", "scad/height.png"]) {
    const url = `${SCOPE_URL}${path}`;
    routes.set(url, { body: "v1" });
    const first = makeEvent(new Request(url));
    listeners.fetch(first);
    await first.settle();
    routes.set(url, { body: "v2" });
    const second = makeEvent(new Request(url));
    listeners.fetch(second);
    assert.equal(await (await second.settle()).text(), "v2", `${path} bypasses the cache`);
  }
});

test("a partial warm-up is retried by the next trigger, not memoized as success", async () => {
  // Every helper in the warm pass swallows its own per-asset failure, so an
  // interrupted pass resolves looking exactly like a complete one. Remembering
  // that forever would leave an installed app that boots offline and cannot
  // render, with no way back.
  const routes = warmRoutes();
  routes.set(SCAD_SRC, { fail: true }); // a flaky response mid-pass
  const { listeners, fakeCaches, calls } = loadSw({ routes });
  await fireInstall(listeners);
  const cache = await fakeCaches.open(`${NS}-shell-__SW_VERSION__`);

  await fireMessage(listeners, { type: "WARM" });
  assert.ok(await cache.match(LAZY_JS), "what could be fetched was cached");
  assert.ok(!(await cache.match(SCAD_SRC)), "the failing asset is missing");

  // The network recovers and something triggers a warm again (a later `ready`,
  // the tab going hidden, another tab).
  routes.set(SCAD_SRC, { body: "cube(1);" });
  calls.length = 0;
  await fireMessage(listeners, { type: "WARM" });
  assert.ok(await cache.match(SCAD_SRC), "the retry filled the gap");
  // …without re-downloading what the first pass already got.
  assert.ok(!calls.includes(LAZY_JS), "already-cached assets are not refetched");
});

// --- P1: service-worker fixes (SWR write lifetime, scope collision, pruning) --

test("the stale-while-revalidate write is tied to the event, not fired alongside it", async () => {
  // waitUntil received only the fetch promise, so a worker killed between the
  // response arriving and cache.put() landing lost the revalidation silently.
  //
  // Driven, not pattern-matched: `waitUntil` is called either way, so the
  // assertion has to be that awaiting WHAT IT RECEIVED is enough for the write
  // to have landed. Slowing put() past the fetch is what makes the two
  // distinguishable — an unchained put resolves after the event has settled,
  // which is exactly the window a terminated worker falls into.
  const routes = goodRoutes();
  const { listeners, fakeCaches } = loadSw({ routes });
  await fireInstall(listeners);
  const cache = await fakeCaches.open(`${NS}-shell-__SW_VERSION__`);
  const realPut = cache.put.bind(cache);
  cache.put = (req, res) => new Promise((r) => setTimeout(() => r(realPut(req, res)), 10));

  routes.set(ENTRY_JS, { body: "v2" });
  const waits = [];
  let responded;
  listeners.fetch({
    request: new Request(ENTRY_JS),
    waitUntil: (p) => waits.push(p),
    respondWith: (p) => {
      responded = p;
    },
  });
  assert.equal(
    await (await responded).text(),
    "console.log(1)",
    "the stale copy is served immediately"
  );
  await Promise.allSettled(waits);
  assert.equal(
    await (await cache.match(ENTRY_JS)).text(),
    "v2",
    "and awaiting only what waitUntil received is enough for the revalidation to have landed"
  );
});

test("a deployment scoped at /scad/ does not make every asset network-first", async () => {
  // isVolatileSource matched the segment `scad` anywhere in the pathname, so a
  // BASE_PATH=/scad/ build treated its own hashed JS/CSS as build-volatile
  // sources — every asset network-first, no offline app at all.
  const SCOPED = "https://example.test/scad/";
  const scopedHtml = `<!doctype html><html><head>
<link rel="stylesheet" href="/scad/assets/index.css">
</head><body><script type="module" src="/scad/assets/index.js"></script></body></html>`;
  const JS = "https://example.test/scad/assets/index.js";
  const CSS = "https://example.test/scad/assets/index.css";
  const routes = new Map([
    [SCOPED, { body: scopedHtml }],
    [JS, { body: "v1" }],
    [CSS, { body: "body{}" }],
  ]);
  const { listeners, calls } = loadSwAt(SCOPED, { routes });
  await fireInstall(listeners);

  // Second fetch of the hashed bundle must be served from the cache (SWR), not
  // treated as a volatile source that always goes to the network first.
  const first = makeEvent(new Request(JS));
  listeners.fetch(first);
  assert.equal(await (await first.settle()).text(), "v1");
  routes.set(JS, { body: "v2" });
  calls.length = 0;
  const second = makeEvent(new Request(JS));
  listeners.fetch(second);
  assert.equal(await (await second.settle()).text(), "v1", "served from cache, not network-first");

  // The design sources under the scope still ARE volatile.
  const SRC = "https://example.test/scad/scad/plate.scad";
  routes.set(SRC, { body: "a" });
  const s1 = makeEvent(new Request(SRC));
  listeners.fetch(s1);
  await s1.settle();
  routes.set(SRC, { body: "b" });
  const s2 = makeEvent(new Request(SRC));
  listeners.fetch(s2);
  assert.equal(await (await s2.settle()).text(), "b", "sources stay network-first");
});

test("precache-manifest.json outside the scope is not treated as volatile", async () => {
  // The suffix check ran before the scope guard, so an out-of-scope path
  // ending in precache-manifest.json was classified volatile regardless of
  // scope. Assert the in-scope manifest stays volatile (network-first)
  // while an out-of-scope one served under the same origin is cached
  // (SWR), for both an unscoped deployment and one at BASE_PATH=/scad/.
  const routes = goodRoutes();
  const IN_SCOPE = `${SCOPE_URL}precache-manifest.json`;
  const OUT_OF_SCOPE = "https://example.test/other/precache-manifest.json";
  routes.set(IN_SCOPE, { body: "v1" });
  routes.set(OUT_OF_SCOPE, { body: "v1" });
  const { listeners } = loadSw({ routes });
  await fireInstall(listeners);

  const inFirst = makeEvent(new Request(IN_SCOPE));
  listeners.fetch(inFirst);
  assert.equal(await (await inFirst.settle()).text(), "v1");
  routes.set(IN_SCOPE, { body: "v2" });
  const inSecond = makeEvent(new Request(IN_SCOPE));
  listeners.fetch(inSecond);
  assert.equal(
    await (await inSecond.settle()).text(),
    "v2",
    "in-scope precache-manifest.json stays network-first"
  );

  const outFirst = makeEvent(new Request(OUT_OF_SCOPE));
  listeners.fetch(outFirst);
  assert.equal(await (await outFirst.settle()).text(), "v1");
  routes.set(OUT_OF_SCOPE, { body: "v2" });
  const outSecond = makeEvent(new Request(OUT_OF_SCOPE));
  listeners.fetch(outSecond);
  assert.equal(
    await (await outSecond.settle()).text(),
    "v1",
    "out-of-scope precache-manifest.json is served from cache, not network-first"
  );
});

test("BASE_PATH=/scad/: precache-manifest.json volatility is scope-relative", async () => {
  const SCOPED = "https://example.test/scad/";
  const scopedHtml = `<!doctype html><html><head></head><body></body></html>`;
  const IN_SCOPE = "https://example.test/scad/precache-manifest.json";
  const OUT_OF_SCOPE = "https://example.test/other/precache-manifest.json";
  const routes = new Map([
    [SCOPED, { body: scopedHtml }],
    [IN_SCOPE, { body: "v1" }],
    [OUT_OF_SCOPE, { body: "v1" }],
  ]);
  const { listeners } = loadSwAt(SCOPED, { routes });
  await fireInstall(listeners);

  const inFirst = makeEvent(new Request(IN_SCOPE));
  listeners.fetch(inFirst);
  assert.equal(await (await inFirst.settle()).text(), "v1");
  routes.set(IN_SCOPE, { body: "v2" });
  const inSecond = makeEvent(new Request(IN_SCOPE));
  listeners.fetch(inSecond);
  assert.equal(
    await (await inSecond.settle()).text(),
    "v2",
    "in-scope precache-manifest.json stays network-first under BASE_PATH=/scad/"
  );

  const outFirst = makeEvent(new Request(OUT_OF_SCOPE));
  listeners.fetch(outFirst);
  assert.equal(await (await outFirst.settle()).text(), "v1");
  routes.set(OUT_OF_SCOPE, { body: "v2" });
  const outSecond = makeEvent(new Request(OUT_OF_SCOPE));
  listeners.fetch(outSecond);
  assert.equal(
    await (await outSecond.settle()).text(),
    "v1",
    "out-of-scope precache-manifest.json is served from cache, not network-first"
  );
});

test("a navigation to <scope>index.html refreshes the offline shell", async () => {
  const routes = goodRoutes();
  const { listeners, fakeCaches } = loadSw({ routes });
  await fireInstall(listeners);
  const cache = await fakeCaches.open(`${NS}-shell-__SW_VERSION__`);

  const INDEX = `${SCOPE_URL}index.html`;
  routes.set(INDEX, { body: "<!doctype html>fresh shell" });
  const req = new Request(INDEX);
  Object.defineProperty(req, "mode", { value: "navigate" });
  const event = makeEvent(req);
  listeners.fetch(event);
  await event.settle();
  await Promise.all(event._waits);
  assert.equal(await (await cache.match("app-shell")).text(), "<!doctype html>fresh shell");
});

test("a WARM pass retires superseded binary caches, keeping a bounded recent set", async () => {
  // The render worker prunes these too, but only once it has rendered: a
  // visitor who installs and warms without rendering had no other owner. The
  // retention bound mirrors binCache.ts's MAX_RETAINED_BIN_CACHES, because
  // these caches are origin-shared and another deployment may still be on an
  // older pin.
  //
  // Driven through install + WARM, with the manifest served from the network
  // exactly as a real deploy serves it. Pruning on the ACTIVATE path could
  // never work and this is why: CACHE is versioned per build, so an activating
  // worker opens a cache holding only what install put there, and the copy of
  // the manifest a previous warm pass stored lives in the cache activate has
  // just deleted. Seeding the manifest into the current shell cache by hand
  // (which is what this test used to do) reaches a state production never has.
  const CURRENT = "openscad-wasm-bin-2026.06.12";
  const existing = {};
  for (const k of [
    "openscad-wasm-bin-2025.01.01",
    "openscad-wasm-bin-2025.06.01",
    "openscad-wasm-bin-2026.01.01",
    "unrelated-app-cache",
  ]) {
    existing[k] = new FakeCache();
  }
  const routes = goodRoutes();
  routes.set(new URL("precache-manifest.json", SCOPE_URL).href, {
    body: JSON.stringify({ version: 2, shell: [], bin: { cache: CURRENT, urls: [] } }),
  });
  const { listeners, fakeCaches } = loadSw({ routes, existingCaches: existing });
  await fireInstall(listeners);
  await fireActivate(listeners);
  assert.ok(
    (await fakeCaches.keys()).includes("openscad-wasm-bin-2025.01.01"),
    "install and activate on their own retire nothing: the warm pass owns this"
  );
  await fireMessage(listeners, { type: "WARM" });

  const keys = await fakeCaches.keys();
  // MAX_RETAINED_BIN_CACHES is 3: the current pin plus the two most recent
  // others, so exactly the oldest goes.
  assert.ok(keys.includes("openscad-wasm-bin-2026.01.01"), "the most recent other pin is retained");
  assert.ok(keys.includes("openscad-wasm-bin-2025.06.01"), "and the one before it");
  assert.ok(!keys.includes("openscad-wasm-bin-2025.01.01"), "the oldest pin is retired");
  assert.ok(keys.includes("unrelated-app-cache"), "a cache that isn't ours is untouched");
});

test("pruning survives the deploy boundary: a second build still retires an old pin", async () => {
  // The regression this pins. Every deploy stamps a new VERSION and therefore a
  // new shell cache, so anything the prune step needs must not be read out of
  // the *previous* build's cache. Two builds in a row, each warming once.
  let existing = Object.fromEntries(
    ["openscad-wasm-bin-2025.01.01", "openscad-wasm-bin-2025.06.01"].map((k) => [k, new FakeCache()])
  );
  // Each build gets a fresh worker over the caches the previous one left behind
  // — the caches persist across deploys, the shell cache name does not.
  const run = async (binCache) => {
    const routes = goodRoutes();
    routes.set(new URL("precache-manifest.json", SCOPE_URL).href, {
      body: JSON.stringify({ version: 2, shell: [], bin: { cache: binCache, urls: [] } }),
    });
    const { listeners, fakeCaches } = loadSw({ routes, existingCaches: existing });
    await fireInstall(listeners);
    await fireActivate(listeners);
    await fireMessage(listeners, { type: "WARM" });
    existing = Object.fromEntries(fakeCaches.caches);
  };
  await run("openscad-wasm-bin-2026.01.01");
  await run("openscad-wasm-bin-2026.06.12");

  const keys = Object.keys(existing);
  assert.ok(
    !keys.includes("openscad-wasm-bin-2025.01.01"),
    "the oldest pin is gone after the second deploy's warm pass"
  );
  assert.ok(keys.includes("openscad-wasm-bin-2026.06.12"), "the current pin survives");
});

test("sw.js's hand-mirrored bin-cache policy matches binCache.ts", async () => {
  // public/sw.js is plain JS and cannot import TypeScript, so it re-declares
  // BIN_CACHE_PREFIX and MAX_RETAINED_BIN_CACHES. Nothing checked that: the
  // suite asserted sw.js against sw.js's own literal, so raising the bound in
  // binCache.ts alone left both workers evicting the same origin-shared ~11 MB
  // caches under different rules, with everything green. Same guard the WASM
  // pin got (tests/binCache.test.mjs), for the same reason.
  const { BIN_CACHE_PREFIX, MAX_RETAINED_BIN_CACHES } = await import(
    "../src/openscad/binCache.ts"
  );
  const prefix = /const BIN_CACHE_PREFIX = "([^"]+)"/.exec(swSource)?.[1];
  const retain = Number(/const MAX_RETAINED_BIN_CACHES = (\d+)/.exec(swSource)?.[1]);
  assert.equal(prefix, BIN_CACHE_PREFIX, "sw.js's cache prefix");
  assert.equal(retain, MAX_RETAINED_BIN_CACHES, "sw.js's retention bound");
});

test("the warm-hint marker vite.config.ts writes is the one sw.js reads", () => {
  // Two files, one string, and nothing else connects them: the marker is what
  // tells install a `rel="modulepreload"` belongs to a chunk the app loads
  // later rather than to one the entry statically imports. If they drift, every
  // hint reads as boot-critical (a slower install) or — the direction that
  // actually broke — Vite's own entry imports read as supplementary and the
  // offline shell cannot boot. Asserted through sw.js's OWN matcher rather than
  // by re-deriving its regex here, which would just be a third copy to drift.
  const viteConfig = readFileSync(
    fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    "utf-8"
  );
  const attr = /const WARM_ATTR = "([^"]+)"/.exec(viteConfig)?.[1];
  assert.ok(attr, "vite.config.ts declares WARM_ATTR");
  const { sandbox } = loadSw();
  assert.equal(typeof sandbox.hasWarmMarker, "function", "sw.js exposes its matcher");
  assert.ok(sandbox.hasWarmMarker(` ${attr} href="/x.js"`), `sw.js does not recognise ${attr}`);
});

test("the marker is an attribute, not a substring of a filename", () => {
  // A chunk Vite happened to name `data-warm-runtime.js` demoted its own
  // boot-critical modulepreload to supplementary, dropping an entry import out
  // of the install shell — silently, and only for the bundle that produced that
  // name.
  const { listeners, calls } = loadSw({
    routes: new Map([
      [
        SCOPE_URL,
        {
          body:
            `<html><head><link rel="modulepreload" href="/${NS}/assets/data-warm-runtime.js">` +
            `<link rel="modulepreload" data-warm href="/${NS}/assets/Viewer-abc.js" />` +
            `</head><body><script type="module" src="/${NS}/assets/index.js"></script></body></html>`,
        },
      ],
      [ENTRY_JS, { body: "console.log(1)" }],
      [`https://example.test/${NS}/assets/data-warm-runtime.js`, { body: "export {}" }],
    ]),
  });
  return fireInstall(listeners).then(() => {
    assert.ok(
      calls.includes(`https://example.test/${NS}/assets/data-warm-runtime.js`),
      "a chunk merely NAMED data-warm is still boot-critical"
    );
    assert.ok(!calls.includes(VIEWER_JS), "the one that carries the attribute is not");
  });
});
