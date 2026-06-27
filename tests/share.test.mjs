// Tests the Web Share API wrappers (src/lib/share.ts): outcome reporting so the
// app knows when to fall back to clipboard / download. navigator is swapped out
// per-case (it's a configurable global in Node).
import { test } from "node:test";
import assert from "node:assert/strict";
import { shareUrl, shareFile } from "../src/lib/share.ts";

const orig = Object.getOwnPropertyDescriptor(globalThis, "navigator");
function withNavigator(nav, fn) {
  Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
  try {
    return fn();
  } finally {
    if (orig) Object.defineProperty(globalThis, "navigator", orig);
  }
}

const abort = () => Object.assign(new Error("dismissed"), { name: "AbortError" });
const fakeFile = { name: "m.3mf" };

test("shareUrl: unsupported when navigator.share is absent", async () => {
  const out = await withNavigator({}, () => shareUrl("https://x/#d=a"));
  assert.equal(out, "unsupported");
});

test("shareUrl: shared on success, passes url + title", async () => {
  let got;
  const out = await withNavigator(
    { share: async (data) => { got = data; } },
    () => shareUrl("https://x/#d=a", "Tag")
  );
  assert.equal(out, "shared");
  assert.deepEqual(got, { url: "https://x/#d=a", title: "Tag" });
});

test("shareUrl: cancelled on AbortError (caller must not fall back)", async () => {
  const out = await withNavigator({ share: async () => { throw abort(); } }, () => shareUrl("u"));
  assert.equal(out, "cancelled");
});

test("shareUrl: failed on a non-abort error (caller falls back)", async () => {
  const out = await withNavigator({ share: async () => { throw new Error("nope"); } }, () => shareUrl("u"));
  assert.equal(out, "failed");
});

test("shareFile: unsupported when canShare rejects the file", async () => {
  const out = await withNavigator(
    { share: async () => {}, canShare: () => false },
    () => shareFile(fakeFile)
  );
  assert.equal(out, "unsupported");
});

test("shareFile: unsupported when canShare is absent (Level 1 only)", async () => {
  const out = await withNavigator({ share: async () => {} }, () => shareFile(fakeFile));
  assert.equal(out, "unsupported");
});

test("shareFile: shared when canShare accepts the file", async () => {
  let got;
  const out = await withNavigator(
    { share: async (d) => { got = d; }, canShare: ({ files }) => files.length === 1 },
    () => shareFile(fakeFile, "m.3mf")
  );
  assert.equal(out, "shared");
  assert.deepEqual(got, { files: [fakeFile], title: "m.3mf" });
});
