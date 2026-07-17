// GettingStarted.tsx — a dismissible onboarding checklist mounted at the top
// of the panel area, above the Presets/Customize/Files tab strip, in BOTH
// layouts (ParamPanel docks it above its <Tabs>; SheetTabs' AppShell wrapper
// docks it above its <Tabs> the same way) — see each call site's own comment.
// Shown only in guided experience, only when the config allows it
// (`ui.checklist !== false`), and only until the visitor dismisses it (the
// `checklist.v1` once-flag, mirroring AppShell's sheetHintFlag).
//
// STATUS, NOT THEATER: item completion is derived from real app state by the
// pure src/lib/checklist.ts — this component only renders that derivation
// and owns the dismiss/replay/auto-collapse/compact/retirement UI chrome
// around it.
//
// PR14 — three renders behind one component, gated by two independent
// booleans threaded from AppShell (never recomputed divergently here):
//   - `peek` (mobile only, sheetDetent === "peek"): NOTHING but a slim,
//     non-dismissible progress line. BottomSheet measures the Peek height
//     from whatever sits between the sheet's top edge and its tab strip (see
//     BottomSheet.tsx's `measure()`), so mounting the full/compact card there
//     balloons Peek past "handle + tab strip" — the exact mobile-peek bug
//     this milestone fixes ("Mobile peek is a real peek").
//   - `quickStartActive` (the same `quickStartAvailable` predicate
//     CustomizeTab gates its own step UI on, see quickStart.ts): a compact
//     one-line "N of M complete" form, expandable inline (session-only) to
//     the classic full card, replaces the full card outright — QuickStart
//     already walks the visitor through the same journey step by step, so
//     the full checklist would restate it at a second, redundant level of
//     detail. The full card stays the default whenever QuickStart is NOT the
//     active guide (single-design builds, All settings, a design without
//     `@step`s, `ui.quickStart: false`) — today's behavior, unchanged.
//
// Retirement: once an export completed BEFORE this component's mount (i.e.
// `state.exported` was already true at the very moment it first rendered —
// see the `dismissed` initializer below), the checklist retires permanently
// starting on that load — no timer, no mid-session disappearance. The
// session that actually performs the export still shows the completed state
// as always (a `useState` lazy initializer runs exactly once, at mount,
// before any in-session export could yet have happened) — only a LATER
// mount (the next reload) reads the persisted flag and skips rendering
// outright. Chosen over a ~5s auto-hide timer because it's simple and fully
// deterministic (no race against paint/render timing) — see the milestone
// brief's own "pick the simpler deterministic option" instruction. Help
// modal replay still resurrects a retired checklist exactly like a manually
// dismissed one (both just clear the same `checklist.v1` flag).
import { useState } from "react";
import { Check as CheckIcon, ChevronRight as ChevronIcon } from "lucide-react";
import { makeOnceFlag } from "../lib/prefs";
import { t } from "../lib/i18n";
import { readinessDotClass, readinessPulse } from "../lib/reviewSummary";
import {
  deriveChecklistItems,
  checklistAllDone,
  checklistTaskProgress,
  type ChecklistItem,
} from "../lib/checklist";
import { useSignal } from "../lib/useSignal";
import { usePanelData } from "../lib/panelData";
import { cn } from "../lib/utils";

const checklistFlag = makeOnceFlag("checklist.v1");

const TASK_LABEL_KEY: Record<"design" | "review" | "export", string> = {
  design: "checklist.chooseDesign",
  review: "checklist.reviewEssential",
  export: "checklist.exportModel",
};

// Small inline text-link action — mirrors CustomizeTab's own noteActionClass
// so the checklist's dismiss control reads as the same family of quiet
// in-panel action as "Review"/"Show all" elsewhere, rather than a bespoke
// look. Kept on BOTH the compact and full-card forms via the SAME
// `.getting-started__dismiss` class hook the smoke/vis harness already keys
// off (see CLAUDE.md's "keep script hook classes").
const dismissClass =
  "getting-started__dismiss inline-flex shrink-0 cursor-pointer items-center rounded-(--radius-sm) border-none bg-transparent p-0 font-medium text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-offset-2";

function ChecklistRow({ item }: { item: ChecklistItem }) {
  if (item.kind === "status") {
    // checklist.ts's PreviewStatus ("building" | "ready" | "attention" |
    // "failed") is the same 4-value union as readiness.ts's ReadinessState —
    // reviewSummary.ts's readinessDotClass/readinessPulse are the single
    // source for the state->dot-colour/pulse mapping (shared with QuickStart's
    // Review stage), so this row draws from there instead of a local copy.
    return (
      <li className="flex items-center gap-2 text-muted-foreground">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full",
            readinessDotClass(item.previewStatus),
            readinessPulse(item.previewStatus) && "animate-pulse"
          )}
        />
        <span>
          {t("checklist.preview")} — {t(`checklist.${item.previewStatus}`)}
        </span>
      </li>
    );
  }
  const done = item.status === "done";
  return (
    <li className={cn("flex items-center gap-2", done ? "text-foreground" : "text-muted-foreground")}>
      {done ? (
        <CheckIcon aria-hidden="true" size={13} className="shrink-0 text-brand" />
      ) : (
        <span aria-hidden="true" className="size-[13px] shrink-0 rounded-full border border-current" />
      )}
      <span>
        {t(TASK_LABEL_KEY[item.id])}
        {done && <span className="sr-only"> — {t("checklist.done")}</span>}
      </span>
    </li>
  );
}

