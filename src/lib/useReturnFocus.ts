// useReturnFocus.ts: put focus back on whatever opened a dialog once it closes.
//
// Radix does this itself through `onCloseAutoFocus`, but only for a Dialog that
// stays mounted and flips `open`. Both dialog surfaces here are instead rendered
// conditionally (`{showHelp && <HelpModal …/>}`, `{prepOpen && <SvgWizard/>}`),
// so closing unmounts the Dialog synchronously and that callback never runs:
// focus fell to `<body>` and a keyboard visitor landed at the top of the
// document (2.4.3).
import { useEffect, useRef } from "react";

/**
 * Call from a dialog body that is mounted only while open. The restore is
 * deferred past the unmount (Radix's FocusScope teardown runs after this
 * cleanup and would overwrite it) and conditional on focus actually having been
 * lost, so a close that hands focus somewhere deliberate keeps it.
 */
export function useReturnFocus(): void {
  const opener = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );
  useEffect(() => {
    const trigger = opener.current;
    return () => {
      if (!trigger || trigger === document.body) return;
      setTimeout(() => {
        const lost = !document.activeElement || document.activeElement === document.body;
        if (lost && trigger.isConnected) trigger.focus();
      }, 0);
    };
  }, []);
}
