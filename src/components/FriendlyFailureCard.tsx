// FriendlyFailureCard.tsx: the shared failed-render presentation: the
// friendly {title, body} from src/lib/friendlyErrors.ts, plus a collapsed
// "Raw output" <details> holding the technical tail. Used by OutputConsole's
// Notices tab and ReviewDialog so a failure reads identically wherever it
// surfaces.
//
// Deliberately NOT `role="alert"`. ParamForm's banner carries the same
// sentence, at the point of edit, and is the one that should interrupt; with
// both marked assertive a desktop visitor heard the identical text twice the
// moment a render failed. The failure is still announced: OutputToggle's own
// `role="status"` live region reports "Render status: Failed …" wherever this
// card is reached (console or review dialog), so a second assertive alert
// here would only repeat that.
import type { FriendlyErrorInfo } from "../lib/friendlyErrors";
import { t } from "../lib/i18n";
import { useLocale } from "../lib/localeStore";

export function FriendlyFailureCard({ info }: { info: FriendlyErrorInfo }) {
  useLocale(); // subscription only: re-render this component's t() calls on a locale switch
  return (
    <div className="friendly-failure flex flex-col gap-2">
      <p className="m-0 font-semibold text-foreground">{info.title}</p>
      {info.body && <p className="m-0 text-[0.88rem] text-muted-foreground">{info.body}</p>}
      {info.technical.length > 0 && (
        <details className="friendly-failure__raw mt-1">
          <summary className="cursor-pointer select-none text-[0.82rem] text-muted-foreground hover:text-brand">
            {t("console.rawOutput")}
          </summary>
          <pre className="log m-0 mt-2 max-h-40 overflow-auto overscroll-contain whitespace-pre-wrap rounded-(--radius-sm) bg-code px-3 py-2 font-mono text-xs leading-[1.4] text-muted-foreground">
            {info.technical.join("\n")}
          </pre>
        </details>
      )}
    </div>
  );
}
