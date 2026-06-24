// theme.ts — light/dark theming. Three modes: "auto" follows the OS
// (prefers-color-scheme) and reacts to changes; "light"/"dark" force it. The
// resolved theme is written to <html data-theme>, which the CSS variables key
// off. Persisted in localStorage; a tiny inline script in index.html applies it
// before first paint to avoid a flash.
import { useEffect, useState } from "react";

export type ThemeMode = "auto" | "light" | "dark";
export type Theme = "light" | "dark";

// The dark browser-chrome colour comes from the config (Vite `define`; default
// dark panel). `typeof` guard keeps it safe under the Node test runner.
declare const __APP_THEME_COLOR__: string | undefined;
const DARK_THEME_COLOR =
  typeof __APP_THEME_COLOR__ !== "undefined" ? __APP_THEME_COLOR__ : "#1f2229";

// A neutral, fixed key (not namespaced by appId): the theme is a harmless
// cross-configurator UI preference, and the pre-paint inline script in
// index.html — which can't import the appId — must read the same key.
const KEY = "scadpub.theme";
const ORDER: ThemeMode[] = ["auto", "light", "dark"];

function systemDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

export function resolveTheme(mode: ThemeMode): Theme {
  return mode === "auto" ? (systemDark() ? "dark" : "light") : mode;
}

function readMode(): ThemeMode {
  let v: string | null = null;
  try {
    v = localStorage.getItem(KEY);
  } catch {
    /* storage unavailable */
  }
  return v === "light" || v === "dark" || v === "auto" ? v : "auto";
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "light" ? "#ffffff" : DARK_THEME_COLOR);
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(readMode);
  const resolved = resolveTheme(mode);

  useEffect(() => {
    apply(resolveTheme(mode));
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* ignore */
    }
    if (mode !== "auto") return;
    // In auto mode, track OS changes live.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply(resolveTheme("auto"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const cycle = () =>
    setMode((m) => ORDER[(ORDER.indexOf(m) + 1) % ORDER.length]);

  return { mode, resolved, cycle };
}
