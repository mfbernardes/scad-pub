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
  sections: string[];
  /** Section names that start collapsed (from a `// @collapsed` annotation). */
  collapsedSections?: string[];
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
   * alongside its label (default true). Shown as visually-secondary monospace
   * text; set false to hide it entirely.
   */
  showVarName?: boolean;
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
  /** Page/header title (used as the document title and the header text). */
  title: string;
  /** Optional stable id; namespaces this configurator's browser storage so two
   *  configs on one origin don't collide. Defaults to "scadpub". */
  id?: string;
  /** Optional help content shown in the Help modal. When null, a generic,
   *  project-agnostic default is used. `sections` renders as a single pane;
   *  supplying `tabs` renders a tab strip (top-level `sections`, if any, become
   *  a leading tab so adding tabs never drops existing content). */
  help: { intro?: string; sections?: HelpSection[]; tabs?: HelpTab[] } | null;
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
  /** OpenSCAD experimental features to --enable for every render. */
  features: string[];
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
  /** Light-mode theme color for `<meta name="theme-color">` (default "#ffffff"). */
  themeColorLight?: string;
  /** iOS standalone launch images (apple-touch-startup-image), generated when a
   *  build-time rasterizer is available. Injected into index.html by vite. */
  appleSplash?: { href: string; media: string }[];
}
