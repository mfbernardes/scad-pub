// swUpdate.ts — register the service worker and surface "a new version is
// available" to the UI. The worker no longer auto-activates (see public/sw.js):
// when an update finishes installing while an old worker still controls the
// page, it sits in `waiting`; we detect that and let the user apply it, which
// posts SKIP_WAITING and reloads once the new worker takes control.
import { useEffect, useRef, useState } from "react";
import { assetUrl } from "./assetUrl";
import { APP_ID } from "./appId";

/**
 * A freshly-installed worker is an *update* (not the first install) only when a
 * controller already exists for this page. Pure, so it can be unit-tested.
 */
export function isWaitingUpdate(state: string, hasController: boolean): boolean {
  return state === "installed" && hasController;
}

/**
 * Nuclear escape hatch for a tab wedged on a stale build (e.g. a service worker
 * that never activated its update). Unregisters this app's own worker and
 * drops its own shell cache, then hard-reloads so index.html and its hashed
 * chunks are refetched from the network. The big version-pinned WASM binary
 * cache (`openscad-wasm-bin-*`, shared across deploys) is deliberately left
 * intact so the reload doesn't re-download ~10 MB. Best-effort: it reloads
 * regardless.
 *
 * M3: scoped to THIS app only — never every worker/cache on the origin. The
 * app-id/scope namespacing (`APP_ID`, `sw.js`'s `?ns=` param, `${APP_ID}-shell-*`
 * cache names) exists specifically so multiple ScadPub configs (or any other
 * app) can share an origin; a force-update for one must not unregister or
 * evict another's offline state.
 *
 * Exported (not just used internally by `forceUpdate` below) so its scoping
 * behavior is directly unit-testable without a real browser.
 */
export async function forceReload(reg?: ServiceWorkerRegistration): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      // Prefer the registration this hook already holds for its own scope
      // (set by the effect below); fall back to looking it up by BASE_URL if
      // called before that completes (e.g. `forceUpdate` fired very early).
      const r =
        reg ?? (await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL));
      await r?.unregister();
    }
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      const prefix = `${APP_ID}-shell-`;
      await Promise.all(
        keys.filter((k) => k.startsWith(prefix)).map((k) => caches.delete(k))
      );
    }
  } catch {
    /* best-effort — reload anyway */
  } finally {
    location.reload();
  }
}

/**
 * Tell the service worker the page is done with its first screen, so it can
 * pull down the rest of the offline bundle — the lazy chunks, artwork, design
 * sources and the ~11 MB of pinned binaries (public/sw.js's WARM message).
 * Install deliberately caches only the boot-critical shell; without this call
 * the offline bundle still fills in through the fetch handler as things get
 * used, so a page that never reaches this (closed early, JS error) degrades
 * rather than breaks. Safe to call repeatedly — the worker memoizes the pass.
 */
export function warmServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.ready
    .then((reg) => (reg.active ?? navigator.serviceWorker.controller)?.postMessage({ type: "WARM" }))
    .catch(() => {
      /* offline support is best-effort */
    });
}

/** What the offline warm-up needs to know about the session. */
export interface WarmupState {
  /** The design chooser is the first screen — nothing may compete with it. */
  holdBoot: boolean;
  /** The render worker finished its own bootstrap download. */
  ready: boolean;
  /** This visit installed the app, or is running as the installed app. */
  committed: boolean;
  /** The page is currently hidden. */
  hidden: boolean;
}

/**
 * How long to wait before asking the service worker to fill the offline cache,
 * or null for "not yet". Pure, so the policy is testable without a browser.
 *
 * The tension: the bundle is ~11 MB, and downloading it while the first screen
 * still needs the network is what made a cold visit slow. So the trigger is
 * whichever comes first of three moments where bandwidth is provably not
 * contended:
 *
 *   - `committed` — installed, or launched as the installed app. Offline
 *     completeness is the whole point of installing, so this outranks
 *     politeness and warms with no delay. It is also the only trigger that
 *     fires for someone who never renders at all.
 *   - `hidden` — the user has looked away. Free bandwidth by definition, and
 *     the pass outlives the page (the worker holds it in `waitUntil`).
 *   - `ready` — the render worker's own bootstrap is done, i.e. the heavy
 *     download the app actually needed has landed. A short delay lets the
 *     first render's own work settle first.
 *
 * `holdBoot` vetoes only the last of those. It must NOT veto the other two, or
 * the case this exists for goes uncovered: someone who installs from the
 * chooser and never picks a design would never warm — not on that visit and
 * not on any later launch, since the chooser they never dismissed comes back
 * every time, leaving an installed app permanently unable to render offline.
 * Politeness about ~240 kB of thumbnails is worth it for a first visit in a
 * browser tab; it is not worth an installed app that doesn't work, and it means
 * nothing at all while the page is hidden.
 */
