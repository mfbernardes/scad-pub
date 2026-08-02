// swUpdate.ts: register the service worker and surface "a new version is
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

/** How long applyUpdate waits for the waiting worker's `controllerchange`
 *  before falling back to forceReload's unregister-and-reload. Long enough that
 *  a normal handoff (activate + clients.claim, both local) always wins; short
 *  enough that a redundant worker doesn't leave the button looking broken. */
export const SKIP_WAITING_TIMEOUT_MS = 3000;

/**
 * Wire up "a new worker is waiting" notification for one registration, and
 * report it through `onWaiting`.
 *
 * Extracted from the hook, and taking its collaborators as arguments, because
 * the interesting behaviour is all in the ORDER of an async registration
 * against an unmount, which is exactly what a hook body makes untestable.
 *
 * Every listener is added with `signal`, and that is the fix as well as the
 * tidiness: the previous version removed `updatefound` in the effect's cleanup
 * using a registration captured in the `.then`, so a cleanup that ran BEFORE
 * registration resolved removed nothing and the `.then` then added a listener
 * to a long-lived registration that nothing would ever remove. The inner
 * `statechange` listeners were anonymous and were never removed at all. An
 * already-aborted signal makes addEventListener a no-op, so both cases close
 * with one mechanism rather than two bookkeeping refs.
 *
 * Resolves with the registration (so the caller can keep it for `update()` and
 * the escape hatch), or undefined when registration failed or the caller
 * abandoned it first.
 */
export async function watchForWaitingWorker(
  sw: Pick<ServiceWorkerContainer, "controller">,
  register: () => Promise<ServiceWorkerRegistration>,
  onWaiting: (worker: ServiceWorker) => void,
  signal: AbortSignal
): Promise<ServiceWorkerRegistration | undefined> {
  let reg: ServiceWorkerRegistration;
  try {
    reg = await register();
  } catch {
    return undefined; // offline support is best-effort
  }
  if (signal.aborted) return undefined;
  // An update may already be waiting from a previous visit.
  if (reg.waiting && sw.controller) onWaiting(reg.waiting);
  reg.addEventListener(
    "updatefound",
    () => {
      const installing = reg.installing;
      installing?.addEventListener(
        "statechange",
        () => {
          if (isWaitingUpdate(installing.state, !!sw.controller)) onWaiting(installing);
        },
        { signal }
      );
    },
    { signal }
  );
  return reg;
}

/**
 * Hand the page over to a waiting worker, with a bounded fallback.
 *
 * A worker that went redundant between being promoted and being accepted never
 * fires `controllerchange`, and the user is left looking at a button that did
 * nothing. So the graceful handoff gets `SKIP_WAITING_TIMEOUT_MS`, and after
 * that the unregister-and-reload path takes over.
 *
 * Extracted from the hook, with its collaborators as arguments, for the same
 * reason `watchForWaitingWorker` was: the behaviour that matters is a RACE —
 * which of two paths reloads, and that exactly one of them does — and a race
 * inside a `useEffect` closure cannot be asserted at all. `reloaded` is the
 * shared guard both routes check and set; the caller owns it (a ref) so a
 * `controllerchange` arriving from the effect closes this path too.
 *
 * Returns the timer id so a caller can cancel it; the hook does not, because a
 * page that is reloading has nothing left to clean up.
 */
