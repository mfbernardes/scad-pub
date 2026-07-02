// ErrorBoundary.tsx — contains rendering errors (e.g. a malformed 3MF or a
// three.js/WebGL failure) so one bad mesh can't blank the whole app. When
// `resetKey` changes (a new render arrives) it clears the error and retries.
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  resetKey?: unknown;
}

interface State {
  error: Error | null;
  lastKey: unknown;
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
    console.error("Viewer error boundary:", error);
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div
            className="viewer-error flex flex-1 flex-col items-center justify-center gap-[0.4rem] bg-card p-4 text-center text-foreground"
            role="alert"
          >
            <p>The 3D preview couldn't be shown.</p>
            <p className="text-[0.82rem] text-muted-foreground">{this.state.error.message}</p>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