export function warmDelayMs(s: WarmupState): number | null {
  if (s.committed || s.hidden) return 0;
  if (s.holdBoot) return null;
  return s.ready ? 2000 : null;
}

/**
 * Ask the service worker to fill the offline cache at the first uncontended
 * moment — see `warmDelayMs` for the policy. Re-arms as the session changes;
 * the worker itself memoizes the pass, so an extra call costs nothing.
 */
export function useOfflineWarmup(state: Omit<WarmupState, "hidden">): void {
  const { holdBoot, ready, committed } = state;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const evaluate = () => {
      const delay = warmDelayMs({
        holdBoot,
        ready,
        committed,
        hidden: typeof document !== "undefined" && document.hidden,
      });
      if (delay === null) return;
      clearTimeout(timer);
      timer = setTimeout(warmServiceWorker, delay);
    };
    evaluate();
    document.addEventListener("visibilitychange", evaluate);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", evaluate);
    };
  }, [holdBoot, ready, committed]);
}

export function useServiceWorkerUpdate() {
  const [updateReady, setUpdateReady] = useState(false);
  const waitingRef = useRef<ServiceWorker | null>(null);
  // This app's own scoped registration — captured so forceUpdate's escape
  // hatch (M3) can target only it, never every worker on the origin.
  const regRef = useRef<ServiceWorkerRegistration | undefined>(undefined);
  // Set when the user accepts, so the resulting controllerchange reloads (and a
  // first-install clients.claim() doesn't trigger a spurious reload).
  const applyingRef = useRef(false);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;
    let reg: ServiceWorkerRegistration | undefined;
    let reloaded = false;

    const promote = (worker: ServiceWorker | null) => {
      if (!worker) return;
      waitingRef.current = worker;
      setUpdateReady(true);
    };

    const onControllerChange = () => {
      if (applyingRef.current && !reloaded) {
        reloaded = true;
        location.reload();
      }
    };
    sw.addEventListener("controllerchange", onControllerChange);

    // Pass the app id so the worker namespaces its shell cache per config
    // (sw.js is a static file, so it can't read the build-time define directly).
    sw.register(`${assetUrl("sw.js")}?ns=${encodeURIComponent(APP_ID)}`, {
      scope: import.meta.env.BASE_URL,
    })
      .then((r) => {
        reg = r;
        regRef.current = r;
        // An update may already be waiting from a previous visit.
        if (r.waiting && sw.controller) promote(r.waiting);
        r.addEventListener("updatefound", () => {
          const installing = r.installing;
          installing?.addEventListener("statechange", () => {
            if (isWaitingUpdate(installing.state, !!sw.controller))
              promote(installing);
          });
        });
      })
      .catch(() => {
        /* offline support is best-effort */
      });

    // Long-lived tabs: the browser only checks for a new worker on navigation,
    // so nudge it periodically and when the tab regains focus.
    const check = () => reg?.update().catch(() => {});
    const onVisible = () => {
      if (!document.hidden) check();
    };
    const timer = setInterval(check, 60 * 60 * 1000);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      sw.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, []);

  const applyUpdate = () => {
    applyingRef.current = true;
    const w = waitingRef.current;
    if (w) w.postMessage({ type: "SKIP_WAITING" });
    else location.reload(); // no waiting worker (shouldn't happen) — hard reload
  };

  // Reload onto the newest build. Prefer the graceful waiting-worker handoff;
  // if there's no waiting worker (the running bundle is stale but the SW never
  // staged an update), fall back to the nuclear unregister-and-reload.
  const forceUpdate = () => {
    if (waitingRef.current) applyUpdate();
    else void forceReload(regRef.current);
  };

  const dismiss = () => setUpdateReady(false);

  return { updateReady, applyUpdate, forceUpdate, dismiss };
}
