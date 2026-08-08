// configI18n.ts: projects config-authored `LocalizableText` leaves (see
// src/openscad/types.ts's own doc) to a plain string for one active locale
// tag. This is the ONLY place that resolves a `LocalizableText` value; every
// read site (HelpModal, PopupModal, FileBar, LicensesModal, useReadinessModel,
// App's design memo, DesignPicker) calls through here rather than reaching
// into a raw map by hand, so the fallback rule (`map[tag] ?? map[defaultTag]`)
// can't drift between call sites.
//
// Deliberately pure and side-effect free, like src/lib/designI18n.ts: given a
// raw value/object and a tag, return the resolved one. No React, no
// subscription — callers already re-run these through a `useLocale()`-backed
// memo (see each consumer's own comment).
import type {
  LocalizableText,
  HelpContent,
  HelpSection,
  HelpTab,
  ResolvedHelpContent,
  ResolvedHelpSection,
  ResolvedHelpTab,
  RawNoticeCategory,
  NoticeCategory,
  Design,
  LocalizedDesign,
} from "../openscad/types";
import { defaultTag } from "./i18n";

/**
 * Resolve one `LocalizableText` leaf for `tag`: a plain string applies to every
 * locale; an object resolves `map[tag]`, falling back to the deployment's
 * default locale's entry (gen-schema's `parseLocalizableText` guarantees that
 * entry exists — see docs/config.md "Localizing config text").
 */
export function lx(v: LocalizableText, tag: string): string {
  return typeof v === "string" ? v : (v[tag] ?? v[defaultTag]);
}

/** Like `lx`, but passes `null`/`undefined` through unchanged — for an
 *  optional `LocalizableText` field (`popup.footnote`, `fileImport.note`, …). */
export function lxOpt(v: LocalizableText | null | undefined, tag: string): string | undefined {
  return v == null ? undefined : lx(v, tag);
}

function lxSection(s: HelpSection, tag: string): ResolvedHelpSection {
  return { title: lx(s.title, tag), body: lx(s.body, tag) };
}

function lxTab(t: HelpTab, tag: string): ResolvedHelpTab {
  return {
    ...(t.id !== undefined ? { id: t.id } : {}),
    label: lx(t.label, tag),
    ...(t.intro !== undefined ? { intro: lx(t.intro, tag) } : {}),
    sections: t.sections.map((s) => lxSection(s, tag)),
  };
}

/** Deep-projects an entire `HelpContent` tree (title/intro/sections/tabs, and
 *  every tab's own intro/sections) to plain strings for `tag`. HelpModal calls
 *  this once, in a `[content, tag]` memo, rather than projecting piecemeal. */
export function lxHelp(help: HelpContent, tag: string): ResolvedHelpContent {
  return {
    ...(help.title !== undefined ? { title: lx(help.title, tag) } : {}),
    ...(help.intro !== undefined ? { intro: lx(help.intro, tag) } : {}),
    ...(help.sections !== undefined ? { sections: help.sections.map((s) => lxSection(s, tag)) } : {}),
    ...(help.tabs !== undefined ? { tabs: help.tabs.map((t) => lxTab(t, tag)) } : {}),
  };
}

/** Projects one config `notices[]` entry's `label` (the only localizable field
 *  on a notice category) to the plain-`{one,other}` shape `src/lib/i18n.ts`'s
 *  `selectPlural` — and everything downstream of it — already expects. */
export function lxNotice(n: RawNoticeCategory, tag: string): NoticeCategory {
  return { ...n, label: { one: lx(n.label.one, tag), other: lx(n.label.other, tag) } };
}

/** Projects a `Design`'s config-authored `label`/`group` to plain strings for
 *  `tag`, ahead of (see src/lib/designI18n.ts) a design's own sidecar
 *  translation. Every other field passes through unchanged. `group` stays
 *  absent when the raw design never had it at all (rather than becoming a
 *  present-but-`undefined` key), matching `LocalizedDesign.group`'s own
 *  optional shape. */
export function lxDesignEntry(d: Design, tag: string): LocalizedDesign {
  const { group, ...rest } = d;
  return {
    ...rest,
    label: lx(d.label, tag),
    ...(group !== undefined ? { group: group == null ? group : lx(group, tag) } : {}),
  };
}
