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
