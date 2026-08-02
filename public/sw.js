// sw.js: service worker for offline use. Caches the app shell and hashed
// build assets at runtime (stale-while-revalidate); SPA navigations fall back
// to the cached shell when offline. The big version-pinned binaries (the
// ~10 MB WASM + the bundled fonts) are warmed into the render worker's own
// versioned Cache Storage entry (same cache, same keys, see
// src/openscad/worker.ts BIN_CACHE), so offline rendering works even before
// the first render, without double-storing 10 MB.
//
// Install caches the boot-critical shell and nothing else; the rest, that
// binary warm-up included: waits for the page's WARM message, sent once its
// first screen no longer needs the network (see warmSupplementary below and
// src/lib/swUpdate.ts's warmServiceWorker). Each WARM fills whatever is still
// missing, so an interrupted pass is repaired by the next one.
// The cache is namespaced per configurator: the registering page passes ?ns=<id>
// (the config's `id`) on the worker URL, so two configs on one origin don't share
// a shell cache. Falls back to a neutral name if registered without it.
const NS = new URL(self.location.href).searchParams.get("ns") || "scadpub";
// Per-build version, stamped into the shipped sw.js by the `sw-version` Vite
// plugin (vite.config.ts). It changes every deploy so the browser sees a *new*
// worker and can prompt "update available": a byte-identical sw.js would never
// trigger that, leaving users to reload manually. It also names the shell cache,
// so a new build's `activate` clears the previous one. The literal placeholder
// survives in dev, where the worker isn't registered anyway.
const VERSION = "__SW_VERSION__";
const CACHE = `${NS}-shell-${VERSION}`;
const SHELL_KEY = "app-shell";
const SCOPE_URL = self.registration.scope;
// M2: SHELL_KEY (the offline fallback response for every SPA navigation) must
// only ever be refreshed from the canonical app entry. The scope root itself
// (this build's start_url), never from an arbitrary in-scope navigation (a
// Markdown/SCAD/static URL visited directly). Otherwise a direct visit to a
// non-app URL would silently replace the offline app fallback with that page.
const SCOPE_PATH = new URL(SCOPE_URL).pathname;

// The render worker's own binary cache handles these (warmed below); keep
// them out of the shell cache so they aren't stored twice.
const BIN_RE = /\.(wasm|ttf|otf|ttc)$/i;

function shouldCache(url) {
  const u = typeof url === "string" ? new URL(url) : url;
  return u.origin === self.location.origin && !BIN_RE.test(u.pathname);
}

function isAppEntry(url) {
  // `<scope>index.html` is the same document as `<scope>` on every static host
  // that serves this build, and a navigation to it must refresh SHELL_KEY too:
  // a visitor who lands there otherwise leaves the offline fallback stale.
  return url.pathname === SCOPE_PATH || url.pathname === `${SCOPE_PATH}index.html`;
}

// Build-volatile sources: the render worker deliberately fetches .scad sources
// fresh every render (see BIN_CACHE's comment in worker.ts), keyed by the
// build's renderHash. Serving a stale cache-first copy here after a deploy
// would mount the previous build's source while the new bundle's renderHash
// keys the result, permanently poisoning the persisted render cache for those
// parameters. precache-manifest.json drives the SW's own asset list, so it
// needs the same treatment.
//
// asset-manifest.json deliberately does NOT: it is emitted by Vite alongside
// the hashed bundle, so it changes name-for-name only when those hashed
// filenames change, and every warm pass fetches it with cache: "reload"
// anyway (addBuildAssets). precache-manifest.json is generated per build with
// a stable name AND carries the `bin` cache identity, so a stale copy served
// cache-first would warm the previous build's binaries.
//
// EVERYTHING under `scad/` is volatile, with no exceptions by name or by file
// type: that tree mirrors the operator's source layout at its own relative
// paths, so any name here could be theirs. A `.png` can be a `surface()`
// heightmap, and a subdirectory can be whatever they called it.
function isVolatileSource(pathname) {
  if (pathname.endsWith("precache-manifest.json")) return true;
  // Relative to the scope, never anywhere in the pathname: a deployment at
  // BASE_PATH=/scad/ would otherwise make EVERY asset network-first, because
  // its own scope segment is called `scad`.
  if (!pathname.startsWith(SCOPE_PATH)) return false;
  return pathname.slice(SCOPE_PATH.length).split("/")[0] === "scad";
}

function addScopedUrl(urls, path) {
  if (!path) return;
  const url = new URL(path, SCOPE_URL);
  if (shouldCache(url)) urls.add(url.href);
}

