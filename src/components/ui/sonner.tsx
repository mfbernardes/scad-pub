import { Toaster as Sonner, type ToasterProps } from "sonner";
import { t } from "../../lib/i18n";
import { useLocale } from "../../lib/localeStore";

// App-themed Sonner: the project resolves its own theme (data-theme) rather than
// using next-themes, so the caller passes the resolved theme. Toast surfaces use
// the existing palette variables, so they follow the active theme automatically.
//
// top-center, not bottom-center: the export dock (Download/Share, plus the
// after-export panel) floats bottom-center on both layouts, and a
// bottom-anchored toast ("Copied share link", "Model downloaded") landed
// right on top of it. Top offsets clear the desktop CommandBar / mobile top
// bar respectively — Sonner switches to `mobileOffset` below its own 600px
// breakpoint, so both are set. `mobileOffset` also folds in the safe-area
// inset directly (Sonner offsets aren't restyled by app CSS, so this can't
// reuse the `--safe-area-top` custom property the rest of the shell shares).
function Toaster({ theme = "dark", ...props }: ToasterProps) {
  // Subscription only: sonner's close button is given its accessible name
  // below via `closeButtonAriaLabel`, resolved from the catalogue, so this
  // component must itself re-render on a runtime locale switch for that
  // label to update.
  useLocale();
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="top-center"
      // Every toast gets a manual dismiss affordance, not just the ones that
      // happen to pass an `action`/`cancel` (WCAG 3.3.1): a persistent
      // (duration: Infinity) import-failure or notice toast otherwise has no
      // way to leave the screen except being superseded by its own `id`.
      closeButton
      // Sonner's own close button is a fixed 20x20px (styles.css), under SC
      // 2.5.8 (WCAG 2.2)'s 24px minimum. min-width/min-height (not width/height) so this
      // only raises the floor, leaving Sonner's own sizing/positioning rules
      // (which set width/height, a different property, so no specificity
      // fight) otherwise untouched.
      toastOptions={{
        classNames: { closeButton: "toast-close-button" },
        // Sonner hardcodes "Close toast" (English) as the close button's
        // accessible name; without this every locale would read English here.
        closeButtonAriaLabel: t("common.closeToast"),
      }}
      offset={{ top: "4.5rem" }}
      mobileOffset={{ top: "calc(env(safe-area-inset-top, 0px) + 4rem)" }}
      style={
        {
          "--normal-bg": "var(--panel)",
          "--normal-text": "var(--text)",
          "--normal-border": "var(--line)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
