// pwa-assets.mjs — generate the installable-PWA assets from the config: the app
// icon (SVG + rasterized 192/512/512-maskable/180 PNGs), the iOS launch
// ("splash") images, and manifest.webmanifest (with categories, screenshots and
// per-design shortcuts). Runs only in a real build (generate() passes
// outPublicDir); the fixture-driven unit tests skip it.
//
// Nothing in this module touches disk. `generatePwaAssets` QUEUES every file
// it would produce — as `{ dest, data }` / `{ dest, src }` entries — into the
// `batch` array it returns, instead of writing directly; `commitPwaBatch`
// (also exported) is the only function here that calls writeFileSync/
// copyFileSync, and only when the caller invokes it explicitly. generate()
// (gen-schema.mjs) collects this batch alongside every other fallible step —
// design parsing, the staged scad tree — and only flushes it, via
// commitPwaBatch, at its own single commit point, once nothing left can
// throw. That's what makes a late failure here (a `pwa.screenshots[].src`
// that doesn't exist, checked well after the icon/splash rasterization below)
// leave outPublicDir completely untouched rather than pairing freshly
// rasterized icons with a stale scad tree/schema. Returns the appleSplash
// <link> descriptor list vite.config.ts injects into index.html, alongside
// the batch itself and the other bookkeeping described on generatePwaAssets.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { xmlEscape } from "./config-parsers.mjs";
import { sanitizeSvg } from "./svg-sanitize.mjs";

// Read a PNG's pixel dimensions from its IHDR chunk (the first chunk, right
// after the 8-byte signature: 4-byte length + "IHDR" + 4-byte width + height,
// big-endian). Returns "<w>x<h>" for a valid PNG, else null. Used to advertise
// a manifest icon's real `sizes` instead of a bare "any".
function pngSize(buf) {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null; // \x89 P N G
  if (buf.toString("latin1", 12, 16) !== "IHDR") return null;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return w > 0 && h > 0 ? `${w}x${h}` : null;
}

// Optional build-time SVG→PNG rasterizer (@resvg/resvg-js). Present in dev
// builds; gracefully absent in minimal CI environments that didn't npm install.
let Resvg = null;
try {
  ({ Resvg } = await import("@resvg/resvg-js"));
} catch {
  /* not installed — icon rasterization will be skipped */
}

/**
 * Queue the PWA icon set + manifest for outPublicDir and return the iOS
 * splash descriptors (see the module comment for why "queue", not "write").
 *
 * Takes the ALREADY-PARSED `pwa` object (scripts/lib/config-parsers.mjs's
 * parsePwa — the config's `pwa` block, defaults resolved) rather than the
 * raw config: this is the one place in `scripts/`
 * outside the parse layer that used to reach into `config.icon`/
 * `.iconMaskable`/`.screenshots`/`.shortcuts` directly, which meant it had to
 * know the config's raw shape (and would have needed teaching about `pwa.*`
 * nesting a second time here, on top of config-parsers.mjs, if it still read
 * the raw object). Reading the parsed form instead means the parse layer is
 * the only code that ever needs to know scadpub.config.json's actual shape.
 * @returns {{ appleSplash: { href: string, media: string }[], iconFiles: string[],
 *   batch: Array<{ dest: string, data?: Buffer|string, src?: string }> }}
 *   `batch` is every pending write, flushed later by commitPwaBatch; a caller
 *   needing the flat path list (the M8 reconciliation) derives it with
 *   `batch.map((e) => e.dest)`.
 */
