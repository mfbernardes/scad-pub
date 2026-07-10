// Tests for the anchor-click download helper. downloadBlob defers its
// object-URL revocation past the click so WebKit's async blob-URL navigation
// isn't raced into a silent no-op export.
import { test } from "node:test";
import assert from "node:assert/strict";
import { download, downloadBlob } from "../src/lib/download.ts";

class FakeAnchor {
  href = "";
  download = "";
  clicked = false;
  click() {
    this.clicked = true;
  }
}

function stubDocument() {
  const created = [];
  globalThis.document = {
    createElement: (tag) => {
      assert.equal(tag, "a");
      const a = new FakeAnchor();
      created.push(a);
      return a;
    },
  };
  return created;
}

test("download sets href/download on a transient anchor and clicks it", () => {
  const created = stubDocument();
  download("blob:abc", "model.stl");
  assert.equal(created.length, 1);
  assert.equal(created[0].href, "blob:abc");
  assert.equal(created[0].download, "model.stl");
  assert.equal(created[0].clicked, true);
});

test("downloadBlob defers object-URL revocation past the click", (t) => {
  const created = stubDocument();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let revoked = null;
  globalThis.URL.createObjectURL = () => "blob:generated";
  globalThis.URL.revokeObjectURL = (u) => {
    revoked = u;
  };
  try {
    downloadBlob(new Blob(["x"]), "model.stl");
    // The click already happened, but revocation must not have fired yet — a
    // synchronous revoke is exactly the WebKit race this fix avoids.
    assert.equal(created[0].clicked, true);
    assert.equal(revoked, null);
    t.mock.timers.tick(1000);
    assert.equal(revoked, "blob:generated");
  } finally {
    t.mock.timers.reset();
  }
});
