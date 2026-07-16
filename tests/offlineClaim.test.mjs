// Tests the pure offline-claim selection logic (src/lib/offlineClaim.ts): the
// impure gathering (Cache Storage, service-worker controller, the toast
// itself) lives in useAppNotices.ts and isn't exercised here — see that
// file's doc comment for the full design this supports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectOfflineClaim } from "../src/lib/offlineClaim.ts";

const base = {
  downloadHappened: true,
  swControls: true,
  precacheOk: true,
  engineCached: true,
};

test("no claim when no download happened this session, regardless of cache state", () => {
  assert.equal(
    selectOfflineClaim({ ...base, downloadHappened: false }),
    null
  );
});

test("readyOffline: a controlling service worker plus a fully verified precache", () => {
  assert.equal(selectOfflineClaim(base), "loading.readyOffline");
});

test("falls back to engineOffline when the service worker doesn't control the page yet", () => {
  assert.equal(
    selectOfflineClaim({ ...base, swControls: false }),
    "loading.engineOffline"
  );
});

test("falls back to engineOffline when the precache isn't fully verified", () => {
  assert.equal(
    selectOfflineClaim({ ...base, precacheOk: false }),
    "loading.engineOffline"
  );
});

test("no claim when neither the precache nor the engine cache is confirmed", () => {
  assert.equal(
    selectOfflineClaim({ ...base, precacheOk: false, engineCached: false }),
    null
  );
});

test("engineOffline never wins over readyOffline when both are honestly available", () => {
  assert.equal(selectOfflineClaim(base), "loading.readyOffline");
});

test("a download with no cache confirmed at all yields no claim", () => {
  assert.equal(
    selectOfflineClaim({
      downloadHappened: true,
      swControls: false,
      precacheOk: false,
      engineCached: false,
    }),
    null
  );
});
