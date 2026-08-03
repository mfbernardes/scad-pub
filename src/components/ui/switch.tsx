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
        // The track is 36×20, and for a bare switch (every boolean parameter in
        // ParamForm) the track is the whole target. The `after` overlay lifts
        // that to 24px tall on a fine pointer and 44px on a coarse one (2.5.8)
        // without touching the drawn pill, which is what padding would have
        // resized. Vertical only: 36px already clears the width.
        "peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-[background-color,border-color,box-shadow,opacity] outline-none after:absolute after:inset-x-0 after:top-1/2 after:h-6 after:-translate-y-1/2 after:content-[''] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:after:h-11",
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
