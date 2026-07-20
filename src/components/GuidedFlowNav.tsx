// GuidedFlowNav.tsx — compact, non-blocking navigation for the optional
// Start → Customize → Review flow. Files stays an unnumbered utility tab.
import { ArrowRight as NextIcon } from "lucide-react";
import type { PanelTab } from "../lib/usePanelState";
import type { GuidedStage } from "../lib/guidedStages";
import { Button } from "./ui/button";
import { TabsList, TabsTrigger, chipTabTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";

interface NavProps {
  hasPresets: boolean;
  hasFiles: boolean;
  stages: GuidedStage[];
  onActivate?: () => void;
  className?: string;
}

export function GuidedFlowNav({ hasPresets, hasFiles, stages, onActivate, className }: NavProps) {
  let number = 1;
  const startNumber = hasPresets ? number++ : null;
  const numberedStages = stages.map((stage) => ({ ...stage, number: number++ }));
  const reviewNumber = number;
  // Five items (Start + two common design stages + Review + Files) should fit
  // the default 360 px desktop panel without clipping its edge labels.
  const trigger = cn(chipTabTrigger, "mx-0.5 min-w-fit flex-1 px-1.5 text-[0.82rem]");

  return (
    <TabsList
      className={cn("guided-flow-nav w-full shrink-0 overflow-x-auto rounded-none border-b bg-transparent p-0", className)}
      aria-label="Guided steps"
    >
      {startNumber && (
        <TabsTrigger value="presets" className={trigger} onClick={onActivate}>
          {startNumber} Start
        </TabsTrigger>
      )}
      {numberedStages.map((stage) => (
        <TabsTrigger key={stage.value} value={stage.value} className={trigger} onClick={onActivate}>
          {stage.number} {stage.label}
        </TabsTrigger>
      ))}
      <TabsTrigger value="review" className={trigger} onClick={onActivate}>
        {reviewNumber} Review
      </TabsTrigger>
      {hasFiles && (
        <TabsTrigger value="files" className={trigger} onClick={onActivate}>
          Files
        </TabsTrigger>
      )}
    </TabsList>
  );
}

export function GuidedContinue({ to, label, onContinue }: { to: PanelTab; label: string; onContinue: (tab: PanelTab) => void }) {
  return (
    <div className="guided-flow-continue shrink-0 border-t px-3 py-2 text-right">
      <Button size="sm" variant="secondary" onClick={() => onContinue(to)}>
        Continue to {label} <NextIcon size={15} aria-hidden="true" />
      </Button>
    </div>
  );
}
