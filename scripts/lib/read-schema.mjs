// read-schema.mjs: read the generated designs.json for the BUILD side (vite.config.ts).
//
// `strict` fails loudly instead of falling back. In a real build a missing or
// corrupt designs.json means the gen-schema prebuild step didn't run or didn't
// finish, and quietly shipping the "scadpub"/"3mf" defaults produces a site
// whose storage namespace, title, theme colour and export format all belong to
// no config at all. The lenient path stays for the dev server, where a
// half-written file between two saves is ordinary.
//
// Its own module rather than a closure inside vite.config.ts so the two paths
// can be driven from a test without loading Vite and its plugin graph.
import { readFileSync } from "node:fs";

/**
 * @param {string} absPath
 * @param {boolean} [strict]
 * @returns {Promise<import("./read-schema.d.mts").BuildSchema>}
 */
export async function readGeneratedSchema(absPath, strict = false) {
  try {
    const parsed = JSON.parse(readFileSync(absPath, "utf-8"));
    // Parseable is not the same as usable. `null`, an array and a bare number
    // all parse, and so does `{}` — and `{}` was the interesting one, because
    // every field the build reads is optional here, so an empty object silently
    // built a site whose title, storage namespace, theme colour and export
    // format all came from fallbacks and belonged to no config at all. The app
    // then rejected the same file at startup, so the failure surfaced as a
    // deployed site that would not boot.
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      throw new TypeError(`expected a JSON object, got ${Array.isArray(parsed) ? "an array" : typeof parsed}`);
    // THE app's validator, not a second opinion: src/lib/schema.ts states the
    // contract, and anything this accepts has to boot. A hand-written subset
    // here was the previous attempt and it drifted immediately — it passed
    // `{ id, title, designs: [{ id }], format }`, which validateSchema rejects
    // for missing `features`/`fonts`/`assets` and an incomplete design, so the
    // build succeeded and the deployed app did not start.
    //
    // Imported as TypeScript: Node strips the types (the repo already requires
    // that for its test suite, see CLAUDE.md), and schema.ts's only value
    // import is helpShape.mjs, so nothing app-side is dragged in.
    if (strict) {
      const { validateSchema } = await import("../../src/lib/schema.ts");
      validateSchema(parsed);
    }
    return parsed;
  } catch (e) {
    if (strict)
      throw new Error(
        `vite: src/generated/designs.json is missing or unreadable — run gen-schema first ` +
          `(the prebuild/predev hooks do). ${e.message}`,
        { cause: e }
      );
    return {};
  }
}
