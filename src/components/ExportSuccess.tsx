// ExportSuccess.tsx — compact, non-modal inline success panel shown above the
// action cluster after a successful 3MF export, when the config opts in via
// `ui.afterExport` (see gen-schema's cross-validation of `helpTab` against
// the config's help tabs). Off entirely — never mounted at all — when
// `ui.afterExport` is absent from the config; see App.tsx's exportModel and
// src/lib/exportOutcome.ts for the outcome->wording mapping and the
// precedence-with-the-install-hint rule this panel is built on.
//
// Deliberately NOT a Radix Dialog: it never traps focus and never covers the
// action cluster it sits above (glass styling matches StaleBanner/
// UpdatingChip — see AppShell's shared `.action-dock` wrapper), so a visitor
// can keep exporting/sharing/tweaking without dismissing it first. App.tsx
// only ever sets this state AFTER awaiting exportModel's share-or-download
// outcome — never before — so this panel can never appear over, or race, the
// native share sheet.
import { useEffect, useRef } from "react";
import { X as CloseIcon } from "lucide-react";
import { useAppActions } from "../lib/appActions";
import { t } from "../lib/i18n";
import { afterExportAutoHideMs, exportOutcomeTitleKey, type ExportOutcomeKind } from "../lib/exportOutcome";
import { Button } from "./ui/button";
import { IconButton } from "./IconButton";

export interface ExportSuccessState {
  outcome: ExportOutcomeKind;
  /** Distinguishes this export from the previous one even when the outcome
   *  repeats (two downloads in a row), so the auto-hide timer restarts on
   *  every export instead of being frozen by an unchanged `outcome` value. */
  key: number;
  /** Whether this is the very first time this browser has ever shown the
   *  panel — see src/lib/exportOutcome.ts's afterExportAutoHideMs. */
  isFirstShow: boolean;
}

export function ExportSuccess({
  state,
  title,
  body,
  helpTab,
  onDismiss,
}: {
  state: ExportSuccessState;
  /** Config `ui.afterExport.title` override; falls back to the outcome-led
   *  i18n title (export.downloaded / export.readyToShare). */
  title?: string;
  /** Config `ui.afterExport.body` override; falls back to `export.nextSteps`. */
  body?: string;
  /** Config `ui.afterExport.helpTab` — shows the "Printing guide" action,
   *  deep-linking Help to that tab, only when set. gen-schema's build-time
   *  validation guarantees a set value always names a real Help tab. */
  helpTab?: string;
  onDismiss: () => void;
}) {
  const { showHelp } = useAppActions();
  const resolvedTitle = title ?? t(exportOutcomeTitleKey(state.outcome));
  const resolvedBody = body ?? t("export.nextSteps");

  // Read through a ref so the effect below only re-arms on a genuinely new
  // export (state.key), not on every render that hands it a fresh closure.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  useEffect(() => {
    const ms = afterExportAutoHideMs(state.isFirstShow);
    const timer = setTimeout(() => onDismissRef.current(), ms);
    return () => clearTimeout(timer);
  }, [state.key, state.isFirstShow]);

  return (
    <div
      className="export-success flex max-w-[min(22rem,calc(100vw-1.5rem))] items-start gap-2 rounded-lg border glass-card px-3 py-[0.55rem] text-[0.82rem]"
      role="status"
      // Polite: announces the title without stealing focus from wherever the
      // visitor's attention already is (they just clicked Export).
      aria-live="polite"
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{resolvedTitle}</p>
        <p className="mt-[0.15rem] text-muted-foreground">{resolvedBody}</p>
        {helpTab && (
          <Button
            size="sm"
            variant="link"
            className="export-success__guide mt-[0.2rem] h-auto p-0 text-brand"
            onClick={() => showHelp(helpTab)}
          >
            {t("export.printingGuide")}
          </Button>
        )}
      </div>
      <IconButton
        label={t("common.close")}
        className="export-success__dismiss size-6 shrink-0 border-none bg-transparent p-1 hover:border"
        onClick={onDismiss}
      >
        <CloseIcon aria-hidden="true" size={14} />
      </IconButton>
    </div>
  );
}
