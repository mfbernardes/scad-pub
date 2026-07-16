// offlineClaim.ts — pure selection logic for the one-time "this configurator
// works offline" toast (see useAppNotices.ts's offline-claim effect for the
// impure gathering — Cache Storage lookups, the service-worker controller
// check, the toast itself — and its own doc comment for the full design).
// Kept separate so the actual DECISION (which claim, if any, this session can
// honestly make) is unit-testable without a Cache Storage / service-worker /
// toast environment.
//
// Two claims exist, from strongest to weakest — the caller shows at most one,
// picking the strongest it can honestly support:
//   - "loading.readyOffline": the whole app (shell + the render engine) is
//     verified cached AND a service worker currently controls the page, so a
//     reload right now would work with the network off.
//   - "loading.engineOffline": weaker — only the render engine's own binary
//     cache is confirmed, e.g. no service worker (or its shell isn't fully
//     warmed yet), but OpenSCAD itself would still boot from Cache Storage.
// Neither is considered at all unless a real download happened THIS session —
// a warm reload where everything was already cached proves nothing changed
// just now, so there is nothing new to announce.
export interface OfflineClaimInputs {
  /** A real engine download happened THIS session (the render worker's
   *  `loadProgress` channel fired at least once) — see useRenderPipeline's
   *  `engineDownloaded`. false means a cache hit (or no render yet), so this
   *  session earned no claim to make regardless of the other inputs. */
  downloadHappened: boolean;
  /** A service worker currently controls this page
   *  (`navigator.serviceWorker?.controller`). */
  swControls: boolean;
  /** The full offline-readiness set (the shell precache AND the render
   *  engine's binary cache) was verified present in Cache Storage. */
  precacheOk: boolean;
  /** The render engine's own binary Cache Storage entry (BIN_CACHE, see
   *  src/openscad/binCache.ts) is present. */
  engineCached: boolean;
}

export type OfflineClaimKey = "loading.readyOffline" | "loading.engineOffline";

/** The strongest honest claim this session can make, or null for none. */
export function selectOfflineClaim(inputs: OfflineClaimInputs): OfflineClaimKey | null {
  if (!inputs.downloadHappened) return null;
  if (inputs.swControls && inputs.precacheOk) return "loading.readyOffline";
  if (inputs.engineCached) return "loading.engineOffline";
  return null;
}
