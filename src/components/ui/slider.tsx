import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  );
  // Radix puts role="slider" on the Thumb, so the accessible name has to live
  // there (not on the Root): forward aria-label/labelledby down to each thumb.
  const thumbLabel = props["aria-label"];
  const thumbLabelledBy = props["aria-labelledby"];

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      {/* Chunky track + solid thumb: the sliders are the app's main hands-on
          control, so they read as tactile hardware, not a hairline widget.
          The track's border is --line-strong for the same reason: bg-muted
          (--panel-2) against the surrounding --panel is under 1.3:1 (WCAG
          1.4.11 needs 3:1). The thumb keeps its card-coloured border (contrast
          against its own accent fill) and gets the 3:1 boundary from a
          --line-strong ring instead, since --line-strong itself measures only
          1.19:1 against the accent-solid fill the thumb sits on. */}
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="bg-muted border-(--line-strong) relative grow overflow-hidden rounded-full border h-2 w-full"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="bg-primary absolute h-full"
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          aria-label={thumbLabel}
          aria-labelledby={thumbLabelledBy}
          className="bg-primary border-card ring-1 ring-(--line-strong) block size-5 shrink-0 rounded-full border-2 shadow-sm transition-[color,box-shadow] hover:ring-4 hover:ring-ring/80 focus-visible:ring-4 focus-visible:ring-ring/80 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
