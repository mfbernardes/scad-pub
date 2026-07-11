import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

// StrictMode is dev-only (React's production build is a no-op for its extra
// checks, so this costs nothing in the shipped bundle — see
// docs/architecture-review.md L1). It used to be omitted here because it
// double-invokes effects in dev, and the render worker used to be spawned as
// a render-time side effect (`if (!runnerRef.current) runnerRef.current = new
// OpenSCADRunner(...)` in useRenderPipeline.ts) — the extra invocation would
// have leaked a second worker. Worker construction now happens inside a
// useEffect with matching cleanup (see useRenderPipeline.ts), so Strict
// Mode's dev-only mount -> cleanup -> remount replay disposes the first
// runner before constructing the second, leaving exactly one live worker and
// no leak.
//
// The service worker is registered from within the app (see lib/swUpdate.ts) so
// the same place that registers it can surface the "update available" prompt.
//
// Root error boundary: an uncaught render error anywhere in the tree (not just
// the Viewer or the SVG wizard, which have their own scoped boundaries) would
// otherwise unmount past `#root` and leave a blank page with no on-screen
// signal. This is the last line of defence — reload is the only generally
// correct recovery at this scope, since app state itself may be what's broken.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary
      fallback={
        <div
          role="alert"
          className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground"
        >
          <p className="text-lg font-medium">Something went wrong.</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            The app hit an unexpected error and couldn't continue. Reloading
            usually fixes it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex cursor-pointer items-center gap-[0.4rem] rounded-(--radius-sm) border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground focus-visible:outline-offset-2"
          >
            Reload
          </button>
        </div>
      }
    >
      <App />
    </ErrorBoundary>
  </StrictMode>
);
