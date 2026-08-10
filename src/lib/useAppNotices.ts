// useAppNotices.ts: the app-level persistent notices, extracted from App.tsx:
// stale-bundle (hard) and service-worker-update (soft) reload prompts, and the
// offline indicator. All Sonner toasts with stable ids so a notice replaces
// its previous instance instead of stacking.
import { useEffect } from "react";
import { toast } from "sonner";
import { t } from "./i18n";
import { useLocale } from "./localeStore";

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
  // A stable toast id REPLACES its previous instance rather than stacking, so
  // adding the active locale `tag` to every effect below re-fires an already-
  // showing notice in the new language on a runtime switch, instead of
  // leaving it showing stale text until its own trigger condition changes.
  const { tag } = useLocale();

  useEffect(() => {
    if (bundleStale)
      toast.error(t("notice.bundleStale"), {
        id: "bundle-stale",
        duration: Infinity,
        // Reload is the only way out: a stale bundle can't safely keep
        // running, so this one toast overrides the app-wide close button.
        closeButton: false,
        action: { label: t("notice.reload"), onClick: forceUpdate },
      });
  }, [bundleStale, forceUpdate, tag]);

  useEffect(() => {
    if (updateReady && !bundleStale)
      toast(t("notice.updateAvailable"), {
        id: "sw-update",
        duration: Infinity,
        action: { label: t("notice.reload"), onClick: applyUpdate },
        cancel: { label: t("notice.later"), onClick: dismissUpdate },
        // The app-wide close button (✕) must behave like "Later", or the
        // toast just resurrects on the next render with no way to keep it
        // dismissed: applyUpdate/dismissUpdate are unstable identities, so
        // this effect re-fires on every App render while updateReady holds.
        onDismiss: dismissUpdate,
      });
  }, [updateReady, bundleStale, applyUpdate, dismissUpdate, tag]);

  // Offline indicator: a persistent (but reassuring) toast while offline, since
  // the cached WASM means rendering and export keep working. Clears on reconnect.
  useEffect(() => {
    if (!online)
      toast(t("notice.offline"), {
        id: "offline",
        duration: Infinity,
        // This is a live status, not a dismissible notice: the ✕ must not be
        // able to hide "you're offline" while it's still true.
        closeButton: false,
      });
    else toast.dismiss("offline");
  }, [online, tag]);
}
