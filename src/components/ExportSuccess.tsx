// ExportSuccess.tsx — compact, non-modal panel shown above the action dock
// right after a successful model export, when the config opts in via
// `ui.afterExport` (see docs/config.md and scripts/gen-schema.mjs's
// cross-validation of `helpTab` against the config's help tabs). Off
// entirely — never mounted at all — when `ui.afterExport` is absent from the
// config; see App.tsx's exportModel.
//
// Deliberately NOT a Radix Dialog: it never traps focus and never covers the
// action dock it sits above (glass styling matches StaleBanner/the action
// cluster — see AppShell's shared ACTION_DOCK_CLASS), so a visitor can keep
// exporting/sharing/tweaking without dismissing it first. App.tsx only ever
// sets this state AFTER awaiting exportModel's share-or-download outcome —
// never before — so this panel can never appear over, or race, the native
// share sheet.
//
// Ported (simplified) from a donor branch's design-reference component: no
// i18n, and a single generic title/body regardless of share-vs-download
// outcome (the donor distinguished "shared" from "downloaded" wording via a
// dedicated exportOutcome.ts; CLAUDE.md's Phase 2 scope asks for one plain
// default, "Your file is on its way", so that extra machinery isn't ported).
import { useEffect, useRef } from "react";
import { X as CloseIcon } from "lucide-react";
import { useAppActions } from "../lib/appActions";
import { Markdown } from "./Markdown";
import { Button } from "./ui/button";
import { IconButton } from "./IconButton";

const AUTO_HIDE_MS = 9000;
const DEFAULT_TITLE = "Your file is on its way";
const DEFAULT_BODY = "Check your browser's downloads, then slice and print when you're ready.";

export interface ExportSuccessState {
  /** Distinguishes this export from the previous one so the auto-hide timer
   *  restarts even when the title/body repeat verbatim (two exports in a row). */
  key: number;
}

export function ExportSuccess({
  state,
  title,
  body,
  helpTab,
  onDismiss,
}: {
  state: ExportSuccessState;
  /** Config `ui.afterExport.title` override; falls back to DEFAULT_TITLE. */
  title?: string;
  /** Config `ui.afterExport.body` override; falls back to DEFAULT_BODY. */
  body?: string;
  /** Config `ui.afterExport.helpTab` — shows the "Open printing help" action,
   *  deep-linking Help to that tab, only when set. gen-schema's build-time
   *  validation guarantees a set value always names a real Help tab. */
  helpTab?: string;
  onDismiss: () => void;
}) {
  const { showHelp } = useAppActions();

  // Read through a ref so the effect below only re-arms on a genuinely new
  // export (state.key), not on every render that hands it a fresh closure.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  useEffect(() => {
    const timer = setTimeout(() => onDismissRef.current(), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [state.key]);

  return (
    <div
      className="export-success flex w-full max-w-[min(92vw,26rem)] items-start gap-2 rounded-lg border border-(color:--glass-border) bg-(--glass-bg) px-3 py-[0.55rem] text-[0.82rem] shadow-(--elevation)"
      role="status"
      // Polite: announces the title without stealing focus from wherever the
      // visitor's attention already is (they just clicked Download).
      aria-live="polite"
    >
      <div className="min-w-0 flex-1">
        <p className="m-0 font-medium text-foreground">{title ?? DEFAULT_TITLE}</p>
        <div className="mt-[0.15rem] text-muted-foreground [&_p]:m-0">
          <Markdown body={body ?? DEFAULT_BODY} />
        </div>
        {helpTab && (
          <Button
            size="sm"
            variant="link"
            className="export-success__guide mt-[0.2rem] h-auto p-0 text-brand"
            onClick={() => showHelp(helpTab)}
          >
            Open printing help
          </Button>
        )}
      </div>
      <IconButton
        label="Dismiss"
        className="export-success__dismiss size-6 shrink-0 border-none bg-transparent p-1 hover:border"
        onClick={onDismiss}
      >
        <CloseIcon aria-hidden="true" size={14} />
      </IconButton>
    </div>
  );
}
