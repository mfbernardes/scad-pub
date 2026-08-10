// gen-config-schema.mjs: emits a real JSON Schema (draft 2020-12) for
// scadpub.config.json, generated from scripts/lib/config-spec.mjs so the
// schema can never drift from what gen-schema.mjs itself accepts: a key
// config-spec.mjs doesn't know about can't appear here, and a key added here
// by hand (rather than in config-spec.mjs) is impossible, since this file has
// no data of its own to add it with. Wired into the same predev/prebuild/
// pretest hooks as gen-schema.mjs (see package.json's "gen" script):
// regenerating on every build is fine, but the output,
// scadpub.config.schema.json at the repo root, is committed, and
// tests/config-spec.test.mjs fails the build if it's stale.
//
// This is intentionally NOT a precise JSON Schema for every corner of the
// config. The handful of top-level keys that carry real bespoke validation
// logic (colors, licenses, notices, strings, help, designs, categories,
// screenshots, shortcuts, see config-spec.mjs's `custom` marker) get a
// best-effort structural schema from whatever `properties`/`items` shape is
// registered for them there, which is looser than what gen-schema.mjs
// actually enforces (it can't express "a `reviewLabels` key must name a real
// declared parameter" or "a `strings` key must be in the i18n catalogue":
// those are cross-field/file-I/O checks, not shape, and config-spec.mjs
// deliberately doesn't own them either, see its file-top comment). The goal
// here is editor autocomplete and typo-catching for the config author, not a
// drop-in replacement for gen-schema's own validation.
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { CONFIG_SPEC } from "./lib/config-spec.mjs";

const PRIMITIVE_TYPES = new Set(["string", "boolean", "number", "integer"]);

// scripts/lib/config-parsers.mjs's applyGroupSpec treats an explicit `null`
// exactly like an absent key for every field it drives, so a config the real
// build ACCEPTS (`"heavyMs": null`) must not be flagged invalid by an editor
// honouring this schema's `$schema` pointer. `addNull` is applied to every
// optional field in `objectSchema`'s loop below, not to a node's own
// top-level document schema, nor to an array's `items` template, since
// nullability is a property of one KEY having a value, not of "is this array
// allowed to contain null" or "is the whole document nullable".
//
// `required` suppresses it (`popup.header`/`popup.body`, `designs[].id`,
// `notices[].marker`, `licenses[].name`/`license`/`copyright`/`url`/
// `licenseUrl`). Every other field's parser genuinely accepts an explicit
// `null` as "unset"; tests/config-spec.test.mjs sweeps the whole spec
// mechanically so a newly added field can't silently drift from that.
//
// Merging into an already-built fragment, rather than reshaping types by hand
// at each call site, gives every shape `nodeToSchema` can produce exactly one
// uniform treatment:
//   - already `anyOf` (a union of shapes): append a `{ type: "null" }` branch
//     rather than nesting a second anyOf inside the first.
//   - `enum`: splits into its own two-branch `anyOf`. The original
//     `{ type, enum }` unchanged, plus `{ type: "null" }`. Widening `type`
//     instead would be silently self-defeating: draft 2020-12 requires an
//     instance to satisfy BOTH keywords, and `null` is never a listed value.
//   - anything else: widen `type` into an array that also lists `"null"`.
//     `properties`/`items`/`required` stay untouched, per JSON Schema's own
//     semantics those keywords don't apply to a `null` instance.
// `description`/`default` stay OUTSIDE the anyOf/type split in every branch,
// rather than duplicated into each alternative, so they read as a single
// field's metadata instead of two.
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
// Appended to a `textSuppliable` field's own description (config-spec.mjs's
// comment on the marker has the full rationale): noted on the field itself,
// not just left to the reader to infer from its absence in `required`.
const TEXT_SUPPLIABLE_NOTE =
  "May be omitted here — a deployment with the top-level 'text' key configured supplies it from a text " +
  'file instead (see docs/config.md "Localizing config text").';

