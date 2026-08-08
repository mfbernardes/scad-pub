export type Level = "ERROR" | "WARN" | "INFO";

/** A value a Finding/Change/SvgPrepError can carry for its display text to
 *  interpolate: a plain scalar, or a list joined through formatList (region
 *  ids, layer names, tag names — see svgPrepText.ts). */
export type VarValue = string | number | string[];
export type Vars = Record<string, VarValue>;

/** A single check result. `code` is a stable identifier the engine's tests
 *  assert on and the display layer (src/lib/svgPrepText.ts) resolves to
 *  human-readable text; `vars` carries whatever that text interpolates. The
 *  engine itself is i18n-free (see check.ts's header) so it runs unchanged
 *  under Node tests. */
export interface Finding {
  level: Level;
  code: string;
  vars?: Vars;
}

/** A named, colourable region of the drawing. */
export interface Region {
  id: string;
  /** OpenSCAD-friendly colour (a CSS name when known, else `#rrggbb`). */
  color: string;
  /** The group mixed several fill colours; the most common was used. */
  mixed: boolean;
  /** The group had an explicit fill (vs. defaulting to black). */
  explicit: boolean;
  /** Number of shapes in the region. */
  count: number;
}

/** A safe fix or a group-by-colour outcome, in the same coded shape as
 *  Finding: see fixes.ts and groupByColor.ts for the codes each mints, and
 *  svgPrepText.ts's changeText for how one becomes display text. */
export interface Change {
  code: string;
  vars?: Vars;
}

/** Thrown by the engine's few terminal failure points (parseSvg, a layers-spec
 *  field that would corrupt the spec) so the wizard's error step can resolve a
 *  coded message the same way a Finding does. `message` still carries
 *  parser-supplied detail (e.g. the DOMParser's own parsererror text) for
 *  whatever isn't itself translatable. */
export class SvgPrepError extends Error {
  code: string;
  vars?: Vars;

  constructor(code: string, message: string, vars?: Vars) {
    super(message);
    this.name = "SvgPrepError";
    this.code = code;
    this.vars = vars;
  }
}
