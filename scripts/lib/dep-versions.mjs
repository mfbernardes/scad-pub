// dep-versions.mjs (build side): the installed versions of the third-party
// packages the app actually bundles, read at build time and emitted as
// schema.componentVersions for the open-source licenses modal.
//
// Why not read them in the app? Two reasons:
//   - Importing a version constant from the package itself (`three`'s REVISION)
//     drags that package into the modal's eager chunk. Verified: it added a
//     196kB three.core chunk to index.html's modulepreload links, defeating the
//     Viewer's lazy-load split.
//   - Hand-copied version literals drift silently. They did: the modal claimed
//     React 18.3 long after the app moved to 19.x. An attribution notice that
//     names the wrong version is worse than one that names none.
//
// So the versions come from the same node_modules Vite bundles from, resolved
// against THIS checkout (see version.mjs on why the ScadPub dir, not the cwd):
// a consumer project's build stamps whatever its own install resolved.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { SCADPUB_DIR } from "./version.mjs";

/**
 * The bundled runtime packages the built-in attributions name. Build-only
 * tooling (Vite, TypeScript, …) isn't served, so it isn't listed here or in
 * src/lib/licenses.ts. Keep the two in step: an entry here with no attribution
 * is dead weight, and an attribution whose version never resolves shows none.
 */
export const BUNDLED_PACKAGES = [
  "three",
  "react",
  "react-dom",
  "@fontsource/atkinson-hyperlegible",
  "@radix-ui/react-alert-dialog",
  "@radix-ui/react-checkbox",
  "@radix-ui/react-dialog",
  "@radix-ui/react-label",
  "@radix-ui/react-popover",
  "@radix-ui/react-progress",
  "@radix-ui/react-select",
  "@radix-ui/react-slider",
  "@radix-ui/react-slot",
  "@radix-ui/react-switch",
  "@radix-ui/react-tabs",
  "@radix-ui/react-tooltip",
  "lucide-react",
  "sonner",
  "clsx",
  "tailwind-merge",
  "class-variance-authority",
];

/**
 * The installed version of one package, or undefined when it can't be read.
 * Tries `<name>/package.json` first, then walks up from the resolved entry
 * point: packages with an `exports` map can refuse the direct path (three
 * does), so the walk-up is the load-bearing path, not a rare fallback.
 */
function packageVersion(name, req) {
  const read = (file) => {
    try {
      return JSON.parse(readFileSync(file, "utf-8"));
    } catch {
      return null;
    }
  };
  try {
    const json = read(req.resolve(`${name}/package.json`));
    if (json?.version) return json.version;
  } catch {
    /* exports-restricted or absent: try the entry point below */
  }
  let dir;
  try {
    dir = dirname(req.resolve(name));
  } catch {
    return undefined;
  }
  // Bounded walk to the package root: node_modules/<name>/<...>/entry.js is
  // shallow, and the loop stops at the filesystem root regardless.
  for (let i = 0; i < 12; i++) {
    const file = join(dir, "package.json");
    // Stop at the first package.json that actually names this package, so a
    // nested one (a package's own sub-entry) can't be mistaken for the root.
    if (existsSync(file)) {
      const json = read(file);
      if (json?.name === name && json.version) return json.version;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return undefined;
}

/**
 * Installed versions of the bundled packages, keyed by package name. Packages
 * that can't be resolved are absent (their attribution then shows no
 * version rather than a stale one): a missing bundled dependency fails the
 * vite build a moment later on its own, so this is not the place to throw.
 * @param {object} [opts]
 * @param {string} [opts.dir]  Checkout whose node_modules to resolve against.
 * @param {string[]} [opts.packages]  Package list (tests inject).
 * @returns {Record<string, string>}
 */
export function componentVersions({ dir = SCADPUB_DIR, packages = BUNDLED_PACKAGES } = {}) {
  const req = createRequire(join(dir, "package.json"));
  const out = {};
  for (const name of packages) {
    const version = packageVersion(name, req);
    if (version) out[name] = version;
  }
  return out;
}