export function GettingStarted({
  peek = false,
}: {
  /** Mobile only: true while the bottom sheet (BottomSheet.tsx) is at the
   *  Peek detent — see SheetTabs' `sheetDetent` prop. Renders nothing but a
   *  slim, non-dismissible progress line in place of the compact/full card —
   *  see this file's own module doc for why Peek can't afford either. Left as
   *  an explicit prop (not PanelDataContext — see panelData.ts's own doc):
   *  it's layout wiring ParamPanel/SheetTabs compute themselves (desktop has
   *  no sheet, so it never passes this), not data the two layouts merely
   *  happen to pass through identically. */
  peek?: boolean;
}) {
  // `state` (the checklist's derived input — see checklist.ts's
  // ChecklistState), `replaySignal` (bumped by the Help modal's replay row —
  // the same "only act on a genuine CHANGE, not the initial value" nonce
  // idiom as CustomizeTab's focusHiddenDiffSignal) and `quickStartActive`
  // (the exact `quickStartAvailable` predicate CustomizeTab gates its own
  // step UI on, so the two surfaces can never disagree about which "mode" is
  // showing) all come from PanelDataContext now — see panelData.ts.
  const { checklist: state, checklistReplaySignal: replaySignal, quickStartActive } = usePanelData();
  const [dismissed, setDismissed] = useState(() => {
    if (checklistFlag.seen()) return true;
    // Retirement (PR14): see the module doc above. `state.exported` here is
    // its value at the very first render — the lazy initializer never runs
    // again after mount — so this is true only when the export flag was
    // ALREADY persisted before this load, i.e. "the next app load after the
    // export that finished it".
    if (state.exported) {
      checklistFlag.remember();
      return true;
    }
    return false;
  });
  // Compact -> full expansion (rule 1): session-only, deliberately not
  // persisted — a fresh mount (reload, or a layout swap across the M7
  // breakpoint) always starts collapsed again.
  const [expanded, setExpanded] = useState(false);
  // F8: fires exactly once per genuine replaySignal change (the Help modal's
  // replay row) — see useSignal's own doc for why this can't just be a plain
  // effect on [replaySignal] (the initial mount value may already be nonzero).
  useSignal(replaySignal, () => {
    checklistFlag.forget();
    setDismissed(false);
  });

  if (!state.enabled || dismissed) return null;

  const items = deriveChecklistItems(state);
  const allDone = checklistAllDone(items);
  const { completed, total } = checklistTaskProgress(items);

  const dismiss = () => {
    checklistFlag.remember();
    setDismissed(true);
  };

  // Peek (rule 3): a single slim line, no card chrome, no dismiss control —
  // there isn't room for one, and raising the sheet off Peek already reaches
  // a form that has one. Deliberately NOT `.getting-started` (a different
  // class entirely) so the harness's dismiss-hook lookup and the "no card at
  // peek" assertion can tell the two apart unambiguously.
  if (peek) {
    return (
      <div
        className="getting-started-peek flex shrink-0 items-center justify-center gap-1 px-3 py-[0.3rem] text-[0.72rem] text-muted-foreground"
        role="status"
      >
        {t("checklist.createModel")} · {t("checklist.progress", { completed, total })}
      </div>
    );
  }

  // Compact (rule 1): QuickStart is already the active guide, so this is a
  // one-line summary instead of the full card, with a chevron that expands
  // it inline.
  if (quickStartActive && !expanded) {
    return (
      <div
        className="getting-started flex shrink-0 items-center gap-2 border-b bg-muted px-3 py-[0.4rem] text-[0.82rem]"
        role="group"
        aria-label={t("checklist.createModel")}
      >
        <button
          type="button"
          className="getting-started__expand flex flex-1 items-center gap-1 border-none bg-transparent p-0 text-left font-medium text-foreground"
          aria-expanded={false}
          onClick={() => setExpanded(true)}
        >
          <ChevronIcon aria-hidden="true" size={14} className="shrink-0" />
          <span>
            {t("checklist.createModel")} · {t("checklist.progress", { completed, total })}
          </span>
        </button>
        <button type="button" className={dismissClass} onClick={dismiss}>
          {t("checklist.hide")}
        </button>
      </div>
    );
  }

  // Full card: today's behavior when QuickStart isn't active; when it IS
  // active this is the expanded state, with the same chevron (now pointing
  // down) collapsing back to compact.
  return (
    <div
      className="getting-started shrink-0 border-b bg-muted px-3 py-[0.5rem] text-[0.82rem]"
      role="group"
      aria-label={t("checklist.createModel")}
    >
      <div className="flex items-center gap-2">
        {quickStartActive ? (
          <button
            type="button"
            className="getting-started__expand flex flex-1 items-center gap-1 border-none bg-transparent p-0 text-left font-semibold text-foreground"
            aria-expanded={true}
            onClick={() => setExpanded(false)}
          >
            <ChevronIcon aria-hidden="true" size={14} className="shrink-0 rotate-90" />
            <span>
              {t("checklist.createModel")}
              {allDone && <> — {t("checklist.ready")}</>}
            </span>
          </button>
        ) : (
          <span className={cn("flex-1", allDone ? "font-medium text-foreground" : "font-semibold text-foreground")}>
            {t("checklist.createModel")}
            {/* Auto-collapsed "done" state: a quiet one-line confirmation
                instead of vanishing outright — see the module doc and
                CustomizeTab's similarly-reasoned inline notes for why a
                disappearing-without-action card reads as flaky UI. The card
                stays dismissible either way; only "Hide guide" remembers the
                once-flag, so a reload before dismissing shows it again
                (unless retirement — see the module doc — already applies). */}
            {allDone && <> — {t("checklist.ready")}</>}
          </span>
        )}
        <button type="button" className={dismissClass} onClick={dismiss}>
          {t("checklist.hideGuide")}
        </button>
      </div>
      {!allDone && (
        <ul className="mt-[0.4rem] flex flex-col gap-[0.3rem]">
          {items.map((item) => (
            <ChecklistRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
