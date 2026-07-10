// Tests src/lib/idb.ts's connection lifecycle against an in-memory IndexedDB
// (fake-indexeddb). stlCache.test.mjs exercises the store logic built on top;
// this file is about openDb()'s own caching/reopen behavior.
import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";

const { openDb, reqToPromise, USER_FILES_STORE } = await import("../src/lib/idb.ts");

test("openDb reopens after the connection abnormally closes", async () => {
  const db1 = await openDb();

  // A normal versionchange-triggered close is already handled; this simulates
  // the other way a connection dies — an abnormal close (e.g. the browser
  // force-closing it under storage pressure), which fires "close" rather than
  // "versionchange". Firing the handler directly, then actually closing the
  // connection, reproduces that: the cached promise must not keep pointing at
  // a dead connection.
  db1.onclose?.();
  db1.close();

  // The dead connection can no longer start a transaction.
  assert.throws(() => db1.transaction(USER_FILES_STORE, "readonly"));

  const db2 = await openDb();
  assert.notEqual(db2, db1, "a fresh connection replaces the dead one");
  // The new connection is actually usable.
  const count = await reqToPromise(
    db2.transaction(USER_FILES_STORE, "readonly").objectStore(USER_FILES_STORE).count()
  );
  assert.equal(count, 0);
});
