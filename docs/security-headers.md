# Response headers

`src/lib/securityHeaders.mjs` builds the `_headers` block (Cloudflare Pages / Netlify
convention) that locks down the app document, and models how a real host merges those
rules so the smoke server validates the policy that actually ships. This page is the
rationale; the source is the policy.

Related: the SVG asset trust model in [config.md](config.md), which is what the `/scad/*`
and `/art/*` rules below exist to enforce.

## The app CSP, directive by directive

The reason a directive is as permissive as it is lives here — preserve it when editing.

- **`default-src 'self'`** — the fallback for every fetch directive not listed below
  (`media-src`, `frame-src`, `child-src`, …): anything the policy doesn't name explicitly is
  same-origin only, so a new resource type added to the app fails closed rather than open.
- **`script-src 'self' 'wasm-unsafe-eval' <hashes>`** — `'wasm-unsafe-eval'` is required
  for the OpenSCAD-WASM module's own WebAssembly compilation (`worker.ts`). The hashes
  allow-list exactly the inline theme script by content, nothing more. That script's body
  varies per config (`%APP_THEME_KEY%` is substituted per deployment at build time), so the
  hash cannot be a literal: `vite.config.ts` computes it fresh from the built `index.html`
  on every build, per config. `securityHeaders.mjs` itself stays environment-free and takes
  the pre-formatted `sha256-<base64>` sources as an argument.
- **`worker-src 'self'`** — the render worker is loaded from this origin only.
- **`style-src 'self' 'unsafe-inline'`** — the build injects a config-driven `<style>` into
  `<head>` (`configCss.ts`'s `headStyleInjection`: the colour overrides documented under
  `colors` in [config.md](config.md)), and React components set inline `style` attributes at
  runtime (the viewer and panel layout code). Neither is a fixed, hashable set, so
  `'unsafe-inline'` stays rather than inventing a stricter directive that would break real
  UI.
- **`img-src 'self' data: blob:`** — the PNG export snapshot renders to a `data:` URL, and
  preset/icon artwork can be inlined as `data:` URIs.
- **`font-src 'self'`** — bundled and imported fonts are same-origin only.
- **`connect-src 'self' data:`** — the PNG snapshot flow (`savePng` in `src/App.tsx`) does
  `fetch(dataUrl)` to turn the snapshot into a `File` for the share sheet. `fetch()` of a
  `data:` URL is governed by `connect-src`, not `img-src`, even though the URL looks
  image-shaped.
- **`object-src 'none'`, `base-uri 'none'`, `form-action 'none'`** — no plugin content, no
  `<base>` hijack, no form submissions anywhere in the app. All closeable outright.
- **`frame-ancestors 'none'`**, plus the sibling `X-Frame-Options: DENY` for browsers that
  don't honour it — nothing about this app, least of all the export flow, should ever run
  inside someone else's frame, where a clickjacking overlay could hijack a Download click.
- **`manifest-src 'self'`** — the PWA manifest is same-origin only.

The three sibling headers: `X-Content-Type-Options: nosniff` stops a misdeclared response
from being sniffed into an executable type; `Referrer-Policy: no-referrer` keeps the full
URL (which can carry a shareable design's state) out of any cross-origin request's
`Referer`; `Permissions-Policy` denies the three sensor APIs the app never asks for.

## How rules merge (`headersFor`)

A Cloudflare Pages host applies every matching rule **in file order**, not only the first
match. `public/_headers`'s own layout relies on that: a request under `/scad/*` gets that
rule's CSP *and* whatever the trailing `/*` block the `securityHeaders` Vite plugin appends
adds. A test server that only matched the first rule would validate a policy nobody ships.

When two matching rules set the **same** header name, Cloudflare Pages does not let the
later one win — it joins both values with `", "` into one header ("If a header is applied
twice in the `_headers` file, the values are joined with a comma separator", per
Cloudflare's `_headers` docs).

That is load-bearing for exactly the header this repo relies on it for. CSP's grammar
treats a comma-separated header value as a **list of policies** — equivalently, multiple
`Content-Security-Policy` response headers — and enforces their **intersection**. So
comma-joining `/scad/*`'s `default-src 'none'; sandbox` with the appended `/*` block's app
CSP is precisely how "both enforced, no weakening" happens on the real host. Overriding
instead of joining would silently drop the SVG sandbox for every path both rules match, so
`headersFor` matches Cloudflare's join behaviour rather than the simpler-looking override
that would misrepresent it.

Header names are compared case-insensitively, as HTTP requires; the first matching rule's
casing is kept for the combined header's name.
