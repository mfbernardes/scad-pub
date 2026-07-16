// Shared types for the OpenSCAD render worker protocol and the parameter schema.

export type ParamValue = number | string | boolean;

/**
 * The model format OpenSCAD exports (and the viewer parses). Chosen at build
 * time in the config; "3mf" carries per-object colour from `color(...)`, "stl"
 * is geometry-only. Defaults to "3mf".
 */
export type ModelFormat = "3mf" | "stl";

export interface RenderRequest {
  id: number;
  design: string; // a design id, e.g. "nameplate"
  /** Parameter overrides as { name: scadValue }. Strings already quoted. */
  defines: Record<string, string>;
  /**
   * Extra user-supplied files to mount, keyed by filename -> bytes. Fonts
   * (.ttf/.otf/.ttc) are mounted into the renderer's font dir so OpenSCAD's
   * `text()` can use them; every other file is mounted at the FS root so a
   * design can reference it by name (e.g. `import("logo.svg")`).
   */
  userFiles?: Record<string, Uint8Array>;
}

export interface RenderResult {
  id: number;
  ok: boolean;
  exitCode: number;
  stl: Uint8Array; // empty on failure
  log: string[];
  ms: number;
  /** True when served from a cache (in-memory or persistent) rather than freshly rendered. */
  cached?: boolean;
  /**
   * Parameter names the request tried to define but the freshly-fetched `.scad`
   * source no longer declares — a sign this JS bundle is stale relative to the
   * deployed sources (see `orphanedDefines`). Present only when non-empty; the
   * UI uses it to prompt the user to reload.
   */
  staleDefines?: string[];
  /**
   * True when this failure means the renderer's asset bootstrap (WASM/glue
   * import, shared sources, fonts) never completed — as opposed to an
   * ordinary model failure (bad OpenSCAD source/parameters). See M1: the
   * worker resets its bootstrap state on such a failure, so the very next
   * render() call retries the whole bootstrap automatically. A caller may use
   * this to avoid presenting a "that combination of settings didn't work"
   * message about a renderer that never started, or to surface a distinct
   * "renderer failed to start, retrying…" state. Absent on ordinary results
   * (successes and model failures alike).
   */
  fatal?: boolean;
}

/**
 * Progress update posted by the worker during its one-time asset bootstrap
 * (worker.ts's `ensureAssets`), before the one-shot "ready" message. Only the
 * ~10 MB OpenSCAD WASM binary download is instrumented — it dominates a cold
 * first load; the small `.scad`/fonts.conf/font-binary fetches alongside it
 * aren't worth a progress channel. Nothing is posted at all on a Cache
 * Storage HIT (there's no download to report on that path) — a consumer that
 * never sees a `progress` message before `ready` should treat the engine as
 * having loaded instantly from cache.
 */
export interface WorkerProgress {
  type: "progress";
  /**
   * The only stage currently emitted: downloading the WASM binary. Typed as a
   * literal (not a wider union) so a future stage can be added additively
   * without every existing switch/consumer needing an `default` arm today.
   */
  stage: "engine";
  /** Bytes downloaded so far. */
  loaded: number;
  /**
   * Total bytes from the response's `Content-Length`, when present and the
   * response isn't compressed in a way that makes that header unreliable
   * (see worker.ts's `readWithProgress`); null when unknown, in which case a
   * consumer should render an indeterminate progress indicator rather than a
   * percentage.
   */
  total: number | null;
}

// ---- Parameter schema (produced by scripts/gen-schema.mjs) ----

export interface EnumChoice {
  value: string;
  label: string;
}

export interface ParamBase {
  name: string;
  section: string;
  /** Concise label: the comment line directly above the parameter (OpenSCAD). */
  description: string;
  /** Full preceding comment block, shown as a tooltip. */
  help: string;
  /** Optional `@showIf` expression: the control is shown only when it's true. */
  showIf?: string;
  /**
   * Optional `@info` annotation: surface this parameter's live value in the
   * viewer's dimension info panel. `label` overrides the displayed name (null →
   * fall back to `description`); `unit` is appended to the value (null → none).
   */
  info?: { label: string | null; unit: string | null };
  /**
   * Optional `@filledBy <param>` annotation: this parameter is populated by the
   * SVG wizard on the named `@svg` field, so the UI renders it demoted (behind an
   * "Advanced" disclosure) rather than as a prominent, hand-edited control. The
   * value is the name of the `@svg` field that fills it. It stays editable.
   */
  filledBy?: string;
  /**
   * Resolved `@advanced` state (gen-schema's `scripts/lib/params.mjs`): true
   * when this parameter should be demoted behind the "all settings" view
   * rather than shown in the default "essentials" view. Set by a param-level
   * `// @advanced` on this parameter, or by a section-level `// @advanced`
   * directly above this parameter's section-header occurrence — unless this
   * parameter also carries `// @essential`, which overrides the
   * section back to non-advanced for it alone. Omitted (not just `false`)
   * when not advanced, matching how the other optional fields here are
   * emitted sparsely. Like `@showIf`, this is UI-only filtering: an advanced
   * parameter's value is still retained and always sent to OpenSCAD, whether
   * or not its control is currently shown.
   */
  advanced?: boolean;
}

