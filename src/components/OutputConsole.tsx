// OutputConsole.tsx — bottom drawer with Notices + Log tabs (shadcn/ui Tabs).
// Auto-opens when a render first surfaces a notice/assert; also toggled by the
// Output button. Diagnostics/badges are computed once by the parent (AppShell)
// and passed in.
//
// The Notices tab leads with the same friendly attention cards
// (AttentionItems.tsx) QuickStart's Review stage shows — a visitor who opens
// Messages directly (the bell badge) gets the readable summary too, not just
// raw parsed lines. Mirrors how FriendlyError already leads on a render
// FAILURE; both can appear together (failure leads, attention cards next).
//
// Next come this file's OWN plain-language notice cards (diagnostics.ts's
// `noticeCards`): every notice category NOT already covered by an
// AttentionItems card (i.e. not `attention`-flagged in config) — e.g. a
// `fontnote` marker with `attention: false` — used to be visible ONLY as raw
// ECHO text behind a fold, so a non-zero "Notices 1" chip could point at
// nothing a visitor would ever see. `noticeCards` guarantees a visible card
// for every such pending badge (see its own doc for exactly how); each card
// shows the category's plain LABEL plus `cleanNoticeText`-cleaned message —
// no Fontconfig `:style=…` plumbing, no leading internal design-id prefix.
//
// The RAW parsed lines (notices, warnings, asserts — including the ones a
// friendly/plain card above already explains, PLUS the uncleaned Fontconfig/
// design-id text those cards strip) live behind a collapsed "Technical
// details" disclosure: with plain-language cards now covering the primary
// surface, the raw wire-format text is purely for anyone who wants OpenSCAD's
// exact wording — collapsed by default, no auto-expand.
//
// 5.1b: on mobile, when the total of attention + plain notice cards actually
// VISIBLE is small (diagnostics.ts's `isCompactConsoleContent`), the
// console's own full-screen modal wrapper (see AppShell's Dialog around this
// component) shrinks to a content-height panel docked at the bottom instead
// of commanding the whole viewport.
import { useMemo, useState } from "react";
import {
  type Diagnostic,
  type BadgeCount,
  type DiagnosticLevel,
  displayBadges,
  isCompactConsoleContent,
  noticeCards,
} from "../lib/diagnostics";
import { type RenderMetrics, formatDuration } from "../lib/renderMetrics";
import type { FriendlyErrorInfo } from "../lib/friendlyErrors";
import type { AttentionItem } from "../lib/readiness";
import { t } from "../lib/i18n";
import { Tabs, TabsContent, TabsList, TabsTrigger, chipTabTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";
import { useIsMobile } from "../lib/useIsMobile";
import { CountBadges } from "./CountBadges";
import { IconButton } from "./IconButton";
import { FriendlyError } from "./FriendlyError";
import { AttentionItems } from "./AttentionItems";
import { X as XIcon } from "lucide-react";

const ICON: Record<DiagnosticLevel, string> = { notice: "ⓘ", warning: "⚠", assert: "✗" };
/* The ⓘ/⚠/✗ glyph colour per diagnostic level (config categories may override
   per-notice via inline style). An assert reads as an error, matching the
   destructive count chip CountBadges already gives it on the console tab. */
const ICON_COLOR: Record<DiagnosticLevel, string> = {
  notice: "text-brand",
  warning: "text-warn",
  assert: "text-destructive",
};

// Stable default identity (mirrors AppShell's own EMPTY_LOG / QuickStart's
// EMPTY_ATTENTION_ITEMS precedent) so an omitted `attention` never hands
// AttentionItems a freshly-allocated value on every render.
const EMPTY_ATTENTION: AttentionItem[] = [];

interface Props {
  log: string[];
  diagnostics: Diagnostic[];
  badges: BadgeCount[];
  /** Local-only render performance telemetry (see lib/renderMetrics.ts). */
  metrics: RenderMetrics;
  open: boolean;
  onClose: () => void;
  /** Layout-specific sizing/positioning (desktop band vs mobile overlay). */
  className?: string;
  /** Friendly render-failure summary (see src/lib/friendlyErrors.ts) — null
   *  whenever the latest render didn't fail, in which case the Notices tab
   *  shows only the plain diagnostics list, as before. */
  friendlyError?: FriendlyErrorInfo | null;
  /** True when the viewer is genuinely still showing the last successful
   *  render's (dimmed) geometry despite the failed latest render — see
   *  renderState.ts's retainedResultAfterFailure and ViewerStage. Gates the
   *  "your last working preview is still shown" reassurance line. */
  lastPreviewKept?: boolean;
  /** hiddenAdvancedDiff(...).length > 0 in the current view — gates the
   *  "Review hidden settings" action; never inferred from the error text. */
  showReviewHidden?: boolean;
  onReviewSettings?: () => void;
  onReviewHiddenSettings?: () => void;
  onRetryRender?: () => void;
  /** Unresolved production-readiness gaps for the current render, rendered
   *  here as friendly warning cards leading the raw diagnostics list.
   *  Empty/omitted renders nothing extra (AttentionItems itself no-ops on an
   *  empty list). */
  attention?: AttentionItem[];
  /** A font-fallback card's THIRD action here (Messages isn't anchored near
   *  any control, unlike the contextual card or Review's own separate link):
   *  closes Messages, switches to the Customize tab, and focuses the named
   *  param's control (AppShell's `handleGoToAttentionSetting`). */
  onGoToAttentionSetting?: (name: string) => void;
}

export function OutputConsole({
  log,
  diagnostics,
  badges,
  metrics,
  open,
  onClose,
  className,
  friendlyError,
  lastPreviewKept = false,
  showReviewHidden = false,
  onReviewSettings,
  onReviewHiddenSettings,
  onRetryRender,
  attention = EMPTY_ATTENTION,
  onGoToAttentionSetting,
}: Props) {
  const [tab, setTab] = useState("notices");

  // Same fix as diagnostics.ts's `displayBadges` doc: a `subsumedByFont`
  // badge's count must not exceed what's actually visible. `attention`'s own
  // `kind: "notice"` items are the exact, already-correct (deriveAttention,
  // including its ambiguity guard) answer to "which notice categories have a
  // genuinely visible card this render" — reuse that instead of
  // re-deriving font-fallback state here.
  const visibleNoticeKeys = useMemo(
    () => new Set(attention.filter((a) => a.kind === "notice").map((a) => `notice:${a.marker}`)),
    [attention]
  );
  const noticeBadges = useMemo(() => displayBadges(badges, visibleNoticeKeys), [badges, visibleNoticeKeys]);

  // "Notices surface" directive: the plain-language cards for every notice
  // category NOT already covered by an AttentionItems card — see
  // diagnostics.ts's `noticeCards` for the badge-count ⇔ visible-card
  // guarantee this relies on.
  const cards = useMemo(() => noticeCards(diagnostics, badges), [diagnostics, badges]);

  // UX plan 5.1b: on mobile, a short console shrinks to a content-height
  // panel docked at the bottom instead of the full-screen modal AppShell
  // otherwise mounts it in (see this file's own header doc). `isMobile`
  // mirrors the same breakpoint the rest of the app lays out against
  // (useIsMobile); the desktop docked instance below the viewer is
  // unaffected either way since it's never full-screen to begin with.
  // "Short" is now judged by what's actually VISIBLE (attention cards +
  // plain notice cards), not the raw diagnostics count.
  const isMobile = useIsMobile();
  const compact =
    isMobile &&
    isCompactConsoleContent({
      hasFriendlyError: !!friendlyError,
      attentionCount: attention.length,
      noticeCardCount: cards.length,
    });

  if (!open) return null;

  return (
    <div
      className={cn(
        "output-console flex shrink-0 flex-col border-t bg-card",
        // Overrides the full-height sizing the mobile modal wrapper passes
        // via `className` (`h-full max-h-none`) with an inline `style`
        // below, which always wins over a class regardless of merge order
        // (src/lib/utils.ts's `cn` "last-wins" only applies within the class
        // list itself, never against an inline style).
        compact && "output-console--compact mt-auto rounded-t-2xl border-t shadow-lg",
        className
      )}
      style={compact ? { height: "auto", maxHeight: "60dvh" } : undefined}
      role="region"
      aria-label={t("console.regionAria")}
    >
      <Tabs value={tab} onValueChange={setTab} className="gap-0">
        <div className="flex shrink-0 items-stretch border-b">
          <TabsList className="h-auto rounded-none border-0 bg-transparent p-0">
            <TabsTrigger value="notices" className={cn(chipTabTrigger, "px-3")}>
              {t("console.notices")}
              <CountBadges badges={noticeBadges} />
            </TabsTrigger>
            <TabsTrigger value="log" className={cn(chipTabTrigger, "px-3")}>
              {t("console.log")}
            </TabsTrigger>
            <TabsTrigger value="metrics" className={cn(chipTabTrigger, "px-3")}>
              {t("console.metrics")}
            </TabsTrigger>
          </TabsList>
          <IconButton
            label={t("console.closeAria")}
            className="output-console__close my-1 ml-auto mr-[0.4rem] shrink-0 self-center"
            onClick={onClose}
          >
            <XIcon size={16} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="notices" className="mt-0">
            {friendlyError && (
              <FriendlyError
                error={friendlyError}
                lastPreviewKept={lastPreviewKept}
                showReviewHidden={showReviewHidden}
                onReviewSettings={() => onReviewSettings?.()}
                onReviewHiddenSettings={() => onReviewHiddenSettings?.()}
                onRetry={() => onRetryRender?.()}
              />
            )}
            <AttentionItems
              attention={attention}
              onGoToSetting={onGoToAttentionSetting}
              className="console-attention m-3"
            />
            {/* Plain-language notice cards — see this file's own header doc
                and diagnostics.ts's `noticeCards`. Same ⓘ icon/colour the
                raw list below uses (ICON/ICON_COLOR), just with a cleaned
                message and a category heading instead of raw echo text. */}
            {cards.length > 0 && (
              <ul className="notice-cards m-3 flex flex-col gap-2" aria-live="polite">
                {cards.map((c, i) => (
                  <li
                    key={`${c.marker}-${i}`}
                    className="notice-card flex items-start gap-2 rounded-(--radius-card) border px-3 py-2"
                  >
                    <span className="mt-[1px] shrink-0 text-brand" aria-hidden>
                      {ICON.notice}
                    </span>
                    <div className="flex min-w-0 flex-col gap-[0.15rem]">
                      <p className="m-0 text-[0.72rem] font-semibold text-muted-foreground uppercase tracking-wide">
                        {c.label}
                      </p>
                      <p className="m-0 text-[0.85rem] text-foreground">{c.text}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {diagnostics.length > 0 && (
              <details className="output-console__technical border-t px-3 py-2">
                <summary className="cursor-pointer select-none text-[0.82rem] text-muted-foreground">
                  {t("console.rawOutput")}
                </summary>
                <ul className="mt-[0.4rem]" aria-live="polite">
                  {diagnostics.map((d, i) => (
                    <li key={i} className="flex items-baseline gap-2 py-[0.2rem] text-[0.82rem]">
                      <span
                        className={cn("shrink-0", ICON_COLOR[d.level])}
                        aria-hidden
                        style={d.color ? { color: d.color } : undefined}
                      >
                        {ICON[d.level]}
                      </span>
                      <span className="text-foreground">{d.text}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {!friendlyError && attention.length === 0 && cards.length === 0 && diagnostics.length === 0 && (
              <p className="px-3 py-2 text-[0.85rem] text-muted-foreground">{t("console.emptyNotices")}</p>
            )}
          </TabsContent>
          <TabsContent value="log" className="mt-0">
            <pre className="log m-0 max-h-44 overflow-auto whitespace-pre-wrap bg-code px-4 py-[0.6rem] font-mono text-xs leading-[1.4] text-muted-foreground">
              {log.length ? log.join("\n") : t("console.emptyLog")}
            </pre>
          </TabsContent>
          <TabsContent value="metrics" className="mt-0">
            <div className="render-metrics px-3 py-[0.4rem] text-[0.82rem]">
              {!metrics.last ? (
                <p className="text-muted-foreground">{t("console.emptyMetrics")}</p>
              ) : (
                <dl className="m-0 flex flex-col gap-[0.3rem]">
                  <div className="flex gap-1">
                    <dt className="text-muted-foreground">{t("console.lastRender")}</dt>
                    <dd className="m-0 text-foreground">
                      {formatDuration(metrics.last.ms)}
                      {metrics.last.cached ? t("console.cachedSuffix") : ""}
                    </dd>
                  </div>
                  {metrics.slowest && (
                    <>
                      <div className="flex gap-1">
                        <dt className="text-muted-foreground">{t("console.slowestSession")}</dt>
                        <dd className="m-0 text-foreground">{formatDuration(metrics.slowest.ms)}</dd>
                      </div>
                      {metrics.slowest.changed.length > 0 && (
                        <div className="flex gap-1">
                          <dt className="text-muted-foreground">{t("console.changed")}</dt>
                          <dd className="m-0 text-foreground">{metrics.slowest.changed.join(", ")}</dd>
                        </div>
                      )}
                    </>
                  )}
                </dl>
              )}
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