export function handOffToWaiting(
  waiting: Pick<ServiceWorker, "postMessage">,
  reloaded: { current: boolean },
  fallback: () => void,
  schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout
): ReturnType<typeof setTimeout> {
  // ARMED FIRST, and postMessage guarded. `postMessage` on a worker that has
  // already gone redundant throws InvalidStateError synchronously — and a
  // redundant worker is precisely the case this fallback exists for, so posting
  // first meant the one failure it was built to survive skipped it entirely.
  const timer = schedule(() => {
    if (reloaded.current) return; // a handoff landed first and already reloaded
    reloaded.current = true;
    fallback();
  }, SKIP_WAITING_TIMEOUT_MS);
  try {
    waiting.postMessage({ type: "SKIP_WAITING" });
  } catch {
    /* redundant already: the timer above is the whole plan now */
  }
  return timer;
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
 * M3: scoped to THIS app only, never every worker/cache on the origin. The
 * app-id/scope namespacing (`APP_ID`, `sw.js`'s `?ns=` param, `${APP_ID}-shell-*`
 * cache names) exists specifically so multiple ScadPub configs (or any other
 * app) can share an origin; a force-update for one must not unregister or
 * evict another's offline state.
 *
 * Exported (not only used internally by `forceUpdate` below) so its scoping
 * behavior is directly unit-testable without a real browser.
 */
export async function forceReload(reg?: ServiceWorkerRegistration): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      // Prefer the registration this hook already holds for its own scope
      // (set by the effect below); fall back to looking it up by BASE_URL if
      // called before that completes (e.g. `forceUpdate` fired early).
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
    /* best-effort: reload anyway */
  } finally {
    location.reload();
  }
}

/**
 * Every worker a WARM has to reach: the one serving this page, and a WAITING
 * one if an update has installed behind it.
 *
 * The waiting worker is the reason this isn't only `active`. Each build's shell
 * cache is named after its own version, and an update's install fills only the
 * boot-critical part of it, so a freshly-installed worker owns an almost-empty
 * cache while the active one owns a complete one. The browser activates a
 * waiting worker on its own once the last tab closes, and `activate` then
 * retires the older cache: an installed app could go from fully offline-capable
 * to unable to render, without the user doing anything but closing a tab. So
 * the next build's worker gets told to fill its cache while the current one is
 * still serving.
 *
 * Deduplicated, since `active` and `controller` are usually the same worker.
 * Pure so the targeting is testable without a browser.
 */
export function warmTargets(
  reg: Pick<ServiceWorkerRegistration, "active" | "waiting"> | undefined,
  controller: ServiceWorker | null
): ServiceWorker[] {
  return [...new Set([reg?.waiting, reg?.active ?? controller].filter(Boolean))] as ServiceWorker[];
}

/**
 * Tell the service worker the page is done with its first screen, so it can
 * pull down the rest of the offline bundle: the lazy chunks, artwork, design
 * sources and the ~11 MB of pinned binaries (public/sw.js's WARM message).
 * Install deliberately caches only the boot-critical shell; without this call
 * the offline bundle still fills in through the fetch handler as things get
 * used, so a page that never reaches this (closed early, JS error) degrades
 * rather than breaks. Safe to call repeatedly: the worker memoizes the pass.
 */
function warmServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.ready
    .then((reg) => {
      for (const worker of warmTargets(reg, navigator.serviceWorker.controller))
        worker.postMessage({ type: "WARM" });
    })
    .catch(() => {
      /* offline support is best-effort */
    });
}

/**
 * Subscribe to tab visibility changes; returns the unsubscribe. Both hooks
 * below want this: one to notice the tab going away, the other to notice it
 * coming back, and each hand-rolling the add/remove pair is one more place for
 * a listener to outlive its effect.
 */
function onVisibilityChange(handler: () => void): () => void {
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}

