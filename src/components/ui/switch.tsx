import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        // A bare switch (every boolean parameter) is its own target, and the
        // drawn track is 36×20; the `after` overlay lifts it to 2.5.8's 24px
        // floor without resizing a pill that paints its own background.
        // 24 and not a coarse pointer's 44: the overlay is centred on the
        // track, so extra height spills past this (positioned) root and wins
        // the hit test against what sits below — at 44, a tap 2px inside the
        // next row of the mobile "More actions" menu toggled Live preview.
        // A coarse pointer gets its 44 from the row instead (PanelFooter).
        "peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-[background-color,border-color,box-shadow,opacity] outline-none after:absolute after:inset-x-0 after:top-1/2 after:h-6 after:-translate-y-1/2 after:content-[''] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "bg-background pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%+2px)] data-[state=unchecked]:translate-x-[1px]"
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
