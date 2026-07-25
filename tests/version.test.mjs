// Unit tests for the build's ScadPub version stamp (scripts/lib/version.mjs):
// the $SCADPUB_VERSION override, the `git describe` fallback, the cleanup
// applied to both, and the "no git, no stamp" path a git-less build tree hits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { scadpubVersion, SCADPUB_DIR } from "../scripts/lib/version.mjs";

// A git runner double: records how it was called, replays a canned stdout.
const gitStub = (stdout, calls = []) => {
  const git = (dir, args) => {
    calls.push({ dir, args });
    if (stdout instanceof Error) throw stdout;
    return stdout;
  };
  git.calls = calls;
  return git;
};

test("uses `git describe` output from the ScadPub checkout", () => {
  const git = gitStub("v1.4.0-3-gab12cd6\n");
  assert.equal(
    scadpubVersion({ dir: "/somewhere/scad-pub", env: {}, git }),
    "v1.4.0-3-gab12cd6"
  );
  // -C <dir> so the described repo is the one providing the ScadPub sources,
  // not whatever repo the consumer's build happens to run from.
  assert.deepEqual(git.calls, [
    {
      dir: "/somewhere/scad-pub",
      args: ["describe", "--tags", "--always", "--dirty"],
    },
  ]);
});

test("passes through git's tagged, untagged and dirty forms", () => {
  for (const out of ["v2.0.0", "ab12cd6", "v2.0.0-dirty", "ab12cd6-dirty"]) {
    assert.equal(scadpubVersion({ env: {}, git: gitStub(`${out}\n`) }), out);
  }
});

test("$SCADPUB_VERSION overrides git and skips the git call entirely", () => {
  const git = gitStub("v1.4.0\n");
  assert.equal(
    scadpubVersion({ env: { SCADPUB_VERSION: "2026.7.0" }, git }),
    "2026.7.0"
  );
  assert.deepEqual(git.calls, []);
});

test("an empty or blank override falls through to git", () => {
  for (const override of ["", "   "]) {
    assert.equal(
      scadpubVersion({ env: { SCADPUB_VERSION: override }, git: gitStub("v9\n") }),
      "v9"
    );
  }
});

test("returns undefined when git can't answer", () => {
  // git missing, not a repository, dubious ownership, no commits — all surface
  // as an empty run() result. A build must never fail over a missing stamp.
  assert.equal(scadpubVersion({ env: {}, git: gitStub("") }), undefined);
  assert.equal(scadpubVersion({ env: {}, git: gitStub("\n") }), undefined);
});

test("cleans up whatever it is handed", () => {
  // Only the first line, no control characters, whitespace collapsed.
  assert.equal(
    scadpubVersion({ env: {}, git: gitStub("v1.0.0\nwarning: something\n") }),
    "v1.0.0"
  );
  assert.equal(
    scadpubVersion({ env: { SCADPUB_VERSION: "  1.0  build  x " }, git: gitStub("") }),
    "1.0 build x"
  );
  // Length-capped, so a runaway value can't bloat the schema or the modal line.
  const long = "v".repeat(200);
  assert.equal(
    scadpubVersion({ env: { SCADPUB_VERSION: long }, git: gitStub("") }).length,
    64
  );
});

test("describes this checkout when it is a real git repository", (t) => {
  // Integration check against the actual repo — skipped where the tests run
  // from a git-less tree (release tarball, vendored copy), which is exactly the
  // case that must yield undefined rather than throw.
  let inRepo = true;
  try {
    execFileSync("git", ["-C", SCADPUB_DIR, "rev-parse", "--git-dir"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    inRepo = false;
  }
  if (!inRepo) {
    t.skip("not a git checkout");
    return;
  }
  const v = scadpubVersion({ env: {} });
  assert.equal(typeof v, "string");
  assert.ok(v.length > 0 && v.length <= 64, `unexpected version stamp ${JSON.stringify(v)}`);
});
