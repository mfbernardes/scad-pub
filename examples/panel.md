<!--
meta.contentType: How-to
content plan: explain what the panel design exports, list the steps to prepare an SVG, and give print-specific tips.
-->

# Configure a relief panel

Turn any SVG drawing into a coloured relief plaque: a flat base plate with your artwork raised from its surface. A multi-colour SVG keeps each region's colour through to the printed model.

## What you get

The panel design exports a printable 3MF with the relief and colour data included:

- A rounded base plate you size with **Panel width**, **Panel height** and **Base plate thickness**.
- Your artwork raised by **Relief height** and framed by an optional **Margin**.
- Per-region colours preserved in the exported `3MF`, ready for a multi-material slicer.

## Getting started

Use the SVG wizard before you tune the panel dimensions:

- Open **Prepare SVG…** and drop in your drawing. The wizard checks it, fixes common issues, and reads each named region's colour.
- Adjust the panel size and **Relief height** until the preview looks right.
- Press **Download 3MF** and slice it as you would any other mesh.

## Tips for a clean print

These settings make the relief easier to slice and print:

- Keep strokes and small details chunky enough for your nozzle size.
- A **Relief height** of about `1–1.5 mm` reads well without long print times.
- Single-colour art works too: leave the colours blank and the whole drawing imports as one relief.

For a walkthrough of the whole app, open **Help** from the top bar or see the [ScadPub repository](https://github.com/mfbernardes/scad-pub).
