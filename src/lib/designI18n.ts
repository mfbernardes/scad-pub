// designI18n.ts: project a design-translation sidecar
// (`<design>.strings.<tag>.json`, see docs/config.md "Design translations")
// onto a parsed `Design`. Pure and side-effect free: `localizeDesign` is the
// one place that turns "a design" + "a maybe-translation" into "the design a
// non-default locale should show", so every read site (ParamForm,
// paramGroups, DimensionInfo, ReviewDialog/reviewSummary, ResetButton,
// ViewerEditOnModel, DesignDocModal, DesignPicker, …) keeps reading
// `design.*` completely unchanged — App.tsx calls this once, in its design
// memo (right after `src/lib/configI18n.ts`'s `lxDesignEntry`, which resolves
// the config-authored `label`/`group` first), and everything downstream is
// oblivious to either projection having happened.
//
// gen-schema.mjs's scripts/lib/design-strings.mjs validates a sidecar at
// BUILD time against the design it translates (unknown param/section/choice,
// stale key, …); this module trusts that a `DesignStrings` it's handed
// already passed that check — it does no validation of its own, only
// substitution.
import type { LocalizedDesign, Param } from "../openscad/types";

/** One parameter's translatable fields — a subset of `Param`'s own shape
 *  (see scripts/lib/design-strings.mjs's PARAM_KEYS): `choices` keys off the
 *  declared enum VALUE (never relabeled), `info` mirrors `Param.info`'s two
 *  fields. */
export interface DesignParamStrings {
  description?: string;
  help?: string;
  choices?: Record<string, string>;
  info?: { label?: string; unit?: string };
}

/** One design's translation sidecar, exactly the shape
 *  scripts/lib/design-strings.mjs validates (see its own doc, and
 *  docs/config.md "Design translations"). Every field optional: a sidecar
 *  translates only what it sets, everything else stays in the design's own
 *  (authored) language. */
export interface DesignStrings {
  /** Translates the design's file-level `// @description`. */
  description?: string;
  /** Section NAME -> translated name. Renames `Design.sections`,
   *  `Design.collapsedSections` and every `Param.section` coherently: a
   *  section translated here moves everywhere it's referenced; one left out
   *  keeps its original (authored) name everywhere. */
  sections?: Record<string, string>;
  /** Parameter NAME (never translated itself) -> its translatable fields. */
  params?: Record<string, DesignParamStrings>;
  /** Curated review-summary label overrides, keyed by parameter name (see
   *  `Design.reviewLabels`). */
  reviewLabels?: Record<string, string>;
  /** Translates the design's file-level `// @reviewNote`. */
  reviewNote?: string;
  /** Source ECHO'd string (as the design's own `.scad` literally wrote it,
   *  e.g. an `echo("@info", "Total width", …)` label) -> its translation.
   *  Free-form: gen-schema cannot cross-check these against anything static,
   *  see design-strings.mjs's own comment. Looked up at display time by
   *  `localizeEcho`, not applied by `localizeDesign` (nothing in `Design`
   *  carries a source ECHO string to replace). */
  echo?: Record<string, string>;
}

/** The generated `src/generated/i18n/<tag>.json` shape: every translated
 *  design for one locale tag, keyed by design id. Written for every shipped
 *  locale tag by gen-schema (empty `designs: {}` when none translate). */
export interface DesignI18nFile {
  designs: Record<string, DesignStrings>;
}

// Whether `s` has anything that could change a `LocalizedDesign` (i.e.
// localizeDesign has real work to do). `echo` is deliberately excluded: it
// never touches the design object itself (see localizeEcho below), so a
// sidecar that sets ONLY `echo` entries still means "nothing to project here,
// hand back the same reference".
function affectsDesign(s: DesignStrings): boolean {
  return (
    s.description !== undefined ||
    (s.sections !== undefined && Object.keys(s.sections).length > 0) ||
    (s.params !== undefined && Object.keys(s.params).length > 0) ||
    (s.reviewLabels !== undefined && Object.keys(s.reviewLabels).length > 0) ||
    s.reviewNote !== undefined
  );
}

function localizeParam(p: Param, sectionMap: Record<string, string>, ps: DesignParamStrings | undefined): Param {
  const section = sectionMap[p.section] ?? p.section;
  const description = ps?.description ?? p.description;
  const help = ps?.help ?? p.help;
  const info =
    ps?.info && p.info ? { label: ps.info.label ?? p.info.label, unit: ps.info.unit ?? p.info.unit } : p.info;
  // Every branch of the `Param` union carries section/description/help/info,
  // so this spread stays a legal `Param` for any of them; only the `enum`
  // branch below additionally touches `choices`, a field only it has.
  const next = { ...p, section, description, help, info } as Param;
  if (p.type === "enum" && ps?.choices) {
    const choices = ps.choices;
    return { ...next, choices: p.choices.map((c) => ({ ...c, label: choices[c.value] ?? c.label })) } as Param;
  }
  return next;
}

/**
 * Project `s` onto `design`, returning a new `LocalizedDesign` — or the SAME
 * reference when `s` is absent or translates nothing that would change it
 * (see `affectsDesign`), so a design with no sidecar for the active locale
 * costs nothing beyond the one check and never breaks a memo/identity
 * comparison downstream. Parameter NAMES and choice VALUES are never
 * translated (they're the wire identity `-D name=value` render args and
 * stored preset/URL state key off) — only their display labels/text.
 *
 * `design` is expected to already be a `LocalizedDesign` (its `label`/`group`
 * resolved by `src/lib/configI18n.ts`'s `lxDesignEntry`, run ahead of this):
 * this function never reads or writes either field, so it passes them
 * through untouched either way.
 */
export function localizeDesign(design: LocalizedDesign, s: DesignStrings | undefined): LocalizedDesign {
  if (!s || !affectsDesign(s)) return design;

  const sectionMap = s.sections ?? {};
  const sections = design.sections.map((sec) => sectionMap[sec] ?? sec);
  const collapsedSections = design.collapsedSections?.map((sec) => sectionMap[sec] ?? sec);
  const params = design.params.map((p) => localizeParam(p, sectionMap, s.params?.[p.name]));
  const reviewLabels = design.reviewLabels
    ? Object.fromEntries(
        Object.entries(design.reviewLabels).map(([name, label]) => [name, s.reviewLabels?.[name] ?? label])
      )
    : design.reviewLabels;

  return {
    ...design,
    description: s.description ?? design.description,
    sections,
    ...(collapsedSections ? { collapsedSections } : {}),
    params,
    reviewLabels,
    reviewNote: s.reviewNote ?? design.reviewNote,
  };
}

/**
 * Resolve one source ECHO'd string (an `@info` label, e.g. "Total width", as
 * the design's `.scad` literally wrote it) to its translation for the active
 * locale, via the sidecar's free-form `echo` map. A miss (no sidecar, or no
 * entry for this exact source string) returns `source` unchanged — the
 * author's own text is always a valid fallback, exactly like `t()`'s
 * English-then-bare-key fallback in `src/lib/i18n.ts`.
 */
export function localizeEcho(s: DesignStrings | undefined, source: string): string {
  return s?.echo?.[source] ?? source;
}
