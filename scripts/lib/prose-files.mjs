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
 * paths), or when the referenced file doesn't exist (via `mustExist`, so the
 * message matches every other missing-path error).
 *
 * @param {object} [obj] the object to resolve (e.g. `config.popup`)
 * @param {string} field the inline key (e.g. "body")
 * @param {string} fileField the file-path sibling key (e.g. "bodyFile")
 * @param {string} CONFIG_DIR base directory file paths resolve against
 * @param {(abs: string, what: string) => string} mustExist
 * @param {string} path dotted path to `obj` itself, for error messages (e.g. "popup")
 */
export function resolveFileField({ obj, field, fileField, CONFIG_DIR, mustExist, path }) {
  const fileRel = obj?.[fileField];
  if (fileRel == null) return obj;
  const fieldPath = `${path}.${field}`;
  const filePath = `${path}.${fileField}`;
  // Validate BEFORE resolving: a non-string or blank value must fail with the
  // same message every other optional string field gives, not escape as a
  // raw Node TypeError out of node:path's resolve()/readFileSync() below.
  if (typeof fileRel !== "string" || !fileRel.trim()) throw optionalStringFieldError(filePath);
  const fileTrimmed = fileRel.trim();
  if (obj[field] != null)
    throw new Error(`gen-schema: both '${fieldPath}' and '${filePath}' are set — remove one.`);
  const abs = mustExist(resolve(CONFIG_DIR, fileTrimmed), `${filePath} '${fileTrimmed}'`);
  const content = readFileSync(abs, "utf-8").trim();
  const { [fileField]: _dropped, ...rest } = obj;
  return { ...rest, [field]: content };
}
