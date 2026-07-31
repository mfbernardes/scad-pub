// version.mjs (build side): the ScadPub version stamped into a build and shown
// in the app's open-source licenses modal ("which ScadPub built this site?").
//
// ScadPub is infrastructure: a deployment is usually built from *another*
// project (a fork carrying its own designs, or ScadPub vendored/submoduled next
// to a consumer config). So the version is read from the git metadata of THIS
// checkout (the tree these build scripts themselves live in) never from the
// process's cwd, which is the consumer's repo root. `git -C <scadpub dir>`
// describes whichever repository actually provides the ScadPub sources being
// built, including when that is a submodule with its own history.
//
// Resolution order:
//   1. $SCADPUB_VERSION. Explicit override. Needed when the build tree has no
//      git metadata at all (release tarball, `docker COPY`, npm-packed tree),
//      and when ScadPub is vendored as plain files into a consumer repo whose
//      tags describe the consumer's app rather than ScadPub.
//   2. `git describe --tags --always --dirty`: "v1.4.0" on a tagged commit,
//      "v1.4.0-3-gab12cd6" past one, the abbreviated commit ("ab12cd6") when the
//      checkout has no tags at all (e.g. a shallow CI clone: fetch tags, or
//      fetch-depth: 0, for the tag form), plus "-dirty" for a modified tree.
//   3. undefined. No git, no repository, no override. The stamp is
//      omitted from the schema and the modal shows no version line.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** This checkout's root (scripts/lib/ -> repo root): the tree we describe. */
export const SCADPUB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Longest version string we keep; anything beyond is a mistake, not a version. */
const MAX_LEN = 64;

/**
 * A version string fit for a schema field and a line of UI text: first line
 * only, no control characters, whitespace collapsed, length-capped. Returns ""
 * when nothing usable is left (the caller then falls through / omits the stamp).
 * Applied to the operator-supplied override too, not only git's output.
 */
function clean(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .split("\n")[0]
    // Control characters (C0/C1) can never be part of a git ref or a
    // sensible override, and would corrupt the JSON/UI line.
    // eslint-disable-next-line no-control-regex -- deliberate: strip them
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LEN);
}

/**
 * Run git in `dir`, returning stdout, or "" for any failure: git missing, no
 * repository, an unreadable/"dubious ownership" checkout, a repo with no
 * commits. A build must never fail over a missing version stamp.
 */
function runGit(dir, args) {
  try {
    return execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      // Inherit nothing on stdin, capture stdout, discard git's diagnostics.
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
  } catch {
    return "";
  }
}

/**
 * The ScadPub version for this build, or undefined when it can't be determined.
 * @param {object} [opts]
 * @param {string} [opts.dir]  Checkout to describe (default: this one).
 * @param {Record<string,string|undefined>} [opts.env]  Environment to read the override from.
 * @param {(dir: string, args: string[]) => string} [opts.git]  Git runner (tests inject).
 */
export function scadpubVersion({ dir = SCADPUB_DIR, env = process.env, git = runGit } = {}) {
  const override = clean(env.SCADPUB_VERSION);
  if (override) return override;
  return clean(git(dir, ["describe", "--tags", "--always", "--dirty"])) || undefined;
}
