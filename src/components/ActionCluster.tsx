// ActionCluster.tsx — floating bottom-center action cluster.
// Auto-render toggle · Render · Export · PNG · Share + Output toggle (badged).
import { memo } from "react";
import { useAppActions } from "../lib/appActions";
import { ActionButtons } from "./ActionButtons";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";

interface Props {
  rendering: boolean;
  autoRender: boolean;
  /** True when auto-render is off and params/preset/design changed since the last render. */
  stalePreview?: boolean;
  hasResult: boolean;
  modelFormat: string;
  outputOpen: boolean;
  /** PNG snapshot needs the active viewer ref, so this glue stays a prop. */
  onSavePng: () => void;
  onToggleOutput: () => void;
  className?: string;
}

export const ActionCluster = memo(function ActionCluster({
  rendering,
  autoRender,
  stalePreview = false,
  hasResult,
  modelFormat,
  outputOpen,
  onSavePng,
  onToggleOutput,
  className = "",
}: Props) {
  const { autoRenderChange } = useAppActions();
  return (
    <div className={`action-cluster ${className}`.trim()}>
      <Label
        className="action-cluster__auto-render cursor-pointer gap-1.5 text-xs font-normal"
        title="Re-render automatically as you change parameters"
      >
        <Switch checked={autoRender} onCheckedChange={autoRenderChange} aria-label="Auto-render" />
        Auto
      </Label>
      <ActionButtons
        rendering={rendering}
        autoRender={autoRender}
        stalePreview={stalePreview}
        hasResult={hasResult}
        modelFormat={modelFormat}
        outputOpen={outputOpen}
        onSavePng={onSavePng}
        onToggleOutput={onToggleOutput}
      />
    </div>
  );
});
