export type Level = "ERROR" | "WARN" | "INFO";

/** A single check result. `code` is a stable identifier for tests/UI; `message`
 *  and `hint` are human-readable. */
export interface Finding {
  level: Level;
  code: string;
  message: string;
  hint?: string;
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
