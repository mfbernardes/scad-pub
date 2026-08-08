// prose-files.mjs: the shared "<field>/<field>File" resolution used by
// popup.body/bodyFile, fileImport.note/noteFile, and licenses[].text/textFile
// (see docs/config.md and config-spec.mjs's comments on each). All three are
// scalar prose fields where the config author may write the value inline OR
// point at a config-relative file instead; this runs as a pre-pass in
// gen-schema.mjs's generate(), BEFORE the field's own validation (applyGroupSpec
// for popup/fileImport, parseLicenses for licenses[]) ever sees the object, so
// by the time that validation runs, `field` is already populated exactly as if
// the config author had written it inline: the app never gains a runtime
// fetch for this content (contrast a design's `// @doc` annotation, whose
// resolved `designs[].doc` URL genuinely is fetched on demand, see
// docs/config.md).
//
// This is deliberately NOT folded into applyGroupSpec/config-spec.mjs's
// generic field-descriptor machinery: "one of two sibling keys must resolve
// a THIRD key" is a cross-field rule (the same reason `ui.afterExport.helpTab`
// stays a hand-written check in gen-schema.mjs rather than a config-spec.mjs
// axis), not a per-field shape one.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { optionalStringFieldError } from "./config-parsers.mjs";

/**
 * Resolve one `<field>`/`<fileField>` pair on a plain object (or `undefined`/
 * `null`, passed through unchanged). Returns a NEW object: the input is
 * never mutated, with `fileField` removed and `field` set to the referenced
 * file's contents (trimmed) when `fileField` was set. Throws a gen-schema
 * style Error when both `field` and `fileField` are set (naming both dotted
 * paths), or when a referenced file doesn't exist (via `mustExist`, so the
 * message matches every other missing-path error).
 *
 * `fileField`'s value is either a config-relative path (`field` becomes that
 * file's plain-string contents, as before), or — when `languages` is passed —
 * an object of locale tag -> config-relative path (`field` becomes the
 * resulting `LocalizableText` map: each tag's file read independently, one
 * `map[tag] ?? map[defaultTag]` entry per locale — see
 * `scripts/lib/config-parsers.mjs`'s `parseLocalizableText`, whose object-form
 * invariants this mirrors: at least one entry, every key in `languages`, and
 * `defaultTag` must be present). Omit `languages` (as `licenses[].textFile`
 * does — license text stays single-language) to accept only the plain path
 * form; an object value then fails the build naming the field.
 *
 * @param {object} [obj] the object to resolve (e.g. `config.popup`)
 * @param {string} field the inline key (e.g. "body")
 * @param {string} fileField the file-path sibling key (e.g. "bodyFile")
 * @param {string} CONFIG_DIR base directory file paths resolve against
 * @param {(abs: string, what: string) => string} mustExist
 * @param {string} path dotted path to `obj` itself, for error messages (e.g. "popup")
 * @param {string[]} [languages] this deployment's enabled locale tags; omit to disallow the per-locale map form
 * @param {string} [defaultTag] this deployment's default locale tag (required together with `languages`)
 */
export function resolveFileField({ obj, field, fileField, CONFIG_DIR, mustExist, path, languages, defaultTag }) {
  const fileRel = obj?.[fileField];
  if (fileRel == null) return obj;
  const fieldPath = `${path}.${field}`;
  const filePath = `${path}.${fileField}`;
  if (obj[field] != null)
    throw new Error(`gen-schema: both '${fieldPath}' and '${filePath}' are set — remove one.`);

  const readOne = (rel, errPath) => {
    // Validate BEFORE resolving: a non-string or blank value must fail with
    // the same message every other optional string field gives, not escape
    // as a raw Node TypeError out of node:path's resolve()/readFileSync().
    if (typeof rel !== "string" || !rel.trim()) throw optionalStringFieldError(errPath);
    const trimmed = rel.trim();
    const abs = mustExist(resolve(CONFIG_DIR, trimmed), `${errPath} '${trimmed}'`);
    return readFileSync(abs, "utf-8").trim();
  };

  let value;
  if (typeof fileRel === "string") {
    value = readOne(fileRel, filePath);
  } else if (fileRel && typeof fileRel === "object" && !Array.isArray(fileRel)) {
    // A genuinely object-shaped value: distinct from "not a string and not an
    // object at all" (a number, a boolean, …) below, which is always the
    // ordinary optional-string-field message regardless of whether this field
    // supports the per-locale form.
    if (!languages)
      throw new Error(
        `gen-schema: '${filePath}' must be a file path (this field doesn't support per-locale forms)`
      );
    const entries = Object.entries(fileRel);
    if (entries.length === 0) throw new Error(`gen-schema: '${filePath}' must have at least one locale entry`);
    const tags = new Set(languages);
    const localized = {};
    for (const [tag, rel] of entries) {
      if (!tags.has(tag))
        throw new Error(
          `gen-schema: '${filePath}' has an entry for locale "${tag}", which isn't one of this ` +
            `deployment's enabled locales.\n  Valid tags: ${[...tags].join(", ")}`
        );
      localized[tag] = readOne(rel, `${filePath}.${tag}`);
    }
    if (!(defaultTag in localized))
      throw new Error(
        `gen-schema: '${filePath}' must include an entry for "${defaultTag}", this deployment's default locale`
      );
    value = localized;
  } else {
    throw optionalStringFieldError(filePath);
  }
  const { [fileField]: _dropped, ...rest } = obj;
  return { ...rest, [field]: value };
}
