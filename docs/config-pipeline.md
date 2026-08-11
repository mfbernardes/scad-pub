# The config pipeline

How `scadpub.config.json` becomes `src/generated/designs.json`, and the policies
behind the three files that do most of the work: `scripts/lib/config-spec.mjs`,
`src/lib/schema.ts` and `scripts/lib/destinations.mjs`. [config.md](config.md) is the
user-facing reference for the config surface itself.

## `CONFIG_SPEC` (`scripts/lib/config-spec.mjs`)

The single declarative description of the config's surface: every top-level key, and every
key inside the handful that are themselves small nested objects. It is data, not
behaviour. Three consumers read it:

1. `config-spec.mjs` itself derives `KNOWN_TOP_LEVEL_KEYS` from `Object.keys(CONFIG_SPEC)`;
   `gen-schema.mjs` imports it for top-level unknown-key rejection.
2. `config-parsers.mjs`'s `applyGroupSpec` walks the `ui`, `viewer`, `render`, `fileImport`
   and `popup` nodes' `properties` to check and default each field; `gen-schema.mjs`'s
   `resolveDesignList` reuses it per `designs[]` entry against that entry's `presets`
   sub-node.
3. `gen-config-schema.mjs` turns the tree into a real JSON Schema, and
   `tests/config-spec.test.mjs` cross-checks that against [config.md](config.md) so a key
   cannot drift out of one without the other.

It describes **structure only**: names, nesting, JSON types, enums, static defaults, and
which nested keys are recognised at all. Path existence, cross-field checks
(`defaultDesign` naming a real design, `designs[].presets.images` keys naming real
presets), colour-value safety and the `strings`-against-i18n-catalogue check all stay in
`gen-schema.mjs`'s `generate()` and the bespoke parsers in `config-parsers.mjs`.

`applyGroupSpec` applies one behaviour per axis to every field it drives: an explicit
`null` always means "not set"; an enum error always appends ` (got <value>)`; a string is
always rejected blank and stored trimmed; a nested object's unrecognised key always fails
the build, with the valid-key list read straight off `properties`.

### Field-descriptor markers

Every one is opt-in.

- **`custom`** — runtime validation lives in a bespoke parser, so don't derive behaviour
  from this node's shape. On a leaf field inside an otherwise `applyGroupSpec`-driven
  group (`render.features`, `render.fonts`, `pwa.themeColor`, `pwa.screenshots`,
  `pwa.categories`) it also means "recognise the key, then skip it": neither defaulted,
  validated, nor returned, because the bespoke reader takes the raw config value instead.
- **`openKeys`** — the emitted JSON Schema tolerates an unrecognised key. Reserved for
  genuinely open key spaces (`strings`, `help`) and for parsers that silently drop what
  they don't know (the parent `colors` object, `licenses[]`/`notices[]` entries, `logo`'s
  object form). **Not** implied by `custom`: most bespoke parsers reject an unknown key by
  hand and stay as closed as an `applyGroupSpec`-driven node, so a config author relying on
  the schema for autocomplete still sees a typo rejected.
- **`required`** — the field must genuinely be present, and `gen-config-schema`'s `addNull`
  withholds the null alternative it adds to every other field.
- **`collapseEmptyToNull`** — an empty `{}` disappears entirely, for a pure tuning knob
  like `render`/`render.cache`. Contrast `ui.afterExport`, where the key's mere presence,
  even empty, is itself the "show the panel" toggle.
- **`alwaysPresent`** — a nested group whose own fields carry defaults that must resolve
  even when the config omits the group (only `viewer.controls`).
- **`rootTypeError`** — a plain-string override naming a field's actual accepted shapes
  (`fileImport` is `true`/an object/`null`, `popup` needs `header`+`body`), where the
  generic message would be less useful.
