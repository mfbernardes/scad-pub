// Module resolution hook for the unit tests: lets Node's built-in TypeScript
// type-stripping load the app's source, which uses extensionless relative
// imports (e.g. `./scad`, resolved by Vite at build time). When such a specifier
// has no extension, we try the matching `.ts` file. Registered via
// tests/register-ts.mjs (node --import).
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as joinPath } from "node:path";

const HAS_EXT = /\.[cm]?[jt]sx?$/;
// src/ dir, for resolving the `@/…` alias (mirrors tsconfig paths + vite alias)
// so tests can import alias-using source.
const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url));

// Resolve a base path (no extension) to an existing .ts/.tsx file, or null.
function resolveTs(base) {
  for (const ext of [".ts", ".tsx"]) if (existsSync(base + ext)) return base + ext;
  return null;
}

export async function resolve(specifier, context, next) {
  // `@/foo` alias -> src/foo(.ts|.tsx)
  if (specifier.startsWith("@/")) {
    const base = joinPath(SRC_DIR, specifier.slice(2));
    const hit = HAS_EXT.test(specifier) ? base : resolveTs(base);
    if (hit) return next(pathToFileURL(hit).href, context);
  }
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !HAS_EXT.test(specifier) &&
    context.parentURL?.startsWith("file:")
  ) {
    const base = joinPath(dirname(fileURLToPath(context.parentURL)), specifier);
    const hit = resolveTs(base);
    if (hit) return next(pathToFileURL(hit).href, context);
  }
  return next(specifier, context);
}
