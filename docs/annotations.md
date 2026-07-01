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

Values reflect the **rendered** model, not the live controls — a line updates only once a render finishes, in step with the bounding box — and are formatted by type (booleans as Yes/No, enums by their choice label, empty strings are omitted). A line inherits its parameter's `// @showIf`, so it disappears when that control is hidden. The panel is purely informative and never part of the exported model.

## Calculated values (`echo("@info", ...)`)

The `// @info` annotation above only works on real Customizer parameters — `gen-schema.mjs` parses `.scad` source statically, so it can never know the actual numeric result of an internal formula (e.g. a dot height derived from a base value and a norm-specified factor) for whatever values a user currently has set; only OpenSCAD itself, at render time, can evaluate that. For a computed/derived value — including one your design only assigns inside a `/* [Hidden] */` section — echo it with a fixed 4-argument convention instead:

```scad
r = diameter / 2;
echo("@info", "Radius", "mm", r);
```

This is a **separate, purely-runtime mechanism** from the comment-based `// @info` annotation above — don't confuse the two. It has no build-time component at all: nothing in `gen-schema.mjs` changes, and the Customizer parameter surface is untouched. The app scans the design's OpenSCAD output for `echo("@info", label, unit, value)` calls and adds one row per matching echo to the measurements panel, after the bounding box and any parameter `@info` rows, in the order the design echoes them.

The call can appear anywhere after the value is known, including inside a conditional — the echo simply won't fire when not applicable, which is often simpler than a `// @showIf` expression:

```scad
if (relevant)
  echo("@info", "X", "mm", x);
```

Arguments:

| Position | Meaning |
|---|---|
| `"@info"` | Fixed literal tag — required, must match exactly. |
| Label (string) | Row label, e.g. `"Dot height"`. |
| Unit (string) | Appended after the value, e.g. `"mm"`. Use `""` for a unitless value. |
| Value | Any OpenSCAD value — number, string, boolean, vector, or `undef`. |

A quoted string has its quotes stripped; everything else (numbers, booleans, vectors, `undef`) is shown exactly as OpenSCAD printed it. The unit is appended as `value unit`.

Two things to watch for: rows are **not** de-duplicated, so if two branches both echo the same label unconditionally you'll see two rows — make sure only one branch echoes a given label per render. And a malformed call (wrong number of arguments, or a missing/misspelled `"@info"` tag) is silently ignored — if a row doesn't appear, double-check your `echo()` matches the four-argument form exactly.
