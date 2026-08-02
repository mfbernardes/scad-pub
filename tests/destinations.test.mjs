// Unit tests for scripts/lib/destinations.mjs's reconcileGenerated (M8), the
// only code in the build that DELETES files outside the wholesale-wiped scad
// tree. Its guards were previously covered only incidentally, through a
// gen-schema fixture that exercised the digest and tracked-file vetoes — the
// containment checks, the legacy manifest shape and the corrupt-manifest branch
// had no test at all, and removing them left the whole suite green.
//
// docs/config-pipeline.md states each of these as a promise; this is where they
// are held to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { reconcileGenerated } from "../scripts/lib/destinations.mjs";

/** A root to reconcile, a sibling directory outside it, and a manifest path. */
function scaffold() {
  const base = mkdtempSync(join(tmpdir(), "reconcile-"));
  const root = join(base, "public");
  const outside = join(base, "outside");
  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
  return { base, root, outside, manifest: join(base, ".gen-manifest.json") };
}

const write = (p, body = "x") => {
  writeFileSync(p, body);
  return p;
};

test("only files inside the root are ever deleted", () => {
  // The historical bug docs/config-pipeline.md describes: absolute paths in a
  // manifest made a stale or tampered copy an authority to remove files
  // anywhere on disk. Both guards — the textual one and the re-resolved one —
  // are load-bearing, and neither was covered.
  const { root, outside, manifest } = scaffold();
  const victim = write(join(outside, "victim.txt"));
  const stale = write(join(root, "stale.txt"));
  const kept = write(join(root, "kept.txt"));

  writeFileSync(
    manifest,
    JSON.stringify([
      { path: "stale.txt", sha256: null },
      { path: "kept.txt", sha256: null },
      // Every shape that must be refused.
      { path: "../outside/victim.txt", sha256: null },
      { path: victim, sha256: null }, // absolute
      { path: "sub/../../outside/victim.txt", sha256: null },
    ])
  );

  // Only kept.txt is written this run, so stale.txt is the one legitimate
  // removal.
  reconcileGenerated(manifest, root, [kept]);

  assert.ok(existsSync(victim), "a file outside the root must never be deleted");
  assert.ok(existsSync(kept), "a path this run still writes is kept");
  assert.ok(!existsSync(stale), "a path inside the root that this run dropped is removed");
});

test("a legacy bare-string manifest entry still cleans up after itself", () => {
  // The pre-digest shape. Dropping support silently means an upgrader's stale
  // generated files accumulate under public/ forever.
  const { root, manifest } = scaffold();
  const legacy = write(join(root, "legacy.txt"));
  const modern = write(join(root, "modern.txt"));
  const kept = write(join(root, "kept.txt"));
  writeFileSync(manifest, JSON.stringify(["legacy.txt", { path: "modern.txt", sha256: null }, "kept.txt"]));

  reconcileGenerated(manifest, root, [kept]);

  assert.ok(!existsSync(legacy), "a bare-string entry is honoured");
  assert.ok(!existsSync(modern), "and so is the object form beside it");
  assert.ok(existsSync(kept));
});

test("a corrupt or non-array manifest deletes nothing", () => {
  // "Nothing to clean up" is the only safe reading of a manifest that cannot be
  // trusted — the alternative is deleting on the strength of garbage.
  for (const body of ['{"not":"an array"}', "[", "null", "42", '"a string"']) {
    const { root, manifest } = scaffold();
    const untouched = write(join(root, "untouched.txt"));
    writeFileSync(manifest, body);
    reconcileGenerated(manifest, root, []);
    assert.ok(existsSync(untouched), `manifest ${body} must not authorise a delete`);
  }
  // A missing manifest is the first-run case and behaves the same way.
  const { root, manifest } = scaffold();
  const untouched = write(join(root, "untouched.txt"));
  reconcileGenerated(manifest, root, []);
  assert.ok(existsSync(untouched), "a first run deletes nothing");
});

test("a file whose bytes changed since we wrote it is left alone", () => {
  // The digest guard: a contributor who committed something over a path this
  // tool once generated owns those bytes now.
  const { root, manifest } = scaffold();
  const edited = write(join(root, "edited.txt"), "ours");
  const untouchedByUs = write(join(root, "stale.txt"), "ours");
  const digest = (s) => createHash("sha256").update(s).digest("hex");
  writeFileSync(
    manifest,
    JSON.stringify([
      { path: "edited.txt", sha256: digest("ours") },
      { path: "stale.txt", sha256: digest("ours") },
    ])
  );
  writeFileSync(edited, "theirs now");

  reconcileGenerated(manifest, root, []);

  assert.ok(existsSync(edited), "changed bytes are no longer ours to remove");
  assert.ok(!existsSync(untouchedByUs), "unchanged bytes still reconcile away");
});

