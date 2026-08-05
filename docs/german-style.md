<!--
meta.contentType: Reference
content plan: give German-copy authors (src/locales/de.json, design .strings.de.json
sidecars, .de.md docs, config de leaves) a durable glossary and style yardstick, so new
copy lands consistent instead of drifting per author/PR.
-->

# German style

The working reference for German UI copy: `src/locales/de.json`, design
`.strings.de.json` sidecars ([config.md#design-translations](config.md#design-translations)),
`.de.md` docs, and `de` leaves in `scadpub.config.json`. Not an essay — check a term or
rule here before writing new German copy or reviewing a translation PR.

## Glossary

One canonical German term per concept. Never use the alternatives listed.

| Concept | Canonical | Never |
|---|---|---|
| The preview render process | Vorschau … erstellen / … aktualisieren | Render, Rendering (as a verb) |
| The WASM subsystem that renders | Render-Engine | 3D-Engine, Renderer |
| Save the print-ready file | Herunterladen / Download | Exportieren (reserved for presets) |
| Move a preset file in/out as JSON | Exportieren / Importieren | — |
| A typeface the user supplies | Schrift | Font |
| The whole customize panel | Parameterbereich | — |
| One collapsible group within it | Abschnitt | Bereich (alone), Sektion |
| The configurable template | Design | Modell |
| The rendered/exported geometry | Modell | Design |
| A named settings snapshot | Voreinstellung | Preset |
| The bell/console surface as a whole | Meldungen | — |
| Its notices sub-tab | Hinweise | — |
| Its raw-output sub-tab | Protokoll | — |
| Its render-stats sub-tab | Kennzahlen | Messwerte |
| An SVG drawing | Zeichnung | — |
| Its drawable area (the viewBox) | Zeichenfläche | Zeichenrahmen (only when English source itself says "canvas frame", e.g. an absent viewBox — mirror the source distinction, don't introduce it) |
| A shape within it | Form | — |
| A named colour group of shapes | Farbbereich | — |
| Add a user file to a design | importieren | hochladen (see below) |
| Verb for reviewing/validating | prüfen | kontrollieren, testen |
| Raised relief | erhaben | erhöht |
| Sunken/incised relief | eingraviert / eingravieren | — |
| The print base | Grundplatte (first/defining reference) or Platte (short form in flowing text) | — |
| Touch a control (touchscreen) | antippen | tippen (kept only where space is genuinely constrained, e.g. a dense aria-label) |
| Press with a mouse | klicken | — |
| Push a physical/on-screen button verb in remediation copy | drücken | — |
| Move a slider/pointer | ziehen | — |
| Swipe gesture | wischen | — |
| A clickable control | Schaltfläche | Button |
| A drag-to-set numeric control | Schieberegler | Slider, Regler (alone) |
| A single-choice list control | Auswahlliste | Dropdown, Drop-down |
| An on/off control | Schalter | Switch, Toggle |
| The app's top chrome | obere Leiste | oben (alone), Top-Bar |
| A license's source link | Quellcode | Quelle |
| The panel-collapsed viewer state | Vollbildansicht | Vollbild-Ansicht (don't hyphenate — see Typography) |

**`importieren`, never `hochladen`:** every user-supplied file (font, SVG) stays local to
the browser — nothing goes to a server — so "hochladen" (upload) is not just off-glossary,
it's factually wrong. Reserve "hochladen" for the rare place prose explicitly says the
*opposite* ("nichts wird hochgeladen" — nothing is uploaded).

## Register

- **Infinitive or bare imperative** for labels, titles, and short remediation clauses
  after an em dash: *"Verbindung prüfen und erneut versuchen."*, *"die Zeichnung
  vereinfachen und erneut versuchen."*
- **Sie-form** for standalone prose of two clauses or more: *"Prüfen Sie die Downloads
  Ihres Browsers — in den Slicer laden und drucken können Sie, sobald Sie bereit sind."*
- Don't mix the two within one sentence's main clause; a trailing infinitive remediation
  clause after an em dash is not a mix.

## Typography

- `„…"` (low-high quotes), never straight `"…"`.
- `…` is U+2026, never three periods.
- Em dash (`—`) for asides — deliberate house style, matches the English source rather
  than the more common German en dash usage. Don't "fix" it to `–`.
- `z. B.` (space between the two abbreviated words), not `z.B.`
- Decimal comma in prose (`1,5 mm`), **except** a value that is literally what to type
  into a locale-invariant `<input type="number">` (see `SvgWizard.tsx`'s `D3` reasoning) —
  those stay period-decimal because the field itself rejects a comma.
- A space before a unit: `2 MB`, `1,5 mm`.
- Compound hyphenation: hyphenate only after an acronym or a recent loanword
  (`SVG-Zeichnung`, `Render-Engine`, `Exit-Code`, `Live-Vorschau`, `App-Chrome`); close
  compounds where every part is native German (`Zeichnungssteuerelement`,
  `Zeichenflächenrechteck`, `Ebenenspezifikation`, `Drittanbieterbibliotheken`).

## Deliberate exceptions

- `help.defaultTitle`: **"So verwenden Sie diesen Konfigurator"** — an idiomatic Sie-form
  title kept as-is even though most titles/labels default to the infinitive register.
- The em dash (see Typography) — intentional, not an oversight to "correct" toward `–`.

## Known source-side debts

`examples/tag.scad` and `examples/coin.scad`'s **English** comments still say "uploaded
font" (upload/import terminology) and tangle "raise"/"emboss"/"carve" loosely. Both files
are inside `renderHash`'s hashed closure indirectly as mounted `.scad` sources — see
`scripts/lib/hash.mjs`'s `computeRenderHash` — so a wording-only edit to them evicts every
deployment's persisted render cache for no functional gain. Left deliberately for now;
batch the wording fix with the next change that touches those files' actual geometry.
The German sidecars (`tag.strings.de.json`, `coin.strings.de.json`) are unaffected by this
and already use the canonical `importieren`/`erhaben`/`eingravieren` terms regardless of
the English source's wording.
