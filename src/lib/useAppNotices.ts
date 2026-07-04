// useAppNotices.ts — the app-level persistent notices, extracted from App.tsx:
// stale-bundle (hard) and service-worker-update (soft) reload prompts, and the
// offline indicator. All Sonner toasts with stable ids so a notice replaces
// its previous instance instead of stacking.
import { useEffect } from "react";
import { toast } from "sonner";

export interface AppNoticesArgs {
  /** A render used defines the current bundle no longer declares. */
  bundleStale: boolean;
  forceUpdate: () => void;
  updateReady: boolean;
  applyUpdate: () => void;
  dismissUpdate: () => void;
  online: boolean;
}

export function useAppNotices({
  bundleStale,
  forceUpdate,
  updateReady,
  applyUpdate,
  dismissUpdate,
  online,
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
}
