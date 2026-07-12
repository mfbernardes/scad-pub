// Module resolution + load hooks for the unit tests: lets Node's built-in
// TypeScript type-stripping load the app's source, which uses extensionless
// relative imports (e.g. `./scad`, resolved by Vite at build time). When such a
// specifier has no extension, we try the matching `.ts`/`.tsx` file. `.tsx`
// files carry JSX, which Node's native strip-types neither registers as a
// loadable extension nor transforms, so the `load` hook below transpiles them
// with the TypeScript compiler (already a devDependency) using the automatic
// JSX runtime — matching tsconfig's `jsx: "react-jsx"`. Registered via
// tests/register-ts.mjs (node --import).
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as joinPath } from "node:path";
import ts from "typescript";

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

// Transpile `.tsx` source (types + JSX) to ESM. Node's native type-stripping
// only registers `.ts`/`.cts`/`.mts` and can't lower JSX, so those files reach
// here and are compiled with the automatic JSX runtime (`react/jsx-runtime`).
// Plain `.ts` and everything else fall through to the default loader.
export async function load(url, context, next) {
  if (url.startsWith("file:") && url.endsWith(".tsx")) {
    const source = readFileSync(fileURLToPath(url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: fileURLToPath(url),
    });
    return { format: "module", source: outputText, shortCircuit: true };
  }
  return next(url, context);
}
