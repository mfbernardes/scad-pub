# OpenSCAD annotations

ScadPub adds two comment annotations that `gen-schema.mjs` parses. Both are invisible to OpenSCAD and the desktop Customizer.

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
font = "DIN 32986 Taktil Positiv:style=Regular";
```

The annotation is required — there's no name-based auto-detection, so a string param is only treated as a font selector when you mark it `// @font`. It applies to **free-text** string params only; a `// [..]` enum dropdown of fixed font choices is left alone (its options are pre-vetted). See [Fonts](config.md#fonts-fonts-fontfallback) for the availability check and the `fontFallback` config key.
