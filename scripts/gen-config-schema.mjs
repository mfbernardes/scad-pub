// gen-config-schema.mjs — emits a real JSON Schema (draft 2020-12) for
// scadpub.config.json, generated from scripts/lib/config-spec.mjs so the
// schema can never drift from what gen-schema.mjs itself accepts: a key
// config-spec.mjs doesn't know about can't appear here, and a key added here
// by hand (rather than in config-spec.mjs) is impossible, since this file has
// no data of its own to add it with. Wired into the same predev/prebuild/
// pretest hooks as gen-schema.mjs (see package.json's "gen" script) —
// regenerating on every build is fine, but the output,
// scadpub.config.schema.json at the repo root, is committed, and
// tests/config-spec.test.mjs fails the build if it's stale.
//
// This is intentionally NOT a precise JSON Schema for every corner of the
// config. The handful of top-level keys that carry real bespoke validation
// logic (colors, licenses, notices, strings, help, designs, categories,
// screenshots, shortcuts — see config-spec.mjs's `custom` marker) get a
// best-effort structural schema from whatever `properties`/`items` shape is
// registered for them there, which is looser than what gen-schema.mjs
// actually enforces (it can't express "a `reviewLabels` key must name a real
// declared parameter" or "a `strings` key must be in the i18n catalogue" —
// those are cross-field/file-I/O checks, not shape, and config-spec.mjs
// deliberately doesn't own them either — see its file-top comment). The goal
// here is editor autocomplete and typo-catching for the config author, not a
// drop-in replacement for gen-schema's own validation.
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { CONFIG_SPEC } from "./lib/config-spec.mjs";

const PRIMITIVE_TYPES = new Set(["string", "boolean", "number", "integer"]);

// scripts/lib/config-parsers.mjs's applyGroupSpec treats an explicit `null`
// exactly like an absent key for every field it drives (see that function's
// own comment) — that's the entire point of this reorg, and it's why a
// config the real build ACCEPTS (`"heavyMs": null`) used to be flagged
// invalid by any editor honouring this schema's own `$schema` pointer: the
// emitted type had no null alternative. `addNull` is the fix, applied to
// every optional field in `objectSchema`'s loop below (not called for a
// node's own top-level document schema, nor for an array's `items` template
// — nullability is a property of one KEY having a value, not of "is this
// array allowed to contain null" or "is the whole document nullable").
//
// One field-descriptor marker (see config-spec.mjs's file-top comment)
// suppresses this: `required` (the field must genuinely be present —
// currently only `popup.header`/`popup.body`, `designs[].id`,
// `notices[].marker`, and `licenses[].name`/`license`/`copyright`/`url`/
// `licenseUrl`). Every other field is genuinely optional AND its parser
// genuinely accepts an explicit `null` as "unset" — verified field-by-field
// against the real parsers (see each spec node's own comment), and swept
// mechanically over the whole spec by tests/config-spec.test.mjs so a newly
// added field can't silently drift from whichever behaviour its own code
// actually has. (An earlier revision carried a second marker here for a
// handful of fields whose bespoke parsers hadn't been taught this yet; those
// parsers were fixed to match the rule instead, so that marker is gone.)
//
// Merges a null alternative into an already-built schema fragment rather
// than reshaping types by hand at each call site, so every shape `nodeToSchema`
// can produce — a plain `type`, an `enum`, an existing `anyOf` (fileImport/
// logo/pwa.themeColor's primitive-or-object union, designs[].presets.images's
// string-or-object one) — gets exactly one, uniform treatment:
//   - already `anyOf` (a union of shapes): append a `{ type: "null" }` branch
//     rather than nesting a second anyOf inside the first.
//   - `enum`: `type: [..., "null"]` alongside an untouched `enum` list would
//     be silently self-defeating — draft 2020-12 requires an instance to
//     satisfy BOTH keywords, and `null` is never one of the listed enum
//     values — so this splits into its own two-branch `anyOf` instead: the
///    original `{ type, enum }` unchanged, plus `{ type: "null" }`.
//   - anything else (a plain `type: "string"/"object"/"array"/…`, `object`/
//     `array` schemas straight out of `objectSchema`/the array branch below):
//     widen `type` into an array that also lists `"null"` — the
//     `"heavyMs"`/`"restOnGrid"` cases the PR review's finding named
//     directly. `properties`/`items`/`required` all stay untouched: per JSON
//     Schema's own semantics those keywords simply don't apply to a `null`
//     instance, so nothing further needs to change for the object/array
//     shapes.
// `description`/`default` (when present) are kept OUTSIDE the anyOf/type
// split in every branch, rather than duplicated into each alternative, so
// they still read as a single field's metadata instead of two.
function addNull(schema) {
  const { description, default: def, ...core } = schema;
  let widened;
  if (core.anyOf) {
    widened = { anyOf: [...core.anyOf, { type: "null" }] };
  } else if (core.enum) {
    widened = { anyOf: [{ ...core }, { type: "null" }] };
  } else if (Array.isArray(core.type)) {
    widened = { ...core, type: [...core.type, "null"] };
  } else {
    widened = { ...core, type: [core.type, "null"] };
  }
  return {
    ...(description !== undefined ? { description } : {}),
    ...(def !== undefined ? { default: def } : {}),
    ...widened,
  };
}

