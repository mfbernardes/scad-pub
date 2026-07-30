// Thumbnail.tsx — the card image used by the design gallery and the bundled-
// preset grid. Both used to render a bare `<img>` inside a `bg-muted` box,
// which on a cold first visit left the whole grid blank for as long as the
// images took to arrive. A skeleton fills it instead, and the image fades in
// over it, so a loading grid reads as loading rather than empty and doesn't
// flash card-by-card as each one pops in.
//
// Scheduling is left entirely to the browser: `loading="lazy"` fetches what is
// in the viewport and skips what isn't. An earlier version overrode that with
// `fetchpriority="high"` on a fixed count of leading cards, because a lazy
// image is Low priority and the grid was losing the bandwidth race at boot —
// but what it was losing to (the render worker's ~11 MB bootstrap and the
// service worker's whole offline bundle) no longer runs while a chooser is on
// screen, and with that gone the override measured no faster on a throttled
// first visit while forcing off-screen fetches at one and two columns. The
// cause was worth fixing; the workaround was not worth keeping.
import { useCallback, useState } from "react";
import { cn } from "../lib/utils";

/** The 4:3 card image box — exported so callers can frame a non-image
 * fallback (a design's icon, its initial) identically. */
export const THUMB_FRAME =
  "relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted";

export function Thumbnail({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false);
  // A cached image can finish decoding before React attaches `onLoad`, which
  // would leave the skeleton up forever. The callback ref runs once the
  // element exists, so re-check `complete` there — that covers the warm case
  // (second visit, design switched back) without a layout effect.
  const ref = useCallback((el: HTMLImageElement | null) => {
    if (el?.complete && el.naturalWidth > 0) setLoaded(true);
  }, []);
  return (
    <span className={THUMB_FRAME}>
      {!loaded && (
        <span
          aria-hidden="true"
          className="thumb-skeleton absolute inset-0 animate-pulse bg-foreground/10 motion-reduce:animate-none"
        />
      )}
      <img
        ref={ref}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        width={640}
        height={480}
        onLoad={() => setLoaded(true)}
        // A broken/missing image must not leave a skeleton pulsing forever.
        onError={() => setLoaded(true)}
        className={cn(
          "h-full w-full object-cover transition-opacity duration-200 motion-reduce:transition-none",
          loaded ? "opacity-100" : "opacity-0"
        )}
      />
    </span>
  );
}
