// licenses.ts: open-source attribution notice for ScadPub itself and the
// third-party components shipped in this app. Listed to satisfy each
// component's license terms (attribution + license/source availability).
// Build-only tooling (Vite, TypeScript, etc.) is not bundled into what we
// serve and is omitted.
//
// No version here is a literal: every one is supplied by the build (see
// BuildVersions below) so an attribution can't claim a version the app doesn't
// ship. Hand-copied literals drifted in exactly that way: the list read
// "React 18.3" while the app bundled 19.x. What's hard-coded is only what a
// dependency bump can't invalidate: names, copyright lines, license texts.
import oflText from "../licenses/OFL-1.1.txt?raw";
import type { ResolvedSoftwareLicense } from "../openscad/types";
import { t } from "./i18n";

/**
 * Versions resolved at build time and carried in the generated schema. All
 * optional: a build that can't determine one shows that entry without a version
 * rather than a wrong one.
 */
export interface BuildVersions {
  /** ScadPub itself: `git describe` of the building checkout (schema.scadpubVersion). */
  scadpub?: string;
  /** The pinned OpenSCAD WASM snapshot the renderer fetches (schema.wasmVersion). */
  openscad?: string;
  /**
   * Installed npm versions of the bundled packages, keyed by package name
   * (schema.componentVersions, from scripts/lib/dep-versions.mjs). Read from
   * the node_modules Vite bundles from, not imported from the packages
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

// The ISC permission notice (lucide-react's; short enough to inline like MIT's).
const ISC_BODY = `Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

const isc = (copyright: string) => `ISC License\n\n${copyright}\n\n${ISC_BODY}`;

/**
 * The app's built-in attributions, in display order, with each entry's version
 * taken from the build. Consumer-configured notices are appended after these by
 * the licenses modal; the built-ins are never removed.
 */
// Only `note` (the plain-language blurb) is translated below; `name`,
// `version`, `license` (SPDX id), `copyright`, `url`/`licenseUrl`/`sourceUrl`
// and `text` are legal facts and proper nouns, and stay verbatim in every
// locale.
export function licenseList(versions: BuildVersions = {}): ResolvedSoftwareLicense[] {
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
      note: t("licenses.note.scadpub"),
    },
    {
      name: "OpenSCAD (WebAssembly build)",
      version: versions.openscad,
      license: "GPL-2.0-or-later",
      copyright: "Copyright (C) 2009-2024 The OpenSCAD developers",
      url: "https://openscad.org/",
      licenseUrl: "https://www.gnu.org/licenses/old-licenses/gpl-2.0.html",
      sourceUrl: "https://github.com/openscad/openscad",
      note: t("licenses.note.openscad"),
    },
    {
      name: "three.js",
      version: pkg("three"),
      license: "MIT",
      copyright: "Copyright © 2010-2024 three.js authors",
      url: "https://threejs.org/",
      licenseUrl: "https://github.com/mrdoob/three.js/blob/dev/LICENSE",
      text: mit("Copyright © 2010-2024 three.js authors"),
      note: t("licenses.note.three"),
    },
    {
      name: "React & React-DOM",
      version: reactVersion,
      license: "MIT",
      copyright: "Copyright (c) Meta Platforms, Inc. and affiliates.",
      url: "https://react.dev/",
      licenseUrl: "https://github.com/facebook/react/blob/main/LICENSE",
      text: mit("Copyright (c) Meta Platforms, Inc. and affiliates."),
      note: t("licenses.note.react"),
    },
    {
      name: "Radix UI primitives",
      // No single version: this covers 12 independently-versioned
      // @radix-ui/react-* packages (dialog, alert-dialog, popover, select,
      // tabs, slider, switch, checkbox, label, slot, progress, tooltip — see
      // BUNDLED_PACKAGES), each pinned and cross-checked against
      // package.json, but with no one number that describes them all.
      license: "MIT",
      copyright: "Copyright (c) 2022 WorkOS",
      url: "https://github.com/radix-ui/primitives",
      licenseUrl: "https://github.com/radix-ui/primitives/blob/main/LICENSE",
      text: mit("Copyright (c) 2022 WorkOS"),
    },
    {
      name: "lucide-react",
      version: pkg("lucide-react"),
      license: "ISC",
      copyright: "Copyright (c) 2026 Lucide Icons and Contributors",
      url: "https://github.com/lucide-icons/lucide",
      licenseUrl: "https://github.com/lucide-icons/lucide/blob/main/LICENSE",
      text: isc("Copyright (c) 2026 Lucide Icons and Contributors"),
    },
    {
      name: "sonner",
      version: pkg("sonner"),
      license: "MIT",
      copyright: "Copyright (c) 2023 Emil Kowalski",
      url: "https://github.com/emilkowalski/sonner",
      licenseUrl: "https://github.com/emilkowalski/sonner/blob/main/LICENSE.md",
      text: mit("Copyright (c) 2023 Emil Kowalski"),
    },
    {
      name: "clsx",
      version: pkg("clsx"),
      license: "MIT",
      copyright: "Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com)",
      url: "https://github.com/lukeed/clsx",
      licenseUrl: "https://github.com/lukeed/clsx/blob/master/license",
      text: mit("Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com)"),
    },
    {
      name: "tailwind-merge",
      version: pkg("tailwind-merge"),
      license: "MIT",
      copyright: "Copyright (c) 2021 Dany Castillo",
      url: "https://github.com/dcastil/tailwind-merge",
      licenseUrl: "https://github.com/dcastil/tailwind-merge/blob/main/LICENSE.md",
      text: mit("Copyright (c) 2021 Dany Castillo"),
    },
    {
      name: "class-variance-authority",
      version: pkg("class-variance-authority"),
      license: "Apache-2.0",
      copyright: "Copyright 2022 Joe Bell",
      url: "https://github.com/joe-bell/cva",
      // Apache-2.0 runs to ~200 lines; unlike the MIT/ISC bodies above it
      // isn't reproduced inline (same call this file makes for OpenSCAD's
      // GPL text) — licenseUrl is the canonical copy.
      licenseUrl: "https://github.com/joe-bell/cva/blob/main/LICENSE",
    },
    {
      name: "Liberation Fonts",
      license: "OFL-1.1",
      copyright: "Copyright © 2012 Red Hat, Inc.",
      url: "https://github.com/liberationfonts/liberation-fonts",
      licenseUrl:
        "https://github.com/liberationfonts/liberation-fonts/blob/main/LICENSE",
      text: `Copyright © 2012 Red Hat, Inc.\nLiberation is a trademark of Red Hat, Inc.\n\n${oflText}`,
      note: t("licenses.note.liberation"),
    },
    {
      name: "Atkinson Hyperlegible",
      // The Fontsource package's version: the typeface's own release is not
      // recorded in what we bundle, and the package is what we redistribute.
      version: pkg("@fontsource/atkinson-hyperlegible"),
      license: "OFL-1.1",
      copyright: "Copyright 2020 Braille Institute of America, Inc.",
      url: "https://www.brailleinstitute.org/freefont/",
      licenseUrl:
        "https://github.com/googlefonts/atkinson-hyperlegible/blob/main/OFL.txt",
      text: `Copyright 2020 Braille Institute of America, Inc.\n\n${oflText}`,
      note: t("licenses.note.atkinson"),
    },
  ];
}