- **`mapValue`** — a dynamically-keyed object (like `openKeys`'s open key space) whose
  *values* all share one shape, given as a ready-made JSON Schema fragment used verbatim as
  `additionalProperties` (`strings`: a catalogue key maps to a plain string, or an object of
  locale tag: string pairs). Distinct from `acceptsString` below: that describes a *fixed*
  property set also reachable via a primitive shorthand, this describes an open key space
  whose values are typed.
- **`acceptsString`** — a field that accepts either a plain string or an object with no fixed
  key set (`designs[].presets.images`: a directory path, or a preset-name -> path map).
  Emitted as an `anyOf` of the primitive and object forms, distinct from `mapValue` above.
- **`localizable`** — a `LocalizableText`-valued leaf (docs/config.md's "Localizing config
  text"): a plain string that shows for every locale, or an object of locale tag -> string.
  Set by the `localizable()` factory, which also sets `custom: true` (config-parsers.mjs's
  `parseLocalizableText` needs this deployment's resolved `languages`/default tag — not
  something a generic `applyGroupSpec` field descriptor has access to — so the field's own
  parser, not `applyGroupSpec`, validates the raw value). `gen-config-schema.mjs`'s
  `nodeToSchema` reads the marker on its own, ahead of `custom`'s usual plain-`"string"`
  emission, and produces the same string-or-locale-map `anyOf` shape `mapValue` (`strings`)
  emits by hand — the two exist side by side because `mapValue` describes a dynamically-keyed
  *container* whose values share one shape, while `localizable` describes one ordinary FIELD
  whose own value is that shape.

## Config text fold (`scripts/lib/config-text.mjs`)

The opt-in `text` config key (docs/config.md "Localizing config text") moves every
`LocalizableText` value out of `scadpub.config.json` into one JSON file per locale. It's a
pure pre-pass, not a new parser track: `generate()` calls `parseTextKey` (validates the
`text` map itself — default locale required, every tag ⊆ `languages`, every path exists)
and, when it returns non-null, `foldConfigText` — right after `parseIdentity` (so
`LANGUAGES`/`DEFAULT_TAG` are known) and *before* `resolveProseFields`, so every downstream
step (`resolveProseFields`, `parseConfigBlocks`, `resolveDesignList`) sees exactly the
object it would have seen from an inline config. `foldConfigText` cross-checks each text
file against the config's own structure — a `help.tabs[]` entry by its (in text mode,
required) `id`, a `notices[]` entry by `marker`, a `licenses[]` entry by `name`, a
`designs[]` entry by `id` — and writes the resulting `{ tag: value, … }` maps directly onto
`config`'s own fields (mutating it in place, the same idiom `resolveProseFields`'s
`bodyFile`/`noteFile` pre-pass already uses). It never re-implements a field's real
invariants (non-empty string, must include the default tag): those still run once,
downstream, in `parseLocalizableText`/`parseNoticeLabel`/`resolveHelpPane` exactly as for an
inline value — the fold's own validation is limited to what only IT can check (the
join-key cross-references, section-count parity between locales, and the "no inline prose
once `text` is set" conflict check). This is also the equivalence contract's mechanism: a
deployment expressed as structure + text files and the same deployment expressed inline
diverge nowhere past this pre-pass, so `tests/config-text.test.mjs`'s load-bearing
equivalence test — an inline fixture and this repo's own migrated
`scadpub.config.json`/`scadpub.text.*.json` pair — asserts a deep-equal `designs.json`.
`gen-config-schema.mjs` emits a second committed schema, `scadpub.config.text.schema.json`,
for the text file's own (looser, hand-written — it isn't `CONFIG_SPEC`-derived, since a
text file's keys mirror config *surfaces* rather than the config's own top-level shape)
shape, freshness-tested the same way as the main one.

## Validating `designs.json` at runtime (`src/lib/schema.ts`)

`schema.ts` is the **fourth** hand-written description of the schema's shape, after
`src/openscad/types.ts`, `config-spec.mjs`, and `gen-schema`'s own emission. Every new
field touches four to six places, so the July 2026 review asked for a decision rather than
more drift. The decision:

