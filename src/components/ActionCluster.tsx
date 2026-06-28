// ActionCluster.tsx — floating bottom-center output cluster (desktop).
// Export · PNG · Share + Output toggle. Render-mode (auto-render) moved to the
// param panel footer and the "needs re-render" call-to-action to the viewer's
// StaleBanner, so this cluster is a stable, outputs-only toolbar.
import { memo } from "react";
import { ActionButtons } from "./ActionButtons";

interface Props {
  hasResult: boolean;
  modelFormat: string;
  outputOpen: boolean;
  hasNotices: boolean;
  /** PNG snapshot needs the active viewer ref, so this glue stays a prop. */
  onSavePng: () => void;
  onToggleOutput: () => void;
  className?: string;
}

export const ActionCluster = memo(function ActionCluster({
  hasResult,
  modelFormat,
  outputOpen,
  hasNotices,
  onSavePng,
  onToggleOutput,
  className = "",
}: Props) {
  return (
    <div className={`action-cluster ${className}`.trim()}>
      <ActionButtons
        hasResult={hasResult}
        modelFormat={modelFormat}
        outputOpen={outputOpen}
        hasNotices={hasNotices}
        onSavePng={onSavePng}
        onToggleOutput={onToggleOutput}
      />
    </div>
  );
});
