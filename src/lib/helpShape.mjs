// helpShape.mjs: the structural contract for the `help` block, in one place.
//
// src/lib/schema.ts had the full contract and gen-schema had two of its checks,
// so a `help` that was merely object-shaped built green and was rejected by the
// runtime validator — which runs during app-module initialisation, so several
// of those cases did not fail a page, they failed the whole boot. "Malformed
// help fails the build" was the intent; `{}`, `{ tabs: "bad" }`,
// `{ sections: [{ title: 42 }] }` and `{ tabs: [{ sections: [] }] }` all
// disproved it.
//
// `.mjs` for the same reason showIfSyntax.mjs is: gen-schema is plain Node and
// cannot import TypeScript, and a contract that has to hold at build time and
// at runtime cannot be written twice and stay one contract.

// A `LocalizableText` leaf (src/openscad/types.ts's own doc): a plain string,
// or an object whose own values are all strings (a locale tag -> string map).
// Doesn't check the object form's build-time invariants (must include the
// default tag, every key a shipped locale) — gen-schema's own
// `parseLocalizableText` (scripts/lib/config-parsers.mjs) does, ahead of this
// shape check; this only guards what `src/lib/configI18n.ts`'s `lx` indexes into.
const isLocalizableText = (x) =>
  typeof x === "string" ||
  (!!x && typeof x === "object" && !Array.isArray(x) && Object.values(x).every((v) => typeof v === "string"));

const isSection = (x) =>
  !!x && typeof x === "object" && isLocalizableText(x.title) && isLocalizableText(x.body);
const isSectionList = (x) => Array.isArray(x) && x.every(isSection);

// The id the Overview tab HelpModal synthesizes (top-level `sections`
// alongside `tabs`) uses, and `ui.afterExport.helpTab` may reference. A real
// config tab claiming it would collide with that synthetic tab, so it's
// rejected here rather than silently shadowed at render time.
export const OVERVIEW_TAB_ID = "overview";

/**
 * Check `help` against the contract, reporting through `fail`. Reports every
 * problem through the caller's own reporter rather than throwing its own error,
 * so the build says `gen-schema: …` with the config path and the runtime says
 * what it has always said.
 *
 * `help` is assumed non-null; both callers guard that themselves (absent help
 * is valid, and each has its own opinion of what to return for it).
 *
 * @param {unknown} help
 * @param {(msg: string) => never} fail
 */
export function checkHelpShape(help, fail) {
  if (typeof help !== "object" || Array.isArray(help))
    fail("'help' must be { title?, intro?, sections?, tabs? } or null");
  const h = /** @type {Record<string, unknown>} */ (help);
  if (h.title !== undefined && !isLocalizableText(h.title)) fail("'help.title' must be a string");
  if (h.intro !== undefined && !isLocalizableText(h.intro)) fail("'help.intro' must be a string");
  if (h.sections !== undefined && !isSectionList(h.sections))
    fail("'help.sections' must be an array of { title, body }");
  if (h.tabs !== undefined) {
    if (!Array.isArray(h.tabs))
      fail("'help.tabs' must be an array of { id?, label, intro?, sections: [{ title, body }] }");
    const tabs = /** @type {unknown[]} */ (h.tabs);
    const seenIds = new Set();
    tabs.forEach((raw, i) => {
      if (
        !raw ||
        typeof raw !== "object" ||
        !isLocalizableText((/** @type {Record<string, unknown>} */ (raw)).label) ||
        ((/** @type {Record<string, unknown>} */ (raw)).intro !== undefined &&
          !isLocalizableText((/** @type {Record<string, unknown>} */ (raw)).intro)) ||
        !isSectionList((/** @type {Record<string, unknown>} */ (raw)).sections)
      )
        fail("'help.tabs' must be an array of { id?, label, intro?, sections: [{ title, body }] }");
      const tab = /** @type {Record<string, unknown>} */ (raw);
      if (tab.id === undefined) return;
      if (typeof tab.id !== "string" || !tab.id.trim())
        fail(`'help.tabs[${i}].id', when set, must be a non-empty string`);
      if (tab.id === OVERVIEW_TAB_ID)
        fail(
          `'help.tabs[${i}].id' is "${OVERVIEW_TAB_ID}", which is reserved for the synthetic ` +
            `Overview tab (the leading tab HelpModal synthesizes from top-level 'help.sections')`
        );
      if (seenIds.has(tab.id))
        fail(`'help.tabs[${i}].id' (${JSON.stringify(tab.id)}) duplicates an earlier tab's id`);
      seenIds.add(tab.id);
    });
  }
  // A help block that offers neither is a modal with nothing in it. Checked
  // last so the more specific message above wins when both apply.
  if (h.sections === undefined && h.tabs === undefined)
    fail("'help' must provide 'sections' or 'tabs'");
}
