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
      <Label className="auto-render cursor-pointer font-normal" title="Re-render automatically as parameters change">
        <Switch checked={autoRender} onCheckedChange={autoRenderChange} aria-label="Auto-render" />
        Auto-render
      </Label>
      <ResetButton design={design} values={values} onReset={reset} className="reset-link ml-auto">
        <ResetIcon size={14} /> Reset to defaults
      </ResetButton>
    </div>
  );
}
