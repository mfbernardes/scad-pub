<!--
meta.contentType: Reference
content plan: define each supported OpenSCAD comment annotation, show its syntax, and explain how the app renders it.
-->

# OpenSCAD annotations

ScadPub adds a handful of comment annotations that `gen-schema.mjs` parses. All are invisible to OpenSCAD and the desktop Customizer.

## Design metadata (`// @description`, `// @icon`, `// @image`, `// @doc`)

A design can describe itself from its own `.scad` file instead of the config. Put these anywhere in the file. A header comment above the first section is the natural home:

```openscad
// @description Auto-sized flat name plate for a door, shelf, or desk.
// @icon icons/nameplate.svg
// @image icons/nameplate-photo.jpg
// @doc nameplate.md

/* [Text] */
label = "Room 1";
```

- **`@description`**: the design's picker sub-label. It sets the same value as `description` on a config `designs[]` entry.
- **`@icon`**: a path to the design's small thumbnail. The path resolves **relative to the design's own `.scad` file**, unlike a config `icon`, which is relative to the config. It may be a Scalable Vector Graphics (SVG), PNG, or WebP file. ScadPub serves it as-is and reuses it as the design's manifest shortcut icon.
- **`@image`**: a path to a larger picker-card photo or render — a real picture of the printed/rendered model, distinct from the small `@icon` glyph. Same path-resolution rule as `@icon`, and the same accepted formats. Shown by [`DesignPickerDialog`](config.md#ui-behaviour-and-pwa) (the card-grid design switcher enabled by `ui.gallery`); the classic dropdown Select never shows it. Not reused for the manifest shortcut icon — that stays `@icon`.
- **`@doc`**: a path to the design's own user-documentation Markdown file, same path-resolution rule as `@icon`. It sets the same value as `doc` on a config `designs[]` entry. When present, the app shows a documentation button that opens the file's contents in a modal.

All four are **fallbacks**: a value on the design's config `designs[]` entry wins. First occurrence in the file wins; blank values are ignored. This keeps a design self-describing (and works even with auto-discovery, when the config lists no `designs[]` at all), while still letting a deployment override any of them from the config.

## Conditional parameters (`// @showIf`)

Add `// @showIf <expr>` anywhere in a parameter's doc comment block:

```scad
/* [Arrow] */
arrow = "none"; // [none, left, right, up, down]

// Arrow style. Ignored when arrow is "none".
// @showIf arrow != none
arrow_style = "solid"; // [solid:Solid arrow, outline:Open (outline) arrow]
```

Expression syntax:

| Form | True when |
|---|---|
| `name` | `name` is truthy |
| `!name` | `name` is falsy |
| `name == value` | `name` equals `value` |
| `name != value` | `name` differs from `value` |

`value` is a bare word, quoted string, number, or `true`/`false`. Combine with `&&` and `||` (OR of ANDs). A malformed expression fails safe: the control stays visible.

Visibility is UI-only: hidden parameters are still sent to OpenSCAD, their values are retained, and their DOM nodes are removed.

## Collapsible groups (`// @collapsed`)

Put `// @collapsed` directly above a section header to start it folded:

```scad
// @collapsed
/* [Mounting] */
mounting = "none"; // [none, screw, countersunk]
```

Collapsed parameters remain in the DOM and are still sent to OpenSCAD.

## Essential and advanced settings (`// @advanced`, `// @essential`)

Mark a parameter, or a whole section, `// @advanced` to demote it into an "all settings" view, leaving only the "essentials" visible by default. This is unrelated to `// @collapsed`: a collapsed section is still fully shown, just folded; an advanced parameter can be hidden from the default view entirely, in a client-side settings mode the next milestone builds on top of these annotations.

`// @advanced` works in two positions:

- **Parameter-level** — a bare marker in a parameter's doc-comment block, exactly like `// @font`:

  ```scad
  // Facet count override. Leave at 0 to use the render's global $fn.
  // @advanced
  facet_override = 0; // [0:1:64]
  ```

- **Section-level** — directly above a `/* [Section] */` header, exactly like `// @collapsed`. It marks every parameter in that section occurrence advanced:

  ```scad
  // @advanced
  /* [Coin edge] */
  edge_style = "plain"; // [plain, reeded, milled]
  edge_depth = 0.6; // [0.1:0.1:2]
  ```

  "That section *occurrence*" matters when a section name repeats in the file: `// @advanced` applies only to the header it directly precedes, not to every section sharing that name.

`// @essential` is parameter-level only — a bare marker that overrides a section-level `// @advanced` back to non-advanced for that one parameter:

```scad
// @advanced
/* [Coin edge] */
edge_style = "plain"; // [plain, reeded, milled]

// Always shown, even though the rest of this section is advanced.
// @essential
edge_depth = 0.6; // [0.1:0.1:2]
```

Precedence, resolved per parameter:

1. A parameter-level `// @advanced` always wins — the parameter is advanced.
2. Otherwise, a parameter-level `// @essential` always wins — the parameter is **not** advanced, even inside an advanced section.
3. Otherwise, the parameter is advanced exactly when its section occurrence is `// @advanced`.

`// @essential` on a parameter whose section is not advanced is legal and a no-op — it simply has nothing to override. A single parameter carrying **both** `// @advanced` and `// @essential` is a contradiction and fails the build. `// @advanced` and `// @essential` are also rejected inside the `[Hidden]` section, same as any other annotation on a parameter that never reaches the schema.

`// @showIf` composes with `// @advanced` as an AND: an advanced parameter that's also conditionally hidden needs both the "all settings" view active *and* its `@showIf` condition true to show its control. Like `@showIf` and `@collapsed`, this is UI-only: an advanced parameter's value is still retained and always sent to OpenSCAD, whether or not its control is currently shown.

## Guided steps (`// @step`)

Mark a section `// @step <id>` (or `// @step <id> | <label>`) to fold it into a named step of QuickStart, a guided, curated-subset-at-a-time navigation over the same form — never a destructive wizard: nothing unmounts, earlier steps stay reachable via their chip, and every value lives in the same app state regardless of which step is showing. QuickStart replaces the classic scrolling form only in guided experience's essentials settings view, for a design that declares at least one `// @step` (and `ui.quickStart` — see [`ui.quickStart`](config.md#ui-behaviour-and-pwa) — hasn't opted out); standard experience, the All settings view, and an active search query always show the classic form instead, one action (the settings-view toggle, or just clearing the search box) away. See `src/components/QuickStart.tsx`.

