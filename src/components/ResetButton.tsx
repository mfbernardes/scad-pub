// ResetButton.tsx — "Reset to defaults" with an accidental-click guard: it
// confirms via an AlertDialog only when there are unsaved changes (current
// parameter values differ from the design's defaults); otherwise it's a no-op.
import { useMemo, useState, type ReactNode } from "react";
import type { Design } from "../openscad/types";
import type { SettingsView } from "../lib/useExperience";
import { defaultsFor, type Values } from "../lib/presets";
import { hiddenAdvancedDiff } from "../lib/paramFilter";
import { tn } from "../lib/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

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
  /** Essentials/all settings-view. When params hidden by the essentials view
   *  also carry a non-default value, the confirmation dialog says so —
   *  resetting isn't scoped to what's currently visible, so the user should
   *  know it also touches what they can't currently see. Omitted/"all"
   *  means nothing is hidden, so the extra sentence never appears. */
  view?: SettingsView;
}

export function ResetButton({ design, values, onReset, className, children, view }: Props) {
  const dirty = useMemo(() => isModified(design, values), [design, values]);
  const [open, setOpen] = useState(false);
  const hiddenDiffCount = useMemo(
    () => hiddenAdvancedDiff(design.params, values, defaultsFor(design), view ?? "all").length,
    [design, values, view]
  );

  return (
    <>
      <button
        type="button"
        className={className}
        aria-label="Reset to defaults"
        title={dirty ? "Reset all parameters to this design's defaults" : "Parameters are already at their defaults"}
        disabled={!dirty}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to defaults?</AlertDialogTitle>
            <AlertDialogDescription>
              This discards your current parameter changes for “{design.label}”.
              {hiddenDiffCount > 0 && " " + tn("settings.resetIncludesHidden", hiddenDiffCount)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onReset}>Reset</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
