// licenses.ts — open-source attribution notice for ScadPub itself and the
// third-party components shipped in this app. Listed to satisfy each
// component's license terms (attribution + license/source availability).
// Build-only tooling (Vite, TypeScript, etc.) is not bundled into what we
// serve and is omitted.
import oflText from "../licenses/OFL-1.1.txt?raw";
import type { SoftwareLicense } from "../openscad/types";

// three.js's bundled version — kept as a literal (matching package.json's
// "three": "^0.185.1") rather than `import { REVISION } from "three"`.
// three.js ships as a single ~650kB bundled ESM file that Rollup can't
// tree-shake down to one constant, and this modal is not lazy-loaded (see
// App.tsx's static `import { LicensesModal }`), so that import would pull
// three.js into the app's eager chunk — verified via `npm run build`: it
// added a 196kB `three.core` chunk to index.html's eager `modulepreload`
// links, defeating the Viewer's lazy-load split (see CLAUDE.md's render
// architecture section). Bump this string when the `three` dependency's
// minor version changes.
const THREE_VERSION = "0.185";

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

// ScadPub's own entry. Kept as a named const (rather than inline in LICENSES)
// so licenseList() below can stamp the build's version onto exactly this one
// without matching by name or position.
const SCADPUB: SoftwareLicense = {
  name: "ScadPub",
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
};

export const LICENSES: SoftwareLicense[] = [
  SCADPUB,
  {
    name: "OpenSCAD (WebAssembly build)",
    version: "2026.06.12",
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
    version: THREE_VERSION,
    license: "MIT",
    copyright: "Copyright © 2010-2024 three.js authors",
    url: "https://threejs.org/",
    licenseUrl: "https://github.com/mrdoob/three.js/blob/dev/LICENSE",
    text: mit("Copyright © 2010-2024 three.js authors"),
    note: "Renders the 3D preview.",
  },
  {
    name: "React & React-DOM",
    version: "18.3",
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

/**
 * The built-in attributions, with ScadPub's own entry carrying the version this
 * site was built from (`schema.scadpubVersion` — the build's `git describe`, see
 * scripts/lib/version.mjs). A build with no resolvable version (a git-less tree
 * and no override) passes undefined and the entry simply shows no version, as
 * before. The returned array is otherwise the untouched LICENSES list.
 */
export function licenseList(version?: string): SoftwareLicense[] {
  if (!version) return LICENSES;
  return LICENSES.map((l) => (l === SCADPUB ? { ...l, version } : l));
}
