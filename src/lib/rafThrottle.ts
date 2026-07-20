// rafThrottle.ts — a pure, generic trailing-edge "at most once per animation
// frame" throttle, extracted so the policy is unit-testable without a real
// requestAnimationFrame/DOM environment (mirrors progressThrottle.ts's own
// injectable-clock approach, but for a frame-scheduled stream rather than a
// time-scheduled one). ParamRows.tsx's NumberControl is the first caller: a
// Radix Slider's `onValueChange` fires continuously during a drag, often
// several times per animation frame, and forwarding every one of those
// straight to the app-level `onChange` (which drives the 400ms render
// debounce) does needless work — this collapses a drag to at most one
// forwarded call per frame, always the LAST (most current) value.
export interface RafThrottleOptions {
  /** Injectable requestAnimationFrame (tests); defaults to the real one. */
  raf?: (cb: () => void) => number;
  /** Injectable cancelAnimationFrame (tests); defaults to the real one. */
  caf?: (handle: number) => void;
}

export interface RafThrottle<T> {
  /** Record a new value. Forwards to `fn` at most once per animation frame —
   *  the last value recorded before a frame fires is the one `fn` sees; any
   *  values recorded and superseded within the same frame are dropped. */
  call(value: T): void;
  /** Cancel any pending frame without forwarding its buffered value. */
  cancel(): void;
  /** Cancel any pending frame (dropping its buffered value) and forward
   *  `value` synchronously right now — guarantees a specific value lands
   *  immediately, e.g. on drag-commit/pointer-up. */
  flush(value: T): void;
}

export function makeRafThrottle<T>(
  fn: (value: T) => void,
  opts: RafThrottleOptions = {}
): RafThrottle<T> {
  const raf = opts.raf ?? ((cb: () => void) => requestAnimationFrame(cb));
  const caf = opts.caf ?? ((handle: number) => cancelAnimationFrame(handle));

  let frame: number | null = null;
  let pending: T | undefined;

  function cancel(): void {
    if (frame != null) {
      caf(frame);
      frame = null;
    }
  }

  function call(value: T): void {
    pending = value;
    if (frame != null) return;
    frame = raf(() => {
      frame = null;
      fn(pending as T);
    });
  }

  function flush(value: T): void {
    cancel();
    fn(value);
  }

  return { call, cancel, flush };
}
