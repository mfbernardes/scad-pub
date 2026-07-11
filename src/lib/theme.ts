// theme.ts — light/dark theming. Three modes: "auto" follows the OS
// (prefers-color-scheme) and reacts to changes; "light"/"dark" force it. The
// resolved theme is written to <html data-theme>, which the CSS variables key
// off. Persisted in localStorage; a tiny inline script in index.html applies it
// before first paint to avoid a flash.
import { useEffect, useState, useSyncExternalStore } from "react";
import { ns } from "./appId";
import { readLocal, writeLocal } from "./safeStorage";

export type ThemeMode = "auto" | "light" | "dark";
export type Theme = "light" | "dark";

// The dark browser-chrome colour comes from the config (Vite `define`; default
// dark panel). `typeof` guard keeps it safe under the Node test runner.
declare const __APP_THEME_COLOR__: string | undefined;
const DARK_THEME_COLOR =
  typeof __APP_THEME_COLOR__ !== "undefined" ? __APP_THEME_COLOR__ : "#1f2229";

// Namespaced by appId so two configs on one origin keep independent light/dark
// choices (like every other storage key). The pre-paint inline script in
// index.html can't import appId, so the configHtml Vite plugin injects the same
// key (%APP_THEME_KEY%). For the default id this is "scadpub.theme".
const KEY = ns("theme");
const ORDER: ThemeMode[] = ["auto", "light", "dark"];
const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemDark(): boolean {
  return window.matchMedia?.(DARK_QUERY).matches ?? true;
}

// useSyncExternalStore glue so "does the OS prefer dark" is one authoritative,
// reactive value instead of a snapshot read once at resolve time. Every
// consumer (this hook's `resolved`, and anything built on it) re-renders
// together on a matchMedia change — no imperative apply() can run ahead of
// the React value it's meant to mirror. `typeof window` guards module-scope
// use under the Node test runner (no DOM/matchMedia there).
// Exported (only) so tests/theme.test.mjs can exercise the store's
// subscribe/snapshot contract directly — this repo has no DOM-rendering test
// harness (no jsdom), so a full render of the `useTheme` hook isn't feasible;
// this is the pure unit the useSyncExternalStore call above is built from.
export function subscribeSystemDark(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function getSystemDarkSnapshot(): boolean {
  return typeof window === "undefined" ? true : systemDark();
}

export function resolveTheme(mode: ThemeMode): Theme {
  return mode === "auto" ? (systemDark() ? "dark" : "light") : mode;
}

function readMode(): ThemeMode {
  const v = readLocal(KEY);
  return v === "light" || v === "dark" || v === "auto" ? v : "auto";
}

// index.html ships two `meta[name="theme-color"]` tags, media-scoped to dark
// and light (dark listed first), each pre-filled by the configHtml Vite
// plugin with the configured colour for that scheme. A plain
// `querySelector('meta[name="theme-color"]')` always grabs the first (dark)
// one regardless of which theme is applied, so forcing dark under a light OS
// never updates the meta the browser actually reads, and forcing light
// discards the configured light colour for a hardcoded white. Resolve and
// cache both metas — and the colours their original `content` encodes — on
// first use, then keep both in sync with whichever theme is applied.
interface ThemeColorMetas {
  light: Element | null;
  dark: Element | null;
  lightColor: string;
  darkColor: string;
}

let themeColorMetas: ThemeColorMetas | null = null;

function getThemeColorMetas(): ThemeColorMetas {
  if (themeColorMetas) return themeColorMetas;
  let light: Element | null = null;
  let dark: Element | null = null;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const media = meta.getAttribute("media") ?? "";
    if (media.includes("dark")) dark = meta;
    else if (media.includes("light")) light = meta;
  }
  themeColorMetas = {
    light,
    dark,
    lightColor: light?.getAttribute("content") || "#ffffff",
    darkColor: dark?.getAttribute("content") || DARK_THEME_COLOR,
  };
  return themeColorMetas;
}

export function apply(theme: Theme) {
  // No-op under the Node test runner (no DOM); only resolveTheme is exercised
  // there.
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  const metas = getThemeColorMetas();
  const color = theme === "light" ? metas.lightColor : metas.darkColor;
  metas.light?.setAttribute("content", color);
  metas.dark?.setAttribute("content", color);
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(readMode);
  // The one subscription to the OS preference, shared by every render. In
  // "auto" mode this — not a value captured imperatively inside an effect —
  // is what `resolved` derives from, so DOM state (via the effect below) and
  // the React value returned to callers (Viewer theme, BarBrand, Toaster)
  // can never diverge: a matchMedia change re-renders this hook and every
  // consumer reading `resolved` in the same pass.
  const systemDark = useSyncExternalStore(
    subscribeSystemDark,
    getSystemDarkSnapshot,
    getSystemDarkSnapshot
  );
  const resolved: Theme = mode === "auto" ? (systemDark ? "dark" : "light") : mode;

  // Apply is a DOM side effect keyed off the single resolved value above, so
  // it re-runs both on an explicit mode change and on a live OS change while
  // in auto mode — there's no separate matchMedia listener here to fall out
  // of sync with it.
  useEffect(() => {
    apply(resolved);
  }, [resolved]);

  useEffect(() => {
    writeLocal(KEY, mode);
  }, [mode]);

  const cycle = () =>
    setMode((m) => ORDER[(ORDER.indexOf(m) + 1) % ORDER.length]);

  return { mode, resolved, cycle };
}