QuickStart itself renders differently by layout, deriving from the same step list either way (so a step that disappears — every one of its params hidden by `@showIf` or the settings view — drops its chip identically in both):

- **Desktop** (the docked parameter panel has room to spare): every visible step's group renders at once in a single scrollable form, with the chip strip as sticky anchors — click a chip and its group smooth-scrolls into view (instant if the visitor prefers reduced motion) rather than swapping content. There's no Back/Next; `aria-current` on the chip strip tracks scroll position instead.
- **Mobile** (the bottom sheet is short on vertical room): one step's content shows at a time, with Back/Next alongside the chips — the original behavior, unchanged.

`// @step` is **section-level only** — directly above a `/* [Section] */` header, exactly like `// @collapsed` and section-level `// @advanced`:

```scad
// @step text | Text
/* [Text] */
label = "Room 1";

// @step size | Size
/* [Size] */
width = 60; // [20:1:200]
height = 25; // [10:1:100]

// @step mounting
/* [Mounting] */
mounting = "none"; // [none, screw, countersunk]
```

- **`<id>`**: a bare token, `[A-Za-z0-9_-]+` — stable and never shown; it's what other tooling (and QuickStart's own current-step state) refers to the step by.
- **`<label>`** (optional): free text, trimmed, shown as the step's own name in the UI. Omit it (bare `// @step mounting`) and the label defaults to the section name of that id's *first* occurrence in the file — here, "Mounting".

### Sharing a step across sections

Several section occurrences — even ones with different names — can carry the same step id. Their parameters concatenate, in file order, into one step:

```scad
// @step tag | Tag details
/* [Text] */
label = "Room 1";

/* [Mounting] */
// @step tag
mounting = "none"; // [none, screw, countersunk]
```

Both `[Text]` and `[Mounting]` belong to the `tag` step here; its label is "Tag details", from the first occurrence. A later occurrence's own `| <label>` text (if it supplies one) is simply ignored — only the first appearance's label wins. This isn't an error; it's documented behavior, so renaming a label only ever means editing the first `// @step` line.

