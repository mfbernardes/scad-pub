// Shared types for the OpenSCAD render worker protocol and the parameter schema.

export type ParamValue = number | string | boolean;

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
}

export type Param = ParamBase &
  (
    | { type: "number"; default: number; min?: number; max?: number; step?: number }
    | { type: "boolean"; default: boolean }
    | { type: "enum"; default: string; choices: EnumChoice[] }
    | { type: "string"; default: string; raw?: boolean }
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
  /** Optional tooltip / hint shown on the button. */
  note?: string;
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
  /** OpenSCAD experimental features to --enable for every render. */
  features: string[];
  /** Bundled font filenames the renderer mounts from public/fonts/. */
  fonts: string[];
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
   * Extra third-party software / license notices supplied by the consumer
   * config, APPENDED after the app's built-in attributions (src/lib/licenses.ts)
   * in the open-source licenses modal. The built-ins are never removed; a config
   * can only add to the list. Empty when none are configured.
   */
  licenses: SoftwareLicense[];
  /** Source-relative paths of the shared .scad dependency files to mount. */
  assets: string[];
  designs: Design[];
}
