// useReturnFocus.ts: put focus back on whatever opened a dialog once it closes.
//
// Radix does this itself through `onCloseAutoFocus`, but only for a Dialog that
// stays mounted and flips `open`. Both dialog surfaces here are instead rendered
// conditionally (`{showHelp && <HelpModal …/>}`, `{pending && <SvgWizard/>}`),
// so closing unmounts the Dialog synchronously and that callback never runs:
// focus fell to `<body>` and a keyboard visitor landed at the top of the
// document (2.4.3).
import { useEffect, useRef } from "react";

const DIALOG = "[role=dialog], [role=alertdialog]";

/** Whether `el` is somewhere focus could usefully be sent back to. */
function restorable(el: HTMLElement | null): el is HTMLElement {
  return !!el && el !== document.body && el.isConnected && !el.closest(DIALOG);
}

/**
 * Call from a dialog body that is mounted only while open.
 *
 * The opener is tracked rather than snapshotted once, because the element
 * focused as the dialog mounts is not always the one still standing when it
 * closes. Opening Help from the mobile "⋮" menu is the case: the menu row that
 * was focused unmounts with its popover, which then hands focus back to the
 * "⋮" button — so a single snapshot captured a doomed row and the restore
 * became a silent no-op. Every focus landing outside a dialog updates the
 * target until the dialog takes focus, so what gets remembered is the last
 * thing that actually survived.
 *
 * The restore is deferred past the unmount (Radix's FocusScope teardown runs
 * after this cleanup and would overwrite it) and conditional on focus actually
 * having been lost, so a close that hands focus somewhere deliberate keeps it.
 */
export function useReturnFocus(): void {
  const opener = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      if (el instanceof HTMLElement && restorable(el)) opener.current = el;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      const trigger = opener.current;
      if (!restorable(trigger)) return;
      setTimeout(() => {
        const lost = !document.activeElement || document.activeElement === document.body;
        if (lost && trigger.isConnected) trigger.focus();
      }, 0);
    };
  }, []);
}
