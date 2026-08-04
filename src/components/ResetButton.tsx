// ResetButton.tsx: "Reset to defaults" with an accidental-click guard: it
// confirms via an AlertDialog only when there are unsaved changes (current
// parameter values differ from the design's defaults); otherwise it's a no-op.
import { useMemo, useState, type ReactNode } from "react";
import type { Design } from "../openscad/types";
import { defaultsFor, type Values } from "../lib/presets";
import { ConfirmDialog } from "./ConfirmDialog";
import { t } from "../lib/i18n";
import { useLocale } from "../lib/localeStore";

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

export function ResetButton({ design, values, onReset, className, children }: Props) {
  useLocale(); // subscription only: re-render this component's t() calls on a locale switch
  const dirty = useMemo(() => isModified(design, values), [design, values]);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={t("reset.label")}
        title={dirty ? t("reset.reasonDirty") : t("reset.reasonClean")}
        disabled={!dirty}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("reset.confirmTitle")}
        description={t("reset.confirmBody", { label: design.label })}
        cancelLabel={t("presets.cancel")}
        confirmLabel={t("presetDiff.reset")}
        onConfirm={onReset}
      />
    </>
  );
}
