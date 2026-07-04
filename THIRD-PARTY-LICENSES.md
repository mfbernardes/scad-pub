# Third-party licenses

ScadPub's own source code is **MIT** (see [LICENSE](LICENSE)). It bundles the
third-party components below. This file is informational, not legal advice.

## Your `.scad` models are not affected

The models you publish are **input data** to OpenSCAD, not a derivative work of
it — running them through the engine no more licenses them than compiling
proprietary source with GCC licenses your source. **You may bundle proprietary
`.scad` models in the output and distribute (or sell) the resulting site**,
regardless of the licenses below.

## Bundled at runtime (redistributed in `dist/`)

| Component | License | Source |
|-----------|---------|--------|
| **OpenSCAD-WASM** (`openscad.js`, `openscad.wasm`) | **GPL-2.0-or-later** (effective floor GPLv3 via CGAL) | https://github.com/openscad/openscad — official snapshots at https://files.openscad.org/snapshots/ |
| React, react-dom, scheduler, loose-envify, js-tokens | MIT | https://github.com/facebook/react |
| three.js | MIT | https://github.com/mrdoob/three.js |
| Radix UI primitives (`@radix-ui/react-*`: dialog, alert-dialog, popover, select, tabs, slider, switch, checkbox, label, slot) | MIT | https://github.com/radix-ui/primitives |
| lucide-react (icons) | ISC | https://github.com/lucide-icons/lucide |
| sonner (toasts) | MIT | https://github.com/emilkowalski/sonner |
| clsx | MIT | https://github.com/lukeed/clsx |
| tailwind-merge | MIT | https://github.com/dcastil/tailwind-merge |
| class-variance-authority | Apache-2.0 | https://github.com/joe-bell/cva |
| Liberation fonts (Sans / Mono) | OFL-1.1 | https://github.com/liberationfonts/liberation-fonts |
| Space Grotesk (UI display typeface, via `@fontsource-variable/space-grotesk`) | OFL-1.1 | https://github.com/floriankarsten/space-grotesk |

### The OpenSCAD-WASM (GPL) obligation

OpenSCAD-WASM is the only strong-copyleft component. ScadPub loads it as a
**separate WebAssembly module in a Web Worker** and invokes it like a subprocess
(it feeds `.scad` in and reads geometry out); it does **not** link OpenSCAD's
code into ScadPub's own JavaScript or derive from OpenSCAD source. That is a
"mere aggregation" of two independently-licensed programs, so ScadPub's own code
stays under MIT.

When you **distribute a built site**, you redistribute OpenSCAD-WASM, so you must
honor its GPL: keep its license and attribution (ScadPub surfaces this in the
in-app **ⓘ Open-source licenses** panel and `src/lib/licenses.ts`) and point
recipients to its corresponding source — the public pinned snapshot URL above.
This obligation is limited to that one component; it does not reach ScadPub's MIT
code or your `.scad` models.

> If you want to avoid shipping any GPL component, you would need to replace the
> in-browser OpenSCAD-WASM engine — there is currently no permissively-licensed
> drop-in equivalent.

## Build / test only (NOT redistributed in `dist/`)

These run at build and test time and are not part of the published site, so they
do not constrain the output: vite, @vitejs/plugin-react (MIT), TypeScript,
Tailwind CSS + `@tailwindcss/vite` + `tw-animate-css` (MIT, generate the
stylesheet), `@resvg/resvg-js` (MPL-2.0, rasterizes the PWA icons), Playwright
(Apache-2.0), axe-core (MPL-2.0), pixelmatch (ISC), pngjs (MIT).
