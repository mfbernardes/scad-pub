// licenses.ts — open-source attribution notice for ScadPub itself and the
// third-party components shipped in this app. Listed to satisfy each
// component's license terms (attribution + license/source availability).
// Build-only tooling (Vite, TypeScript, etc.) is not bundled into what we
// serve and is omitted.
//
// No version here is a literal: every one is supplied by the build (see
// BuildVersions below) so an attribution can't claim a version the app doesn't
// ship. Hand-copied literals drifted in exactly that way — the list read
// "React 18.3" while the app bundled 19.x. What's hard-coded is only what a
// dependency bump can't invalidate: names, copyright lines, license texts.
import oflText from "../licenses/OFL-1.1.txt?raw";
import type { SoftwareLicense } from "../openscad/types";

/**
 * Versions resolved at build time and carried in the generated schema. All
 * optional: a build that can't determine one shows that entry without a version
 * rather than a wrong one.
 */
export interface BuildVersions {
  /** ScadPub itself — `git describe` of the building checkout (schema.scadpubVersion). */
  scadpub?: string;
  /** The pinned OpenSCAD WASM snapshot the renderer fetches (schema.wasmVersion). */
  openscad?: string;
  /**
   * Installed npm versions of the bundled packages, keyed by package name
   * (schema.componentVersions, from scripts/lib/dep-versions.mjs). Read from
   * the node_modules Vite bundles from — not imported from the packages
   * themselves, which would pull three.js into this modal's eager chunk (it is
   * statically imported by App.tsx) and undo the Viewer's lazy-load split.
   */
  packages?: Record<string, string>;
}

// The MIT permission notice (shared body; each component prepends its own
// copyright line, which the license requires us to reproduce).
const MIT_BODY = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const mit = (copyright: string) =>
  `MIT License\n\n${copyright}\n\n${MIT_BODY}`;

/**
 * The app's built-in attributions, in display order, with each entry's version
 * taken from the build. Consumer-configured notices are appended after these by
 * the licenses modal; the built-ins are never removed.
 */
export function licenseList(versions: BuildVersions = {}): SoftwareLicense[] {
  const pkg = (name: string) => versions.packages?.[name];
  // React and React-DOM share one entry (they version in lockstep); if an
  // install ever splits them, say so rather than quietly naming one.
  const reactVersion =
    pkg("react") === pkg("react-dom")
      ? pkg("react")
      : [pkg("react"), pkg("react-dom")].filter(Boolean).join(" / ") || undefined;
  return [
    {
      name: "ScadPub",
      version: versions.scadpub,
      license: "MIT",
      copyright: "Copyright (c) 2026 Murillo Bernardes",
      url: "https://github.com/mfbernardes/scad-pub",
      licenseUrl: "https://github.com/mfbernardes/scad-pub/blob/main/LICENSE",
      sourceUrl: "https://github.com/mfbernardes/scad-pub",
      text: mit("Copyright (c) 2026 Murillo Bernardes"),
      note:
        "This configurator itself. ScadPub publishes OpenSCAD models as static, " +
        "browser-based configurators; its own source is MIT-licensed and available " +
        "at the link above. The MIT license covers ScadPub's own code only — the " +
        "bundled components listed below carry their own terms.",
    },
    {
      name: "OpenSCAD (WebAssembly build)",
      version: versions.openscad,
      license: "GPL-2.0-or-later",
      copyright: "Copyright (C) 2009-2024 The OpenSCAD developers",
      url: "https://openscad.org/",
      licenseUrl: "https://www.gnu.org/licenses/old-licenses/gpl-2.0.html",
      sourceUrl: "https://github.com/openscad/openscad",
      note:
        "Renders the models in your browser. OpenSCAD is free software under the " +
        "GNU GPL v2 (or later); the corresponding source is available at the link " +
        "above. Its build also statically links further third-party libraries " +
        "(e.g. CGAL, Boost, Eigen, Manifold, FreeType, HarfBuzz, fontconfig, " +
        "libzip) under their own licenses — see the OpenSCAD source for those.",
    },
    {
      name: "three.js",
      version: pkg("three"),
      license: "MIT",
      copyright: "Copyright © 2010-2024 three.js authors",
      url: "https://threejs.org/",
      licenseUrl: "https://github.com/mrdoob/three.js/blob/dev/LICENSE",
      text: mit("Copyright © 2010-2024 three.js authors"),
      note: "Renders the 3D preview.",
    },
    {
      name: "React & React-DOM",
      version: reactVersion,
      license: "MIT",
      copyright: "Copyright (c) Meta Platforms, Inc. and affiliates.",
      url: "https://react.dev/",
      licenseUrl: "https://github.com/facebook/react/blob/main/LICENSE",
      text: mit("Copyright (c) Meta Platforms, Inc. and affiliates."),
      note: "Powers the user interface.",
    },
    {
      name: "Liberation Fonts",
      license: "OFL-1.1",
      copyright: "Copyright © 2012 Red Hat, Inc.",
      url: "https://github.com/liberationfonts/liberation-fonts",
      licenseUrl:
        "https://github.com/liberationfonts/liberation-fonts/blob/main/LICENSE",
      text: `Copyright © 2012 Red Hat, Inc.\nLiberation is a trademark of Red Hat, Inc.\n\n${oflText}`,
      note:
        "Bundled fallback typeface. Any external font a deployment requires " +
        "(e.g. a license-restricted profile font) is not bundled and is uploaded by you.",
    },
    {
      name: "Atkinson Hyperlegible",
      // The Fontsource package's version — the typeface's own release is not
      // recorded in what we bundle, and the package is what we redistribute.
      version: pkg("@fontsource/atkinson-hyperlegible"),
      license: "OFL-1.1",
      copyright: "Copyright 2020 Braille Institute of America, Inc.",
      url: "https://www.brailleinstitute.org/freefont/",
      licenseUrl:
        "https://github.com/googlefonts/atkinson-hyperlegible/blob/main/OFL.txt",
      text: `Copyright 2020 Braille Institute of America, Inc.\n\n${oflText}`,
      note:
        "The interface's display typeface (packaged via Fontsource). Used only " +
        "for the app chrome — it is not available to the rendered designs.",
    },
  ];
}
