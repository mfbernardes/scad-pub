// defaultHelp.ts: the generic, project-agnostic help shown when a config does
// not supply its own `help`. It documents only universal configurator features
// (no design-specific wording), in the Markdown subset the Markdown component
// renders, and speaks to a non-technical maker: no OpenSCAD knowledge assumed.
// A deployment can override any of this via `help` in its config.
//
// This is PROSE ABOUT THE UI, so it goes stale silently: nothing type-checks a
// sentence against the component it describes. When a control moves, is renamed,
// or changes layout, fix it here in the same commit. Two recurring traps:
//   • Several controls live in different places per layout. Live preview, Save
//     image, theme, Help, licenses and Files are top-bar/panel items on desktop
//     and sit behind the mobile top bar's "⋮" overflow (BarActions). Say both,
//     or the instruction is wrong for half the visitors.
//   • Names here must be the strings the visitor actually sees: the catalogue
//     (src/locales/en.json) for anything routed through t()/tn(), the component
//     otherwise. The tab names are the exception: `strings["presets.title"]` /
//     `strings["settings.title"]` can rename them, but a config that renames
//     tabs supplies its own `help` too, so the defaults are the right thing to
//     name.
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
        "The **Customize** tab lists what you can change, grouped into sections.\n\n" +
        "- Drag a slider (or type a number), pick from a dropdown, type text, or flip a switch.\n" +
        "- Tap the small **ⓘ** next to a label for a fuller explanation.\n" +
        "- Click a **section header** to fold or unfold it; some start folded.\n" +
        "- Some settings only appear when another one makes them relevant.\n" +
        "- **Find a setting…** narrows the list as you type. A long form also offers **Jump to section** (the list button beside it) to skip straight to one.\n" +
        "- Some designs keep their advanced settings out of the way at first. If you see **Show all settings** — shortened to **+N more** on a phone — that reveals them, and the same control puts them back.\n" +
        "- Once you've changed something, a strip at the **top** of the tab counts your changes and offers **Reset to defaults** (or, with a preset applied, **Revert** to it).",
    },
    {
      title: "3. Look around the preview",
      body: "**Drag** to spin the model, **scroll or pinch** to zoom, and **right-drag** (or two fingers) to move it.",
    },
    {
      title: "4. Keep the preview fresh",
      body:
        "With **Live preview** on, the model updates a moment after each change. " +
        "You'll find the switch under the settings panel on a wide screen, and in the **⋮** menu (top right) on a phone.\n\n" +
        "For slow designs it pauses itself — press **Update** over the preview when you're ready.",
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
        "- The **Files** action (top bar, or the **⋮** menu on a phone) is where you **manage** what you've imported — see each file's type and size, remove one, or clear all. You don't import from there.\n" +
        "- Files stay in this browser and come back on your next visit; nothing is uploaded.",
    },
    {
      title: "7. Download & share",
      body:
        "The two buttons over the preview:\n\n" +
        "- **Download for 3D printing** — get the printable file for your slicer.\n" +
        "- **Share** (**Copy link** where your browser can't share directly) — a link that reopens this exact design with your settings.\n\n" +
        "**Save image**, for a picture of the preview, is in the top bar — or the **⋮** menu on a phone.\n\n" +
        "If anything needs a look before you download, a coloured pill appears just above those buttons (“1 issue to review”). " +
        "Tap it — or Download — to open **Review**, which summarises what you're about to get and what's unresolved. " +
        "Once the model has rendered you can still choose **Download anyway**; while a render has failed, that stays unavailable.",
    },
    {
      title: "8. Appearance & info",
      body:
        "The **sun/moon** button switches between light, dark, and automatic, and the **ⓘ** button lists open-source licenses. " +
        "Both sit in the top bar on a wide screen, and in the **⋮** menu (top right) on a phone.",
    },
    {
      title: "Troubleshooting",
      body:
        "If the preview fails or looks wrong, open **Messages** (the bell in the top bar) — " +
        "the design reports what it didn't like there, and the Log tab has the full technical output.",
    },
  ],
};
