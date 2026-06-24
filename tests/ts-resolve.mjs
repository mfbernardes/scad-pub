// Module resolution hook for the unit tests: lets Node's built-in TypeScript
// type-stripping load the app's source, which uses extensionless relative
// imports (e.g. `./scad`, resolved by Vite at build time). When such a specifier
// has no extension, we try the matching `.ts` file. Registered via
// tests/register-ts.mjs (node --import).
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as joinPath } from "node:path";

const HAS_EXT = /\.[cm]?[jt]sx?$/;

export async function resolve(specifier, context, next) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !HAS_EXT.test(specifier) &&
    context.parentURL?.startsWith("file:")
  ) {
    const candidate = joinPath(
      dirname(fileURLToPath(context.parentURL)),
      specifier + ".ts"
    );
    if (existsSync(candidate)) {
      return next(pathToFileURL(candidate).href, context);
    }
  }
  return next(specifier, context);
}
