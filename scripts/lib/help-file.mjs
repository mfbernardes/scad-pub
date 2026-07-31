// help-file.mjs: splitHelpMarkdown: the "whole help tab (or single-pane
// help) from one Markdown file" split rule (see docs/config.md "Sourcing
// help from Markdown files" and config-spec.mjs's `help` node comment).
// Content before the first level-2 (`##`) heading becomes `intro`; each `##`
// heading after that starts a `{ title, body }` section running up to the
// next `##` heading or the end of the file. This maps exactly onto the
// existing `help.sections`/`help.tabs[].sections` shape, so a config author
// writes one readable Markdown file per pane instead of a handful of
// `\n\n`-joined JSON string literals.
//
// Deliberately only `##` (not `#`/`###`) so a file can use a leading `#`
// for its own title (left as ordinary text inside `intro`) and `###` for
// finer structure WITHIN a section's body without either being mistaken for
// a section boundary.
const H2_HEADING = /^##(?!#)[ \t]+(.+?)[ \t]*$/gm;

/**
 * @param {string} content raw Markdown file content
 * @returns {{ intro: string|null, sections: { title: string, body: string }[] }}
 */
export function splitHelpMarkdown(content) {
  const text = content.replace(/\r\n/g, "\n");
  const headings = [...text.matchAll(H2_HEADING)];
  const introEnd = headings.length ? headings[0].index : text.length;
  const intro = text.slice(0, introEnd).trim();
  const sections = headings.map((heading, i) => {
    const bodyStart = heading.index + heading[0].length;
    const bodyEnd = i + 1 < headings.length ? headings[i + 1].index : text.length;
    return { title: heading[1].trim(), body: text.slice(bodyStart, bodyEnd).trim() };
  });
  return { intro: intro || null, sections };
}