function objectSchema(node) {
  const properties = {};
  const required = [];
  for (const [key, field] of Object.entries(node.properties)) {
    let fieldSchema = nodeToSchema(field);
    // Every field is nullable UNLESS it's genuinely required (see addNull's
    // comment and config-spec.mjs's file-top one for the marker). This is
    // unaffected by `textSuppliable` below: a text-mode config still can't
    // set the field to `null` inline, only omit it, so nullability stays
    // keyed off `required` alone.
    if (!field.required) fieldSchema = addNull(fieldSchema);
    if (field.textSuppliable) {
      fieldSchema = {
        ...fieldSchema,
        description: fieldSchema.description ? `${fieldSchema.description} ${TEXT_SUPPLIABLE_NOTE}` : TEXT_SUPPLIABLE_NOTE,
      };
    }
    properties[key] = fieldSchema;
    // `textSuppliable` suppresses ONLY presence (this group's `required`
    // list), not the field's own nullability above: a raw config validly
    // OMITS the key when text-supplied, but still can't set it to `null`.
    if (field.required && !field.textSuppliable) required.push(key);
  }
  const schema = { type: "object", properties };
  if (required.length) schema.required = required;
  // Every node `applyGroupSpec` drives (the top-level config itself, `ui`,
  // `viewer`, `render`, `render.cache`, `popup`, the object form of
  // `fileImport`/`ui.afterExport`) is genuinely closed at runtime: an
  // unrecognised key always fails the build. Most bespoke/`custom` shapes are
  // JUST as closed, their own hand-written validation rejecting a key it
  // doesn't recognise instead of `applyGroupSpec` doing it for them:
  // `designs.items`, `colors.light`/`colors.dark`, and `pwa.themeColor`'s
  // object form are the concrete examples (see config-spec.mjs's file-top
  // comment). `custom` alone can't tell these apart from a shape that
  // genuinely tolerates an unrecognised key, so it ISN'T what decides this:
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
// form. The two shapes config-parsers.mjs's own runtime shortcuts accept.
function nodeToSchema(node) {
  const base = {};
  if (node.description) base.description = node.description;
  if ("default" in node) base.default = node.default;

  if (node.type === "enum") return { ...base, type: "string", enum: node.values };

  // `localizable: true` (config-spec.mjs's `localizable()` factory): a
  // `LocalizableText`-valued field — a plain string (every locale), or an
  // object of locale tag -> string. Checked ahead of the generic `custom`
  // string handling below, since every `localizable` field is also
  // `custom: true` (the object form's real invariants — must include the
  // default tag, every key a shipped locale — need this deployment's
  // resolved `languages`, which a static schema can't express; this emits
  // only the SHAPE, same "best-effort" stance as every other bespoke field).
  if (node.localizable)
    return { ...base, anyOf: [{ type: "string" }, { type: "object", additionalProperties: { type: "string" } }] };

  // `"color"` (config-spec.mjs's `color()` factory) is a real, distinct type
  // for config-parsers.mjs's own validateFieldValue dispatch, but it isn't a
  // legal JSON Schema type: a schema-consuming editor would reject the
  // whole document over it. It's only a CSS-colour-flavoured string as far as
  // shape goes (color()'s description already spells out the colour-string
  // meaning this collapse would otherwise lose), so it's emitted as "string"
  // like every other colour-valued field in this config
  // (`notices[].color`, `logo`, `pwa.themeColor`'s `light`/`dark`).
  if (node.type === "color") return { ...base, type: "string" };

  if (node.type === "array")
    return { ...base, type: "array", items: node.items ? nodeToSchema(node.items) : {} };

  // A dynamically-keyed object whose VALUES all share one shape (`strings`:
  // catalogue key -> string-or-locale-map), as opposed to `acceptsString`
  // below (the object form's PROPERTY SET is fixed but the object itself is
  // also accepted bare as a string) or the plain `{ type: "object" }`
  // fallback further down (genuinely untyped values, `help`/`colors`/a
  // `logo`/`pwa.themeColor` object form). `node.mapValue` is already a JSON
  // Schema fragment (config-spec.mjs's `strings` node builds it directly, see
  // that node's own comment), so it's used verbatim as `additionalProperties`
  // rather than routed back through this function.
  if (node.type === "object" && node.mapValue)
    return { ...base, type: "object", additionalProperties: node.mapValue };

  // A field that accepts EITHER a plain string OR an object with no fixed key
  // set (`designs[].presets.images`: a directory path, or a preset-name ->
  // path map). Distinct from the primitive-shorthand-plus-options-object
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

// A `{ title?, body? }` help section — SPARSE on purpose: a config text
// file's own section objects are validated for real by
// scripts/lib/config-text.mjs (both keys required there, once the join
// against the config's structure is known); this schema only offers editor
// autocomplete/typo-catching, the same "best-effort, looser than the real
// build" stance buildConfigSchema's own module comment states.
const TEXT_SECTION_SCHEMA = {
  type: "object",
  properties: { title: { type: "string" }, body: { type: "string" } },
  additionalProperties: false,
};

// A help pane's own shape (top-level 'help'): inline sections, or a single
// Markdown 'file' — see scripts/lib/config-text.mjs's foldHelp, which decides
// which form is in play from the DEFAULT locale's own entry. The top-level
// pane carries no 'label' (nothing picks a single-pane help by name); one
// 'help.tabs.<id>' entry is the same shape PLUS 'label' (TEXT_HELP_TAB_PROPERTIES
// below) — foldHelpTab requires it on the default locale's entry, so leaving
// it off this schema would make every real tabbed text file fail validation
// against 'additionalProperties: false'.
const TEXT_HELP_PANE_PROPERTIES = {
  intro: { type: "string" },
  sections: { type: "array", items: TEXT_SECTION_SCHEMA },
  file: { type: "string", description: "Config-relative Markdown file, split into intro/sections at build time." },
};

const TEXT_HELP_TAB_PROPERTIES = {
  label: { type: "string" },
  ...TEXT_HELP_PANE_PROPERTIES,
};

// scadpub.config.text.schema.json: the shape of ONE locale's text file (see
// docs/config.md "Localizing config text" and scripts/lib/config-text.mjs's
// own module comment for the full contract). Hand-written, not derived from
// CONFIG_SPEC: a text file's keys mirror config surfaces
// (popup/help/fileImport/notices/licenses/designs/strings) rather than the
// config's own top-level shape, and its real join-key/completeness/
// count-parity invariants are cross-field checks against the CONFIG this file
// accompanies — exactly the kind of thing buildConfigSchema's own comment
// says a static schema can't express for any `custom` field. This is
// deliberately loose in the same places: `notices`/`licenses`/`designs`/
// `help.tabs` are dynamically-keyed (marker/name/id are the config's own),
// and `strings` mirrors the main schema's own catalogue-keyed openness.
export function buildConfigTextSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "ScadPub config text file",
    description:
      "One locale's text file, referenced by scadpub.config.json's 'text' key. Generated from " +
      "scripts/gen-config-schema.mjs's buildConfigTextSchema — see docs/config.md 'Localizing config text'.",
    type: "object",
    properties: {
      $schema: { type: "string" },
      popup: {
        type: "object",
        properties: {
          header: { type: "string" },
          body: { type: "string" },
          button: { type: "string" },
          footnote: { type: "string" },
        },
        additionalProperties: false,
      },
      help: {
        type: "object",
        properties: {
          ...TEXT_HELP_PANE_PROPERTIES,
          tabs: {
            type: "object",
            description: "Keyed by 'help.tabs[].id' in scadpub.config.json.",
            additionalProperties: { type: "object", properties: TEXT_HELP_TAB_PROPERTIES, additionalProperties: false },
          },
        },
        additionalProperties: false,
      },
      fileImport: {
        type: "object",
        properties: { note: { type: "string" } },
        additionalProperties: false,
      },
      notices: {
        type: "object",
        description: "Keyed by 'notices[].marker' in scadpub.config.json.",
        additionalProperties: {
          anyOf: [
            { type: "string" },
            {
              type: "object",
              properties: { one: { type: "string" }, other: { type: "string" } },
              required: ["other"],
              additionalProperties: false,
            },
          ],
        },
      },
      licenses: {
        type: "object",
        description: "Keyed by 'licenses[].name' in scadpub.config.json.",
        additionalProperties: {
          type: "object",
          properties: { note: { type: "string" } },
          additionalProperties: false,
        },
      },
      designs: {
        type: "object",
        description: "Keyed by 'designs[].id' in scadpub.config.json.",
        additionalProperties: {
          type: "object",
          properties: { label: { type: "string" }, group: { type: "string" } },
          additionalProperties: false,
        },
      },
      strings: {
        type: "object",
        description: "Chrome-catalogue overrides for this locale, keyed like scadpub.config.json's own 'strings'.",
        additionalProperties: { type: "string" },
      },
    },
    additionalProperties: false,
  };
}

function main() {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const outPath = join(HERE, "..", "scadpub.config.schema.json");
  writeFileSync(outPath, JSON.stringify(buildConfigSchema(), null, 2) + "\n");
  console.log(`gen-config-schema: wrote ${outPath}`);
  const textOutPath = join(HERE, "..", "scadpub.config.text.schema.json");
  writeFileSync(textOutPath, JSON.stringify(buildConfigTextSchema(), null, 2) + "\n");
  console.log(`gen-config-schema: wrote ${textOutPath}`);
}

// Run only when executed directly (not when imported by the tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
