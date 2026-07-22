<!--
meta.contentType: Reference
content plan: define each supported OpenSCAD comment annotation, show its syntax, and explain how the app renders it.
-->

# OpenSCAD annotations

ScadPub adds a handful of comment annotations that `gen-schema.mjs` parses. All are invisible to OpenSCAD and the desktop Customizer.

## Design metadata (`// @description`, `// @icon`, `// @doc`)

A design can describe itself from its own `.scad` file instead of the config. Put these anywhere in the file. A header comment above the first section is the natural home:

```openscad
// @description Auto-sized flat name plate for a door, shelf, or desk.
// @icon icons/nameplate.svg
// @doc nameplate.md

/* [Text] */
label = "Room 1";
```

- **`@description`**: the design's picker sub-label. It sets the same value as `description` on a config `designs[]` entry.
- **`@icon`**: a path to the design's thumbnail. The path resolves **relative to the design's own `.scad` file**, unlike a config `icon`, which is relative to the config. It may be a Scalable Vector Graphics (SVG), PNG, or WebP file. ScadPub serves it as-is and reuses it as the design's manifest shortcut icon.
- **`@doc`**: a path to the design's own user-documentation Markdown file, same path-resolution rule as `@icon`. It sets the same value as `doc` on a config `designs[]` entry. When present, the app shows a documentation button that opens the file's contents in a modal.

All three are **fallbacks**: a value on the design's config `designs[]` entry wins. First occurrence in the file wins; blank values are ignored. This keeps a design self-describing (and works even with auto-discovery, when the config lists no `designs[]` at all), while still letting a deployment override any of them from the config.

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

## Essential and advanced settings (`// @advanced`)

When `ui.essentials` is enabled, parameters marked `// @advanced` start hidden
behind **Show all settings**. Put the annotation in a parameter's comment block
to mark one parameter, or directly above a section header to mark the entire
section. Unmarked parameters are essential by default. The annotation affects
only the browser UI; every value is still sent to OpenSCAD.

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

## On-model text editing (`// @editOnModel`)

Mark one plain string parameter `// @editOnModel` to let the user edit its value **directly on the 3D model** — "type on the sign". In the viewer, a click or tap on the rendered mesh opens a small floating text box pre-filled with the current value; each keystroke updates the parameter exactly like the panel's own text box (same debounced auto-render). An always-visible **edit** pencil chip over the viewer gives the same editor a keyboard- and screen-reader-accessible path, and opens it centered.

```scad
/* [Text] */
// Text to emboss on the tag.
// @editOnModel
label = "ScadPub";
```

Constraints, enforced at build time:

- It is valid **only on a plain `string`** parameter — not a number/boolean, not a `// [..]` enum dropdown, and not a `// @font` string. Any of those fails the build with the file and line.
- **At most one** parameter per design may carry it. A second one fails the build, naming the first.

Behaviour:

- The mesh click is a **click, not a drag**: a pointerdown→pointerup that moved only a few pixels, single-pointer. Orbit, pan, pinch and zoom gestures are completely unaffected and never open the editor. A click that misses the model (grid/empty space) does nothing.
- The editor floats near where you clicked, clamped inside the viewer; on a phone it anchors toward the top so the on-screen keyboard can't cover it.
- **Enter** or clicking away closes it (the value is already applied). **Escape** closes it *and* reverts to the value it had when you opened it.
- The mesh click is offered only once a model is on screen (the last render succeeded). The pencil chip appears whenever the capability is active.

This annotation is purely a UI affordance: the parameter is an ordinary Customizer string everywhere else (the panel, the desktop OpenSCAD Customizer, presets, the URL). A deployment adopts the feature by adding the one comment line to its design; nothing else changes.

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

## Curated review override (`echo("@review", …)`)

A curated review row (`designs[].reviewLabels`, see [config.md](config.md#design-sources)) normally shows a parameter's raw stored value, formatted the same way as any other row. Some designs **transform** a value before it reaches the printed model — a lettering profile that uppercases free text, for instance: typed `"Raum 101"`, printed `"RAUM 101"`. Showing the raw typed value in the review row would misrepresent what's actually on the model.

Echo the rendered value with a fixed 2-argument convention, naming the parameter it overrides:

```scad
/* [Text] */
label = "Raum 101";

rendered_label = uppercase_umlaut(label);
echo("@review", "label", rendered_label);
```

This is a runtime mechanism, like the calculated-value `@info` echo above — no build-time component, nothing in `gen-schema.mjs` changes. The app scans the design's OpenSCAD output for `echo("@review", param, value)` calls after each render and, for any curated review row whose parameter has a matching override, shows that value in place of the parameter's own raw stored value. A parameter with no override behaves exactly as before. Pair this with `designs[].reviewNote` to explain the transform in words (e.g. "Text prints in capitals even though you typed it in lowercase").

Arguments:

| Position | Meaning |
|---|---|
| `"@review"` | Fixed literal tag. Required, must match exactly. |
| Param name (string) | The **declared parameter's exact name** this override applies to — the same name used as a `reviewLabels` key. A name that doesn't match a param, or a param with no `reviewLabels` entry, is simply never looked up. |
| Value | Typically a string — the whole point is showing the rendered TEXT. A quoted string has its quotes stripped; anything else is shown exactly as OpenSCAD printed it. There is no unit argument. |

Two checks help avoid confusing output:

- Overrides are keyed by param name and **last write wins**: a later echo for the same param overwrites an earlier one within the same render, matching `@info`'s own "current value" intent (unlike `@info`'s rows, which are never de-duplicated, since a param name is unique but a label is not).
- A malformed call is silently ignored. If a row still shows the raw value, double-check the argument count and the exact `"@review"` tag, and that the param name matches a `reviewLabels` key exactly.
