// useAppNotices.ts — the app-level persistent notices, extracted from App.tsx:
// stale-bundle (hard) and service-worker-update (soft) reload prompts, the
// offline indicator, and the one-time offline-readiness claim toast. All
// Sonner toasts with stable ids so a notice replaces its previous instance
// instead of stacking.
import { useEffect } from "react";
import { toast } from "sonner";
import { t } from "./i18n";
import { makeOnceFlag } from "./prefs";
import { assetUrl } from "./assetUrl";
import { binCacheName } from "../openscad/binCache";
import { selectOfflineClaim } from "./offlineClaim";
import schemaJson from "../generated/designs.json" with { type: "json" };
import type { Schema } from "../openscad/types";

const offlineClaimFlag = makeOnceFlag("offline.claim.v1");
// Same name the render worker's own BIN_CACHE resolves to (binCacheName is
// pure — no worker-only APIs — so it's honest to compute main-thread too; see
// offlineClaim.ts's doc and worker.ts's BIN_CACHE for the shared source).
const BIN_CACHE = binCacheName((schemaJson as Schema).wasmVersion);

/**
 * Gather this session's offline-readiness signals and pick the strongest
 * honest claim (see offlineClaim.ts). Best-effort and failure-tolerant end to
 * end: any Cache Storage / fetch error degrades toward "no claim" rather than
 * throwing or overclaiming. `caches.match` is the ambient, cache-name-agnostic
 * lookup (searches every Cache Storage entry on the origin), so this never
 * needs to know the service worker's own shell-cache name (see public/sw.js's
 * `CACHE` — it's namespaced by config id + per-deploy version, neither of
 * which is worth reconstructing here just to ask a question `caches.match`
 * already answers directly).
 */
async function gatherOfflineClaimInputs(downloadHappened: boolean) {
  const swControls = !!navigator.serviceWorker?.controller;
  const engineCached = await caches.has(BIN_CACHE).catch(() => false);
  let shellOk = false;
  try {
    const res = await fetch(assetUrl("precache-manifest.json"), { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      // v2 shape carries `{ shell: [...] }`; tolerate a plain array (the
      // pre-v2 shape — see sw.js's own addPublicAssets for the same fallback)
      // so a mismatched manifest degrades instead of throwing.
      const shell: string[] = Array.isArray(data) ? data : (data.shell ?? []);
      shellOk =
        shell.length > 0 &&
        (await Promise.all(shell.map((path) => caches.match(assetUrl(path))))).every(Boolean);
    }
  } catch {
    shellOk = false;
  }
  // "Ready for offline use" means the WHOLE app — shell AND engine — would
  // boot with the network off, not just the shell manifest's own entries
  // (which deliberately exclude the big binaries — see sw.js's BIN_RE comment).
  const precacheOk = shellOk && engineCached;
  return { downloadHappened, swControls, precacheOk, engineCached };
}

export interface AppNoticesArgs {
  /** A render used defines the current bundle no longer declares. */
  bundleStale: boolean;
  forceUpdate: () => void;
  updateReady: boolean;
  applyUpdate: () => void;
  dismissUpdate: () => void;
  online: boolean;
  /** The render worker has finished its one-time bootstrap (useRenderPipeline's
   *  `ready`) — the offline-claim toast's first gate: nothing to check before
   *  this. */
  engineReady: boolean;
  /** A render attempt (success or failure) has completed at least once
   *  (useRenderPipeline's `result !== null`) — the toast's second gate, so it
   *  never fires purely off `ready` before the first preview actually lands. */
  renderCompleted: boolean;
  /** A real engine download happened THIS session (useRenderPipeline's
   *  `engineDownloaded`) — see offlineClaim.ts: without this, a warm reload
   *  would re-show the toast for nothing new. */
  engineDownloaded: boolean;
}

export function useAppNotices({
  bundleStale,
  forceUpdate,
  updateReady,
  applyUpdate,
  dismissUpdate,
  online,
  engineReady,
  renderCompleted,
  engineDownloaded,
}: AppNoticesArgs): void {
  useEffect(() => {
    if (bundleStale)
      toast.error("This page is running an outdated version. Reload to update.", {
        id: "bundle-stale",
        duration: Infinity,
        action: { label: "Reload", onClick: forceUpdate },
      });
  }, [bundleStale, forceUpdate]);

  useEffect(() => {
    if (updateReady && !bundleStale)
      toast("A new version is available.", {
        id: "sw-update",
        duration: Infinity,
        action: { label: "Reload", onClick: applyUpdate },
        cancel: { label: "Later", onClick: dismissUpdate },
      });
  }, [updateReady, bundleStale, applyUpdate, dismissUpdate]);

  // Offline indicator: a persistent (but reassuring) toast while offline, since
  // the cached WASM means rendering and export keep working. Clears on reconnect.
  useEffect(() => {
    if (!online)
      toast("You're offline — rendering and export still work.", {
        id: "offline",
        duration: Infinity,
      });
    else toast.dismiss("offline");
  }, [online]);

  // Staged offline-readiness claim: a one-time, informational toast telling a
  // visitor this configurator (or at least its render engine) now works
  // offline. Gated on THREE things together — engineReady, renderCompleted,
  // and engineDownloaded — so it can only ever fire once, right after a
  // genuine first-time/cache-miss bootstrap actually finishes proving itself
  // with a real render, never on a warm reload (no download -> gatherOffline-
  // ClaimInputs never even runs) and never mid-bootstrap. `online` gates it
  // too: skip while the "you're offline" notice above would be showing (a
  // claim about offline readiness landing at the same moment as "you're
  // offline right now" is a confusing pairing, even though both would be true).
  useEffect(() => {
    if (!engineReady || !renderCompleted || !engineDownloaded) return;
    if (!online) return;
    if (offlineClaimFlag.seen()) return;
    if (typeof caches === "undefined") return;
    let cancelled = false;
    void (async () => {
      // Best-effort end to end: a failure anywhere here (a blocked Cache
      // Storage, a fetch error) must never crash the app or show a false
      // claim — gatherOfflineClaimInputs already degrades every sub-check
      // toward "false", so a thrown error here just means "no claim".
      try {
        const inputs = await gatherOfflineClaimInputs(engineDownloaded);
        if (cancelled) return;
        const key = selectOfflineClaim(inputs);
        if (!key) return;
        // Claim the once-flag before showing — if the write doesn't stick
        // (storage unavailable), skip rather than risk repeating it.
        if (!offlineClaimFlag.remember()) return;
        toast(t(key), { id: "offline-claim", duration: 8000 });
      } catch {
        /* best-effort — see the comment above */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engineReady, renderCompleted, engineDownloaded, online]);
}
