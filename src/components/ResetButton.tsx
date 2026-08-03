// ResetButton.tsx: "Reset to defaults" with an accidental-click guard: it
// confirms via an AlertDialog only when there are unsaved changes (current
// parameter values differ from the design's defaults); otherwise it's a no-op.
import { useMemo, useState, type ReactNode } from "react";
import type { Design } from "../openscad/types";
import { defaultsFor, type Values } from "../lib/presets";
import { ConfirmDialog } from "./ConfirmDialog";

function isModified(design: Design, values: Values): boolean {
  const defaults = defaultsFor(design);
  return design.params.some((p) => values[p.name] !== defaults[p.name]);
}

interface Props {
  design: Design;
  values: Values;
  onReset: () => void;
  className?: string;
  children: ReactNode;
}

// The id the sr-only disabled-reason note publishes under, and the button's
// `aria-describedby` points at while disabled: a disabled <button> fires no
// pointer events, so the wrapping <span title> below reaches a sighted hover
// but not assistive tech (see ExplainedDisabledButton.tsx, whose pattern this
// mirrors inline rather than reusing directly — ResetButton's trigger is a
// plain styled <button>, not the shadcn Button that component wraps).
const RESET_DISABLED_HINT_ID = "reset-disabled-hint";

export function ResetButton({ design, values, onReset, className, children }: Props) {
  const dirty = useMemo(() => isModified(design, values), [design, values]);
  const [open, setOpen] = useState(false);
  const disabledReason = dirty ? null : "Parameters are already at their defaults";

  return (
    <>
      {/* shrink-0: the wrapper, not the button, is the flex item now, and
          PresetDiffBar's actionBtnClass relies on this button never shrinking
          beside the truncating summary text next to it. */}
      <span className="inline-flex shrink-0" title={disabledReason ?? undefined}>
        <button
          type="button"
          className={className}
          aria-label="Reset to defaults"
          title={dirty ? "Reset all parameters to this design's defaults" : undefined}
          aria-describedby={disabledReason ? RESET_DISABLED_HINT_ID : undefined}
          disabled={!dirty}
          onClick={() => setOpen(true)}
        >
          {children}
        </button>
      </span>
      {disabledReason && (
        <span id={RESET_DISABLED_HINT_ID} className="sr-only">
          {disabledReason}
        </span>
      )}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Reset to defaults?"
        description={`This discards your current parameter changes for “${design.label}”.`}
        cancelLabel="Cancel"
        confirmLabel="Reset"
        onConfirm={onReset}
      />
    </>
  );
}
