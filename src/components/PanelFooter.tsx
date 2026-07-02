// PanelFooter.tsx — the parameter-scoped footer row: the Auto-render switch and
// Reset-to-defaults. Shared by the desktop ParamPanel (pinned under the whole
// panel) and the mobile SheetTabs (pinned inside the Parameters tab); only the
// container class differs.
import type { Design } from "../openscad/types";
import type { Values } from "../lib/presets";
import { useAppActions } from "../lib/appActions";
import { ResetButton } from "./ResetButton";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { RotateCcw as ResetIcon } from "lucide-react";

export function PanelFooter({
  design,
  values,
  autoRender,
  className,
}: {
  design: Design;
  values: Values;
  autoRender: boolean;
  className: string;
}) {
  const { reset, autoRenderChange } = useAppActions();
  return (
    <div className={className}>
      {/* Auto-render lives here, with the params it governs, rather than in the
          output toolbar: it's a render-mode setting that's rarely toggled. */}
      <Label
        className="auto-render inline-flex cursor-pointer select-none items-center gap-[0.3rem] text-[0.85rem] font-normal text-muted-foreground hover:text-foreground"
        title="Re-render automatically as parameters change"
      >
        <Switch checked={autoRender} onCheckedChange={autoRenderChange} aria-label="Auto-render" />
        Auto-render
      </Label>
      <ResetButton
        design={design}
        values={values}
        onReset={reset}
        className="reset-link ml-auto inline-flex items-center gap-[0.35rem] border-none bg-transparent px-[0.3rem] py-[0.25rem] text-[0.85rem] text-muted-foreground enabled:hover:text-foreground disabled:cursor-default disabled:opacity-40"
      >
        <ResetIcon size={14} className="shrink-0" /> Reset to defaults
      </ResetButton>
    </div>
  );
}
