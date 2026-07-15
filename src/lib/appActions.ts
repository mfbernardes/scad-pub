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
import type { SettingsView } from "./useExperience";

export interface AppActions {
  install: () => void;
  designChange: (id: string) => void;
  change: (name: string, value: ParamValue) => void;
  applyPreset: (v: Values) => void;
  selectedPresetChange: (id: string) => void;
  presetsChange: () => void;
  settingsViewChange: (view: SettingsView) => void;
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
  showDesignDoc: () => void;
  showLicenses: () => void;
}

const AppActionsContext = createContext<AppActions | null>(null);

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
  // Spelled out per action (rather than looped) so adding an AppActions member
  // without wiring it here is a compile error, not a runtime hole.
  const stable = useRef<AppActions | null>(null);
  if (!stable.current)
    stable.current = {
      install: () => latest.current.install(),
      designChange: (id) => latest.current.designChange(id),
      change: (name, value) => latest.current.change(name, value),
      applyPreset: (v) => latest.current.applyPreset(v),
      selectedPresetChange: (id) => latest.current.selectedPresetChange(id),
      presetsChange: () => latest.current.presetsChange(),
      settingsViewChange: (view) => latest.current.settingsViewChange(view),
      render: () => latest.current.render(),
      exportModel: () => latest.current.exportModel(),
      savePng: (url) => latest.current.savePng(url),
      copyLink: () => latest.current.copyLink(),
      reset: () => latest.current.reset(),
      addFile: (name, bytes) => latest.current.addFile(name, bytes),
      removeFile: (name) => latest.current.removeFile(name),
      clearFiles: () => latest.current.clearFiles(),
      autoRenderChange: (v) => latest.current.autoRenderChange(v),
      cycleTheme: () => latest.current.cycleTheme(),
      showHelp: () => latest.current.showHelp(),
      showDesignDoc: () => latest.current.showDesignDoc(),
      showLicenses: () => latest.current.showLicenses(),
    };
  return createElement(AppActionsContext.Provider, { value: stable.current }, children);
}

export function useAppActions(): AppActions {
  const ctx = useContext(AppActionsContext);
  if (!ctx) throw new Error("useAppActions must be used within an AppActionsProvider");
  return ctx;
}