// The entry document links three kinds of asset: boot-critical code (the module
// script, the stylesheets the first paint needs, and the chunks that script
// statically imports — Vite links those as `rel="modulepreload"`), resource
// hints for chunks the app loads LATER (the render worker and the lazy three.js
// Viewer, injected by vite.config.ts's preloadLinks), and PWA
// metadata/artwork (the webmanifest, icons, Apple splash images).
//
// Only the first is install-fatal, and only the first is fetched at install.
// A later-chunk hint is a *page* optimisation: the page is already fetching
// those chunks, and re-fetching them here with cache: "reload" bypasses the
// HTTP cache it just filled, at exactly the moment the first screen owns the
// network — the stall the install brake exists to prevent. Their offline
// coverage is warmSupplementary's job.
//
// `rel` alone cannot draw that line. Vite emits `rel="modulepreload"` for every
// chunk the ENTRY statically imports (its React runtime, its shared vendor
// chunk), and the entry cannot execute without them: treating all modulepreloads
// as supplementary produced an install shell that could not boot offline at all
// until a WARM pass happened to land. So preloadLinks marks its own hints with
// `data-warm`, and that attribute — not the tag, not `rel` — is what demotes a
// link. Anything Vite emits stays boot-critical by default, which is the safe
// direction: an over-cached chunk costs install bandwidth, an under-cached one
// costs the whole offline promise.
const TAG_RE = /<(script|link)\b([^>]*)>/gi;
const SRC_RE = /\bsrc=["']([^"']+)["']/i;
const HREF_RE = /\bhref=["']([^"']+)["']/i;
const REL_RE = /\brel=["']([^"']+)["']/i;
// vite.config.ts's WARM_ATTR. Keep the two in step.
//
// Tested against the tag's attributes with every quoted VALUE blanked out
// first, because a value is not an attribute: a chunk Vite happened to name
// `data-warm-runtime.js` would otherwise demote its own `rel="modulepreload"`
// to supplementary and drop a boot-critical import out of the install shell —
// silently, and only for whoever's bundle produced that name.
const WARM_HINT_RE = /(?:^|[\s/])data-warm(?=[\s/=>]|$)/i;
const ATTR_VALUE_RE = /=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/g;

function hasWarmMarker(attrs) {
  return WARM_HINT_RE.test(attrs.replace(ATTR_VALUE_RE, "="));
}

function addHtmlAssets(essential, extra, html) {
  for (const [, tag, attrs] of html.matchAll(TAG_RE)) {
    const isScript = tag.toLowerCase() === "script";
    const url = (isScript ? attrs.match(SRC_RE) : attrs.match(HREF_RE))?.[1];
    if (!url) continue;
    const rel = attrs.match(REL_RE)?.[1].trim().toLowerCase();
    const bootCritical =
      !hasWarmMarker(attrs) && (isScript || rel === "stylesheet" || rel === "modulepreload");
    addScopedUrl(bootCritical ? essential : extra, url);
  }
}

async function addBuildAssets(urls) {
  const manifestUrl = new URL("asset-manifest.json", SCOPE_URL);
  try {
    const res = await fetch(new Request(manifestUrl, { cache: "reload" }));
    if (!res.ok) return;
    urls.add(manifestUrl.href);
    const manifest = await res.json();
    for (const entry of Object.values(manifest)) {
      addScopedUrl(urls, entry.file);
      for (const css of entry.css || []) addScopedUrl(urls, css);
      for (const asset of entry.assets || []) addScopedUrl(urls, asset);
    }
  } catch {
    /* best-effort: index.html parsing still covers the main entry */
  }
}

async function addPublicAssets(urls) {
  const manifestUrl = new URL("precache-manifest.json", SCOPE_URL);
  try {
    const res = await fetch(new Request(manifestUrl, { cache: "reload" }));
    if (!res.ok) return null;
    urls.add(manifestUrl.href);
    const data = await res.json();
    // v2 shape: { version, shell: [...], bin: { cache, urls } }; a plain array
    // is the pre-v2 shell list (tolerated so a stale manifest can't break install).
    for (const path of Array.isArray(data) ? data : (data.shell ?? []))
      addScopedUrl(urls, path);
    return Array.isArray(data) ? null : (data.bin ?? null);
  } catch {
    /* optional manifest, generated by scripts/gen-schema.mjs */
    return null;
  }
}

