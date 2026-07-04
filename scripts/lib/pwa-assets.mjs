// pwa-assets.mjs — generate the installable-PWA assets from the config: the app
// icon (SVG + rasterized 192/512/512-maskable/180 PNGs), the iOS launch
// ("splash") images, and manifest.webmanifest (with categories, screenshots and
// per-design shortcuts). Runs only in a real build (generate() passes
// outPublicDir); the fixture-driven unit tests skip it. Returns the appleSplash
// <link> descriptor list vite.config.ts injects into index.html.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { xmlEscape } from "./config-parsers.mjs";

// Optional build-time SVG→PNG rasterizer (@resvg/resvg-js). Present in dev
// builds; gracefully absent in minimal CI environments that didn't npm install.
let Resvg = null;
try {
  ({ Resvg } = await import("@resvg/resvg-js"));
} catch {
  /* not installed — icon rasterization will be skipped */
}

/**
 * Write the PWA icon set + manifest into outPublicDir and return the iOS splash
 * descriptors. Mirrors the logic that used to live inline in generate().
 * @returns {{ appleSplash: { href: string, media: string }[] }}
 */
export function generatePwaAssets({
  config,
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
}) {
  // iOS standalone launch images (apple-touch-startup-image). Populated below
  // when a rasterizer is available; injected into index.html by vite.
  let appleSplash = [];

  mkdirSync(outPublicDir, { recursive: true });

  // Build (or use the default) icon SVG source.
  let iconSvg;
  if (config.icon) {
    iconSvg = readFileSync(
      mustExist(resolve(CONFIG_DIR, config.icon), `icon '${config.icon}'`),
      "utf-8"
    );
    copyFileSync(resolve(CONFIG_DIR, config.icon), join(outPublicDir, "icon.svg"));
  } else {
    // Neutral default icon when the config supplies none.
    iconSvg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="${xmlEscape(TITLE)}">\n` +
      `  <rect width="512" height="512" rx="96" fill="${THEME_COLOR}"/>\n` +
      `  <rect x="150" y="150" width="212" height="212" rx="28" fill="none" stroke="#86a9ff" stroke-width="30"/>\n` +
      `</svg>\n`;
    writeFileSync(join(outPublicDir, "icon.svg"), iconSvg);
  }

  // Maskable icon: separate source (safe-zone padded) or fall back to the
  // main icon. The maskable PNG is rendered from this SVG.
  let maskableSvg = iconSvg;
  if (config.iconMaskable) {
    maskableSvg = readFileSync(
      mustExist(resolve(CONFIG_DIR, config.iconMaskable), `iconMaskable '${config.iconMaskable}'`),
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
  if (rasterize) {
    try {
      writeFileSync(join(outPublicDir, "icon-192.png"), rasterize(iconSvg, 192));
      writeFileSync(join(outPublicDir, "icon-512.png"), rasterize(iconSvg, 512));
      writeFileSync(join(outPublicDir, "icon-512-maskable.png"), rasterize(maskableSvg, 512));
      writeFileSync(join(outPublicDir, "icon-180.png"), rasterize(iconSvg, 180));
    } catch (err) {
      console.warn(`gen-schema: icon rasterization failed (${err.message})`);
      copyFileSync(join(outPublicDir, "icon.svg"), join(outPublicDir, "icon-180.png"));
    }
  } else {
    // Fallback: copy SVG as apple-touch-icon placeholder when resvg unavailable.
    copyFileSync(join(outPublicDir, "icon.svg"), join(outPublicDir, "icon-180.png"));
  }

  // iOS standalone launch ("splash") images. iOS only shows one whose media
  // query matches the device exactly, so emit a portrait PNG (the icon centred
  // on the background colour) per common iPhone resolution. Generated only when
  // the rasterizer is present; each becomes an <link rel="apple-touch-startup-image">.
  if (rasterize) {
    // device px width × height, devicePixelRatio — current/common iPhones.
    const DEVICES = [
      [1290, 2796, 3], [1179, 2556, 3], [1284, 2778, 3], [1170, 2532, 3],
      [1125, 2436, 3], [828, 1792, 2], [750, 1334, 2],
    ];
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
        writeFileSync(join(outPublicDir, href), rasterize(splashSvg, w));
        appleSplash.push({
          href,
          media:
            `(device-width: ${w / dpr}px) and (device-height: ${h / dpr}px) ` +
            `and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`,
        });
      }
    } catch (err) {
      console.warn(`gen-schema: splash generation failed (${err.message})`);
      appleSplash = [];
    }
  }

  // Manifest screenshot entries (optional — enables rich Android install UI).
  // `label` (accessibility) and `platform` are passed through when present.
  const screenshots = [];
  if (Array.isArray(config.screenshots)) {
    for (const shot of config.screenshots) {
      if (shot.src && shot.sizes && shot.form_factor) {
        const abs = mustExist(resolve(CONFIG_DIR, shot.src), `screenshot '${shot.src}'`);
        const name = abs.split(/[\\/]/).pop();
        copyFileSync(abs, join(outPublicDir, name));
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

  const manifestIcons = [
    { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ];

  // A manifest icon descriptor for a served image URL, typed by extension.
  // sizes "any" suits an SVG and is an acceptable "scalable" hint for the raster
  // types too. An unknown extension gets no type (also valid per the spec).
  const iconDescriptor = (src) => {
    const ext = src.slice(src.lastIndexOf(".") + 1).toLowerCase();
    const type = { svg: "image/svg+xml", png: "image/png", webp: "image/webp" }[ext];
    return { src, sizes: "any", ...(type ? { type } : {}) };
  };

  // App shortcuts (Android long-press / desktop jump list). Author-provided
  // `shortcuts` win; otherwise, with multiple designs, derive one per design
  // that deep-links to it (#d=<id>, the same hash readInitialState parses). A
  // derived shortcut carries the design's own icon (if any); author entries may
  // supply their own `icons` array ([{ src, sizes?, type? }]).
  let shortcuts = [];
  if (Array.isArray(config.shortcuts)) {
    shortcuts = config.shortcuts
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

  writeFileSync(
    join(outPublicDir, "manifest.webmanifest"),
    JSON.stringify(manifest, null, 2) + "\n"
  );

  return { appleSplash };
}
