// StatusPill.tsx — compact render-status indicator in the CommandBar. Shows only
// a colour-coded dot (green = ok, red = failed, pulsing = working); clicking it
// reveals the detail (e.g. "214 ms"). The full status stays in aria-label/title
// and a polite live region so it's never lost to assistive tech.
import { useState } from "react";
import type { RenderResult } from "../openscad/types";

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

  return (
    <>
      <button
        type="button"
        className={`status-pill status-pill--${state}${open ? " status-pill--open" : ""} ${className}`.trim()}
        aria-label={`Render status: ${text}`}
        aria-pressed={open}
        title={text}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="status-pill__dot" aria-hidden />
        {open && <span className="status-pill__text">{text}</span>}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {`Render status: ${text}`}
      </span>
    </>
  );
}
