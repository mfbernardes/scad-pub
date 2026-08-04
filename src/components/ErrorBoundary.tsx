// ErrorBoundary.tsx: a generic, reusable error boundary. Contains a
// rendering error to its subtree instead of letting it unmount an ancestor
// (or, at the root, the whole app), and clears itself when `resetKey`
// changes so a caller can offer retry by remounting under a fresh key.
// Used scoped to the Viewer (a new render result is the reset signal), the
// lazily-loaded SVG wizard (a bumped attempt counter is the reset signal,
// see SvgPrepareControl.tsx), and at the app root in main.tsx.
import { Component, type ReactNode } from "react";
import { t } from "../lib/i18n";
import { useLocale } from "../lib/localeStore";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  resetKey?: unknown;
}

interface State {
  error: Error | null;
  lastKey: unknown;
}

/** The built-in fallback, extracted to a function component so it can
 *  subscribe via useLocale(): the class it's rendered from can't (React class
 *  components have no hooks), which used to mean a locale switch WHILE this
 *  fallback was showing left it in the error-time language until the next
 *  unrelated re-render. */
export function BoundaryFallback({ message }: { message: string }) {
  useLocale(); // subscription only: re-render this component's t() call on a locale switch
  return (
    <div
      className="viewer-error flex flex-1 flex-col items-center justify-center gap-[0.4rem] bg-card p-4 text-center text-foreground"
      role="alert"
    >
      <p>{t("errorBoundary.viewerFailed")}</p>
      <p className="text-[0.82rem] text-muted-foreground">{message}</p>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, lastKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.lastKey) return { error: null, lastKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error) {
    console.error("ErrorBoundary caught:", error);
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? <BoundaryFallback message={this.state.error.message} />;
    }
    return this.props.children;
  }
}
