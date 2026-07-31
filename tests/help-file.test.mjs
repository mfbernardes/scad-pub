// Unit tests for scripts/lib/help-file.mjs's splitHelpMarkdown: the "whole
// help tab from one Markdown file" split rule (see docs/config.md "Sourcing
// help from Markdown files").
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitHelpMarkdown } from "../scripts/lib/help-file.mjs";

test("splitHelpMarkdown: content with no ## heading is all intro, no sections", () => {
  assert.deepEqual(splitHelpMarkdown("Just some intro text.\n\nMore prose."), {
    intro: "Just some intro text.\n\nMore prose.",
    sections: [],
  });
});

test("splitHelpMarkdown: intro before the first heading, one section per ## after it", () => {
  const md = [
    "Shared intro.",
    "",
    "## Pick a design",
    "",
    "Use the dropdown.",
    "",
    "## Adjust parameters",
    "",
    "The panel lists what you can change.",
    "",
  ].join("\n");
  assert.deepEqual(splitHelpMarkdown(md), {
    intro: "Shared intro.",
    sections: [
      { title: "Pick a design", body: "Use the dropdown." },
      { title: "Adjust parameters", body: "The panel lists what you can change." },
    ],
  });
});

test("splitHelpMarkdown: a heading at the very start yields a null intro", () => {
  const md = "## First section\n\nBody text.\n";
  assert.deepEqual(splitHelpMarkdown(md), {
    intro: null,
    sections: [{ title: "First section", body: "Body text." }],
  });
});

test("splitHelpMarkdown: a section's body may contain its own ### subheadings", () => {
  const md = "## Section\n\n### Not a split point\n\nStill this section's body.\n";
  const { sections } = splitHelpMarkdown(md);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, "Section");
  assert.equal(sections[0].body, "### Not a split point\n\nStill this section's body.");
});

test("splitHelpMarkdown: a bare '#' heading doesn't split either, and stays in intro", () => {
  const md = "# Document title\n\nIntro prose.\n\n## Real section\n\nBody.\n";
  assert.deepEqual(splitHelpMarkdown(md), {
    intro: "# Document title\n\nIntro prose.",
    sections: [{ title: "Real section", body: "Body." }],
  });
});

test("splitHelpMarkdown: heading text and section body are trimmed", () => {
  const md = "## Title with trailing space   \n\n   Body with padding.   \n";
  const { sections } = splitHelpMarkdown(md);
  assert.deepEqual(sections, [{ title: "Title with trailing space", body: "Body with padding." }]);
});

test("splitHelpMarkdown: CRLF line endings are normalised before splitting", () => {
  const md = "Intro.\r\n\r\n## Section\r\n\r\nBody.\r\n";
  assert.deepEqual(splitHelpMarkdown(md), {
    intro: "Intro.",
    sections: [{ title: "Section", body: "Body." }],
  });
});