/**
 * `@svg [layers=<param>]`: this string parameter is an SVG file prepared by the
 * in-app wizard. `layers` names a second parameter that receives the derived
 * per-region colour string (null when the field carries no `layers=` binding, so
 * the colour step is skipped entirely).
 */
export interface SvgFieldMeta {
  layers: string | null;
}

export type Param = ParamBase &
  (
    | { type: "number"; default: number; min?: number; max?: number; step?: number }
    | { type: "boolean"; default: boolean }
    | {
        type: "enum";
        default: string;
        choices: EnumChoice[];
        /**
         * This dropdown selects an OpenSCAD `font` family. Set by gen-schema from an
         * explicit `// @font` annotation. Lets a design keep the native `// [...]`
         * dropdown (rendered by the desktop Customizer) while still getting the
         * in-app availability check / import affordance — see the `string` member.
         */
        isFont?: boolean;
      }
    | {
        type: "string";
        default: string;
        raw?: boolean;
        /**
         * This string selects an OpenSCAD `font` family. Set by gen-schema from an
         * explicit `// @font` annotation. The UI checks its value against the
         * available font set (bundled ∪ imported) and offers an import / fallback
         * affordance when the family isn't loaded.
         */
        isFont?: boolean;
        /**
         * This string is an SVG file prepared by the in-app wizard. Set by
         * gen-schema from an explicit `// @svg [layers=<param>]` annotation. The UI
         * renders it as a "Prepare SVG…" affordance instead of a plain text box.
         */
        svg?: SvgFieldMeta;
      }
  );

export interface Design {
  id: string;
  label: string;
  /** Source-relative path of the design's root .scad (e.g. "nameplate.scad"). */
  file: string;
  /** Source-relative paths of bundled parameterSets JSON files for this design. */
  presets: string[];
  /** Slow to render: skip the debounced auto-render and render on demand. */
  heavy?: boolean;
  /** Optional dropdown grouping label; designs sharing a group cluster under a
   *  header in the design picker. Null/absent designs render ungrouped. */
  group?: string | null;
  /** Optional short description, shown under the label in the design picker. */
  description?: string | null;
  /** Optional served URL of the design's icon (shown in the picker and used as
   *  the design's manifest-shortcut icon). Null/absent for none. */
  icon?: string | null;
  /** Optional served URL of the design's picker-card artwork — a real model
   *  photo/render, distinct from the small `icon` glyph. Shown at a fixed 4:3
   *  aspect in DesignPickerDialog's card grid; falls back to `icon` (centred),
   *  then a letter glyph, when absent. Never used for the manifest shortcut
   *  icon (that stays `icon`). Null/absent for none. */
  image?: string | null;
  /** Optional served URL of the design's own user-documentation Markdown
   *  (scad/<id>-doc.md), fetched on demand and rendered in the doc modal.
   *  Null/absent hides the "Design guide" affordance. */
  doc?: string | null;
  sections: string[];
  /** Section names that start collapsed (from a `// @collapsed` annotation). */
  collapsedSections?: string[];
  /**
   * Guided steps declared with `// @step <id> [| <label>]` (see
   * docs/annotations.md#guided-steps--step), in step ORDER — the order each
   * id first appears in the source file. `sections` lists the section names
   * carrying that id, in file order (several section occurrences, even of
   * different names, may share one id; their params concatenate in that
   * order). Present only when the design declares at least one `@step`; an
   * unstepped design omits this field entirely rather than emitting `[]`.
   * Purely a UI grouping hint for the stepper the next milestone builds on
   * top of this — it doesn't affect which sections/params exist, their
   * `@showIf`/`@advanced` resolution, or geometry.
   */
  steps?: Array<{ id: string; label: string; sections: string[] }>;
  params: Param[];
}

