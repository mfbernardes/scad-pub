// defaultHelp.ts — the generic, project-agnostic help shown when a config does
// not supply its own `help`. It documents only universal configurator features
// (no design-specific wording), in the Markdown subset the Markdown component
// renders, and speaks to a non-technical maker — no OpenSCAD knowledge assumed.
// A deployment can override any of this via `help` in its config.
import type { HelpContent } from "../openscad/types";

export const DEFAULT_HELP: HelpContent = {
  intro:
    "Customize a design in your browser and download a ready-to-print file. " +
    "Everything runs on your device — your settings never leave it, and it works offline.",
  sections: [
    {
      title: "1. Pick a design",
      body: "Use the design name in the top bar to switch between the available designs.",
    },
    {
      title: "2. Make it yours",
      body:
        "The **Customize** tab lists everything you can change, grouped into sections.\n\n" +
        "- Drag a slider (or type a number), pick from a dropdown, type text, or flip a switch.\n" +
        "- Tap the small **ⓘ** next to a label for a fuller explanation.\n" +
        "- Click a **section header** to fold or unfold it; some start folded.\n" +
        "- Some settings only appear when another one makes them relevant.\n" +
        "- **Reset to defaults** (at the bottom) undoes all your changes for the current design.",
    },
    {
      title: "3. Look around the preview",
      body: "**Drag** to spin the model, **scroll or pinch** to zoom, and **right-drag** (or two fingers) to move it.",
    },
    {
      title: "4. Keep the preview fresh",
      body:
        "With **Live preview** on, the model updates a moment after each change. " +
        "For slow designs it pauses itself — press **Update** on the preview when you're ready.",
    },
    {
      title: "5. Save your settings (presets)",
      body:
        "The **Presets** tab lists **Ready-made** starting points and the ones **Saved by you** (kept in this browser).\n\n" +
        "- **Save** keeps your current settings under a name so you can come back to them.\n" +
        "- **Export**/**Import** move saved presets between devices as a file (the same format the desktop OpenSCAD Customizer uses).",
    },
    {
      title: "6. Import fonts and drawings",
      body:
        "Some designs use a file of yours — a font for lettering, or an SVG drawing. " +
        "You add each one from the control that needs it, not from a separate upload screen:\n\n" +
        "- **Fonts** (`.ttf`/`.otf`): choose **Import font…** in a design's font menu; the font then shows there by name for every design.\n" +
        "- **Drawings** (`.svg`): use the drawing control's **Prepare SVG…** to bring one in.\n" +
        "- The **Files** action (in the toolbar) is where you **manage** what you've imported — see each file's type and size, remove one, or clear all. You don't import from there.\n" +
        "- Files stay in this browser and come back on your next visit; nothing is uploaded.",
    },
    {
      title: "7. Download & share",
      body:
        "- **Download** — get the printable file for your slicer.\n" +
        "- **Image** — save a picture of the preview.\n" +
        "- **Share** — copy a link that reopens this exact design with your settings.",
    },
    {
      title: "8. Appearance & info",
      body: "The **sun/moon** button (top right) switches between light, dark, and automatic. The **ⓘ** button lists open-source licenses.",
    },
    {
      title: "Troubleshooting",
      body:
        "If the preview fails or looks wrong, open **Messages** (the bell in the top bar) — " +
        "the design reports what it didn't like there, and the Log tab has the full technical output.",
    },
  ],
};