// Warm the render worker's own binary cache (BIN_CACHE in worker.ts) with the
// version-pinned WASM + fonts, so rendering works offline even if the user
// never rendered while online. Same cache name + request URLs the worker's
// cachedBuffer() uses, so nothing is stored twice. The cache is shared across
// configs on one origin by design; match-before-fetch keeps warming idempotent
// (and cheap when another config already downloaded the binaries). Best-effort
// per asset: an aborted 10 MB fetch must not fail the whole install. The
// render worker fetches on demand as a fallback.
// Serialize a binary download with the render worker fetching the same URL
// into the same cache (worker.ts's withBinLock: the name is built by hand
// from the same prefix + full URL on both sides). Web Locks are origin-scoped
// and shared across the service worker and dedicated workers, so on a cold
// visit whoever wins the per-URL lock downloads the ~10 MB wasm binary once;
// the loser re-checks the cache after acquisition and finds it filled: real
// coordination that holds at any connection speed, unlike a fixed grace
// delay, and costs nothing when there's no contention. The lock auto-releases
// if its holder dies mid-download. Without Web Locks support, run unlocked:
// the old best-effort behavior, a rare duplicate download at worst.
function withBinLock(href, fn) {
  return navigator.locks ? navigator.locks.request(`openscad-bin-fetch:${href}`, fn) : fn();
}

async function precacheBin(bin) {
  if (!bin || !bin.cache || !Array.isArray(bin.urls)) return;
  const cache = await caches.open(bin.cache);
  // Which entries are actually missing, before taking any lock: on the
  // common warm install (a redeploy with an unchanged wasm pin, or a
  // returning visitor) everything is already cached and this whole function
  // must cost ~nothing.
  const missing = [];
  for (const path of bin.urls) {
    try {
      const url = new URL(path, SCOPE_URL);
      if (url.origin !== self.location.origin) continue;
      if (!(await cache.match(url.href))) missing.push(url.href);
    } catch {
      /* malformed manifest entry: skip it */
    }
  }
  await Promise.all(
    missing.map((href) =>
      withBinLock(href, async () => {
        try {
          // The render worker may have filled the entry while we held back
          // for the lock (it takes the same lock around its own fetch), or,
          // without lock support, at any point in this race window.
          if (await cache.match(href)) return;
          const res = await fetch(new Request(href, { cache: "no-cache" }));
          // Re-check before the write, for the no-Web-Locks fallback where
          // the render worker may have filled the entry mid-fetch. Two
          // concurrent cache.put()s for one key don't corrupt anything, but
          // there's no reason to store the ~10 MB body twice in a row.
          if (res.ok && !(await cache.match(href))) await cache.put(href, res);
        } catch {
          /* the render worker fetches on demand as before */
        }
      })
    )
  );
}

// Best-effort supplementary asset: a failure here must not fail install. The
// app shell is already usable offline once the essential shell assets (see
// cacheEssential below) have landed, and the stale-while-revalidate fetch
// handler will pick these up on first request anyway.
async function cacheOne(cache, url) {
  if (!shouldCache(url)) return;
  try {
    const res = await fetch(new Request(url, { cache: "reload" }));
    if (res.ok) await cache.put(url, res.clone());
  } catch {
    /* offline support is best-effort per asset */
  }
}

// M2: unlike cacheOne, a failure here PROPAGATES. These are the minimum set
// of bytes (the app entry document plus everything it directly references)
// needed to boot the app offline. Install must not succeed with a broken
// shell: a missing script/stylesheet the entry HTML references would leave a
// cached fallback that renders a blank/broken page. Callers surface the
// rejection through event.waitUntil so the browser retries install later.
async function cacheEssential(cache, url) {
  if (!shouldCache(url)) return;
  const res = await fetch(new Request(url, { cache: "reload" }));
  if (!res.ok) throw new Error(`shell asset fetch failed: ${url} (${res.status})`);
  await cache.put(url, res.clone());
}

// Install caches ONLY this: the app entry document plus the JS/CSS it
// needs to boot. Everything else (lazy chunks, icons, splash artwork, design
// sources, presets, docs, and the ~11 MB of pinned binaries) is deferred to
// warmSupplementary() below, which the page asks for once its first screen is
// done with the network. Install fires the moment the page registers the
// worker, which is exactly when the app is fetching whatever the user is
// looking at; downloading the entire offline bundle right then made a first
// visit's own content (the design gallery's thumbnails above all) queue
// behind megabytes it doesn't need yet.
async function precacheEssential() {
  const cache = await caches.open(CACHE);

  // The atomic minimum shell: the app entry document itself, plus every
  // asset it directly references (the hashed JS/CSS bundle needed to boot).
  // A failure anywhere in here rejects the whole install, see cacheEssential.
  const res = await fetch(new Request(SCOPE_URL, { cache: "reload" }));
  if (!res.ok) throw new Error(`shell entry fetch failed: ${res.status}`);
  // Clone before consuming the body with .text() below: a Response's body
  // can only be read once.
  await cache.put(SHELL_KEY, res.clone());
  await cache.put(SCOPE_URL, res.clone());
  const html = await res.text();

  const essential = new Set();
  const extra = new Set();
  // JS/CSS the entry needs -> essential (install-fatal); the webmanifest,
  // icons, and Apple splash images it also links -> extra (warmed later).
  addHtmlAssets(essential, extra, html);
  await Promise.all([...essential].map((url) => cacheEssential(cache, url)));
  return extra;
}

