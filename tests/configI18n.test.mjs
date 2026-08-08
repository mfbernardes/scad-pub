// Tests src/lib/configI18n.ts: the projection layer for config-authored
// `LocalizableText` leaves (see src/openscad/types.ts's own doc and
// docs/config.md's "Localizing config text"). Pure functions, no React —
// `lx`/`lxOpt`/`lxHelp`/`lxNotice`/`lxDesignEntry` all just resolve a raw
// value/object to a plain string for one locale tag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lx, lxOpt, lxHelp, lxNotice, lxDesignEntry } from "../src/lib/configI18n.ts";
import { defaultTag } from "../src/lib/i18n.ts";

// This repo's own build (src/generated/designs.json) is single-locale, so
// i18n.ts's `defaultTag` resolves to "en" — asserted here once so the rest of
// this file's fallback-matrix tests (which rely on that value as the
// fallback target) fail loudly, not confusingly, if that ever changes.
test("sanity: this repo's own defaultTag is \"en\"", () => {
  assert.equal(defaultTag, "en");
});

test("lx(): a plain string applies to every locale", () => {
  assert.equal(lx("Hello", "en"), "Hello");
  assert.equal(lx("Hello", "de"), "Hello");
  assert.equal(lx("Hello", "fr"), "Hello");
});

test("lx(): an object resolves the active tag's entry", () => {
  const v = { en: "Hello", de: "Hallo" };
  assert.equal(lx(v, "en"), "Hello");
  assert.equal(lx(v, "de"), "Hallo");
});

test("lx(): an object missing the active tag falls back to defaultTag's entry", () => {
  const v = { en: "Hello", de: "Hallo" };
  // "fr" isn't a key in `v` at all: falls back to defaultTag ("en").
  assert.equal(lx(v, "fr"), "Hello");
});

test("lxOpt(): passes null/undefined through unchanged", () => {
  assert.equal(lxOpt(null, "en"), undefined);
  assert.equal(lxOpt(undefined, "en"), undefined);
});

test("lxOpt(): resolves a present value exactly like lx()", () => {
  assert.equal(lxOpt("Hi", "de"), "Hi");
  assert.equal(lxOpt({ en: "Hi", de: "Hallo" }, "de"), "Hallo");
});

test("lxHelp(): deep-projects title/intro/sections/tabs to plain strings", () => {
  const help = {
    title: { en: "Guide", de: "Anleitung" },
    intro: "Shared intro.",
    sections: [{ title: { en: "Start", de: "Beginn" }, body: "Body text." }],
    tabs: [
      {
        id: "printing",
        label: { en: "Printing", de: "Drucken" },
        intro: { en: "Tips.", de: "Tipps." },
        sections: [{ title: "Material", body: { en: "Use PLA.", de: "Nutze PLA." } }],
      },
    ],
  };
  const en = lxHelp(help, "en");
  assert.deepEqual(en, {
    title: "Guide",
    intro: "Shared intro.",
    sections: [{ title: "Start", body: "Body text." }],
    tabs: [
      {
        id: "printing",
        label: "Printing",
        intro: "Tips.",
        sections: [{ title: "Material", body: "Use PLA." }],
      },
    ],
  });
  const de = lxHelp(help, "de");
  assert.deepEqual(de, {
    title: "Anleitung",
    intro: "Shared intro.",
    sections: [{ title: "Beginn", body: "Body text." }],
    tabs: [
      {
        id: "printing",
        label: "Drucken",
        intro: "Tipps.",
        sections: [{ title: "Material", body: "Nutze PLA." }],
      },
    ],
  });
});

test("lxHelp(): omits a field entirely when the raw content omits it", () => {
  const help = { sections: [{ title: "T", body: "B" }] };
  const resolved = lxHelp(help, "en");
  assert.equal("title" in resolved, false);
  assert.equal("intro" in resolved, false);
  assert.equal("tabs" in resolved, false);
  assert.deepEqual(resolved.sections, [{ title: "T", body: "B" }]);
});

test("lxHelp(): a tab with no id is projected without one", () => {
  const help = { tabs: [{ label: "One", sections: [] }] };
  const resolved = lxHelp(help, "en");
  assert.equal("id" in resolved.tabs[0], false);
  assert.equal(resolved.tabs[0].label, "One");
});

test("lxNotice(): projects label.one/label.other to plain strings, keeping every other field", () => {
  const n = {
    marker: "alert",
    label: { one: { en: "alert", de: "Warnung" }, other: { en: "alerts", de: "Warnungen" } },
    color: "#e0a458",
    attention: true,
    subsumedByFont: true,
  };
  assert.deepEqual(lxNotice(n, "en"), {
    marker: "alert",
    label: { one: "alert", other: "alerts" },
    color: "#e0a458",
    attention: true,
    subsumedByFont: true,
  });
  assert.deepEqual(lxNotice(n, "de"), {
    marker: "alert",
    label: { one: "Warnung", other: "Warnungen" },
    color: "#e0a458",
    attention: true,
    subsumedByFont: true,
  });
});

test("lxNotice(): a plain-string label (the pre-i18n shorthand) still resolves for every locale", () => {
  const n = { marker: "note", label: { one: "note", other: "notes" } };
  assert.deepEqual(lxNotice(n, "de"), { marker: "note", label: { one: "note", other: "notes" } });
});

test("lxDesignEntry(): projects label and group, passing every other field through", () => {
  const design = {
    id: "tag",
    label: { en: "Tag", de: "Etikett" },
    group: { en: "Signage", de: "Beschilderung" },
    file: "tag.scad",
    presets: [],
    sections: ["Size"],
    params: [],
  };
  const en = lxDesignEntry(design, "en");
  assert.equal(en.label, "Tag");
  assert.equal(en.group, "Signage");
  assert.equal(en.file, "tag.scad");
  const de = lxDesignEntry(design, "de");
  assert.equal(de.label, "Etikett");
  assert.equal(de.group, "Beschilderung");
});

test("lxDesignEntry(): a plain-string label/group is unaffected, and a null/absent group passes through", () => {
  const design = { id: "tag", label: "Tag", file: "tag.scad", presets: [], sections: [], params: [], group: null };
  assert.equal(lxDesignEntry(design, "en").label, "Tag");
  assert.equal(lxDesignEntry(design, "en").group, null);
  const noGroup = { id: "tag", label: "Tag", file: "tag.scad", presets: [], sections: [], params: [] };
  assert.equal("group" in lxDesignEntry(noGroup, "en"), false);
});

// Pseudo-locale sanity: a tag nobody configured (not in the map, not
// "defaultTag") never crashes — it just falls back to defaultTag's entry,
// same as any other unmapped tag (lx's own fallback rule, exercised above
// with "fr"; repeated here against a deliberately made-up tag to guard
// against a future change coupling the fallback to a fixed allow-list).
test("pseudo-locale sanity: an unrecognised tag still resolves via the defaultTag fallback, never throws", () => {
  const v = { en: "Hello", de: "Hallo" };
  assert.doesNotThrow(() => lx(v, "xx-PSEUDO"));
  assert.equal(lx(v, "xx-PSEUDO"), "Hello");
});
