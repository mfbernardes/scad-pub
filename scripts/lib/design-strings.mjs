// design-strings.mjs: validate one design-translation sidecar
// (`<design>.strings.<tag>.json`, see docs/config.md "Design translations")
// against the design it sits beside. Pure validation, no I/O: gen-schema.mjs's
// buildDesigns finds the sidecar files (the same sibling-detection idiom as
// the parameterSets `.json`, gen-schema.mjs:~702) and hands each one's parsed
// JSON plus a `ctx` built from that SAME design's already-parsed params/
// sections/meta to `parseDesignStrings` below. Every rejection is a build
// error, matching gen-schema's fail-fast convention everywhere else: a stale
// or typo'd translation key must never silently do nothing.
//
// The sidecar is projected onto a `Design` at RUNTIME by src/lib/designI18n.ts's
// `localizeDesign`; this module only decides whether a sidecar is a legal
// translation of its design, not how it's applied.

const TOP_LEVEL_KEYS = new Set(["description", "sections", "params", "reviewLabels", "reviewNote", "echo"]);
const PARAM_KEYS = new Set(["description", "help", "choices", "info"]);
const INFO_KEYS = new Set(["label", "unit"]);

// OpenSCAD's Customizer convention for a section excluded from the UI
// entirely (params.mjs's SECTION_RE handling skips `/* [Hidden] */`, matching
// desktop OpenSCAD): it can never appear in a design's own `sections` list in
// the first place (ctx.sections, built from the same parse, never carries
// it), so a sidecar naming it as a translation key is always rejected — with
// a dedicated message rather than the generic "unknown section", since the
// name IS meaningful in the .scad file, just never one a translation could
// ever reach.
const CANONICAL_SECTIONS = new Set(["Hidden"]);

function fail(file, msg) {
  throw new Error(`gen-schema: '${file}' ${msg}`);
}

function requireObject(file, value, what) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(file, `'${what}' must be an object (got ${JSON.stringify(value)})`);
}

function requireNonEmptyString(file, value, what) {
  if (typeof value !== "string" || value.trim() === "")
    fail(file, `'${what}' must be a non-empty string (got ${JSON.stringify(value)})`);
}

function checkUnknownKeys(file, obj, allowed, what) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key))
      fail(
        file,
        `'${what}' has unknown key '${key}'.\n  Valid keys: ${[...allowed].join(", ")}`
      );
  }
}

/**
 * Validate one sidecar's already-parsed JSON against the design it translates.
 * @param {unknown} json  The sidecar's parsed JSON (may be malformed).
 * @param {object} ctx
 * @param {string} ctx.file  The sidecar's path, for error messages.
 * @param {string} ctx.designId  The design's id, for error messages.
 * @param {Array<{name: string, choices: string[] | null, hasInfo: boolean}>} ctx.params
 *   Every declared parameter: its enum choice VALUES (null for a non-enum
 *   param) and whether it carries a `// @info` annotation.
 * @param {string[]} ctx.sections  The design's own visible section names
 *   (`[Hidden]` already excluded — see CANONICAL_SECTIONS above).
 * @param {boolean} ctx.hasDescription  Whether the design has a `// @description`.
 * @param {Set<string> | string[]} ctx.reviewLabels  Names of params carrying `// @review`.
 * @param {boolean} ctx.hasReviewNote  Whether the design has a `// @reviewNote`.
 * @returns {object} The validated sidecar, unchanged (pass-through: nothing
 *   here rewrites shape, only rejects an illegal one).
 */
