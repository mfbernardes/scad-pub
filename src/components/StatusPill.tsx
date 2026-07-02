// StatusPill.tsx — compact render-status indicator in the CommandBar. Shows only
// a colour-coded dot (green = ok, red = failed, pulsing = working); clicking it
// reveals the detail (e.g. "214 ms"). The full status stays in aria-label/title
// and a polite live region so it's never lost to assistive tech.
import { useState } from "react";
import type { RenderResult } from "../openscad/types";
import { cn } from "../lib/utils";

/* The dot's literal green/red match the pre-port palette in BOTH themes (the
   light-theme --danger is darker); kept literal for pixel fidelity. */
const STATE_STYLES: Record<string, { pill?: string; dot: string; pulse?: boolean }> = {
  idle: { pill: "text-muted-foreground", dot: "bg-muted-foreground" },
  loading: { dot: "bg-muted-foreground", pulse: true },
  rendering: { dot: "bg-brand", pulse: true },
  ok: { dot: "bg-[#4ade80]" },
  stale: { pill: "text-warn", dot: "bg-warn", pulse: true },
  error: { pill: "text-[#f87171]", dot: "bg-[#f87171]" },
};

interface Props {
  rendering: boolean;
  ready: boolean;
  result: RenderResult | null;
  /** Auto-render off AND params changed since the last render — preview is out of date. */
  stale?: boolean;
  className?: string;
}

export function StatusPill({ rendering, ready, result, stale = false, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  let text: string;
  let state: "idle" | "loading" | "rendering" | "ok" | "error" | "stale";

  if (!ready) {
    text = "Loading renderer…";
    state = "loading";
  } else if (rendering) {
    text = "Rendering…";
    state = "rendering";
  } else if (stale) {
    // The preview no longer matches the controls — surfaced before "ok" so a
    // happy green "214 ms" never masks unrendered changes.
    text = "Preview out of date";
    state = "stale";
  } else if (!result) {
    text = "Idle";
    state = "idle";
  } else if (result.ok) {
    text = result.cached ? `${result.ms} ms (cached)` : `${result.ms} ms`;
    state = "ok";
  } else {
    text = `Failed (exit ${result.exitCode})`;
    state = "error";
  }

  const s = STATE_STYLES[state];
  return (
    <>
      <button
        type="button"
        className={cn(
          "status-pill inline-flex items-center gap-[0.4rem] whitespace-nowrap rounded-(--radius-sm) border border-transparent bg-transparent px-[0.4rem] py-[0.2rem] text-[0.78rem] font-medium leading-[1.3]",
          s.pill,
          className
        )}
        aria-label={`Render status: ${text}`}
        aria-pressed={open}
        title={text}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className={cn(
            "size-[6px] shrink-0 rounded-full",
            s.dot,
            s.pulse && "animate-[pill-pulse_1s_ease-in-out_infinite] motion-reduce:animate-none"
          )}
          aria-hidden
        />
        {open && <span>{text}</span>}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {`Render status: ${text}`}
      </span>
    </>
  );
}
