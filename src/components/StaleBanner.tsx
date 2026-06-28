// StaleBanner.tsx — floating "preview out of date" alert over the viewer. This
// is the primary signal that what you're looking at no longer matches the
// controls: auto-render is off and a parameter changed since the last render.
// The whole banner is the render call-to-action. While a manual render runs it
// shows progress, so heavy renders — the main reason auto-render is ever off —
// aren't silent. It renders nothing while the preview is live (auto-render on,
// or nothing has changed), so the viewer chrome stays clean in the common case.
import { RefreshCw as RefreshIcon } from "lucide-react";
import { Spinner } from "./ui/spinner";

interface Props {
  autoRender: boolean;
  rendering: boolean;
  /** Auto-render off AND params/preset/design changed since the last render. */
  stalePreview: boolean;
  onRender: () => void;
  className?: string;
}

export function StaleBanner({ autoRender, rendering, stalePreview, onRender, className = "" }: Props) {
  // Auto-render keeps the preview live — the banner is a manual-mode concern only.
  if (autoRender) return null;
  if (!rendering && !stalePreview) return null;

  return (
    <button
      type="button"
      className={`stale-banner${rendering ? " stale-banner--busy" : ""} ${className}`.trim()}
      onClick={rendering ? undefined : onRender}
      disabled={rendering}
      aria-label={rendering ? "Rendering" : "Preview out of date — render now"}
    >
      {rendering ? (
        <>
          <Spinner className="size-4" /> Rendering…
        </>
      ) : (
        <>
          <span className="stale-banner__dot" aria-hidden="true" />
          Preview out of date
          <span className="stale-banner__cta">
            <RefreshIcon size={14} /> Render
          </span>
        </>
      )}
    </button>
  );
}
