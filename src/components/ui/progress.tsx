import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn("bg-primary/20 relative h-2 w-full overflow-hidden rounded-full", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        // A null/undefined `value` (Radix: "indeterminate", exposed as
        // data-state="indeterminate" — no aria-valuenow either, per the WAI-ARIA
        // progressbar pattern) has no percentage to translate to, so it gets a
        // looping sweep animation instead of the determinate translateX; see
        // the `progress-indeterminate` keyframes in index.css.
        className="bg-primary h-full w-full flex-1 transition-all data-[state=indeterminate]:w-1/3 data-[state=indeterminate]:animate-[progress-indeterminate_1.4s_ease-in-out_infinite] motion-reduce:data-[state=indeterminate]:animate-none"
        style={value != null ? { transform: `translateX(-${100 - value}%)` } : undefined}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