/** One titled section of the in-app help, with a Markdown-subset body. */
export interface HelpSection {
  title: string;
  body: string;
}

/** One tab of the in-app help: a labelled group of sections with its own
 *  optional intro. A config may supply many tabs; the Help modal renders a tab
 *  strip when any are present. */
export interface HelpTab {
  /** Tab-strip label. */
  label: string;
  /** Optional intro paragraph shown above this tab's sections. */
  intro?: string;
  sections: HelpSection[];
}

/** The Help modal's content. `sections` renders as a single pane; supplying
 *  `tabs` renders a tab strip (top-level `sections`, if any, become a leading
 *  tab so adding tabs never drops existing content). */
export interface HelpContent {
  /** Heading shown at the top of the Help modal (default "How to use this configurator"). */
  title?: string;
  intro?: string;
  /** Single-pane sections (the default form). */
  sections?: HelpSection[];
  /** When present, the modal renders a tab strip; many tabs are supported. */
  tabs?: HelpTab[];
}

/** One third-party software component and its license attribution, shown in the
 *  open-source licenses modal. Mirrors the built-in entries in
 *  src/lib/licenses.ts; a consumer config can APPEND more via the `licenses`
 *  config key (the built-ins are never replaced). */
export interface SoftwareLicense {
  name: string;
  version?: string;
  /** SPDX identifier, e.g. "MIT". */
  license: string;
  copyright: string;
  /** Project homepage. */
  url: string;
  /** Canonical license text (reproduced inline for permissive licenses). */
  text?: string;
  /** Where the full license / corresponding source can be obtained. */
  licenseUrl: string;
  /** Source location, required for copyleft (GPL) components. */
  sourceUrl?: string;
  note?: string;
}

/**
 * Config for the generic "Import file" button. A single control that accepts
 * any file (or font); whether an upload is treated as a font is decided by its
 * extension, not by config — so one button covers both cases.
 */
export interface FileImport {
  /**
   * `accept` attribute for the file picker (e.g. ".svg" or ".ttf,.otf"). Omit to
   * accept any file type.
   */
  accept?: string;
  /** Button label (default "Import file"). */
  label?: string;
  /**
   * Optional help text shown above the file list. Rendered as a Markdown
   * subset (paragraphs, bullet lists, **bold**, `code`, links).
   */
  note?: string;
  /**
   * Optional max upload size in bytes. A larger file is rejected with a friendly
   * message instead of being stored. Omit for no cap.
   */
  maxBytes?: number;
}

/**
 * Build-time render tuning (config's `render` key). Every field is optional; the
 * app keeps its built-in default for any omitted value. None affect geometry, so
 * `render` is absent from renderHash.
 */
export interface RenderConfig {
  /**
   * Auto-pause threshold in ms: a live (auto-render) pass slower than this pauses
   * auto-render for the design. Default ≈ 6000.
   */
  heavyMs?: number;
  /** Render-cache sizing (runner's in-memory L1 + persistent L2). */
  cache?: {
    /** L1 slot count (default 16). */
    maxEntries?: number;
    /** L1 total byte budget (default derived from device memory). */
    maxBytes?: number;
    /** Largest single render that may be cached (default derived from maxBytes). */
    maxEntryBytes?: number;
    /** Persist renders to IndexedDB (L2). Default on where IndexedDB exists. */
    persistent?: boolean;
  };
}

/**
 * One design-defined notice category surfaced on the "OpenSCAD output" panel.
 * A design echoes `ECHO: "<context>: <marker>: <message>"`; each configured
 * category turns matching echoes into a friendly notice and a coloured count
 * badge. Build-time, from the config's `notices` key. OpenSCAD's own
 * warnings/errors and assert failures are handled separately and are not
 * configurable (see src/lib/diagnostics.ts).
 */
export interface NoticeCategory {
  /** The design-defined marker, matched as `: <marker>:` within an echo. */
  marker: string;
  /** Badge / notice noun (e.g. "alerts", "notes"). Defaults to the marker. */
  label: string;
  /** Optional badge fill colour (a plain CSS colour); falls back to the accent. */
  color?: string;
}

/** How often the configurable `popup` notice is shown. */
export type PopupMode = "always" | "once" | "dismissible";

/**
 * Config for the optional notice dialog shown over the app on load. All copy is
 * config-driven so it stays project-agnostic. `body` uses the same Markdown
 * subset as `help` (bold, code, links, bullet lists).
 */
