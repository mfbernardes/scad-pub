// panelData.ts — context for the read-mostly panel DATA that CustomizeTab
// and GettingStarted consume identically regardless of which layout mounted
// them: ParamPanel (desktop) and SheetTabs (mobile) used to each declare the
// same ~25 pass-through props and spread them straight into CustomizeTab
// (see AppShell.tsx's two JSX branches) — a twin list that had to be kept in
// sync by hand on every new Review-stage/attention/checklist prop. AppShell
// now builds this bundle once and mounts a SINGLE `PanelDataProvider` above
// both layout trees; ParamPanel/SheetTabs shrink to their genuinely layout-
// specific props (tab/search wiring, sheetDetent, panel sizing, and the
// presets/file-import plumbing PresetPicker/FileBar consume directly — never
// CustomizeTab/GettingStarted), and CustomizeTab/GettingStarted read this
// bundle via `usePanelData()` instead of a prop drilled through two
// intermediaries.
//
// Deliberately the OPPOSite identity contract from `appActions.ts`'s
// AppActionsProvider, not an oversight:
//   - AppActions carries CALLBACKS. Its provider hands out a context value
//     whose IDENTITY never changes (a ref-backed proxy that always invokes
//     the latest closures) — that's what lets a memo'd consumer read
//     `useAppActions()` without ever re-rendering just because App.tsx
//     re-created a callback. The callbacks' own staleness is a non-issue:
//     they always forward to the current implementation.
//   - PanelData carries STATE — values, attention, readiness, checklist, …
//     that must actually propagate the moment it changes; hiding those
//     updates behind a stable-ref identity (like AppActions) would silently
//     freeze every consumer's view of live render/param state. So this
//     provider's `value` is a PLAIN object, freshly built by the caller each
//     render (AppShell memoizes it — see AppShell.tsx's `panelData` — so a
//     render that doesn't touch any of these fields doesn't hand out a new
//     object either). Ordinary React context semantics apply: a consumer
//     re-renders exactly when the value it reads actually changed, same as
//     if these were still individual props.
import { createContext, createElement, useContext, type ReactNode } from "react";
import type { Design, Param } from "../openscad/types";
import type { Values } from "./presets";
import type { InstalledFont } from "./fonts";
import type { ExperienceMode, SettingsView } from "./useExperience";
import type { ChecklistState } from "./checklist";
import type { AttentionItem, ReadinessState } from "./readiness";
import type { Dimensions } from "../components/Viewer";
import type { ComputedInfo } from "./computedInfo";
import type { ViewName } from "../components/views";

/** Everything CustomizeTab and GettingStarted read identically from both
 *  layouts. Field-by-field provenance (see AppShell.tsx's `panelData`):
 *  design/values/presetBaseline/presetName/baseline/changedParams/
 *  showVarName/availableFontFamilies/fontSuggestion/installedFonts/
 *  settingsView/experienceMode/quickStartEnabled/focusHiddenDiffSignal/
 *  attention/onOpenMessages/readiness/measured/renderedValues/computedInfo/
 *  reviewStale/onSelectView/hiddenDiff flow straight into CustomizeTab; checklist/
 *  checklistReplaySignal/quickStartActive flow into GettingStarted (which
 *  also takes quickStartActive, shared with CustomizeTab's own copy so the
 *  two can never disagree — see quickStart.ts). Search (value + onChange/
 *  onFocus/onBlur) and the tab strip stay OUT of this bundle even though
 *  they too end up at CustomizeTab: they're the one piece of "layout wiring"
 *  each of ParamPanel/SheetTabs still owns as an explicit prop (different
 *  DOM ids/hooks per layout — see AppShell's onParamSearchHiddenBlur doc),
 *  so folding them in here would blur that seam rather than clarify it. */
