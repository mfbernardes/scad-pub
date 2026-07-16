// NoteBar.tsx — F9: the small "label — action" note row CustomizeTab shows in
// three call sites (the hidden-diff chip, the search "hidden matches" note,
// and the "N hidden" note below the form) — structurally the same idea (a
// line of text, an em-dash separator, one action) in two concrete shapes:
//
//   - `as="button"`: the WHOLE row is the clickable action (the hidden-diff
//     chip) — the action label renders as a plain, non-interactive `<span>`,
//     since the row itself already carries the click handler.
//   - `as="div"`: a `role`-carrying (optionally `"status"`) row with its own
//     separate `<button>` action (the search-note / hidden-count note).
//
// Each call site still supplies its OWN full `className` (the literal class
// hook — `.settings-hidden-diff` / `.settings-search-note` /
// `.settings-hidden-note` — plus that row's layout classes) exactly as it
// rendered it before this consolidation: the smoke/vis harness keys off
// those hooks directly (see CLAUDE.md's "keep script hook classes"), and the
// DOM shape below is written to reproduce each call site's markup verbatim,
// not a new visual design.
import type { ReactNode } from "react";

// Shared by the note action (below) and CustomizeTab's unrelated attention
// chip — re-exported so both draw from the one definition.
export const noteActionClass =
  "inline-flex shrink-0 cursor-pointer items-center rounded-(--radius-sm) border-none bg-transparent p-0 font-medium text-brand hover:underline focus-visible:outline-offset-2";

interface NoteBarProps {
  /** Root element shape — see the module doc above. */
  as: "button" | "div";
  /** The stable class hook plus this row's own layout/visual classes,
   *  applied to the root element verbatim. */
  className: string;
  /** Only meaningful when `as="div"` — the hidden-diff button row never had
   *  a `role` attribute; the search-note does (`"status"`), the hidden-count
   *  note doesn't. Omit to render no `role` attribute at all. */
  role?: string;
  /** Row text before the "—" separator. */
  children: ReactNode;
  actionLabel: string;
  onAction: () => void;
}

export function NoteBar({ as, className, role, children, actionLabel, onAction }: NoteBarProps) {
  if (as === "button") {
    return (
      <button type="button" className={className} onClick={onAction}>
        <span className="flex-1">{children}</span>
        <span aria-hidden="true">—</span>
        <span className={noteActionClass}>{actionLabel}</span>
      </button>
    );
  }
  return (
    <div className={className} role={role}>
      <span>{children}</span>
      <span aria-hidden="true">—</span>
      <button type="button" className={noteActionClass} onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}
