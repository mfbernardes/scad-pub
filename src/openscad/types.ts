// Shared types for the OpenSCAD render worker protocol and the parameter schema.

export type ParamValue = number | string | boolean;

export interface RenderRequest {
  id: number;
  design: string; // a design id, e.g. "nameplate"
  /** Parameter overrides as { name: scadValue }. Strings already quoted. */
  defines: Record<string, string>;
  /** Extra user-supplied fonts to mount: filename -> bytes. */
  userFonts?: Record<string, Uint8Array>;
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
   *  project-agnostic default is used. */
  help: { intro?: string; sections: HelpSection[] } | null;
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
  /** Optional per-theme header logo: served-relative image URLs, or null. */
  logo: { light: string; dark: string } | null;
  /** OpenSCAD experimental features to --enable for every render. */
  features: string[];
  /** Bundled font filenames the renderer mounts from public/fonts/. */
  fonts: string[];
  /**
   * Optional startup prompt nudging the user to upload an external font that
   * the designs expect but can't be bundled (e.g. a license-restricted profile
   * font). Shown once on startup when no user font is present, and surfaced as a
   * download link in the preset panel. Null (the default) disables both. All
   * copy is config-driven so this stays project-agnostic.
   */
  fontPrompt: {
    /** Where to download the font (opened in a new tab). */
    url: string;
    /** Friendly font name, e.g. "DIN profile font" (modal title/intro). */
    label?: string;
    /** The font-family the designs reference, shown as a hint. */
    family?: string;
    /** Preset-panel group heading (default "Font"). */
    heading?: string;
    /** Preset-panel download-link text (default `Get ${label ?? "the font"}`). */
    linkText?: string;
    /** Optional explanatory line shown as the download-link tooltip. */
    note?: string;
  } | null;
  /** Source-relative paths of the shared .scad dependency files to mount. */
  assets: string[];
  designs: Design[];
}