> Keep a hand-written validator, and keep it to **load-bearing invariants** — the shapes
> the app indexes into and would crash or silently misbehave on (designs non-empty, each
> design's params well-formed, enums within their declared sets). Do **not** let it grow
> into full structural re-validation of every optional presentation field.

The reason is that `designs.json` is imported as a JSON module and bundled into the same JS
chunk that reads it. The two ship as one artifact and cannot get out of step in a deployed
build: there is no stale-schema-versus-new-code scenario for a full structural check to
catch. What remains is generator bugs at development time, which `tsc -b` and the
gen-schema suite already cover, plus the enum lists `schema.ts` mirrors by hand — and
`tests/config-spec.test.mjs` cross-checks every one of those against `CONFIG_SPEC` and
fails if a new enum arrives without a pair.

Generating the validator from `CONFIG_SPEC` was the other candidate. It was not chosen: it
would add a build artifact and a code generator to defend a drift class the tests already
guard, and the runtime cost of being wrong here is a clear thrown error either way.

So when adding a field, ask whether the app would **misbehave** rather than merely look
wrong if the generator emitted the wrong thing. If not, let TypeScript and the build own
it, and add nothing to `schema.ts`.

### Where `designs.json` mirrors the config, and where it doesn't

`designs.json` is the app-facing artifact and may differ from the config surface where the
app's needs differ; where both express the same grouping (as `viewer` does on both sides)
they mirror each other. The `render` and `pwa` blocks are the two that don't:

- `render.features` / `.format` / `.fonts` land as the schema's own flat
  `features`/`format`/`fonts` fields, because the app already reads those flat. Only
  `render.heavyMs`/`.cache` nest, under `RenderConfig`, since that pairing is genuinely its
  own build-time-tuning concept. `render.fontFallback` lands in no schema field at all — it
  is rendered into the generated `fonts.conf` and reaches `renderHash` from there.
- `pwa` doesn't appear at all. Every one of its keys (`shortName`, `icon`, `iconMaskable`,
  `backgroundColor`, `categories`, `screenshots`, `shortcuts`, `themeColor`, `install`) is
  a `manifest.webmanifest` / icon-rasterizer input with no runtime reader. The closest
  thing, `vite.config.ts`'s meta-tag injection, already consumes the schema's flat
  `themeColor`/`themeColorLight`/`appleSplash` fields, not a `pwa` object.

In one sentence: mirror the config's grouping when the app shares the concept; keep the
flat shape when it doesn't.

## Reconciling generated files (`scripts/lib/destinations.mjs`)

`public/scad/` (render-input sources, presets) and `public/art/` (browser-facing artwork —
design icon/image, bundled-preset thumbnails, the header logo — split out of `scad/` so
`public/sw.js` can serve it cache-first) hold nothing but generated files, so `gen-schema`
builds each into its own staging directory and swaps it into place wholesale; neither needs
what follows in this section.

Generated output *elsewhere* lands in directories that also hold tracked files, so "clean up
what the last build wrote" has to mean exactly that and nothing broader. `reconcileGenerated` reads
the manifest of what the tool wrote on the previous run and deletes only paths that (a) it
wrote before and (b) it did not write this run. A first run — no manifest yet — deletes
nothing.

Entries are stored and compared **relative to `root`** (the reconciliation boundary, e.g.
`public/`), never as absolute host paths: absolute paths in the persisted manifest leaked
the build-host checkout path into any copy of it, and made a stale or tampered manifest an
authority to remove files anywhere on disk. Storing relative and re-resolving under `root`,
plus a containment check before every delete, means a moved, copied or hand-edited manifest
can only ever remove files inside the current output root. The manifest file itself lives
*outside* `root` so it isn't swept into the built site.

Three guards keep "it wrote before" from ever meaning "a tracked file with the same name":

1. `gen-schema` refuses outright to stage a font copy over a git-tracked destination (a
   config font shadowing a bundled one is a real conflict, not something to overwrite
   silently), so such a path never enters the manifest.
2. Each entry records the digest of the bytes the tool wrote. A path whose content has
   changed since is somebody else's file now, and is left alone with a warning.
3. `isProtected` — `gen-schema` passes `isTrackedFile` — is consulted immediately before
   every delete. This is the guard that covers the window `gen-schema`'s own external-font
   warning describes: a transient copy committed *unchanged* is tracked at reconcile time
   but was not at copy time, and still digests clean, so neither of the first two guards
   sees it.

A missing, corrupt or non-array manifest is treated as "nothing to clean up" rather than a
failure. Entries are `{ path, sha256 }`; a bare string is the pre-digest shape, still read
so an older manifest can clean up its own copies — it just has no digest to check.