// The rest of the offline bundle: the HTML-linked PWA metadata/artwork, the
// additional lazy chunks, icons, presets, docs, and the warmed binary cache.
// Best-effort throughout: the app is already bootable offline from the
// essential shell, and the runtime fetch handler (stale-while-revalidate /
// network-first) fills any of this in on first request anyway.
//
// `warming` coalesces concurrent WARMs (several tabs, one tab re-triggering)
// but is cleared once the pass settles, so a LATER trigger retries. That
// matters because every helper below swallows its own per-asset failure: a pass
// interrupted by a dead network, a flaky response or a worker killed mid-flight
// resolves looking exactly like a complete one. Memoizing that forever left an
// installed app that boots offline and then cannot render, with no way back:
// precisely the state the warm-up exists to prevent. Retrying is cheap because
// a pass only fetches what is actually missing.
let warming = null;
function warmSupplementary() {
  warming ??= (async () => {
    const cache = await caches.open(CACHE);
    // The artwork/metadata the entry links comes from the shell install
    // cached, re-parsed rather than carried over from install in a module
    // variable: WARM can only arrive at an ACTIVE worker (the page waits on
    // serviceWorker.ready), so by now that entry is always in the cache, and
    // one cached read costs nothing next to a second way of obtaining the same
    // set.
    const extra = new Set();
    const shell = await cache.match(SHELL_KEY);
    if (shell) addHtmlAssets(new Set(), extra, await shell.text());
    const [, bin] = await Promise.all([addBuildAssets(extra), addPublicAssets(extra)]);
    // Only what isn't cached yet, so re-running this after a partial pass costs
    // a handful of cache lookups rather than the whole bundle again. (The
    // versioned shell cache is per build, so "already there" always means this
    // build's copy; precacheBin does the same check for the binaries.)
    const present = await Promise.all([...extra].map((url) => cache.match(url)));
    const missing = [...extra].filter((_, i) => !present[i]);
    // Light assets first (~1.5 MB of chunks, artwork, sources, presets, docs),
    // the pinned binaries after (~11 MB). A warm-up can be cut short at any
    // point (the tab closes, the worker is terminated, the network drops) and
    // in that order what survives is an app that boots and switches designs
    // offline. Interleaved, an interruption left an arbitrary subset of both.
    await Promise.all(missing.map((url) => cacheOne(cache, url)));
    await precacheBin(bin);
    // After the current pin is in place, never before: pruning first could
    // retire the only cache holding bytes this pass then fails to re-download.
    await pruneBinCaches(bin?.cache);
  })()
    .catch(() => {
      /* whatever is still missing is the next trigger's problem */
    })
    .finally(() => {
      warming = null;
    });
  return warming;
}

// A new worker waits (doesn't auto-activate) so the page can prompt the user
// and activate it on demand, see the message handler below and
// src/lib/swUpdate.ts. This avoids silently swapping code under an open tab
// (which could mismatch the lazily-loaded viewer chunk mid-session).
self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "SKIP_WAITING") self.skipWaiting();
  // The page is past its first screen and the network is free: pull down
  // the rest of the offline bundle now (src/lib/swUpdate.ts's
  // warmServiceWorker). Nothing else triggers this: a visit whose page closes
  // first stays warmed by the fetch handler instead.
  if (type === "WARM") event.waitUntil(warmSupplementary());
});

self.addEventListener("install", (event) => {
  // M2: precacheEssential() rejects on a missing/broken essential shell asset
  // instead of swallowing the failure, so a broken deploy never "succeeds"
  // into an unusable offline fallback. The browser retries install later
  // with the previous worker (and its cache) still fully in control.
  event.waitUntil(precacheEssential());
});