// The `{ type: "object", properties, additionalProperties, required }` shape
// shared by every object-typed node: the top-level config itself, `ui`,
// `viewer`, `render`, `render.cache`, `popup`, `ui.afterExport`, and the
// best-effort shapes for the bespoke/`custom` array-of-object and
// object-of-object keys (colors, designs[], notices[], licenses[]).
function objectSchema(node) {
  const properties = {};
  const required = [];
  for (const [key, field] of Object.entries(node.properties)) {
    let fieldSchema = nodeToSchema(field);
    // Every field is nullable UNLESS it's genuinely required (see addNull's
    // comment and config-spec.mjs's file-top one for the marker).
    if (!field.required) fieldSchema = addNull(fieldSchema);
    properties[key] = fieldSchema;
    if (field.required) required.push(key);
  }
  const schema = { type: "object", properties };
  if (required.length) schema.required = required;
  // Every node `applyGroupSpec` drives (the top-level config itself, `ui`,
  // `viewer`, `render`, `render.cache`, `popup`, the object form of
  // `fileImport`/`ui.afterExport`) is genuinely closed at runtime — an
  // unrecognised key always fails the build. Most bespoke/`custom` shapes are
  // JUST as closed, their own hand-written validation rejecting a key it
  // doesn't recognise instead of `applyGroupSpec` doing it for them —
  // `designs.items`, `colors.light`/`colors.dark`, and `pwa.themeColor`'s
  // object form are the concrete examples (see config-spec.mjs's file-top
  // comment). `custom` alone can't tell these apart from a shape that
  // genuinely tolerates an unrecognised key, so it ISN'T what decides this —
  // `openKeys: true` is: the separate, explicit marker for a node whose own
  // validation silently tolerates or drops a key it doesn't recognise
  // (`colors` itself, a `licenses[]`/`notices[]` entry, `logo`'s object form)
  // or that has no fixed property list to close against in the first place
  // (`strings`, `help`).
  schema.additionalProperties = !!node.openKeys;
  return schema;
}

// Turn one config-spec.mjs node (a top-level key, or a nested field) into a
// JSON Schema fragment. A node with BOTH a primitive `type` and a
// `properties` map (`fileImport`: boolean | options object; `logo`: string |
// { light, dark }) becomes an `anyOf` of the primitive form and the object
// form — the two shapes config-parsers.mjs's own runtime shortcuts accept.
function nodeToSchema(node) {
  const base = {};
  if (node.description) base.description = node.description;
  if ("default" in node) base.default = node.default;

  if (node.type === "enum") return { ...base, type: "string", enum: node.values };

  // `"color"` (config-spec.mjs's `color()` factory) is a real, distinct type
  // for config-parsers.mjs's own validateFieldValue dispatch, but it isn't a
  // legal JSON Schema type — a schema-consuming editor would reject the
  // whole document over it. It's just a CSS-colour-flavoured string as far as
  // shape goes (color()'s description already spells out the colour-string
  // meaning this collapse would otherwise lose), so it's emitted as "string"
  // like every other colour-valued field in this config
  // (`notices[].color`, `logo`, `pwa.themeColor`'s `light`/`dark`).
  if (node.type === "color") return { ...base, type: "string" };

  if (node.type === "array")
    return { ...base, type: "array", items: node.items ? nodeToSchema(node.items) : {} };

  // A field that accepts EITHER a plain string OR an object with no fixed key
  // set (`designs[].presets.images`: a directory path, or a preset-name ->
  // path map) — distinct from the primitive-shorthand-plus-options-object
  // `anyOf` below, which describes a FIXED-shape options object alongside a
  // primitive shorthand.
  if (node.type === "object" && node.acceptsString)
    return { ...base, anyOf: [{ type: "string" }, { type: "object" }] };

  const hasProperties = node.properties && typeof node.properties === "object";

  if (PRIMITIVE_TYPES.has(node.type) && hasProperties)
    return { ...base, anyOf: [{ type: node.type }, objectSchema(node)] };

  if (node.type === "object")
    return hasProperties ? { ...base, ...objectSchema(node) } : { ...base, type: "object" };

  return { ...base, type: node.type };
}

// Exported so tests/config-spec.test.mjs can regenerate in-memory and
// deep-compare against the committed file, without shelling out.
export function buildConfigSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "ScadPub configuration",
    description:
      "scadpub.config.json. Generated from scripts/lib/config-spec.mjs by scripts/gen-config-schema.mjs " +
      "— see docs/config.md for the full human reference.",
    ...objectSchema({ properties: CONFIG_SPEC }),
  };
}

function main() {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const outPath = join(HERE, "..", "scadpub.config.schema.json");
  writeFileSync(outPath, JSON.stringify(buildConfigSchema(), null, 2) + "\n");
  console.log(`gen-config-schema: wrote ${outPath}`);
}

// Run only when executed directly (not when imported by the tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
