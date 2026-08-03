<!--
meta.contentType: Reference
content plan: define each supported OpenSCAD comment annotation, show its syntax, and explain how the app renders it.
-->

# OpenSCAD annotations

ScadPub adds a handful of comment annotations that `gen-schema.mjs` parses. All are invisible to OpenSCAD and the desktop Customizer.

## Design metadata (`// @description`, `// @icon`, `// @image`, `// @doc`)

A design describes itself from its own `.scad` file: this is the **only** place its picker sub-label, thumbnail icon, gallery card art, and user-doc come from; there is no config-level override or escape hatch. Put these anywhere in the file. A header comment above the first section is the natural home:

```openscad
// @description Auto-sized flat name plate for a door, shelf, or desk.
// @icon icons/nameplate.svg
// @doc nameplate.md

/* [Text] */
label = "Room 1";
```

- **`@description`**: the design’s picker sub-label.
- **`@icon`**: a path to the design’s thumbnail, resolved **relative to the design’s own `.scad` file** (and checked to stay inside `source`). It may be a Scalable Vector Graphics (SVG), PNG, or WebP file. ScadPub serves it as-is and reuses it as the design’s manifest shortcut icon.
- **`@image`**: a path to larger card artwork for `ui.gallery`, same path-resolution rule as `@icon`. May also be SVG, PNG, or WebP. When omitted, the gallery card falls back to `@icon` instead (see `ui.gallery` in [config.md](config.md#ui-behaviour-and-pwa)).
- **`@doc`**: a path to the design’s own user-documentation Markdown file, same path-resolution rule as `@icon`. When present, the app shows a documentation button that opens the file’s contents in a modal.

First occurrence of each in the file wins; blank values are ignored. This keeps a design self-describing, and works even with auto-discovery, when the config lists no `designs[]` at all.

## Short control labels (`// @label`)

By default a parameter’s control label is the **first sentence** of its comment block, and the whole block becomes the ⓘ help. That default is right when the docstring reads as a label first and an explanation after (“Figure height (mm). The width follows the silhouette’s aspect ratio.”). It is wrong when the docstring is a single explanatory sentence, which is the usual way to write a Customizer comment:

```scad
// Choose the material and finish standard for this bracket.
material_standard = "steel-astm"; // [steel-astm:Steel, alu-astm:Aluminum]
```

That sentence is a good description and a poor label: above a dropdown on a phone it wraps to two lines where a noun phrase would do. `// @label "…"` supplies the label directly and demotes the whole comment block to help:

```scad
// Choose the material and finish standard for this bracket.
// @label "Material & finish"
material_standard = "steel-astm"; // [steel-astm:Steel, alu-astm:Aluminum]
```

- The quoted label is **required and non-empty**: a control always needs a label, so `@label ""` fails the build rather than clearing one. Bare `@label Short` (unquoted) fails too.
- Nothing is lost. The comment block still becomes `help`, and the app shows its ⓘ popover whenever help differs from the label, so the explanation is one tap away.
- Without the annotation, the first-sentence default is unchanged. That split handles decimals (`0.4 mm`), abbreviations (`e.g.`, `i.e.`, `z.B.`) and sentences opening with a quote (`Text alignment. "center" (default) centres …`), so a multi-sentence block usually needs no annotation at all.
- It also names the parameter in the viewer’s info panel when `// @info` carries no label of its own.

Use it when a docstring’s first sentence is longer than a few words. Skip it when the first sentence already reads as a label.

## Conditional parameters (`// @showIf`)

Add `// @showIf <expr>` anywhere in a parameter’s doc comment block:

```scad
/* [Arrow] */
arrow = "none"; // [none, left, right, up, down]

// Arrow style. Ignored when arrow is "none".
// @showIf arrow != none
arrow_style = "solid"; // [solid:Solid arrow, outline:Open (outline) arrow]
```

Expression syntax:

| Form | True when |
| --- | --- |
| `name` | `name` is truthy |
| `!name` | `name` is falsy |
| `name == value` | `name` equals `value` |
| `name != value` | `name` differs from `value` |

`value` is a bare word, quoted string, number, or `true`/`false`. Combine with `&&` and `||` (OR of ANDs). A malformed expression fails safe: the control stays visible.

`@show-if` (with a hyphen) is accepted as an alias, case-insensitively.

Visibility is UI-only: hidden parameters are still sent to OpenSCAD, their values are retained, and their DOM nodes are removed.

## Collapsible groups (`// @collapsed`)

Put `// @collapsed` directly above a section header to start it folded:

```scad
// @collapsed
/* [Mounting] */
mounting = "none"; // [none, screw, countersunk]
```

Collapsed parameters remain in the DOM and are still sent to OpenSCAD.

`@collapse` (without the `-d`) is accepted as an alias, case-insensitively.

## Essential and advanced settings (`// @advanced`)

When `ui.essentials` is enabled, parameters marked `// @advanced` start hidden
behind **Show all settings**. Put the annotation in a parameter’s comment block
to mark one parameter, or directly above a section header to mark the entire
section. Unmarked parameters are essential by default. The annotation affects
only the browser UI; every value is still sent to OpenSCAD.

## Font selectors (`// @font`)

Mark a string parameter as a font selector. In the app, it renders as a **font dropdown** listing every face the renderer can use: bundled fonts plus imported fonts. Friendly names come from the font files themselves, such as “Liberation Sans Bold”, never the raw Fontconfig `Family:style=Style` string. The list updates the moment you import a font, and the menu includes an **Import font…** action.

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

The `// [..]` choice list is what the **desktop** Customizer renders as a dropdown. In the app, listed faces that are not loaded stay visible and selectable in a “Needs a font file” group. That lets a design keep suggesting its preferred face, even when the font is not bundled.

When the selected face’s family is not loaded, an inline hint appears beneath the control with two fixes: **Import font…** or a one-click switch to a loaded family. For a flagged dropdown, the fallback is the first listed choice whose family is loaded. See [Fonts](config.md#fonts-renderfonts-renderfontfallback) for the availability check and the `fontFallback` config key.

## SVG fields (`// @svg`, `// @filledBy`)

Mark a string parameter that names an SVG file with `// @svg`. In the app, the plain path box becomes a **drop zone / “Prepare SVG…” button** that opens an in-app wizard.

The wizard checks the drawing against OpenSCAD’s geometry-only `import()`. OpenSCAD drops `<text>`, colour, `<image>`, `<use>`, and filters. The wizard can apply safe fixes, such as normalising an off-origin `viewBox` and renaming Inkscape layer IDs to their labels.

When the field binds colours, the wizard also reads the drawing’s per-region colours. On finish, it writes the fixed SVG into the render’s virtual filesystem, points the parameter at it, and re-renders. The configurator’s own 3D viewer is the preview.

```scad
// The drawing to extrude. Drop in an SVG; the wizard checks and fixes it.
// @svg
svg_file = "emblem.svg";
```

Add `layers=<param>` to derive the drawing’s colours and write the standard **layers string** into a second parameter. It is blank for a single-colour drawing; otherwise it is a comma-separated list of:

- `id:colour` region entries, with a bare-token shorthand such as `gray, c8b0000` when the id already names its colour, and an optional third field giving that region’s own relief height in millimetres (`walls:gray:2.5`). A height is a **plain positive decimal** (no sign, no exponent) because a design’s own parser is hand-written and typically hard-fails on anything else rather than falling back. The wizard blocks completion on a height outside that grammar, which the browser’s number input would otherwise accept (`0`, `-2`, `1e3`);
- one leading **canvas entry**, `<width>x<height>`, naming the drawing’s `viewBox` size (`120x80, walls:gray`). A design that imports its regions uncentred (the only way to keep them registered with each other) cannot measure the drawing, so this is what lets it place the regions. It is omitted when the drawing declares no `viewBox`.

Mark that target parameter `// @filledBy <svg-param>` so the UI renders it demoted behind an “Advanced” disclosure. It stays editable for power users, but the wizard is its normal writer.

```scad
// The drawing to extrude. The wizard reads out its colours.
// @svg layers=svg_layers
svg_file = "plan.svg";

// Region colours, filled in by the SVG wizard.
// @filledBy svg_file
svg_layers = "";
```

Add `height=<param>` to name the **number parameter a region’s height falls back to**: the design’s own relief height. The wizard shows it as the placeholder in each region’s height box, so a blank box reads as “raise this region by the design’s relief height” with the actual number in view. Unlike `layers=`, it needs no reciprocal annotation: the wizard only reads it.

```scad
// @svg layers=svg_layers height=relief_height
svg_file = "plan.svg";
```

Both options may appear in either order, and each at most once. Any other trailing text fails the build.

The wizard grades what it finds by severity: **errors first, then warnings, then notes**. A residual **error**, such as no importable geometry, blocks completion. The *Use this SVG* button stays disabled until you resolve it.

Warnings, such as dropped `<text>` or stroke-only outlines, are informational. The drawing still imports, minus what OpenSCAD cannot read. Before the wizard opens, a dropped file that is not an SVG, or one over 2 MB, is rejected inline.

On the colours step, the wizard cautions when a drawing yields several regions that may import unreliably into slicers. It also marks any region colour it cannot preview, while still passing that colour to OpenSCAD verbatim. Each region additionally gets a **height** box; the layers string below stays the single source of truth, so a hand-edit of it is never overwritten by the boxes. A height the consuming design could not use marks its box and disables *Use this SVG*, so a bad value never reaches the renderer.

`@svg` composes with a co-located `// @showIf`, so a conditional SVG field still gets the affordance. Both annotations are invisible to OpenSCAD, which imports the file and, for the per-region path, selects regions by their `<g id>`.

## On-model text editing (`// @editOnModel`)

Mark one plain string parameter `// @editOnModel` to let the user edit its value **directly on the 3D model**: “type on the sign”. In the viewer, a click or tap on the rendered mesh opens a small floating text box pre-filled with the current value; each keystroke updates the parameter exactly like the panel’s own text box (same debounced auto-render). It is a **shortcut, not a second edit path**: the parameter’s own text box in the panel stays the canonical control, so the editor carries no permanent affordance over the viewer. A pointer gesture on the mesh is the only way in.

```scad
/* [Text] */
// Text to emboss on the tag.
// @editOnModel
label = "ScadPub";
```

Constraints, enforced at build time:

- It is valid **only on a plain `string`** parameter, not a number/boolean, not a `// [..]` enum dropdown, and not a `// @font` string. Any of those fails the build with the file and line.
- **At most one** parameter per design may carry it. A second one fails the build, naming the first.

Behaviour:

- The mesh click is a **click, not a drag**: a pointerdown→pointerup that moved only a few pixels, single-pointer. Orbit, pan, pinch and zoom gestures are completely unaffected and never open the editor. A click that misses the model (grid/empty space) does nothing.
- The editor floats near where you clicked, clamped inside the viewer; on a phone it anchors toward the top so the on-screen keyboard can’t cover it.
- **Enter** or clicking away closes it (the value is already applied). **Escape** closes it *and* reverts to the value it had when you opened it.
- The mesh click is offered only once a model is on screen (the last render succeeded).
- Because it is pointer-only, it never *replaces* the panel’s text box: a keyboard or screen-reader user edits the same value there, exactly as for any other parameter.

This annotation is purely a UI affordance: the parameter is an ordinary Customizer string everywhere else (the panel, the desktop OpenSCAD Customizer, presets, the URL). A deployment adopts the feature by adding the one comment line to its design; nothing else changes.

## Viewer info (`// @info`)

Mark a parameter with `// @info` to surface its value in the viewer’s measurements panel, which appears while the **dimensions** overlay is toggled on (the ruler button). The panel always leads with the model’s bounding box (`Dimensions  W × D × H mm`); annotated parameters follow beneath it. Each design chooses its own fields, so the panel is model-specific:

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
| --- | --- |
| `// @info` | the parameter’s own label (its first doc sentence) + value |
| `// @info Label` | a custom `Label` + value |
| `// @info Label \| mm` | a custom `Label` + value with the unit `mm` appended |

Values reflect the **rendered** model, not the live controls. A line updates only once a render finishes, in step with the bounding box. Values are formatted by type: booleans as Yes/No, enums by their choice label, and empty strings omitted. A line inherits its parameter’s `// @showIf`, so it disappears when that control is hidden. The panel is purely informative and never part of the exported model.

## Calculated values (`echo("@info", …)`)

The `// @info` annotation above only works on real Customizer parameters. `gen-schema.mjs` parses `.scad` source statically, so it cannot know the numeric result of an internal formula for your current values. Only OpenSCAD can evaluate that at render time.

For a computed or derived value, echo it with a fixed 4-argument convention instead. This also works for values your design assigns only inside a `/* [Hidden] */` section:

```scad
r = diameter / 2;
echo("@info", "Radius", "mm", r);
```

This runtime mechanism is separate from the comment-based `// @info` annotation above. It has no build-time component: nothing in `gen-schema.mjs` changes, and the Customizer parameter surface is untouched. The app scans the design’s OpenSCAD output for `echo("@info", label, unit, value)` calls and adds one row per matching echo to the measurements panel. Rows appear after the bounding box and any parameter `@info` rows, in the order the design echoes them.

The call can appear anywhere after the value is known, including inside a conditional. When the branch does not run, the echo does not fire:

```scad
if (relevant)
  echo("@info", "X", "mm", x);
```

Arguments:

| Position | Meaning |
| --- | --- |
| `"@info"` | Fixed literal tag. Required, must match exactly. |
| Label (string) | Row label, e.g. `"Rim height"`. |
| Unit (string) | Appended after the value, e.g. `"mm"`. Use `""` for a unitless value. |
| Value | Any OpenSCAD value: number, string, boolean, vector, or `undef`. |

A quoted string has its quotes stripped; everything else (numbers, booleans, vectors, `undef`) is shown exactly as OpenSCAD printed it. The unit is appended as `value unit`.

Two checks help avoid confusing output:

- Rows are **not** de-duplicated. If two branches both echo the same label unconditionally, you see two rows. Make sure only one branch echoes a given label per render.
- A malformed call is silently ignored. If a row does not appear, double-check the argument count and the exact `"@info"` tag.

## Curated review label (`// @review`)

Mark a parameter `// @review "<label>"` to set the label its value is shown under in the pre-download review summary (`designs[].reviewLabels`; see [config.md](config.md#design-sources)). It labels the parameter it sits on (there’s no name argument, unlike `// @filledBy`) so the label lives beside the parameter it documents instead of a separate config block that would have to re-state the parameter’s own name back to itself:

```scad
/* [Text] */
// Text to emboss on the tag.
// @review "Text"
label = "ScadPub";

// Font family/style.
// @font
// @review "Typeface"
font = "Liberation Sans:style=Bold";
```

The quoted label is required: bare `// @review`, with no label, fails the build the same way a malformed `@showIf` does, and so does a label that’s present but blank (`@review ""`). Several parameters may set the same label; their values merge into a single review row, joined by `" / "` (`src/lib/reviewSummary.ts`). A parameter with no `// @review` annotation contributes no row. There is no config-level way to add or override a label: a design’s own annotations are the only source.

Adding `// @review` to a design’s `.scad` file changes that file’s bytes and therefore its `renderHash` (see [Everything renderable is generated at build time](../CLAUDE.md): `renderHash` hashes the mounted `.scad`, comments included). A deployment that adopts the annotation on an already-shipped design invalidates every cached render for it, exactly like any other edit to a mounted `.scad` file.

## Curated review note (`// @reviewNote`)

Set a design’s review-summary note from its own `.scad` file: the same file-level idiom as `// @description`/`@icon`/`@image`/`@doc` above, put anywhere in the file (a header comment is the natural home):

```scad
// @reviewNote "Text prints in capitals even though you typed it in lowercase."

/* [Text] */
label = "gate 12";
```

- First occurrence in the file wins; a blank quoted string (`""`) is ignored, same as the other file-level annotations.
- Unlike those, the quoted-string form is required here: `// @reviewNote` followed by anything other than a `"…"` string fails the build. There is no config-level override: a design’s own `// @reviewNote` is the only source.

Like `// @review` above, adding this line to a design’s `.scad` file changes its `renderHash` for any deployment building against it.

## Curated review override (`echo("@review", …)`)

Not to be confused with the build-time `// @review "<label>"` comment annotation above, which sets a row’s *label*: this is a runtime `echo()` that overrides a row’s *value*.

A curated review row (`designs[].reviewLabels`, see [config.md](config.md#design-sources)) normally shows a parameter’s raw stored value, formatted the same way as any other row. Some designs **transform** a value before it reaches the printed model: a lettering profile that uppercases free text, for instance: typed `"gate 12"`, printed `"GATE 12"`. Showing the raw typed value in the review row would misrepresent what’s actually on the model.

Echo the rendered value with a fixed 2-argument convention, naming the parameter it overrides:

```scad
/* [Text] */
label = "gate 12";

rendered_label = to_upper(label);
echo("@review", "label", rendered_label);
```

This is a runtime mechanism, like the calculated-value `@info` echo above: no build-time component, nothing in `gen-schema.mjs` changes. The app scans the design’s OpenSCAD output for `echo("@review", param, value)` calls after each render and, for any curated review row whose parameter has a matching override, shows that value in place of the parameter’s own raw stored value. A parameter with no override behaves exactly as before. Pair this with `designs[].reviewNote` to explain the transform in words (e.g. “Text prints in capitals even though you typed it in lowercase”).

Arguments:

| Position | Meaning |
| --- | --- |
| `"@review"` | Fixed literal tag. Required, must match exactly. |
| Param name (string) | The **declared parameter’s exact name** this override applies to — the same name used as a `reviewLabels` key. A name that doesn’t match a param, or a param with no `reviewLabels` entry, is never looked up. |
| Value | Typically a string — the whole point is showing the rendered TEXT. A quoted string has its quotes stripped; anything else is shown exactly as OpenSCAD printed it. There is no unit argument. |

Two checks help avoid confusing output:

- Overrides are keyed by param name and **last write wins**: a later echo for the same param overwrites an earlier one within the same render, matching `@info`'s own “current value” intent (unlike `@info`'s rows, which are never de-duplicated, since a param name is unique but a label is not).
- A malformed call is silently ignored. If a row still shows the raw value, double-check the argument count and the exact `"@review"` tag, and that the param name matches a `reviewLabels` key exactly.