// Retire binary caches from superseded WASM pins. The render worker prunes
// these too (staleBinaryCaches, called from worker.ts), but only once it has
// actually run: a visitor who installs the app and warms it without ever
// rendering accumulated one ~11 MB cache per deployed pin, with no other owner
// to clear them.
//
// Mirrors src/openscad/binCache.ts's policy by hand, because that is TypeScript
// and this file is not: same BIN_CACHE_PREFIX, same MAX_RETAINED_BIN_CACHES,
// same "keep the lexically-last, which for date-like pins is the most recent"
// rule. Retaining a few rather than evicting every other one is deliberate
// (H4): these caches are origin-shared by design, so another deployment on this
// origin may still be on a pin this one has moved past.
const BIN_CACHE_PREFIX = "openscad-wasm-bin-";
const MAX_RETAINED_BIN_CACHES = 3;

// Runs from the WARM pass, NOT from activate. Two reasons, and the second is
// why activate cannot do this at all: a functional event is not dispatched
// while the worker is `activating`, and `activating` lasts until every
// waitUntil promise settles, so reading the manifest there would hold the
// page's own fetches for a round trip — the boot stall the install brake
// exists to prevent. Cache-only avoided the round trip but could never find
// the manifest: every deploy stamps a new VERSION, so an activating worker
// opens a freshly created shell cache holding only what precacheEssential put
// there, and the copy a previous warm pass stored belongs to the cache activate
// has just deleted. Here `current` comes straight from the manifest the warm
// pass already fetched, and the pass runs at an idle moment by construction.
async function pruneBinCaches(current) {
  if (!current) return; // a pre-v2 manifest names no bin cache: nothing to reason about
  try {
    const keys = await caches.keys();
    const others = keys.filter((k) => k.startsWith(BIN_CACHE_PREFIX) && k !== current).sort();
    // The outer clamp is load-bearing (a negative end would slice from the
    // tail); the retention count is a constant, so nothing else needs guarding.
    const stale = others.slice(0, Math.max(0, others.length - (MAX_RETAINED_BIN_CACHES - 1)));
    await Promise.all(stale.map((k) => caches.delete(k)));
  } catch {
    /* best-effort: the render worker prunes as well */
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // M2: only retire older shell caches once this build's shell is proven
      // present in CACHE (install already guarantees this unless something
      // evicted it between install and activate), never delete the last good
      // cache before its replacement is validated.
      const cache = await caches.open(CACHE);
      const validated = await cache.match(SHELL_KEY);
      if (validated) {
        // Inside the branch that uses it: `activate` holds clients.claim()
        // behind it, and an unconditional caches.keys() round trip buys nothing
        // on the path where nothing will be deleted. (See pruneBinCaches below
        // on why work during `activating` is worth avoiding.)
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((k) => k.startsWith(`${NS}-shell-`) && k !== CACHE)
            .map((k) => caches.delete(k))
        );
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // The render worker's own cache serves the WASM + font binaries (warmed at
  // install); don't double-store ~10 MB in the shell cache.
  if (BIN_RE.test(url.pathname)) return;

  // SPA navigations: network-first, falling back to the cached shell offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await fetch(req);
          // M2: only the canonical app entry may refresh SHELL_KEY. An
          // in-scope Markdown/SCAD/static page must never overwrite the
          // offline app fallback. Write is tied to the event's lifetime via
          // waitUntil rather than the response, so it completes even though
          // respondWith already resolved with `res`.
          if (res.ok && isAppEntry(url)) {
            event.waitUntil(cache.put(SHELL_KEY, res.clone()));
          }
          return res;
        } catch {
          return (await cache.match(SHELL_KEY)) || Response.error();
        }
      })()
    );
    return;
  }

  // Build-volatile sources: network-first, falling back to the cache only when
  // offline, so a deploy is never shadowed by a previous build's cached copy.
  if (isVolatileSource(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await fetch(req);
          if (res.ok) event.waitUntil(cache.put(req, res.clone()));
          return res;
        } catch {
          return (await cache.match(req)) || Response.error();
        }
      })()
    );
    return;
  }

  // Static assets (hashed JS/CSS, fonts, presets): stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      // The put is chained INTO the promise waitUntil receives, not fired
      // alongside it: awaiting only the fetch let the worker be killed between
      // the response arriving and the write landing, so the revalidation was
      // silently lost. Same shape as the navigation and volatile paths above.
      const refresh = fetch(req).then(async (res) => {
        if (res.ok) await cache.put(req, res.clone());
        return res;
      });
      if (cached) {
        event.waitUntil(refresh.catch(() => {}));
        return cached;
      }
      return refresh.catch(() => Response.error());
    })()
  );
});
