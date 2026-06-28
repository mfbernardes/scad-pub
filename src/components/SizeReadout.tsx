// SizeReadout.tsx — ambient "what size will it print?" chip. Shows the model's
// axis-aligned bounding box (width × depth × height, in millimetres) as a small
// glass overlay in the viewer's bottom-left corner. The figure is measured from
// the loaded three.js geometry (see Viewer's onMeasure) — purely informative and
// downstream of the exported STL/3MF, so it never becomes part of the print.
import type { Dimensions } from "./Viewer";

interface Props {
  /** Bounding-box size in millimetres, or null when nothing is rendered. */
  size: Dimensions | null;
  /** Params changed since the last render — the figure no longer matches the controls. */
  stale?: boolean;
}

// Round to 0.1 mm and drop a trailing ".0", so 48.0 reads as "48" but 4.5 stays.
function mm(n: number): string {
  return String(Math.round(n * 10) / 10);
}

export function SizeReadout({ size, stale = false }: Props) {
  if (!size) return null;
  const [w, d, h] = [mm(size.x), mm(size.y), mm(size.z)];
  return (
    <div
      className={`size-readout${stale ? " size-readout--stale" : ""}`}
      title="Print bounding box (width × depth × height)"
      // role="img" so the aria-label names the chip as a single unit (a plain
      // <div> is a generic element, which prohibits aria-label). The visible "×"
      // text is hidden from AT in favour of the spelled-out label.
      role="img"
      aria-label={`Print size: ${w} by ${d} by ${h} millimetres${stale ? ", preview out of date" : ""}`}
    >
      <span aria-hidden="true">
        {w} × {d} × {h} mm
      </span>
    </div>
  );
}
