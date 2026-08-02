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

const isSection = (x) =>
  !!x && typeof x === "object" && typeof x.title === "string" && typeof x.body === "string";
const isSectionList = (x) => Array.isArray(x) && x.every(isSection);

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
  if (h.title !== undefined && typeof h.title !== "string") fail("'help.title' must be a string");
  if (h.intro !== undefined && typeof h.intro !== "string") fail("'help.intro' must be a string");
  if (h.sections !== undefined && !isSectionList(h.sections))
    fail("'help.sections' must be an array of { title, body }");
  if (h.tabs !== undefined) {
    if (
      !Array.isArray(h.tabs) ||
      !h.tabs.every(
        (t) =>
          !!t &&
          typeof t === "object" &&
          typeof t.label === "string" &&
          (t.intro === undefined || typeof t.intro === "string") &&
          isSectionList(t.sections)
      )
    )
      fail("'help.tabs' must be an array of { label, intro?, sections: [{ title, body }] }");
  }
  // A help block that offers neither is a modal with nothing in it. Checked
  // last so the more specific message above wins when both apply.
  if (h.sections === undefined && h.tabs === undefined)
    fail("'help' must provide 'sections' or 'tabs'");
}
