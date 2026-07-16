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
// and owns the dismiss/replay/auto-collapse UI chrome around it.
import { useEffect, useRef, useState } from "react";
import { Check as CheckIcon, X as CloseIcon } from "lucide-react";
import { makeOnceFlag } from "../lib/prefs";
import { t } from "../lib/i18n";
import { STATE_STYLES, type RenderState } from "../lib/renderStatus";
import { deriveChecklistItems, checklistAllDone, type ChecklistItem, type ChecklistState } from "../lib/checklist";
import { IconButton } from "./IconButton";
import { cn } from "../lib/utils";

const checklistFlag = makeOnceFlag("checklist.v1");

const TASK_LABEL_KEY: Record<"design" | "review" | "export", string> = {
  design: "checklist.chooseDesign",
  review: "checklist.reviewEssential",
  export: "checklist.exportModel",
};

// Reuses renderStatus.ts's own state->dot-colour mapping (read-only import;
// that file is not touched) so the preview row's dot matches the same green/
// amber-pulse/red vocabulary the Output bell already wears elsewhere. "attention"
// has no renderStatus.ts counterpart (it isn't a render outcome — see
// readiness.ts), so it's handled as its own branch below with the same
// `bg-warn` token FontMissingHint/the attention chip already wear, rather
// than stretching renderStatus.ts's RenderState to cover a concept it was
// never meant to model.
function previewRenderState(status: "building" | "ready" | "failed"): RenderState {
  if (status === "ready") return "ok";
  if (status === "failed") return "error";
  return "rendering";
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  if (item.kind === "status") {
    if (item.previewStatus === "attention") {
      return (
        <li className="flex items-center gap-2 text-muted-foreground">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warn" />
          <span>
            {t("checklist.preview")} — {t("checklist.attention")}
          </span>
        </li>
      );
    }
    const renderState = previewRenderState(item.previewStatus);
    const style = STATE_STYLES[renderState];
    return (
      <li className="flex items-center gap-2 text-muted-foreground">
        <span
          aria-hidden="true"
          className={cn("size-2 shrink-0 rounded-full", style.dot, style.pulse && "animate-pulse")}
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
  state,
  replaySignal,
}: {
  state: ChecklistState;
  /** Bumped by the Help modal's replay row (App.tsx) to clear the dismiss
   *  flag and bring the card back — the same "only act on a genuine CHANGE,
   *  not the initial value" nonce idiom as CustomizeTab's
   *  focusHiddenDiffSignal. */
  replaySignal?: number;
}) {
  const [dismissed, setDismissed] = useState(() => checklistFlag.seen());
  const lastReplay = useRef(replaySignal);
  useEffect(() => {
    if (replaySignal === undefined || replaySignal === lastReplay.current) return;
    lastReplay.current = replaySignal;
    checklistFlag.forget();
    setDismissed(false);
  }, [replaySignal]);

  if (!state.enabled || dismissed) return null;

  const items = deriveChecklistItems(state);
  const allDone = checklistAllDone(items);

  const dismiss = () => {
    checklistFlag.remember();
    setDismissed(true);
  };

  return (
    <div
      className="getting-started shrink-0 border-b bg-muted px-3 py-[0.5rem] text-[0.82rem]"
      role="group"
      aria-label={t("checklist.createModel")}
    >
      <div className="flex items-center gap-2">
        <span className={cn("flex-1", allDone ? "font-medium text-foreground" : "font-semibold text-foreground")}>
          {t("checklist.createModel")}
          {/* Auto-collapsed "done" state: a quiet one-line confirmation
              instead of vanishing outright — see the module doc and
              CustomizeTab's similarly-reasoned inline notes for why a
              disappearing-without-action card reads as flaky UI. The card
              stays dismissible either way; only the explicit X remembers the
              once-flag, so a reload before dismissing shows it again. */}
          {allDone && <> — {t("checklist.ready")}</>}
        </span>
        <IconButton
          label={t("checklist.dismiss")}
          className="getting-started__dismiss size-6 shrink-0 border-none bg-transparent p-1 hover:border"
          onClick={dismiss}
        >
          <CloseIcon aria-hidden="true" size={14} />
        </IconButton>
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