/** What the offline warm-up needs to know about the session. */
export interface WarmupState {
  /** The design chooser is the first screen: nothing may compete with it. */
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
 *   - `committed`. Installed, or launched as the installed app. Offline
 *     completeness is the whole point of installing, so this outranks
 *     politeness and warms with no delay. It is also the only trigger that
 *     fires for someone who never renders at all.
 *   - `hidden`: the user has looked away. Free bandwidth by definition, and
 *     the pass outlives the page (the worker holds it in `waitUntil`).
 *   - `ready`: the render worker's own bootstrap is done, i.e. the heavy
 *     download the app actually needed has landed. A short delay lets the
 *     first render's own work settle first.
 *
 * `holdBoot` vetoes only the last of those. It must NOT veto the other two, or
 * the case this exists for goes uncovered: someone who installs from the
 * chooser and never picks a design would never warm, not on that visit and
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
 * moment, see `warmDelayMs` for the policy. Re-arms as the session changes;
 * the worker itself memoizes the pass, so an extra call costs nothing.
 *
 * `updateWaiting` is not a trigger and deliberately not part of the policy: a
 * newly installed worker doesn't make this a better moment to download 11 MB.
 * It re-evaluates the SAME policy because there is now a second worker that
 * needs the pass (`warmTargets`), and nothing else in the session would
 * necessarily change to prompt one. Firing directly on the update instead:
 * bypassing `warmDelayMs`. Is exactly the contention this whole path exists to
 * avoid: an update installing while the chooser's thumbnails are still loading
 * would put the supplementary bundle straight back on top of them.
 */
export function useOfflineWarmup(
  state: Omit<WarmupState, "hidden"> & { updateWaiting?: boolean }
): void {
  const { holdBoot, ready, committed, updateWaiting = false } = state;
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
    const unsubscribe = onVisibilityChange(evaluate);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [holdBoot, ready, committed, updateWaiting]);
}

export function useServiceWorkerUpdate() {
  const [updateReady, setUpdateReady] = useState(false);
  const waitingRef = useRef<ServiceWorker | null>(null);
  // This app's own scoped registration: captured so forceUpdate's escape
  // hatch (M3) can target only it, never every worker on the origin.
  const regRef = useRef<ServiceWorkerRegistration | undefined>(undefined);
  // Set when the user accepts, so the resulting controllerchange reloads (and a
  // first-install clients.claim() doesn't trigger a spurious reload).
  const applyingRef = useRef(false);
  // Set the moment a reload is committed, by either route, so the other one
  // stands down rather than reloading a second time.
  const reloadedRef = useRef(false);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;
    let reg: ServiceWorkerRegistration | undefined;
    // One signal for every listener this effect adds, on `sw` and on the
    // registration alike. The registration outlives the component (a breakpoint
    // flip remounts the tree) and resolves asynchronously, so cleanup has to be
    // able to cancel a subscription that has not been made yet — which a signal
    // does and a removeEventListener in the cleanup body cannot.
    const ac = new AbortController();

    const promote = (worker: ServiceWorker) => {
      waitingRef.current = worker;
      setUpdateReady(true);
    };

    const onControllerChange = () => {
      if (applyingRef.current && !reloadedRef.current) {
        reloadedRef.current = true;
        location.reload();
      }
    };
    sw.addEventListener("controllerchange", onControllerChange, { signal: ac.signal });

    // Pass the app id so the worker namespaces its shell cache per config
    // (sw.js is a static file, so it can't read the build-time define directly).
    void watchForWaitingWorker(
      sw,
      () =>
        sw.register(`${assetUrl("sw.js")}?ns=${encodeURIComponent(APP_ID)}`, {
          scope: import.meta.env.BASE_URL,
        }),
      promote,
      ac.signal
    ).then((r) => {
      reg = r;
      regRef.current = r;
    });

    // Long-lived tabs: the browser only checks for a new worker on navigation,
    // so nudge it periodically and when the tab regains focus.
    const check = () => reg?.update().catch(() => {});
    const onVisible = () => {
      if (!document.hidden) check();
    };
    const timer = setInterval(check, 60 * 60 * 1000);
    const unsubscribeVisibility = onVisibilityChange(onVisible);

    return () => {
      ac.abort();
      unsubscribeVisibility();
      clearInterval(timer);
    };
  }, []);

  const applyUpdate = () => {
    applyingRef.current = true;
    const w = waitingRef.current;
    if (!w) {
      location.reload(); // no waiting worker (shouldn't happen): hard reload
      return;
    }
    handOffToWaiting(w, reloadedRef, () => void forceReload(regRef.current));
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