export interface PopupNotice {
  /** Dialog header / title. */
  header: string;
  /** Dialog body — a Markdown-subset string (supports links). */
  body: string;
  /**
   * Display policy: "always" (every visit), "once" (first visit only), or
   * "dismissible" (every visit until the user ticks "Don't show this again").
   */
  mode: PopupMode;
  /**
   * Label for the primary (confirm) button. Defaults to "OK". A consumer can
   * set an action-oriented call to action ("Start designing", "Let's go") —
   * clicking it closes the popup and, when there's more than one design, opens
   * the design picker so the user's obvious next step is to choose what to make.
   */
  button?: string;
}

/** Build-time UI behaviour overrides. None affect geometry (absent from renderHash). */
export interface UiConfig {
  /** Which edge the parameter panel docks to on desktop (default "left"). */
  panelSide?: "left" | "right";
  /** Whether the panel starts open or collapsed on desktop (default "open"). */
  panelDefault?: "open" | "collapsed";
  /** Whether the OpenSCAD output console starts open (default "closed"). */
  outputDefault?: "closed" | "open";
  /** Whether to offer PWA install affordance (default "auto"). */
  install?: "auto" | "off";
  /**
   * Whether each parameter control shows the underlying OpenSCAD variable name
   * alongside its label (default false — it's developer detail). Shown as
   * visually-secondary monospace text when enabled.
   */
  showVarName?: boolean;
  /**
   * Whether the viewer's measure (dimensions) toggle is offered (default true).
   * Set false to hide the ruler button — and with it the W×D×H overlay and the
   * measurements/@info panel, which are only reachable through that toggle.
   */
  measure?: boolean;
  /** Whether the viewer's view picker (camera-angle menu) is offered (default true). */
  viewPicker?: boolean;
  /** Whether the viewer's "reset view" button is offered (default true). */
  reset?: boolean;
  /** Whether the viewer's zoom in/out buttons are offered (default false). */
  zoom?: boolean;
  /**
   * Whether the viewer's fullscreen toggle is offered (default true). Only ever
   * shown in a browser tab that supports the Fullscreen API anyway; set false to
   * suppress it there too.
   */
  fullscreen?: boolean;
  /** Label for the "Presets" tab/section (default "Presets"). */
  presetsLabel?: string;
  /** Label for the "Customize" (parameters) tab/section (default "Customize"). */
  parametersLabel?: string;
  /**
   * Whether the top-bar design switcher is the card-grid DesignPickerDialog
   * (true) instead of the classic dropdown Select (default false). Only takes
   * effect with more than one design; a single-design config is unaffected
   * either way. See src/components/DesignPickerDialog.tsx.
   */
  gallery?: boolean;
  /**
   * Whether the getting-started checklist (src/components/GettingStarted.tsx)
   * may show at all (default true). Only ever shown in guided experience
   * regardless of this flag — set false to suppress it there too, e.g. for a
   * config whose designs need no walkthrough.
   */
  checklist?: boolean;
  /**
   * Optional seeds for the client-side guided/standard experience (see
   * src/lib/useExperience.ts). Every field here only decides the FIRST-EVER
   * client state: once the user changes either state, a persisted preference
   * (namespaced local storage) wins on every later visit, ahead of these.
   * None affect geometry (absent from renderHash).
   */
  experience?: {
    /**
     * Initial experience mode when no persisted preference exists yet:
     * "guided" surfaces a curated, reduced control set; "standard" shows the
     * classic full panel. Default "standard".
     */
    default?: "guided" | "standard";
    /**
     * Initial settings view when no persisted preference exists yet:
     * "essentials" shows only non-`@advanced` parameters; "all" shows every
     * parameter. Defaults to whichever the initial mode implies (guided ->
     * "essentials", standard -> "all") when omitted.
     */
    settingsView?: "essentials" | "all";
    /**
     * Initial mobile bottom-sheet snap position on first load: "peek" (mostly
     * closed, a thin handle showing) or "half" (half-open). Default "peek".
     */
    mobileInitialSheet?: "peek" | "half";
  };
  /**
   * Optional inline success panel shown above the action cluster after a
   * successful export (see src/components/ExportSuccess.tsx). Absent ->
   * the feature is off entirely — no panel is ever shown, on any export.
   * All fields are optional even when the object is present; omitted
   * `title`/`body` fall back to i18n defaults (the outcome-led
   * `export.downloaded` / `export.readyToShare`, and `export.nextSteps`).
   * None of these fields affect geometry (absent from renderHash).
   */
  /**
   * When true, a stepped design (one declaring at least one `// @step`)
   * leaving an ESSENTIAL section without a step (see `Design.steps`) fails
   * the build instead of only warning (`console.warn`) at gen-schema time.
   * Default false. A section is essential when at least one of its
   * parameters isn't `@advanced`; an all-`@advanced` section left un-stepped
   * never triggers this, in either mode. Never affects geometry (absent from
   * renderHash) — it's a gen-schema-time authoring lint, not a render input.
   */
  strictSteps?: boolean;
  /**
   * Whether a stepped design (one declaring at least one `// @step`) shows
   * the QuickStart step navigation (src/components/QuickStart.tsx) in place
   * of the classic scrolling form. Default true — declaring `@step` sections
   * at all is the opt-in; set false to keep the classic form even for a
   * stepped design (e.g. while a design's steps are still being authored).
   * Only takes effect in guided experience's essentials settings view; the
   * classic form always renders otherwise (standard experience, All
   * settings, or an active search query). Never affects geometry (absent
   * from renderHash).
   */
  quickStart?: boolean;
  afterExport?: {
    /** Overrides the outcome-led i18n title. */
    title?: string;
    /** Overrides the i18n default body (`export.nextSteps`). */
    body?: string;
    /**
     * Help-modal tab label to deep-link the panel's "Printing guide" action
     * to (see HelpModal's `initialTab`). Validated at build time against
     * this config's `help` tabs — gen-schema fails the build if no tab
     * carries this exact label. Omit to hide the action entirely.
     */
    helpTab?: string;
  };
}