**Step order** is the order each id first appears in the file — not necessarily the order of every section. Declare a step's *first* occurrence at the point in the file where you want it to appear in the step sequence.

### Sections without a step

A section without `// @step` is perfectly legal in a stepped design. When it's *essential* (see below) it still isn't lost: QuickStart lists it under an "Also available" heading below the step content — the current step's, on mobile; every visible step's, on desktop's scrolled form. An all-`@advanced` un-stepped section instead stays behind the All settings view, exactly like an advanced param anywhere else. This is deliberate for a section that doesn't belong in the guided flow — a `[Hidden]`-adjacent power-user section, for instance.

What's *not* deliberate, most of the time, is simply forgetting to tag a section that should be part of the flow. gen-schema flags that case: once a design declares at least one `// @step`, every remaining **essential** section (one with at least one parameter that isn't `// @advanced` — see above) that carries no step gets a build-time warning listing it by name. An all-`@advanced` section left un-stepped never triggers this in either mode, since it was already going to be hidden from the default "essentials" view regardless.

Set `"ui": { "strictSteps": true }` in the config (see [`ui.strictSteps`](config.md#ui-behaviour-and-pwa)) to promote that warning to a build **error** — useful once a stepped design is meant to route every essential setting through the guided flow and a forgotten section should block the build, not just print a warning.

### Restrictions

- `// @step` directly above a *parameter* (instead of a section header) is a malformed-annotation build error — the inverse of `// @essential`'s parameter-only restriction.
- `// @step` is rejected on (or inside) the `[Hidden]` section, same as `// @advanced` and `// @essential` — a step over a section whose params are skipped entirely below is nonsensical.
- A malformed shape — bare `@step` with no id, an id with characters outside `[A-Za-z0-9_-]`, or an explicit `| ` with nothing (or only whitespace) after it — fails the build with the file and line, exactly like every other annotation here.

## Font selectors (`// @font`)

Mark a string parameter as a font selector. In the app, it renders as a **font dropdown** listing every face the renderer can use: bundled fonts plus imported fonts. Friendly names come from the font files themselves, such as "Liberation Sans Bold", never the raw Fontconfig `Family:style=Style` string. The list updates the moment you import a font, and the menu includes an **Import font…** action.

```scad
// Lettering face.
// @font
font = "Brand Display:style=Regular";
```

The annotation is required. There is no name-based auto-detection, so ScadPub treats a param as a font selector only when you mark it `// @font`.

It applies to both **free-text** string params and `// [..]` enum **dropdowns** of fixed font choices:

```scad
// Lettering face.
// @font
font = "Brand Display:style=Regular"; // ["Brand Display:style=Regular", "Liberation Sans:style=Bold"]
```

The `// [..]` choice list is what the **desktop** Customizer renders as a dropdown. In the app, listed faces that are not loaded stay visible and selectable in a "Needs a font file" group. That lets a design keep suggesting its preferred face, even when the font is not bundled.

When the selected face's family is not loaded, an inline hint appears beneath the control with two fixes: **Import font…** or a one-click switch to a loaded family. For a flagged dropdown, the fallback is the first listed choice whose family is loaded. See [Fonts](config.md#fonts-fonts-fontfallback) for the availability check and the `fontFallback` config key.

## SVG fields (`// @svg`, `// @filledBy`)

Mark a string parameter that names an SVG file with `// @svg`. In the app, the plain path box becomes a **drop zone / "Prepare SVG…" button** that opens an in-app wizard.

The wizard checks the drawing against OpenSCAD's geometry-only `import()`. OpenSCAD drops `<text>`, colour, `<image>`, `<use>`, and filters. The wizard can apply safe fixes, such as normalising an off-origin `viewBox` and renaming Inkscape layer IDs to their labels.

When the field binds colours, the wizard also reads the drawing's per-region colours. On finish, it writes the fixed SVG into the render's virtual filesystem, points the parameter at it, and re-renders. The configurator's own 3D viewer is the preview.

```scad
// The drawing to extrude. Drop in an SVG; the wizard checks and fixes it.
// @svg
svg_file = "emblem.svg";
```

Add `layers=<param>` to derive the drawing's colours and write the standard **layers string** into a second parameter. The value is a comma-separated `id:colour` list, with a bare-token shorthand such as `gray, c8b0000`. It is blank for a single-colour drawing.

Mark that target parameter `// @filledBy <svg-param>` so the UI renders it demoted behind an "Advanced" disclosure. It stays editable for power users, but the wizard is its normal writer.

```scad
// The drawing to extrude. The wizard reads out its colours.
// @svg layers=svg_layers
svg_file = "plan.svg";

// Region colours, filled in by the SVG wizard.
// @filledBy svg_file
svg_layers = "";
```

The wizard grades what it finds by severity: **errors first, then warnings, then notes**. A residual **error**, such as no importable geometry, blocks completion. The *Use this SVG* button stays disabled until you resolve it.

Warnings, such as dropped `<text>` or stroke-only outlines, are informational. The drawing still imports, minus what OpenSCAD cannot read. Before the wizard opens, a dropped file that is not an SVG, or one over 2 MB, is rejected inline.

On the colours step, the wizard cautions when a drawing yields several regions that may import unreliably into slicers. It also marks any region colour it cannot preview, while still passing that colour to OpenSCAD verbatim.

`@svg` composes with a co-located `// @showIf`, so a conditional SVG field still gets the affordance. Both annotations are invisible to OpenSCAD, which imports the file and, for the per-region path, selects regions by their `<g id>`.

## Viewer info (`// @info`)

Mark a parameter with `// @info` to surface its value in the viewer's measurements panel, which appears while the **dimensions** overlay is toggled on (the ruler button). The panel always leads with the model's bounding box (`Dimensions  W × D × H mm`); annotated parameters follow beneath it. Each design chooses its own fields, so the panel is model-specific:

```scad
// Text to emboss on the tag.
// @info Engraved text
label = "ScadPub";

// Font height (mm).
// @info Text height | mm
text_size = 9; // [3:0.5:30]
```

The text after `@info` is optional:

| Form | Shows |
|---|---|
| `// @info` | the parameter's own label (its first doc sentence) + value |
| `// @info Label` | a custom `Label` + value |
| `// @info Label \| mm` | a custom `Label` + value with the unit `mm` appended |

Values reflect the **rendered** model, not the live controls. A line updates only once a render finishes, in step with the bounding box. Values are formatted by type: booleans as Yes/No, enums by their choice label, and empty strings omitted. A line inherits its parameter's `// @showIf`, so it disappears when that control is hidden. The panel is purely informative and never part of the exported model.

## Calculated values (`echo("@info", …)`)

The `// @info` annotation above only works on real Customizer parameters. `gen-schema.mjs` parses `.scad` source statically, so it cannot know the numeric result of an internal formula for your current values. Only OpenSCAD can evaluate that at render time.

For a computed or derived value, echo it with a fixed 4-argument convention instead. This also works for values your design assigns only inside a `/* [Hidden] */` section:

```scad
r = diameter / 2;
echo("@info", "Radius", "mm", r);
```

This runtime mechanism is separate from the comment-based `// @info` annotation above. It has no build-time component: nothing in `gen-schema.mjs` changes, and the Customizer parameter surface is untouched. The app scans the design's OpenSCAD output for `echo("@info", label, unit, value)` calls and adds one row per matching echo to the measurements panel. Rows appear after the bounding box and any parameter `@info` rows, in the order the design echoes them.

The call can appear anywhere after the value is known, including inside a conditional. When the branch does not run, the echo does not fire:

```scad
if (relevant)
  echo("@info", "X", "mm", x);
```

Arguments:

| Position | Meaning |
|---|---|
| `"@info"` | Fixed literal tag. Required, must match exactly. |
| Label (string) | Row label, e.g. `"Dot height"`. |
| Unit (string) | Appended after the value, e.g. `"mm"`. Use `""` for a unitless value. |
| Value | Any OpenSCAD value: number, string, boolean, vector, or `undef`. |

A quoted string has its quotes stripped; everything else (numbers, booleans, vectors, `undef`) is shown exactly as OpenSCAD printed it. The unit is appended as `value unit`.

Two checks help avoid confusing output:

- Rows are **not** de-duplicated. If two branches both echo the same label unconditionally, you see two rows. Make sure only one branch echoes a given label per render.
- A malformed call is silently ignored. If a row does not appear, double-check the argument count and the exact `"@info"` tag.