/**
 * Merges a deployment's config-supplied `licenses[]` entries into the built-in
 * list, matching on `name` (trimmed, case-insensitive) instead of appending
 * blindly: the same typeface can legitimately be bundled twice for different
 * reasons (ScadPub's own chrome font vs. a deployment's render font), and
 * without this a shared name shows up as two attributions for what a reader
 * sees as one component.
 *
 * A name match only merges when `license` and `copyright` also agree (trimmed,
 * exact); the built-in's legal fields (`license`, `copyright`, `url`,
 * `licenseUrl`, bundled `text`) always win and are never replaced by a config
 * value, so the "ScadPub's own attributions are never removed" guarantee
 * (docs/config.md) holds even after a merge. `version`, `sourceUrl` and `text`
 * fill in from the config only where the built-in doesn't already have one;
 * `note` is the one field both sides can legitimately contribute, so both
 * survive, combined into a single line rather than one replacing the other.
 *
 * A same-name entry that disagrees on `license` or `copyright` is treated as a
 * genuinely different component that happens to share a name: it is kept as
 * its own separate entry rather than merged, since silently blending
 * conflicting legal facts would misattribute one of them.
 *
 * Pure and order-stable: built-ins keep their built-in order (merges update
 * them in place), and unmerged config entries are appended after, in their
 * original relative order.
 */
export function mergeLicenses(
  builtins: ResolvedSoftwareLicense[],
  extras: ResolvedSoftwareLicense[]
): ResolvedSoftwareLicense[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const merged = builtins.map((b) => ({ ...b }));
  const appended: ResolvedSoftwareLicense[] = [];

  for (const extra of extras) {
    const idx = merged.findIndex((b) => norm(b.name) === norm(extra.name));
    const builtin = idx === -1 ? undefined : merged[idx];
    const sameComponent =
      builtin &&
      builtin.license.trim() === extra.license.trim() &&
      builtin.copyright.trim() === extra.copyright.trim();

    if (!builtin || !sameComponent) {
      // No match, or a name collision with a different license/copyright:
      // a distinct entry, not a fact to blend into the built-in's.
      appended.push(extra);
      continue;
    }

    merged[idx] = {
      ...builtin,
      version: builtin.version ?? extra.version,
      text: builtin.text ?? extra.text,
      sourceUrl: builtin.sourceUrl ?? extra.sourceUrl,
      note: combineNotes(builtin.note, extra.note),
    };
  }

  return [...merged, ...appended];
}

function combineNotes(a?: string, b?: string): string | undefined {
  if (a && b) return `${a.trim()} ${b.trim()}`;
  return a ?? b;
}
