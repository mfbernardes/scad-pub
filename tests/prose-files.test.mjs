// Unit tests for scripts/lib/prose-files.mjs's resolveFileField: the shared
// "<field>/<field>File" resolution behind popup.body/bodyFile,
// fileImport.note/noteFile and licenses[].text/textFile (see docs/config.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFileField } from "../scripts/lib/prose-files.mjs";

// A minimal mustExist stand-in matching gen-schema.mjs's own contract: throws
// a clear error naming `what` when `abs` doesn't exist, otherwise returns it.
const mustExist = (abs, what) => {
  if (!existsSync(abs)) throw new Error(`gen-schema: ${what} not found:\n  ${abs}`);
  return abs;
};

function withTmpDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "prose-files-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("resolveFileField: no fileField set returns the object unchanged", () => {
  const obj = { header: "Hi", body: "Inline body." };
  assert.equal(resolveFileField({ obj, field: "body", fileField: "bodyFile", CONFIG_DIR: "/x", mustExist, path: "popup" }), obj);
});

test("resolveFileField: undefined/null obj passes through unchanged", () => {
  assert.equal(resolveFileField({ obj: undefined, field: "body", fileField: "bodyFile", CONFIG_DIR: "/x", mustExist, path: "popup" }), undefined);
  assert.equal(resolveFileField({ obj: null, field: "body", fileField: "bodyFile", CONFIG_DIR: "/x", mustExist, path: "popup" }), null);
});

test("resolveFileField: fileField set reads, trims, and inlines the file, dropping fileField", () => {
  withTmpDir((dir) => {
    writeFileSync(join(dir, "body.md"), "  Configure a widget.  \n");
    const obj = { header: "Hi", bodyFile: "body.md" };
    const out = resolveFileField({ obj, field: "body", fileField: "bodyFile", CONFIG_DIR: dir, mustExist, path: "popup" });
    assert.deepEqual(out, { header: "Hi", body: "Configure a widget." });
    // The input object is never mutated.
    assert.deepEqual(obj, { header: "Hi", bodyFile: "body.md" });
  });
});

test("resolveFileField: both field and fileField set fails the build, naming both", () => {
  withTmpDir((dir) => {
    writeFileSync(join(dir, "body.md"), "From file.");
    const obj = { header: "Hi", body: "Inline.", bodyFile: "body.md" };
    assert.throws(
      () => resolveFileField({ obj, field: "body", fileField: "bodyFile", CONFIG_DIR: dir, mustExist, path: "popup" }),
      /both 'popup\.body' and 'popup\.bodyFile' are set/
    );
  });
});

test("resolveFileField: a missing file fails the build via mustExist", () => {
  withTmpDir((dir) => {
    const obj = { note: undefined, noteFile: "nope.md" };
    assert.throws(
      () => resolveFileField({ obj, field: "note", fileField: "noteFile", CONFIG_DIR: dir, mustExist, path: "fileImport" }),
      /fileImport\.noteFile 'nope\.md' not found/
    );
  });
});

test("resolveFileField: works for any field/fileField pair (licenses[].text/textFile)", () => {
  withTmpDir((dir) => {
    writeFileSync(join(dir, "license.txt"), "MIT License\n\nFull text.\n");
    const entry = { name: "Lib", textFile: "license.txt" };
    const out = resolveFileField({ obj: entry, field: "text", fileField: "textFile", CONFIG_DIR: dir, mustExist, path: "licenses[0]" });
    assert.equal(out.text, "MIT License\n\nFull text.");
    assert.equal("textFile" in out, false);
  });
});