export function parseDesignStrings(json, ctx) {
  const { file, designId, params, sections, hasDescription, reviewLabels, hasReviewNote } = ctx;
  const paramByName = new Map(params.map((p) => [p.name, p]));
  const sectionSet = new Set(sections);
  const reviewLabelSet = reviewLabels instanceof Set ? reviewLabels : new Set(reviewLabels);

  requireObject(file, json, ".");
  checkUnknownKeys(file, json, TOP_LEVEL_KEYS, ".");

  if (json.description !== undefined) {
    if (!hasDescription)
      fail(
        file,
        `sets 'description', but design '${designId}' has no '// @description' to translate`
      );
    requireNonEmptyString(file, json.description, "description");
  }

  if (json.sections !== undefined) {
    requireObject(file, json.sections, "sections");
    for (const [name, value] of Object.entries(json.sections)) {
      if (CANONICAL_SECTIONS.has(name))
        fail(
          file,
          `'sections["${name}"]' names a canonical OpenSCAD section, which never reaches the UI and can never be translated`
        );
      if (!sectionSet.has(name))
        fail(
          file,
          `'sections["${name}"]' does not match any section in design '${designId}' ` +
            `(known sections: ${sections.join(", ") || "(none)"})`
        );
      requireNonEmptyString(file, value, `sections["${name}"]`);
    }
  }

  if (json.params !== undefined) {
    requireObject(file, json.params, "params");
    for (const [name, entry] of Object.entries(json.params)) {
      const param = paramByName.get(name);
      if (!param)
        fail(
          file,
          `'params["${name}"]' does not match any parameter in design '${designId}'`
        );
      requireObject(file, entry, `params["${name}"]`);
      checkUnknownKeys(file, entry, PARAM_KEYS, `params["${name}"]`);

      if (entry.description !== undefined)
        requireNonEmptyString(file, entry.description, `params["${name}"].description`);
      if (entry.help !== undefined)
        requireNonEmptyString(file, entry.help, `params["${name}"].help`);

      if (entry.choices !== undefined) {
        requireObject(file, entry.choices, `params["${name}"].choices`);
        const declared = new Set(param.choices ?? []);
        for (const [value, label] of Object.entries(entry.choices)) {
          if (!declared.has(value))
            fail(
              file,
              `'params["${name}"].choices["${value}"]' is not a declared choice value of '${name}' ` +
                `(declared: ${[...declared].join(", ") || "(none — not an enum parameter)"})`
            );
          requireNonEmptyString(file, label, `params["${name}"].choices["${value}"]`);
        }
      }

      if (entry.info !== undefined) {
        if (!param.hasInfo)
          fail(
            file,
            `'params["${name}"].info' is set, but '${name}' carries no '// @info' annotation to translate`
          );
        requireObject(file, entry.info, `params["${name}"].info`);
        checkUnknownKeys(file, entry.info, INFO_KEYS, `params["${name}"].info`);
        if (entry.info.label !== undefined)
          requireNonEmptyString(file, entry.info.label, `params["${name}"].info.label`);
        if (entry.info.unit !== undefined)
          requireNonEmptyString(file, entry.info.unit, `params["${name}"].info.unit`);
      }
    }
  }

  if (json.reviewLabels !== undefined) {
    requireObject(file, json.reviewLabels, "reviewLabels");
    for (const [name, value] of Object.entries(json.reviewLabels)) {
      if (!reviewLabelSet.has(name))
        fail(
          file,
          `'reviewLabels["${name}"]' does not match any parameter carrying '// @review' in design '${designId}'`
        );
      requireNonEmptyString(file, value, `reviewLabels["${name}"]`);
    }
  }

  if (json.reviewNote !== undefined) {
    if (!hasReviewNote)
      fail(
        file,
        `sets 'reviewNote', but design '${designId}' has no '// @reviewNote' to translate`
      );
    requireNonEmptyString(file, json.reviewNote, "reviewNote");
  }

  // `echo`: source ECHO'd strings (e.g. `echo("@info", "Total width", …)`) are
  // author-chosen free text, not a build-time-known set gen-schema could
  // cross-check — so this is the one block with no name/existence check
  // against the design, only the same leaf-is-a-non-empty-string rule.
  if (json.echo !== undefined) {
    requireObject(file, json.echo, "echo");
    for (const [source, value] of Object.entries(json.echo)) {
      requireNonEmptyString(file, value, `echo["${source}"]`);
    }
  }

  return json;
}
