// Unit tests for Markdown's inline tokenizer (src/components/Markdown.tsx),
// specifically the single-asterisk *emphasis* support added alongside the
// pre-existing **bold**: this repo has no DOM-rendering test harness (see
// tests/gettingStarted.test.mjs's own doc), so — mirroring
// tests/errorBoundary.test.mjs's approach — this calls the plain function
// component directly and inspects the returned React element tree (a pure
// function of its `body` prop; no hooks are used), rather than mounting it.
import { test } from "node:test";
import assert from "node:assert/strict";

const { Markdown } = await import("../src/components/Markdown.tsx");

// Markdown() returns one block element per blank-line-separated paragraph;
// a single-paragraph body is a one-element array whose sole <p> holds the
// inline-tokenized children (a mix of strings and inline elements).
function paragraphChildren(body) {
  const blocks = Markdown({ body });
  assert.equal(blocks.length, 1, "expected a single paragraph block");
  const p = blocks[0];
  assert.equal(p.type, "p");
  const children = p.props.children;
  return Array.isArray(children) ? children : [children];
}

// Find the elements of a given type (e.g. "em", "strong") among a block's
// children, in order.
function elementsOfType(children, type) {
  return children.filter((c) => c && typeof c === "object" && c.type === type);
}

test("*emphasis* renders as a single <em>, not literal asterisks", () => {
  const children = paragraphChildren("Some *emphasis* here.");
  const ems = elementsOfType(children, "em");
  assert.equal(ems.length, 1);
  assert.equal(ems[0].props.children, "emphasis");
  // No raw asterisk survives in any text chunk.
  for (const c of children) {
    if (typeof c === "string") assert.ok(!c.includes("*"), `unexpected literal asterisk in "${c}"`);
  }
});

test("**bold** still renders as <strong>, not <em> (the ** alternative must win)", () => {
  const children = paragraphChildren("Some **bold** text.");
  const strongs = elementsOfType(children, "strong");
  const ems = elementsOfType(children, "em");
  assert.equal(strongs.length, 1);
  assert.equal(strongs[0].props.children, "bold");
  assert.equal(ems.length, 0, "a **bold** pair must not also produce an <em>");
});

test("**bold** and *emphasis* coexist in the same string", () => {
  const children = paragraphChildren("**bold** and *emphasis* together.");
  const strongs = elementsOfType(children, "strong");
  const ems = elementsOfType(children, "em");
  assert.equal(strongs.length, 1);
  assert.equal(strongs[0].props.children, "bold");
  assert.equal(ems.length, 1);
  assert.equal(ems[0].props.children, "emphasis");
});

test("a lone asterisk (no closing pair) renders literally", () => {
  const children = paragraphChildren("3 * 4 = 12, not a typo.");
  const ems = elementsOfType(children, "em");
  assert.equal(ems.length, 0);
  const text = children.filter((c) => typeof c === "string").join("");
  assert.ok(text.includes("*"), "the lone asterisk should survive as plain text");
});
