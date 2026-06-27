// appActions — context for the app-level action callbacks (render, export,
// value/preset changes, file imports, theme, …). App owns them; the panels read
// them here instead of having the whole bundle drilled through AppShell.
//
// The context value is stable for the provider's lifetime (backed by a ref):
// reading it never re-renders a memo'd consumer when a callback's identity
// changes, yet each call always invokes App's latest implementation.
import {
  createContext,
  createElement,
  useContext,
  useRef,
  type ReactNode,
} from "react";
import type { ParamValue } from "../openscad/types";
import type { Values } from "./presets";

export interface AppActions {
  install: () => void;
  designChange: (id: string) => void;
  change: (name: string, value: ParamValue) => void;
  applyPreset: (v: Values) => void;
  selectedPresetChange: (id: string) => void;
  presetsChange: () => void;
  render: () => void;
  exportModel: () => void;
  savePng: (url: string) => void;
  copyLink: () => void;
  reset: () => void;
  addFile: (name: string, bytes: Uint8Array) => void;
  removeFile: (name: string) => void;
  clearFiles: () => void;
  autoRenderChange: (v: boolean) => void;
  cycleTheme: () => void;
  showHelp: () => void;
  showLicenses: () => void;
}

const AppActionsContext = createContext<AppActions | null>(null);

type AnyFn = (...args: never[]) => unknown;

export function AppActionsProvider({
  actions,
  children,
}: {
  actions: AppActions;
  children: ReactNode;
}) {
  // Always forward to the freshest callbacks…
  const latest = useRef(actions);
  latest.current = actions;
  // …through wrappers whose identities never change, so consumers stay stable.
  const stable = useRef<AppActions | null>(null);
  if (!stable.current) {
    const out: Record<string, AnyFn> = {};
    for (const key of Object.keys(actions))
      out[key] = (...args: never[]) =>
        (latest.current as unknown as Record<string, AnyFn>)[key](...args);
    stable.current = out as unknown as AppActions;
  }
  return createElement(AppActionsContext.Provider, { value: stable.current }, children);
}

export function useAppActions(): AppActions {
  const ctx = useContext(AppActionsContext);
  if (!ctx) throw new Error("useAppActions must be used within an AppActionsProvider");
  return ctx;
}