export interface Schema {
  generatedFrom: string;
  /**
   * Automatic content hash (set by gen-schema) of every render-affecting input
   * — the mounted .scad sources, bundled fonts, render features, and the
   * OpenSCAD wasm build. Folded into the render cache key so any of those
   * changing in a deploy invalidates persisted geometry without a manual bump.
   */
  renderHash?: string;
  /**
   * The pinned OpenSCAD WebAssembly snapshot version (set by gen-schema from
   * scripts/wasm-version.mjs). Names the render worker's binary cache — and
   * the service worker warms the same cache — so a WASM bump evicts stale
   * binaries everywhere in one edit.
   */
  wasmVersion?: string;
  /**
   * H4: per-file content digests (short sha256 hex) for the render worker's big
   * binary assets — the pinned wasm binary and each bundled font. The worker
   * (worker.ts) and the service worker's precache warm-up (via
   * precache-manifest.json's `bin.urls`, generated from this same field) both
   * append `?v=<digest>` to a binary's fetch URL, so the fetch/Cache-Storage
   * identity is content-addressed: replacing a font's bytes without renaming
   * it changes its digest and therefore its URL, so a browser with the old
   * bytes cached can never serve them under the new build. Absent/partial in
   * fixture builds that don't produce a real public/wasm or public/fonts tree.
   */
  binAssets?: {
    wasm?: string;
    glue?: string;
    fontsConf?: string;
    fonts?: Record<string, string>;
  };
  /**
   * Byte size of the pinned OpenSCAD WASM binary (public/wasm/openscad.wasm)
   * at build time, derived (not config) — used only to show a "~N MB
   * one-time download" line while the engine phase's progress channel has no
   * `Content-Length` to report a live total from, or as the label for a
   * determinate one. Absent when the file didn't exist at gen time (e.g. a
   * dev run before `fetch-wasm.mjs` populated public/wasm/), in which case
   * the UI simply omits the size line.
   */
  engineBytes?: number;
  /** Page/header title (used as the document title and the header text). */
  title: string;
  /** Optional stable id; namespaces this configurator's browser storage so two
   *  configs on one origin don't collide. Defaults to "scadpub". */
  id?: string;
  /** Document / manifest language (BCP-47 tag). Default "en". */
  lang?: string;
  /** Document / manifest text direction. Default "ltr". */
  dir?: "ltr" | "rtl" | "auto";
  /**
   * Optional per-deployment UI text overrides (config's `strings` key), keyed
   * by the same dot-namespaced catalogue keys as src/locales/en.json (e.g.
   * "action.image", plural variants like "foo.count#other"). Validated at
   * build time (scripts/lib/config-parsers.mjs's parseStrings) so every key
   * must exist in the English bundle. Consulted first by src/lib/i18n.ts's
   * `t`/`tn`, ahead of the active/English bundles. Empty object when unset.
   */
  strings?: Record<string, string>;
  /** Optional help content shown in the Help modal. When null, a generic,
   *  project-agnostic default is used. */
  help: HelpContent | null;
  /**
   * Optional per-theme colour-scheme overrides supplied by the consumer config.
   * Keys are the CSS custom-property tokens from src/index.css (without the
   * leading `--`); values are CSS colours. Emitted as a <style> block at build
   * time (see vite.config.ts), so it's not read at runtime. Null when unset.
   */
  colors?: {
    light?: Record<string, string>;
    dark?: Record<string, string>;
  } | null;
  /**
   * Optional raw-CSS escape hatch: the served URL of a consumer-controlled
   * stylesheet, loaded after the app's own CSS so it can override anything. It
   * targets internal class names at the consumer's own risk (not a stable API,
   * not covered by the accessibility guarantees). Null when unset.
   */
  extraCss?: string | null;
  /** Optional per-theme header logo: served-relative image URLs, or null. */
  logo: { light: string; dark: string } | null;
  /** Model format OpenSCAD exports and the viewer parses (build-time; default "3mf"). */
  format: ModelFormat;
  /**
   * When true, the viewer rests a loaded model's base on the z=0 grid (centred
   * in X/Y only); when false (the default) it centres the model on the origin in
   * all three axes. Build-time, display-only — it doesn't affect the export.
   */
  restOnGrid: boolean;
  /** OpenSCAD experimental features to --enable for every render. */
  features: string[];
  /** Optional build-time render tuning (heavy-render threshold + cache sizing).
   *  Null/absent keeps the app's built-in defaults. */
  render?: RenderConfig | null;
  /** Bundled font filenames the renderer mounts from public/fonts/. */
  fonts: string[];
  /**
   * Embedded family names of the bundled fonts (extracted from their `name`
   * tables at build time). The app matches a design's `font` parameter against
   * this set (plus the families of any user-imported fonts) to decide
   * availability — by real family name, not filename. Empty when no bundled
   * font's family could be read.
   */
  fontFamilies: string[];
  /**
   * Face descriptions of the bundled fonts ({ family, style }, from their
   * `name` tables at build time), display-ordered. The app's font selector
   * lists these — merged with the faces of any user-imported fonts — under
   * friendly names ("Liberation Sans Bold") instead of raw Fontconfig strings.
   */
  fontFaces?: { family: string; style: string }[];
  /**
   * Optional generic "Import file" control in the preset panel. Lets the user
   * supply any file their designs reference but the app can't bundle — a font, an
   * SVG to `import()`, a `surface()` data file, etc. Fonts (by extension) are
   * mounted where OpenSCAD's fontconfig finds them; every other file is mounted
   * at the render FS root so a design can reference it by name. Null/absent hides
   * the button. All copy is config-driven so this stays project-agnostic.
   */
  fileImport: FileImport | null;
  /**
   * Optional notice dialog shown over the app on load (build-time, from the
   * config's `popup` key). Its `mode` decides how often it appears. Null/absent
   * shows no popup. All copy is config-driven so this stays project-agnostic.
   */
  popup: PopupNotice | null;
  /**
   * Config-driven notice categories surfaced on the OpenSCAD output panel. Each
   * is a design-defined marker plus its badge label and optional colour. Empty
   * (the default) when the config omits the `notices` key.
   */
  notices: NoticeCategory[];
  /**
   * Extra third-party software / license notices supplied by the consumer
   * config, APPENDED after the app's built-in attributions (src/lib/licenses.ts)
   * in the open-source licenses modal. The built-ins are never removed; a config
   * can only add to the list. Empty when none are configured.
   */
  licenses: SoftwareLicense[];
  /** Source-relative paths of the shared .scad dependency files to mount. */
  assets: string[];
  designs: Design[];
  /** Build-time UI behaviour overrides (panel side, default state, etc.). */
  ui?: UiConfig;
  /** Optional id of the design shown when a visit carries no `#d=` deep link.
   *  Validated at build time to name a real design; null/absent → the first. */
  defaultDesign?: string | null;
  /** Light-mode theme color for `<meta name="theme-color">` (default "#ffffff"). */
  themeColorLight?: string;
  /** iOS standalone launch images (apple-touch-startup-image), generated when a
   *  build-time rasterizer is available. Injected into index.html by vite. */
  appleSplash?: { href: string; media: string }[];
}
