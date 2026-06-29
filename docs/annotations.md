# OpenSCAD annotations

ScadPub adds four comment annotations that `gen-schema.mjs` parses. All are invisible to OpenSCAD and the desktop Customizer.

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

`value` is a bare word, quoted string, number, or `true`/`false`. Combine with `&&` and `||` (OR of ANDs). A malformed expression fails safe — the control stays visible.

Visibility is UI-only: hidden parameters are still sent to OpenSCAD, their values are retained, and their DOM nodes are removed.

## Collapsible groups (`// @collapsed`)

Put `// @collapsed` directly above a section header to start it folded:

```scad
// @collapsed
/* [Mounting] */
mounting = "none"; // [none, screw, countersunk]
```

Collapsed parameters remain in the DOM and are still sent to OpenSCAD.

## Font selectors (`// @font`)

Mark a string parameter as a font-family selector so the UI can check its value against the available font set (bundled fonts ∪ imported ones, matched by family name) and offer an inline import / fallback affordance when the family isn't loaded:

```scad
// Lettering face.
// @font
font = "Brand Display:style=Regular";
```

The annotation is required — there's no name-based auto-detection, so a param is only treated as a font selector when you mark it `// @font`.

It applies to both **free-text** string params and `// [..]` enum **dropdowns** of fixed font choices:

```scad
// Lettering face.
// @font
font = "DIN 32986:style=Regular"; // ["DIN 32986:style=Regular", "Liberation Sans:style=Bold"]
```

Annotating the dropdown lets a design keep the native OpenSCAD `// [..]` choice list — which the **desktop** Customizer renders as a dropdown — while still getting the in-app availability check and import affordance when a chosen face (e.g. a not-bundled, license-restricted font) isn't loaded. For a flagged dropdown the one-click fallback switches to the first listed choice whose family *is* loaded (an off-list value can't be shown in a dropdown). See [Fonts](config.md#fonts-fonts-fontfallback) for the availability check and the `fontFallback` config key.

## Viewer info (`// @info`)

Mark a parameter with `// @info` to surface its live value in the viewer's info panel, which appears beneath the size readout while the **dimensions** overlay is toggled on (the ruler button). Each design chooses its own fields, so the panel is model-specific:

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

Values are read live from the controls and formatted by type (booleans as Yes/No, enums by their choice label, empty strings are omitted). A line inherits its parameter's `// @showIf`, so it disappears when that control is hidden. Like the size readout, the panel is purely informative and never part of the exported model.