test("isProtected vetoes a delete, and the rewritten manifest carries fresh digests", () => {
  const { root, manifest } = scaffold();
  const protectedFile = write(join(root, "tracked.ttf"));
  const current = write(join(root, "current.txt"), "current bytes");
  writeFileSync(manifest, JSON.stringify([{ path: "tracked.ttf", sha256: null }]));

  reconcileGenerated(manifest, root, [current], (abs) => abs === resolve(protectedFile));

  assert.ok(existsSync(protectedFile), "a protected path survives even though it is stale");
  const written = JSON.parse(readFileSync(manifest, "utf-8"));
  assert.deepEqual(
    written.map((e) => e.path),
    ["current.txt"],
    "the manifest records exactly what this run wrote"
  );
  assert.match(written[0].sha256, /^[0-9a-f]{64}$/, "with a real digest of the bytes on disk");
});

test("containment is a question about the filesystem, not about the string", () => {
  // The lexical checks only ever see the path. A directory symlink INSIDE the
  // root — `public/escape -> ../outside` — makes `escape/victim.txt` resolve
  // cleanly under root while every read and unlink lands outside it. Verified:
  // before the real-path check, the outside file was deleted.
  const cases = {
    "a directory symlink": (root, outside) => {
      symlinkSync(outside, join(root, "escape"), "dir");
      return "escape/victim.txt";
    },
    "a nested symlink chain": (root, outside) => {
      mkdirSync(join(root, "a"));
      symlinkSync(outside, join(root, "a", "b"), "dir");
      return "a/b/victim.txt";
    },
  };
  for (const [what, link] of Object.entries(cases)) {
    const { root, outside, manifest } = scaffold();
    const victim = write(join(outside, "victim.txt"), "precious");
    const rel = link(root, outside);
    writeFileSync(manifest, JSON.stringify([{ path: rel, sha256: null }]));
    reconcileGenerated(manifest, root, []);
    assert.ok(existsSync(victim), `${what}: the file outside the root must survive`);
  }

  // And a MATCHING digest is not permission: the digest guard answers "are
  // these still our bytes", which is a different question from "is this file
  // even in the root", so it must not be reachable first.
  {
    const { root, outside, manifest } = scaffold();
    const victim = write(join(outside, "victim.txt"), "ours");
    symlinkSync(outside, join(root, "escape"), "dir");
    writeFileSync(
      manifest,
      JSON.stringify([
        { path: "escape/victim.txt", sha256: createHash("sha256").update("ours").digest("hex") },
      ])
    );
    reconcileGenerated(manifest, root, []);
    assert.ok(existsSync(victim), "a digest match must not substitute for containment");
  }
});

test("a symlink inside the root is judged by where it sits, not what it points at", () => {
  // Removing a link is fine; removing what it points at is not. The parent is
  // what gets resolved, so a final-path symlink is still an in-root entry.
  const { root, outside, manifest } = scaffold();
  const target = write(join(outside, "target.txt"), "precious");
  symlinkSync(target, join(root, "link.txt"), "file");
  writeFileSync(manifest, JSON.stringify([{ path: "link.txt", sha256: null }]));

  reconcileGenerated(manifest, root, []);

  assert.ok(existsSync(target), "the target outside the root is untouched");
  // Both halves, or "nothing happened at all" would pass the assertion above.
  assert.ok(!existsSync(join(root, "link.txt")), "and the link itself is removed");
});

test("a file merely NAMED with leading dots is reconciled like any other", () => {
  // `..shot.png` is a perfectly ordinary filename, and a `startsWith("..")`
  // containment test rejected it as traversal — so the first build copied it,
  // the second dropped its manifest entry, and the file stayed on disk with
  // nothing left that could ever reconcile it. `..` is a path COMPONENT.
  const { root, outside, manifest } = scaffold();
  const victim = write(join(outside, "victim.txt"), "precious");
  mkdirSync(join(root, "..dir"), { recursive: true });
  const dotted = write(join(root, "..stale.txt"));
  const nested = write(join(root, "..dir", "nested.txt"));

  writeFileSync(
    manifest,
    JSON.stringify([
      { path: "..stale.txt", sha256: null },
      { path: join("..dir", "nested.txt"), sha256: null },
      // Still refused, in the same run: the fix widens what counts as in-root,
      // it does not weaken what counts as escaping.
      { path: join("..", "outside", "victim.txt"), sha256: null },
    ])
  );
  reconcileGenerated(manifest, root, []);

  assert.ok(!existsSync(dotted), "..stale.txt is inside the root and must be removed");
  assert.ok(!existsSync(nested), "..dir/nested.txt likewise");
  assert.ok(existsSync(victim), "a real ../ traversal is still refused");
});
