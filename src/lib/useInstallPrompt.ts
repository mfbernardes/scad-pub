// useInstallPrompt — captures the browser's `beforeinstallprompt` event so the
// app can offer a tasteful install affordance on its own terms (a CommandBar
// button + a one-time post-export hint) instead of the browser's mini-infobar.
// Chromium-only; Safari/Firefox never fire the event, so `canInstall` stays
// false and no install UI shows (iOS users use Share → Add to Home Screen).
import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Stop the browser's default mini-infobar; we surface install ourselves.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    // Once installed, drop the captured prompt so no install UI lingers.
    const onInstalled = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return false;
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      return outcome === "accepted";
    } catch {
      // A rejected/failed prompt (e.g. a double-click reusing the single-use
      // prompt) is not installable; report failure instead of throwing an
      // unhandled rejection.
      return false;
    } finally {
      // A prompt can only be used once; clear it regardless of outcome so a
      // dead prompt can't leave canInstall stuck true.
      setDeferred(null);
    }
  }, [deferred]);

  return { canInstall: deferred !== null, promptInstall };
}