export function generatePwaAssets({
  pwa,
  CONFIG_DIR,
  outPublicDir,
  TITLE,
  SHORT_NAME,
  DESCRIPTION,
  ID,
  LANG,
  DIR,
  THEME_COLOR,
  BG_COLOR,
  CATEGORIES,
  designs,
  mustExist,
  register,
  // Where design picker-icon files (`d.icon` = "scad/<id>-icon.<ext>") live on
  // disk right now, so their real PNG dimensions can be read back for the
  // manifest. During a build this is the STAGING scad dir — generate() runs PWA
  // generation before it swaps staging into the live scad location, so the
  // whole output can commit atomically. Defaults to the live location.
  scadDir = join(outPublicDir, "scad"),
}) {
  // iOS standalone launch images (apple-touch-startup-image). Populated below
  // when a rasterizer is available; injected into index.html by vite.
  let appleSplash = [];
  // The pending write batch (see the module comment): every icon/splash/
  // screenshot/manifest byte this call decides to produce lands here as a
  // `{ dest, data }` (bytes to write) or `{ dest, src }` (file to copy)
  // descriptor, in commit order. Nothing under `outPublicDir` is touched
  // until the caller passes this to commitPwaBatch. `write`/`copy` default to
  // pushing onto `batch` directly; the splash loop below passes its own local
  // array instead, so a mid-loop failure discards just that sub-batch (see
  // there) rather than the whole thing.
  const batch = [];
  const write = (name, data, label, sink = batch) => {
    const dest = join(outPublicDir, name);
    // register() still runs immediately, at collection time — a destination
    // collision between two owners must fail the build before anything is
    // even QUEUED to write, exactly as it failed before a physical write
    // existed to compare against.
    register(dest, label ?? name);
    sink.push({ dest, data });
    return dest;
  };
  const copy = (src, name, label, sink = batch) => {
    const dest = join(outPublicDir, name);
    register(dest, label ?? name);
    sink.push({ dest, src });
    return dest;
  };

  // Build (or use the default) icon SVG source.
  // M13: the app icon is browser-facing (rendered in an <img>/manifest
  // context and directly navigable at /icon.svg), so — unlike render-input
  // SVGs under public/scad/ — it's run through sanitizeSvg() first: cheap
  // defense-in-depth against a served SVG executing as an active document.
  // See docs/config.md "SVG asset trust model" and scripts/lib/svg-sanitize.mjs.
  // Compute the icon SVG source now, but defer QUEUEING icon.svg until the
  // (fallible) rasterization below has succeeded — so a malformed icon that
  // fails rasterization can't queue a write that would overwrite a previous
  // build's good icon.svg either. The whole icon set (svg + PNGs) is queued
  // together or not at all; either way nothing lands on disk until generate()
  // flushes the batch at its own commit point.
  let iconSvg;
  let iconSvgLabel;
  if (pwa.icon) {
    const raw = readFileSync(
      mustExist(resolve(CONFIG_DIR, pwa.icon), `icon '${pwa.icon}'`),
      "utf-8"
    );
    iconSvg = sanitizeSvg(raw).text;
    iconSvgLabel = "pwa 'icon'";
  } else {
    // Neutral default icon when the config supplies none.
    iconSvg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="${xmlEscape(TITLE)}">\n` +
      `  <rect width="512" height="512" rx="96" fill="${THEME_COLOR}"/>\n` +
      `  <rect x="150" y="150" width="212" height="212" rx="28" fill="none" stroke="#86a9ff" stroke-width="30"/>\n` +
      `</svg>\n`;
    iconSvgLabel = "default icon.svg";
  }
  // Icon files actually written this run, in manifest-relevant order —
  // "icon.svg" plus whichever rasterized PNGs succeed below. Manifest icons
  // and the precache shell are built from this, never from a fixed assumed
  // set (M8): a rasterizer that's absent or fails must shrink what's
  // advertised, not leave a dangling reference to a file that doesn't exist.
  const iconFiles = ["icon.svg"];

  // Maskable icon: separate source (safe-zone padded) or fall back to the
  // main icon. The maskable PNG is rendered from this SVG.
  let maskableSvg = iconSvg;
  if (pwa.iconMaskable) {
    maskableSvg = readFileSync(
      mustExist(resolve(CONFIG_DIR, pwa.iconMaskable), `iconMaskable '${pwa.iconMaskable}'`),
      "utf-8"
    );
  }

  // Single SVG→PNG rasterizer (@resvg/resvg-js — Rust/WASM, no headless
  // browser) shared by the icon and the iOS splash generation below. Null when
  // the optional dep is absent, in which case both fall back to copying the SVG.
  const rasterize = Resvg
    ? (svg, width) =>
        new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } })
          .render()
          .asPng()
    : null;

  // Rasterize PNGs at build time. Sizes: 192 & 512 for the manifest, 180 for
  // apple-touch-icon. The maskable 512 uses the safe-zone-padded source.
  //
  // M8: a rasterization failure is a real config error (a configured `icon`/
  // `iconMaskable` SVG that resvg can't render) — it fails the build loudly
  // instead of silently degrading. The previous behaviour warned and copied
  // raw SVG bytes to an `icon-180.png` name — bytes that aren't a PNG at all
  // — while the manifest kept unconditionally advertising all four PNGs, so a
  // malformed icon shipped a build that "succeeded" with missing/mislabeled
  // assets. If the optional rasterizer dependency isn't installed at all
  // (documented as an acceptable minimal-CI state — see the `Resvg` import
  // above), no PNGs are generated and none are advertised (`iconFiles` stays
  // `["icon.svg"]`); index.html's static `<link rel="apple-touch-icon"
  // href="icon-180.png">` then points at a file that doesn't exist, but that
  // link (unlike the manifest/precache) isn't generated by this tool and is
  // out of scope here (fixing it requires editing index.html).
  if (rasterize) {
    // Rasterize the whole icon set into memory BEFORE queueing any of it.
    // Rasterization (resvg) is the only fallible step; queueing an in-memory
    // buffer isn't (the actual write happens later, at generate()'s commit
    // point — see the module comment). Doing all four renders first means a
    // failure on a later size can never leave earlier PNGs half-queued, and
    // — since nothing here ever reaches disk — can never overwrite a
    // previous build's good icons in the first place, let alone need to
    // unwind that overwrite on cleanup.
    let iconPngs;
    try {
      iconPngs = [
        ["icon-192.png", rasterize(iconSvg, 192)],
        ["icon-512.png", rasterize(iconSvg, 512)],
        ["icon-512-maskable.png", rasterize(maskableSvg, 512)],
        ["icon-180.png", rasterize(iconSvg, 180)],
      ];
    } catch (err) {
      throw new Error(
        `gen-schema: icon rasterization failed (${err.message})\n` +
          `  (check 'pwa.icon' / 'pwa.iconMaskable' — both must be valid SVG)`,
        { cause: err }
      );
    }
    // Rasterization succeeded — now queue icon.svg and every PNG together.
    write("icon.svg", iconSvg, iconSvgLabel);
    for (const [name, buf] of iconPngs) {
      write(name, buf, name);
      iconFiles.push(name);
    }
  } else {
    // No rasterizer: ship icon.svg only. Nothing fallible ran, so queueing it
    // here is safe.
    write("icon.svg", iconSvg, iconSvgLabel);
    console.warn(
      "gen-schema: @resvg/resvg-js not installed — PWA icon PNGs will not be generated " +
        "(shipping icon.svg only; manifest/precache omit the PNG sizes)"
    );
  }

  // iOS standalone launch ("splash") images. iOS only shows one whose media
  // query matches the device exactly, so emit a portrait PNG (the icon centred
  // on the background colour) per common iPhone resolution. Generated only when
  // the rasterizer is present; each becomes an <link rel="apple-touch-startup-image">.
  //
  // Queued into a LOCAL sub-batch, not `batch` directly: a mid-loop
  // rasterization failure (device N renders fine, device N+1 doesn't) must
  // ship zero splashes, not the first N — see the catch below. Merging the
  // whole sub-batch into `batch` only after every device succeeds is what
  // makes that true even now that nothing writes eagerly: an early device's
  // descriptor sitting unmerged in `splashBatch` can simply be dropped on the
  // floor, no on-disk cleanup required, and `appleSplash` (the manifest/
  // index.html metadata) is only ever assigned from the same successful set,
  // so it can never describe a splash `batch` doesn't also contain.
  if (rasterize) {
    // device px width × height, devicePixelRatio — current/common iPhones.
    const DEVICES = [
      [1290, 2796, 3], [1179, 2556, 3], [1284, 2778, 3], [1170, 2532, 3],
      [1125, 2436, 3], [828, 1792, 2], [750, 1334, 2],
    ];
    const splashBatch = [];
    const splashDescriptors = [];
    try {
      for (const [w, h, dpr] of DEVICES) {
        const s = Math.round(Math.min(w, h) * 0.32);
        const x = Math.round((w - s) / 2);
        const y = Math.round((h - s) / 2);
        const iconB64 = rasterize(iconSvg, s).toString("base64");
        const splashSvg =
          `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
          `<rect width="${w}" height="${h}" fill="${BG_COLOR}"/>` +
          `<image x="${x}" y="${y}" width="${s}" height="${s}" ` +
          `href="data:image/png;base64,${iconB64}"/></svg>`;
        const href = `apple-splash-${w}x${h}.png`;
        write(href, rasterize(splashSvg, w), href, splashBatch);
        splashDescriptors.push({
          href,
          media:
            `(device-width: ${w / dpr}px) and (device-height: ${h / dpr}px) ` +
            `and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`,
        });
      }
      // Every device rasterized: fold the whole sub-batch into the real one
      // and report it. Before this line NOTHING splash-related is in `batch`.
      batch.push(...splashBatch);
      appleSplash = splashDescriptors;
    } catch (err) {
      console.warn(`gen-schema: splash generation failed (${err.message})`);
      // splashBatch/splashDescriptors are simply discarded (never merged), so
      // a partial device set can never end up queued, let alone written.
      appleSplash = [];
    }
  }

  // Manifest screenshot entries (optional — enables rich Android install UI).
  // `label` (accessibility) and `platform` are passed through when present.
  // A malformed individual entry (missing src/sizes/form_factor) is dropped
  // rather than failing the build, unchanged from before this reorg. This
  // `mustExist` runs no earlier or later than it always has — what changed is
  // that a throw here can no longer race a physical write: the icon set and
  // splashes above are only ever QUEUED (see `batch`/`write`/`copy`), so at
  // this point in the function nothing this call produces has touched disk
  // yet, regardless of where in this file the throw comes from.
  const screenshots = [];
  if (Array.isArray(pwa.screenshots)) {
    for (const shot of pwa.screenshots) {
      if (shot.src && shot.sizes && shot.form_factor) {
        const abs = mustExist(resolve(CONFIG_DIR, shot.src), `screenshot '${shot.src}'`);
        const name = abs.split(/[\\/]/).pop();
        copy(abs, name, `screenshot '${shot.src}'`);
        screenshots.push({
          src: name,
          sizes: shot.sizes,
          type: "image/png",
          form_factor: shot.form_factor,
          ...(typeof shot.label === "string" ? { label: shot.label } : {}),
          ...(typeof shot.platform === "string" ? { platform: shot.platform } : {}),
        });
      }
    }
  }

  // M8: build the manifest's `icons` from `iconFiles` (what was actually
  // written above), not a fixed assumed set — a rasterizer that's absent or
  // failed shrinks this list instead of leaving a dangling reference.
  const ALL_ICON_DESCRIPTORS = {
    "icon.svg": { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    "icon-192.png": { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    "icon-512.png": { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    "icon-512-maskable.png": {
      src: "icon-512-maskable.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  };
  const manifestIcons = iconFiles
    .filter((f) => ALL_ICON_DESCRIPTORS[f])
    .map((f) => ALL_ICON_DESCRIPTORS[f]);

  // A manifest icon descriptor for a served image URL, typed by extension. SVGs
  // advertise sizes "any"; a PNG's real pixel size is read from its header so
  // launchers can pick it accurately (falling back to "any" if unreadable); other
  // types default to "any". An unknown extension gets no type (valid per the spec).
  const iconDescriptor = (src) => {
    const ext = src.slice(src.lastIndexOf(".") + 1).toLowerCase();
    const type = { svg: "image/svg+xml", png: "image/png", webp: "image/webp" }[ext];
    let sizes = "any";
    if (ext === "png") {
      // A design picker icon (`d.icon`) is served from scad/ but lives, at this
      // point in the build, in `scadDir` (the staging dir); read it there.
      // Root-level PWA images (screenshots) resolve under outPublicDir.
      const abs = src.startsWith("scad/")
        ? join(scadDir, src.slice("scad/".length))
        : join(outPublicDir, src);
      try {
        sizes = pngSize(readFileSync(abs)) ?? "any";
      } catch {
        /* icon unreadable here — keep "any" */
      }
    }
    return { src, sizes, ...(type ? { type } : {}) };
  };

  // App shortcuts (Android long-press / desktop jump list). Author-provided
  // `shortcuts` win; otherwise, with multiple designs, derive one per design
  // that deep-links to it (#d=<id>, the same hash readInitialState parses). A
  // derived shortcut carries the design's own icon (if any); author entries may
  // supply their own `icons` array ([{ src, sizes?, type? }]).
  let shortcuts = [];
  if (Array.isArray(pwa.shortcuts)) {
    shortcuts = pwa.shortcuts
      .filter((sc) => sc && typeof sc.name === "string" && typeof sc.url === "string")
      .map((sc) => ({
        name: sc.name,
        ...(sc.short_name ? { short_name: sc.short_name } : {}),
        url: sc.url,
        ...(Array.isArray(sc.icons) &&
        sc.icons.every((ic) => ic && typeof ic.src === "string")
          ? { icons: sc.icons }
          : {}),
      }));
  } else if (designs.length > 1) {
    shortcuts = designs.map((d) => ({
      name: d.label,
      short_name: d.label,
      url: `./#d=${d.id}`,
      ...(d.icon ? { icons: [iconDescriptor(d.icon)] } : {}),
    }));
  }

  const manifest = {
    id: `/${ID}/`,
    name: TITLE,
    short_name: SHORT_NAME,
    description: DESCRIPTION,
    lang: LANG ?? "en",
    dir: DIR ?? "ltr",
    start_url: ".",
    scope: ".",
    display: "standalone",
    background_color: BG_COLOR,
    theme_color: THEME_COLOR,
    launch_handler: { client_mode: "navigate-existing" },
    icons: manifestIcons,
  };
  if (CATEGORIES.length) manifest.categories = CATEGORIES;
  if (screenshots.length) manifest.screenshots = screenshots;
  if (shortcuts.length) manifest.shortcuts = shortcuts;

  write(
    "manifest.webmanifest",
    JSON.stringify(manifest, null, 2) + "\n",
    "manifest.webmanifest"
  );

  // The M8 reconciliation caller derives its written-path list from `batch`
  // itself (`batch.map((e) => e.dest)`), so the batch is the single source of
  // truth for what this call will produce — correct even for the splash
  // sub-batch above, whose entries only ever reach `batch` on a fully
  // successful device loop.
  return { appleSplash, iconFiles, batch };
}

/**
 * Physically write every entry `generatePwaAssets` queued (icons, splashes,
 * screenshot copies, manifest.webmanifest) — the other half of the split the
 * module comment above describes. Called exactly once, by generate(), at its
 * own single commit point: by the time this runs, every fallible step in
 * `generatePwaAssets` (icon rasterization, the screenshot `mustExist` checks)
 * has already succeeded, so this loop is not itself a place a config error
 * can surface — an exception here would mean a genuine environment fault (a
 * full disk, a permission change mid-build), which is allowed to propagate
 * rather than being mistaken for one more thing to validate.
 */
export function commitPwaBatch(batch) {
  for (const dir of new Set(batch.map((e) => dirname(e.dest))))
    mkdirSync(dir, { recursive: true });
  for (const { dest, data, src } of batch) {
    if (src !== undefined) copyFileSync(src, dest);
    else writeFileSync(dest, data);
  }
}