export interface PanelData {
  design: Design;
  values: Values;
  /** The selected preset's values, or null when no preset is selected (baseline is defaults). */
  presetBaseline: Values | null;
  /** The selected preset's display name, or null when no preset is selected. */
  presetName: string | null;
  /** Values the current params are diffed against — presetBaseline, or design defaults. */
  baseline: Values;
  /** Names of params whose value differs from `baseline`. */
  changedParams: Set<string>;
  showVarName: boolean;
  /** Font families the renderer can use (normalised), for the missing-font hint. */
  availableFontFamilies?: Set<string>;
  /** A bundled family to offer as a one-click fallback for a missing font. */
  fontSuggestion?: string | null;
  /** Faces the renderer can use (bundled ∪ imported), for the font selector. */
  installedFonts?: InstalledFont[];
  /** Essentials/all settings-view (see src/lib/useExperience.ts). */
  settingsView: SettingsView;
  /** Guided/standard experience mode — gates QuickStart (see quickStartAvailable). */
  experienceMode: ExperienceMode;
  /** Build-time `ui.quickStart` opt-out. */
  quickStartEnabled: boolean;
  /** Bumped externally to trigger CustomizeTab's "reveal hidden diff" action —
   *  see its own doc. */
  focusHiddenDiffSignal?: number;
  /** PR22: set (fresh `nonce` per request) by OutputConsole's own friendly
   *  attention cards' "Go to setting" action — AppShell already closed
   *  Messages and switched to the Customize tab; this tells whichever
   *  CustomizeTab instance is mounted to reveal + focus the named param's
   *  control, via the same internal focusOnParam the chip's own action uses. */
  focusAttentionParamSignal?: { name: string; nonce: number } | null;
  /** PR22: bumped by the export dock's attention line's "Review" action to
   *  jump QuickStart to its Review stage/chip — see CustomizeTab -> QuickStart's
   *  own focusReviewSignal prop/effect. Only meaningful while QuickStart is
   *  the active guide; otherwise switching to the Customize tab (which
   *  AppShell already does) is enough, since the attention chip sits pinned
   *  above the scrollable form there. */
  focusReviewSignal?: number;
  /** Unresolved production-readiness gaps for the current render (src/lib/readiness.ts). */
  attention: AttentionItem[];
  /** Opens the Output console ("Messages"). */
  onOpenMessages?: () => void;
  /** PR18's Review stage: overall production-readiness for the current render. */
  readiness?: ReadinessState;
  /** The active viewer's measured bounding box (mm), or null before any render. */
  measured?: Dimensions | null;
  /** Values behind the CURRENT render (not the live controls). */
  renderedValues?: Values;
  /** Runtime `echo("@info", …)` rows for the current render. */
  computedInfo?: ComputedInfo[];
  /** Whether the Review summary's figures are stale (src/lib/renderState.ts). */
  reviewStale?: boolean;
  /** Snap the active viewer to a standard camera view. */
  onSelectView?: (view: ViewName) => void;
  /** The essentials-view-hidden params whose value differs from defaults
   *  (src/lib/paramFilter.ts's hiddenAdvancedDiff) — CustomizeTab's own
   *  "Review" chip computation, lifted here so OutputConsole's
   *  showReviewHidden (derived from this array's length by AppShell) and
   *  CustomizeTab's chip can never disagree. */
  hiddenDiff: Param[];
  /** The getting-started checklist's derived state (src/lib/checklist.ts). */
  checklist: ChecklistState;
  /** Bumped by the Help modal's replay row to bring the checklist back. */
  checklistReplaySignal?: number;
  /** Whether QuickStart is the active guide for the current design+view
   *  (src/lib/quickStart.ts) — shared verbatim by CustomizeTab and
   *  GettingStarted so they can never disagree about which mode is showing. */
  quickStartActive: boolean;
}

const PanelDataContext = createContext<PanelData | null>(null);

export function PanelDataProvider({
  value,
  children,
}: {
  value: PanelData;
  children: ReactNode;
}) {
  return createElement(PanelDataContext.Provider, { value }, children);
}

export function usePanelData(): PanelData {
  const ctx = useContext(PanelDataContext);
  if (!ctx) throw new Error("usePanelData must be used within a PanelDataProvider");
  return ctx;
}
