// FriendlyFailureCard.tsx — the shared failed-render presentation: the
// friendly {title, body} from src/lib/friendlyErrors.ts, plus a collapsed
// "Raw output" <details> holding the technical tail. Used by OutputConsole's
// Notices tab and ReviewDialog so a failure reads identically wherever it
// surfaces (see CLAUDE.md item 6b).
import type { FriendlyErrorInfo } from "../lib/friendlyErrors";

export function FriendlyFailureCard({ info }: { info: FriendlyErrorInfo }) {
  return (
    <div className="friendly-failure flex flex-col gap-2" role="alert">
      <p className="m-0 font-semibold text-foreground">{info.title}</p>
      {info.body && <p className="m-0 text-[0.88rem] text-muted-foreground">{info.body}</p>}
      {info.technical.length > 0 && (
        <details className="friendly-failure__raw mt-1">
          <summary className="cursor-pointer select-none text-[0.82rem] text-muted-foreground hover:text-brand">
            Raw output
          </summary>
          <pre className="log m-0 mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-(--radius-sm) bg-code px-3 py-2 font-mono text-xs leading-[1.4] text-muted-foreground">
            {info.technical.join("\n")}
          </pre>
        </details>
      )}
    </div>
  );
}
