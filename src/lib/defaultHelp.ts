// defaultHelp.ts — the generic, project-agnostic help shown when a config does
// not supply its own `help`. It documents only universal configurator features
// (no design-specific wording), in the Markdown subset the Markdown component
// renders. A deployment can override any of this via `help` in its config.
export interface HelpSection {
  title: string;
  body: string;
}

/** One tab of the Help modal: a labelled group of sections with its own intro.
 *  A config may supply many tabs. */
export interface HelpTab {
  label: string;
  intro?: string;
  sections: HelpSection[];
}

export interface HelpContent {
  intro?: string;
  /** Single-pane sections (the default form). */
  sections?: HelpSection[];
  /** When present, the modal renders a tab strip; many tabs are supported. */
  tabs?: HelpTab[];
}

export const DEFAULT_HELP: HelpContent = {
  intro:
    "Configure a design in your browser and export a ready-to-print 3MF. " +
    "Everything runs locally — your settings never leave your device, and it works offline.",
  sections: [
    {
      title: "1. Pick a design",
      body: "Use the **Design** dropdown in the top bar to switch between the available designs. Each one auto-sizes to the parameters you set.",
    },
    {
      title: "2. Adjust the parameters",
      body:
        "The left panel lists every parameter, grouped into sections.\n\n" +
        "- Controls are sliders with a number box, dropdowns, text fields, or checkboxes.\n" +
        "- The grey monospace name is the underlying OpenSCAD variable; **hover** any control for its full description.\n" +
        "- Click a **section header** to fold or unfold it; some start collapsed.\n" +
        "- Some controls appear only when another value makes them relevant.\n" +
        "- **Reset to defaults** (above the first group) clears your changes for the current design.",
    },
    {
      title: "3. Preview the model",
      body: "**Drag** to orbit, **scroll** to zoom, and **right-drag** (or two fingers) to pan. The top bar shows render status and timing.",
    },
    {
      title: "4. Render",
      body: "**Auto-render** re-renders a moment after each change. For a heavy design you can turn it off and press **Render now** when you're ready.",
    },
    {
      title: "5. Save & reuse settings (presets)",
      body:
        "The **presets** dropdown groups **Bundled** examples (read-only) and **Saved** presets (your own, stored in this browser).\n\n" +
        "- **Save** stores the current parameters as a browser preset; **Export** saves them as an OpenSCAD `parameterSets` JSON, which also opens in the desktop OpenSCAD Customizer.",
    },
    {
      title: "6. Add files (fonts, SVGs…)",
      body:
        "Some designs reference a file the app doesn't bundle — a font, an SVG to " +
        "`import()`, or a data file for `surface()`. When an **Import file** button " +
        "appears at the bottom of the panel, use it to supply your own:\n\n" +
        "- **Fonts** (`.ttf`/`.otf`) become available to `text()`; set the design's font parameter to the font's family name.\n" +
        "- **Any other file** is referenced by its name in the design, e.g. `import(\"logo.svg\")`.\n" +
        "- Files are stored in this browser and re-applied on your next visit; the list shows what's loaded.\n" +
        "- **Clear** removes them all. Importing or clearing files re-renders with the new set.\n" +
        "- Nothing is uploaded to a server — files stay on your device.",
    },
    {
      title: "7. Export & share",
      body:
        "- **Export 3MF** — download the printable mesh (with colours) for your slicer.\n" +
        "- **Save PNG** — save a snapshot of the preview.\n" +
        "- **Copy link** — copy a URL that reproduces this exact design, parameters and preset.",
    },
    {
      title: "8. Appearance & info",
      body: "The **sun/moon** button (top-right) cycles light → dark → auto. The **ⓘ** button lists open-source licenses.",
    },
    {
      title: "Troubleshooting",
      body: "If a render fails or looks wrong, open the **OpenSCAD output** panel below the preview — it shows the exact command plus any warnings and errors.",
    },
  ],
};
