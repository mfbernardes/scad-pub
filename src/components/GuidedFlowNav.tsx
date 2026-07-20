// GuidedFlowNav.tsx — compact, non-blocking navigation for the optional
// Start → Customize → Review flow. Files stays an unnumbered utility tab.
import { ArrowRight as NextIcon } from "lucide-react";
import type { PanelTab } from "../lib/usePanelState";
import { Button } from "./ui/button";
import { TabsList, TabsTrigger, chipTabTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";

interface NavProps {
  hasPresets: boolean;
  hasFiles: boolean;
  onActivate?: () => void;
  className?: string;
}

export function GuidedFlowNav({ hasPresets, hasFiles, onActivate, className }: NavProps) {
  let number = 1;
  const startNumber = hasPresets ? number++ : null;
  const customizeNumber = number++;
  const reviewNumber = number;
  const trigger = cn(chipTabTrigger, "min-w-fit flex-1 px-2");

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
      <TabsTrigger value="params" className={trigger} onClick={onActivate}>
        {customizeNumber} Customize
      </TabsTrigger>
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

export function GuidedContinue({ to, onContinue }: { to: PanelTab; onContinue: (tab: PanelTab) => void }) {
  const label = to === "review" ? "Continue to Review" : "Continue to Customize";
  return (
    <div className="guided-flow-continue shrink-0 border-t px-3 py-2 text-right">
      <Button size="sm" variant="secondary" onClick={() => onContinue(to)}>
        {label} <NextIcon size={15} aria-hidden="true" />
      </Button>
    </div>
  );
}
