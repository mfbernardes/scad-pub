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
 * A throttled progress update posted by the render worker while it downloads
 * a large bootstrap asset (currently only the ~10 MB WASM binary, on a Cache
 * Storage miss — see worker.ts's cachedBufferWithProgress). Never posted on a
 * cache hit (nothing to report progress on), and never once the worker's
 * `{ type: "ready" }` message has fired for this worker instance — see
 * runner.ts's `onProgress` doc.
 */
export interface WorkerProgress {
  type: "progress";
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
  /** Hidden by the initial essentials view when `ui.essentials` is enabled. */
  advanced?: boolean;
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
  /** Optional served URL of larger artwork for the visual design picker. */
  image?: string | null;
  /** Optional served URL of the design's own user-documentation Markdown
   *  (scad/<id>-doc.md), fetched on demand and rendered in the doc modal.
   *  Null/absent hides the "Design guide" affordance. */
  doc?: string | null;
  /**
   * Optional bundled-preset thumbnails (config's `designs[].presetImages`;
   * see docs/config.md). Maps a bundled preset's EXACT name (as it appears in
   * the sibling parameterSets file) to a served image URL — gen-schema fails
   * the build if a key doesn't match a real bundled preset name. When set
   * (non-empty), PresetPicker renders that design's bundled presets as a card
   * grid (src/lib/presetCard.ts parses each name into overline/title/badge)
   * instead of the plain compact list. Absent/undefined for the list view.
   */
  presetImages?: Record<string, string>;
  sections: string[];
  /** Section names that start collapsed (from a `// @collapsed` annotation). */
  collapsedSections?: string[];
  params: Param[];
  /**
   * Optional curated label overrides for a review summary (config's
   * `designs[].reviewLabels`; see docs/config.md). Maps a declared
   * parameter's name to the label its value is shown under in the summary
   * — gen-schema fails the build if a key doesn't match one of this
   * design's own params. Several params sharing the same label merge into
   * ONE summary row, their formatted values joined by " / ". Absent -> the
   * curated summary is empty. Never affects geometry.
   */
  reviewLabels?: Record<string, string>;
  /**
   * Optional short explanatory note for a review summary (config's
   * `designs[].reviewNote`) — e.g. "Text prints in capitals even though you
   * typed it in lowercase." A generic hook for a design whose output
   * transforms a parameter's raw value in a way worth calling out; a
   * deployment supplies the wording, ScadPub never infers it. Null/absent
   * renders nothing. Never affects geometry.
   */
  reviewNote?: string | null;
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
  /**
   * Optional singular form of `label` (e.g. "alert" for `label: "alerts"`),
   * used wherever a count renders alongside it whenever the live count is
   * exactly 1 — `label` alone can't pluralize itself ("1 alerts" reads
   * wrong). Omit to keep `label` regardless of count.
   */
  labelOne?: string;
  /** Optional badge fill colour (a plain CSS colour); falls back to the accent. */
  color?: string;
  /** Whether this category should be treated as requiring user attention. */
  attention?: boolean;
}

/** How often the configurable `popup` notice is shown. */
export type PopupMode = "always" | "once" | "dismissible" | "picker";

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
  /**
   * Optional plain-text footnote, rendered small and muted at the bottom of
   * the dialog, in every mode (including "picker"). For a short standing
   * disclosure that doesn't belong in `body`'s main message, e.g. "Everything
   * runs in your browser. Nothing is uploaded." Plain text, not Markdown.
   */
  footnote?: string;
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
  /** Use the card-grid design picker instead of the compact dropdown. */
  gallery?: boolean;
  /** Start with `@advanced` parameters hidden behind a Show all settings action. */
  essentials?: boolean;
  /**
   * Optional inline success panel shown above the action dock after a
   * successful export (see src/components/ExportSuccess.tsx). Absent -> the
   * feature is off entirely — no panel is ever shown, on any export. All
   * fields are optional even when the object is present; omitted `title`/
   * `body` fall back to built-in copy. None of these fields affect geometry
   * (absent from renderHash).
   */
  afterExport?: {
    /** Overrides the panel's default headline ("Your file is on its way"). */
    title?: string;
    /** Overrides the panel's default next-step body text. Rendered as the
     *  same Markdown subset as `help`/`fileImport.note`. */
    body?: string;
    /**
     * Help-modal tab label to deep-link the panel's "Open printing help"
     * action to (HelpModal's `initialTab`). Validated at build time against
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
   * Optional per-deployment UI text overrides (config's `strings` key; see
   * docs/config.md and src/lib/i18n.ts). Keyed by the same dot-namespaced
   * keys (including plural `#one`/`#other` variants) as
   * src/locales/en.json, and validated at build time against that catalogue's
   * key set. Consulted first, ahead of the bundled English catalogue.
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
