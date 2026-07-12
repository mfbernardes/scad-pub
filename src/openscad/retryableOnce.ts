// retryableOnce.ts — M1: a promise-memoizing helper for "run this expensive
// setup once per success, but if it fails, let the NEXT call retry from
// scratch" instead of replaying the same rejection forever.
//
// Extracted from worker.ts's ensureAssets (the render worker's one-time
// asset-bootstrap load: WASM factory import, wasm compile, shared .scad
// sources, fontconfig, fonts) so the memoize/retry CONTRACT itself can be unit
// -tested without a worker/WASM/Cache Storage environment. worker.ts still
// owns what actually gets loaded and how a failure is classified (see
// BootstrapError there); this only owns "was it attempted, and does a failure
// let the next call try again."
//
// The bug this fixes (see docs/architecture-review.md M1): a loader that
// kicks off several independent async pieces MUST have every one of them
// actually be part of what `load()`'s returned promise awaits — a piece that
// is started but never awaited (e.g. assigned to an outer variable and used
// later, but not included in a Promise.all) can reject WITHOUT that rejection
// ever reaching here, so a partial failure looks like success: `run()`
// memoizes a promise that resolves, and every later call — and every later
// read of the outer variable the errant piece populated — is stuck with
// whatever broken/undefined state that piece left behind, with no retry path
// short of a full reload. This helper only prevents the OTHER half of that
// bug (a rejection that DOES reach `load()` staying memoized forever); the
// caller is responsible for making sure `load()` actually awaits everything
// it starts (worker.ts's ensureAssets includes `factoryPromise` directly in
// its Promise.all for exactly this reason).
export function retryableOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return function run(): Promise<T> {
    if (pending) return pending;
    pending = load().catch((err) => {
      // Unlike a plain memoized promise, a REJECTED attempt is not kept: the
      // next run() call re-invokes load() from scratch rather than replaying
      // this same rejection forever.
      pending = null;
      throw err;
    });
    return pending;
  };
}
