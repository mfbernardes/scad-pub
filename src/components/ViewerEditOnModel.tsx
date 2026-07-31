// ViewerEditOnModel.tsx: the floating inline text editor a click/tap on the
// rendered mesh opens: direct on-model editing for a design that declares an
// `@editOnModel` string param (see src/lib/editOnModel.ts + docs/annotations.md).
//
// It is deliberately a *shortcut only*. The canonical way to change the value is
// the same param's text box in the Customize panel, which is always present and
// fully keyboard-reachable; this is the "type on the sign" convenience over the
// model, opened by a pointer gesture and by nothing else. There is no chip or
// other permanent affordance over the viewer: at the mobile viewer's top-left it
// would cover the measurements panel, and the panel's own text box already
// carries the accessible path.
//
// State (open/anchor) lives in ViewerStage so it can wire the Viewer's mesh pick
// and suppress the one-time gesture hint while editing; this component owns the
// card's clamped positioning and focus handling. Each keystroke calls the same
// AppActions `change(param, value)` the panel's text box does: identical
// debounced auto-render, StaleBanner, everything, so there's no special render
// path here.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Param } from "../openscad/types";
import { Input } from "./ui/input";
import { useAppActions } from "../lib/appActions";
import { clampEditorPosition, type Point } from "../lib/editOnModel";
import { t } from "../lib/i18n";

// The editor input's id: a fixed literal is fine because at most one editor is
// open at a time (ViewerStage's single open flag), and it lets the <label>
// associate and the mount effect focus without a forwarded ref through the
// shared Input primitive.
const EDITOR_INPUT_ID = "model-text-editor-input";

interface Props {
  /** The design's `@editOnModel` string param. */
  param: Param;
  /** The param's current live value (prefilled into the editor on open). */
  value: string;
  /** Where the mesh click landed (px, viewer-relative). */
  anchor: Point | null;
  /** Mobile layout: pin the editor toward the top, clear of the keyboard. */
  mobile: boolean;
  /** The `.viewer-wrap` element, measured to clamp the editor within bounds. */
  wrapRef: React.RefObject<HTMLDivElement | null>;
  /** Close the editor. */
  onClose: () => void;
}

export function ViewerEditOnModel({ param, value, anchor, mobile, wrapRef, onClose }: Props) {
  const { change } = useAppActions();
  // Local text keeps the input from resetting when change() re-renders the
  // whole app (the panel's own string box works the same way).
  const [text, setText] = useState(value);
  // The value at open time, for Escape's single-shot revert.
  const initialRef = useRef(value);
  // First close wins: Enter/Escape close, then the input's own unmount fires a
  // blur that must not re-run onClose.
  const closedRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Focus the input on open and select its text, so the user can type over the
  // current value immediately.
  useEffect(() => {
    const el = document.getElementById(EDITOR_INPUT_ID) as HTMLInputElement | null;
    el?.focus();
    el?.select();
  }, []);

  // Clamp the card within the viewer once it (and its real size) is laid out.
  // useLayoutEffect writes the position before paint, so there's no flash from
  // the initial off-position render.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const card = cardRef.current;
    if (!wrap || !card) return;
    const bounds = { width: wrap.clientWidth, height: wrap.clientHeight };
    const size = { width: card.offsetWidth, height: card.offsetHeight };
    const pos = clampEditorPosition(anchor, bounds, size, { mobile });
    card.style.left = `${pos.left}px`;
    card.style.top = `${pos.top}px`;
  }, [anchor, mobile, wrapRef]);

  // Closing doesn't restore focus anywhere: the editor is only ever opened by a
  // pointer gesture on the mesh, so there is no originating control to return
  // to (and the viewer wrap isn't focusable).
  const finish = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose();
  };
  const revertAndClose = () => {
    if (closedRef.current) return;
    change(param.name, initialRef.current); // single change() back to the value at open
    closedRef.current = true;
    onClose();
  };

  const label = param.description || t("editOnModel.label");
  return (
    <div
      ref={cardRef}
      className="model-text-editor absolute z-20 flex flex-col gap-1 rounded-(--radius-sm) border border-(color:--glass-border) bg-(--glass-bg) p-2 shadow-(--elevation)"
      role="group"
      aria-label={t("editOnModel.open")}
      style={{ left: 0, top: 0, width: "15rem", maxWidth: "calc(100% - 1rem)" }}
    >
      {/* The associated <label> is the input's accessible name: no aria-label
          on the input too (that would be a second, competing label source). */}
      <label htmlFor={EDITOR_INPUT_ID} className="text-[0.72rem] font-medium text-muted-foreground">
        {label}
      </label>
      <Input
        id={EDITOR_INPUT_ID}
        type="text"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          change(param.name, e.target.value); // identical to the panel's text box
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            revertAndClose();
          }
        }}
        onBlur={finish}
      />
    </div>
  );
}
