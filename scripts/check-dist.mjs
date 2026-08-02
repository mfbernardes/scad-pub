// check-dist.mjs: assert the things a build can silently fail to do.
//
// Two closeBundle plugins in vite.config.ts write into dist/ after the bundle
// is emitted: `sw-version` stamps the per-build version into sw.js, and
// `security-headers` appends the app CSP block (with hashes computed from the
// built HTML) to _headers. Both used to swallow every error, so a build could
// exit 0 having shipped a service worker that never triggers an update prompt,
// or a site with no CSP at all. Those catches are narrowed now; this is the
// check that says so out loud, from the artifact rather than from the code.
//
// Run after `npm run build` (CI does). Exits non-zero with a named failure.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeCheck } from "./lib/check.mjs";

const DIST = resolve(process.argv[2] ?? "dist");
// The generated schema is an input of THIS checkout, not an artifact of the
// tree being checked: deriving it from DIST's parent made
// `check-dist.mjs /tmp/site` read /tmp/src/generated/designs.json and throw,
// while every artifact path below honoured the argument correctly.
const SCHEMA = fileURLToPath(new URL("../src/generated/designs.json", import.meta.url));
const { check, state } = makeCheck();

console.log("=== built artifact ===");

const indexPath = resolve(DIST, "index.html");
check(existsSync(indexPath), "dist/index.html exists");

const swPath = resolve(DIST, "sw.js");
if (check(existsSync(swPath), "dist/sw.js exists")) {
  const sw = readFileSync(swPath, "utf-8");
  check(
    !sw.includes("__SW_VERSION__"),
    "sw.js carries a real build version (the __SW_VERSION__ placeholder was substituted)"
  );
  const version = /const VERSION = "([^"]*)"/.exec(sw)?.[1];
  check(!!version && version.length >= 8, `sw.js VERSION looks like a build hash (${version})`);
}

const headersPath = resolve(DIST, "_headers");
if (check(existsSync(headersPath), "dist/_headers exists")) {
  const headers = readFileSync(headersPath, "utf-8");
  check(headers.includes("/*"), "_headers declares the app-wide /* block");
  check(
    /Content-Security-Policy:/i.test(headers),
    "_headers carries a Content-Security-Policy"
  );
  check(
    /script-src[^\n]*'sha256-/.test(headers),
    "the CSP's script-src pins the inline pre-paint script by hash"
  );
}

// vite.config.ts makes `viewer.style` a compile-time define specifically so a
// `plain` build drops the studio rig. That contract is invisible to every other
// gate — the app runs fine either way — and it was broken once by passing the
// style into buildStudioRig as an ordinary argument, which made the branch
// reachable and shipped PMREM, the contact shadow and its blur shader to every
// plain deployment. Asserted on the built bytes, since that is the only place
// the answer exists.
const viewerChunk = readdirSync(resolve(DIST, "assets")).find((f) =>
  /^Viewer-.*\.js$/.test(f)
);
if (check(!!viewerChunk, "the built Viewer chunk exists")) {
  const style = /"viewer"\s*:\s*\{[^}]*"style"\s*:\s*"([^"]+)"/.exec(
    readFileSync(SCHEMA, "utf-8")
  )?.[1];
  const js = readFileSync(resolve(DIST, "assets", viewerChunk), "utf-8");
  // Markers unique to the studio rig: the contact shadow's own factory and blur
  // shader, and the environment shader's uniform names (three's core carries
  // the word "PMREM" in its cubeUV chunks whatever we do, so that is not one).
  const studioOnly = ["createContactShadow", "HorizontalBlurShader", "edge0"].filter((m) =>
    js.includes(m)
  );
  if (style === "studio")
    check(studioOnly.length > 0, "a studio build keeps the studio rig");
  else
    check(
      studioOnly.length === 0,
      `a plain build prunes the studio rig (found ${JSON.stringify(studioOnly)})`
    );
}

console.log(state.failures ? `\nDIST CHECK FAIL ❌ (${state.failures})` : "\nDIST CHECK PASS ✅");
process.exit(state.failures ? 1 : 0);
