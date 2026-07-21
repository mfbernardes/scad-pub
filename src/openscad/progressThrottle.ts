// progressThrottle.ts — pure throttle policy for the render worker's WASM
// download progress channel. Extracted from worker.ts so the "at most ~5
// posts/sec, and only when progress actually moved" policy is unit-testable
// without a worker/fetch/postMessage environment (see
// tests/progressThrottle.test.mjs). worker.ts owns the actual read-and-post
// loop (readWithProgress); this only owns the decision of WHEN to call the
// post callback it's given.

export interface ProgressThrottleOptions {
  /** Minimum time between two posts, in ms (default 200 -> ~5/sec). */
  minIntervalMs?: number;
  /** Minimum fractional change (of loaded/total, or of raw loaded bytes when
   *  total is unknown) required to post again, even once minIntervalMs has
   *  elapsed (default 0.01 -> 1%). */
  minDeltaFraction?: number;
  /** Injectable clock (tests); defaults to Date.now. */
  now?: () => number;
}

/**
 * Wrap a `post(loaded, total)` callback so it's actually invoked at most
 * ~`1000/minIntervalMs` times per second, AND only when progress has moved at
 * least `minDeltaFraction` since the last post — a chunky stream (large
 * reader chunks over a fast connection) would otherwise still post every
 * chunk if only the interval were enforced, and a trickle download would post
 * near-identical numbers every 200ms if only the delta were enforced. The
 * very first report is always posted unconditionally (there's nothing to
 * throttle against yet, and a consumer waiting on "any progress at all" to
 * leave its initial state should not wait a full interval for it).
 */
export function makeProgressThrottle(
  post: (loaded: number, total: number | null) => void,
  opts: ProgressThrottleOptions = {}
): (loaded: number, total: number | null) => void {
  const minIntervalMs = opts.minIntervalMs ?? 200;
  const minDeltaFraction = opts.minDeltaFraction ?? 0.01;
  const now = opts.now ?? Date.now;

  let lastPostAt: number | null = null;
  let lastLoaded = 0;

  return function report(loaded: number, total: number | null): void {
    if (lastPostAt !== null) {
      const elapsed = now() - lastPostAt;
      // total known -> fraction of the whole; total unknown -> fraction of
      // bytes seen so far (a trickle without a known size still throttles
      // sensibly instead of posting on every single byte).
      const denom = total && total > 0 ? total : Math.max(lastLoaded, 1);
      const delta = Math.abs(loaded - lastLoaded) / denom;
      if (elapsed < minIntervalMs || delta < minDeltaFraction) return;
    }
    lastPostAt = now();
    lastLoaded = loaded;
    post(loaded, total);
  };
}
