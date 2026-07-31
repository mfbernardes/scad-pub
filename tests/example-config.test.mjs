// Unit tests for the SHIPPED deployment — scadpub.config.json and examples/ —
// rather than a fixture. The fixtures prove each config key and annotation
// works; these prove the example deployment actually uses them, which is what
// keeps smoke.mjs's config-gated branches (the gallery, the essentials toggle,
// the PWA manifest) from silently degrading to "skipped" and reporting green.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "../scripts/gen-schema.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = JSON.parse(readFileSync(join(ROOT, "scadpub.config.json"), "utf-8"));

// One full build of the real config into a temp tree, shared by every test
// below: it rasterizes icons and splashes, so it is the slow part of this file.
const OUT = mkdtempSync(join(tmpdir(), "example-config-"));
// `render.fonts` names the tracked public/fonts/*.ttf, which bundleFonts looks
// for under the OUTPUT tree rather than the checkout: seed them so this build
// resolves them the way a real one does.
mkdirSync(join(OUT, "public", "fonts"), { recursive: true });
for (const f of readdirSync(join(ROOT, "public", "fonts")).filter((f) => f.endsWith(".ttf")))
  copyFileSync(join(ROOT, "public", "fonts", f), join(OUT, "public", "fonts", f));

const schema = generate({
  configPath: join(ROOT, "scadpub.config.json"),
  outSchemaDir: join(OUT, "schema"),
  outScadDir: join(OUT, "public", "scad"),
  outPublicDir: join(OUT, "public"),
});
const manifest = JSON.parse(readFileSync(join(OUT, "public", "manifest.webmanifest"), "utf-8"));
const design = (id) => schema.designs.find((d) => d.id === id);

test("the example config carries a full PWA identity, not just the defaults", () => {
  assert.equal(manifest.short_name, "ScadPub");
  assert.equal(schema.shortName, "ScadPub");
  assert.equal(manifest.theme_color, CONFIG.pwa.themeColor.dark);
  assert.equal(manifest.background_color, CONFIG.pwa.backgroundColor);
  assert.deepEqual(manifest.categories, CONFIG.pwa.categories);
  // vite.config.ts reads these two off designs.json for the per-scheme
  // <meta name="theme-color"> pair.
  assert.equal(schema.themeColor, CONFIG.pwa.themeColor.dark);
  assert.equal(schema.themeColorLight, CONFIG.pwa.themeColor.light);
});

test("the configured icon and maskable icon are both rasterized and advertised", () => {
  for (const name of ["icon.svg", "icon-192.png", "icon-512.png", "icon-512-maskable.png", "icon-180.png"])
    assert.ok(existsSync(join(OUT, "public", name)), `${name} should be generated`);
  assert.ok(
    manifest.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512"),
    "a maskable 512 must be advertised"
  );
  // pwa.iconMaskable is a SEPARATE source (safe-zone padded), so the two 512s
  // must not be the same bytes — that equality is exactly what an ignored
  // `iconMaskable` would produce.
  const png = (n) => readFileSync(join(OUT, "public", n));
  assert.notDeepEqual(png("icon-512-maskable.png"), png("icon-512.png"));
});

test("shortcuts are derived per design (the config hand-writes none)", () => {
  assert.equal(CONFIG.pwa.shortcuts, undefined);
  assert.deepEqual(
    manifest.shortcuts.map((s) => s.url),
    schema.designs.map((d) => `./#d=${d.id}`)
  );
});

test("every example design ships gallery card art (// @image), distinct from its icon", () => {
  // ui.gallery is on, so the card art is what the first screen renders; without
  // @image each card silently falls back to the small @icon.
  assert.equal(schema.ui.gallery, true);
  for (const d of schema.designs) {
    assert.ok(d.image, `design '${d.id}' should carry an @image`);
    assert.notEqual(d.image, d.icon);
    assert.ok(existsSync(join(OUT, "public", d.image)), `${d.image} should be served`);
  }
});

test("// @advanced marks the quality params, and ui.essentials makes them hideable", () => {
  assert.equal(schema.ui.essentials, true);
  // A section-level `// @advanced` above /* [Quality] */ marks every param in
  // it, which is the form the annotation is easiest to get wrong (see
  // docs/annotations.md): assert the whole section, not one line.
  assert.deepEqual(
    design("tag").params.filter((p) => p.advanced).map((p) => p.name),
    ["text_depth", "emblem_height", "facet_angle", "facet_size"]
  );
  assert.deepEqual(
    design("coin").params.filter((p) => p.advanced).map((p) => p.name),
    ["border_height", "text_depth", "facet_angle", "facet_size"]
  );
  // At least one advanced param must sit OUTSIDE the @collapsed section: a
  // design whose only advanced params are already folded away makes the
  // toggle a no-op on screen, which is what smoke.mjs measures.
  const collapsed = new Set(design("tag").collapsedSections ?? []);
  assert.ok(design("tag").params.some((p) => p.advanced && !collapsed.has(p.section)));
});

test("// @label gives panel's layers field a control label its docstring can't", () => {
  const p = design("panel").params.find((p) => p.name === "svg_layers");
  assert.equal(p.description, "Region colours & heights");
  // The point of the annotation: the block is still the help text, and the
  // first-sentence default would have been unusable as a label.
  assert.ok(p.help.length > 100);
  assert.notEqual(p.description, p.help);
});

test("tag curates its review row's value with a runtime echo(\"@review\", …)", () => {
  // The build-time half is the label; the value override is runtime-only, so
  // all that can be asserted here is that the row exists to be overridden and
  // the design emits the call. smoke.mjs checks the rendered value.
  assert.equal(design("tag").reviewLabels.label, "Text");
  const src = readFileSync(join(ROOT, "examples", "tag.scad"), "utf-8");
  assert.match(src, /echo\("@review",\s*"label"/);
});
