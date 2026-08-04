// i18n-coverage.mjs: the field taxonomy a design-translation sidecar can
// cover, shared by scripts/gen-schema.mjs (the build-time drift WARNING, see
// buildDesigns) and scripts/i18n-status.mjs (coverage reporting, --stamp,
// --strict). One list of "translatable fields" per design, derived from the
// SAME parsed shape buildDesigns already has in hand (params/sections/meta/
// reviewLabels/reviewNote/presetNames/the base doc's own text) — never a
// second, hand-rolled enumeration of what a sidecar can translate: that
// enumeration already lives in scripts/lib/design-strings.mjs's TOP_LEVEL_KEYS/
// PARAM_KEYS/INFO_KEYS, and this module's `has()` closures mirror its exact
// optional-field shape so the two can never silently disagree about what
// counts as "translated".
//
// `echo` is deliberately excluded here, matching design-strings.mjs's own
// comment: it's a free-form source-string map gen-schema has no static way to
// cross-check against the design, so there is no fixed field list to report
// coverage or drift for. A miss is a legitimate fallback to the source
// string, not a gap (see docs/config.md "Design translations").
import { createHash } from "node:crypto";

/** sha256 of `text`, hex-encoded. The unit stamps/drift-checks hash on: the
 *  CURRENT authored source text of a translatable field, or a base doc
 *  file's raw content. */
export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * One translatable field of a design, independent of any particular locale.
 * @typedef {object} TranslatableField
 * @property {string} cls  The coverage bucket this field counts under
 *   ("description" | "params" | "sections" | "reviewLabels" | "reviewNote" |
 *   "presets" | "doc").
 * @property {string} path  A dotted field path matching how a sidecar would
 *   name it in an error message (e.g. `params.width.description`), or the
 *   literal `"doc"` for the per-locale doc file.
 * @property {string} sourceText  The CURRENT authored text this field
 *   translates, hashed for drift detection.
 * @property {(sidecar: object | undefined) => boolean} has  Whether a given
 *   tag's already-parsed sidecar JSON sets this field. Unused for the `doc`
 *   class, whose coverage is a file's presence (`docLocales`), not a sidecar
 *   key — see `isCovered` below.
 */

/**
 * Every translatable field of one design, in a stable (design source) order.
 * @param {object} d
 * @param {string | null} [d.description]
 * @param {string[]} [d.sections]
 * @param {Array<{name: string, description?: string, help?: string, type: string, choices?: Array<{value: string, label: string}>, info?: {label: string | null, unit: string | null} | null}>} [d.params]
 * @param {Record<string, string>} [d.reviewLabels]
 * @param {string | null} [d.reviewNote]
 * @param {string[]} [d.presetNames]
 * @param {string | null} [d.docSourceText]  The base `@doc` file's raw
 *   content, or null when the design has no `@doc`.
 * @returns {TranslatableField[]}
 */
export function translatableFields(d) {
  const fields = [];
  const push = (cls, path, sourceText, has) => fields.push({ cls, path, sourceText, has });

  if (d.description != null)
    push("description", "description", d.description, (s) => s?.description !== undefined);

  for (const section of d.sections ?? []) {
    push("sections", `sections.${section}`, section, (s) => s?.sections?.[section] !== undefined);
  }

  for (const p of d.params ?? []) {
    if (p.description)
      push(
        "params",
        `params.${p.name}.description`,
        p.description,
        (s) => s?.params?.[p.name]?.description !== undefined
      );
    if (p.help)
      push("params", `params.${p.name}.help`, p.help, (s) => s?.params?.[p.name]?.help !== undefined);
    if (p.type === "enum") {
      for (const c of p.choices ?? []) {
        push(
          "params",
          `params.${p.name}.choices.${c.value}`,
          c.label,
          (s) => s?.params?.[p.name]?.choices?.[c.value] !== undefined
        );
      }
    }
    if (p.info) {
      // Mirrors format.ts's own "custom label, else the param's own
      // description" fallback, so the hashed source text is whatever a
      // translator was actually looking at.
      const label = p.info.label ?? p.description ?? "";
      if (label)
        push(
          "params",
          `params.${p.name}.info.label`,
          label,
          (s) => s?.params?.[p.name]?.info?.label !== undefined
        );
      if (p.info.unit)
        push(
          "params",
          `params.${p.name}.info.unit`,
          p.info.unit,
          (s) => s?.params?.[p.name]?.info?.unit !== undefined
        );
    }
  }

  for (const [name, label] of Object.entries(d.reviewLabels ?? {})) {
    push("reviewLabels", `reviewLabels.${name}`, label, (s) => s?.reviewLabels?.[name] !== undefined);
  }

  if (d.reviewNote != null)
    push("reviewNote", "reviewNote", d.reviewNote, (s) => s?.reviewNote !== undefined);

  for (const name of d.presetNames ?? []) {
    push("presets", `presets.${name}`, name, (s) => s?.presets?.[name] !== undefined);
  }

  // `doc`'s "sidecar" is a whole sibling FILE (`<design>.doc.<tag>.md`), not a
  // JSON key: coverage/drift for it are checked against `docLocales`/a
  // separately-hashed doc file, not `has()` — see `isCovered`/stamp callers
  // below, which special-case `cls === "doc"` rather than calling `has()`.
  if (d.docSourceText != null) push("doc", "doc", d.docSourceText, null);

  return fields;
}

/** Whether `field` counts as translated for `tag`: `docLocales.includes(tag)`
 *  for the `doc` class (a whole sibling file, not a sidecar key), else
 *  `field.has(sidecar)`. */
export function isCovered(field, tag, sidecar, docLocales) {
  return field.cls === "doc" ? (docLocales ?? []).includes(tag) : !!field.has(sidecar);
}

/** Per-class {translated, total, missing} coverage of `fields` for one tag. */
export function coverageForTag(fields, tag, sidecar, docLocales) {
  const byClass = {};
  for (const f of fields) {
    const bucket = (byClass[f.cls] ??= { translated: 0, total: 0, missing: [] });
    bucket.total++;
    if (isCovered(f, tag, sidecar, docLocales)) bucket.translated++;
    else bucket.missing.push(f.path);
  }
  return byClass;
}

/**
 * The stamp entries `npm run i18n:status -- --stamp` writes for one tag: the
 * sha256 of each field's CURRENT source text, but ONLY for fields that tag's
 * sidecar actually translates (see the module doc — a stamp records what a
 * translation was made against, so an untranslated field gets no stamp).
 */
export function computeStamps(fields, tag, sidecar, docLocales, docHash) {
  const out = {};
  for (const f of fields) {
    if (!isCovered(f, tag, sidecar, docLocales)) continue;
    out[f.path] = f.cls === "doc" ? docHash : sha256Hex(f.sourceText);
  }
  return out;
}

/**
 * Field paths whose stamped hash (from a `<design>.strings.stamps.json`
 * entry for `tag`) no longer matches the field's CURRENT source-text hash:
 * the source changed since the translation was stamped. A field the stamps
 * object never mentions is silently skipped (no stamp -> no drift opinion,
 * see the module doc's "casual authors unburdened" rule).
 */
export function driftFields(fields, tagStamps, docHash) {
  if (!tagStamps) return [];
  const stale = [];
  for (const f of fields) {
    const stamped = tagStamps[f.path];
    if (stamped === undefined) continue;
    const current = f.cls === "doc" ? docHash : sha256Hex(f.sourceText);
    if (stamped !== current) stale.push(f.path);
  }
  return stale;
}
