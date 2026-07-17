// OutputConsole.tsx — bottom drawer with Notices + Log tabs (shadcn/ui Tabs).
// Auto-opens when a render first surfaces a notice/assert; also toggled by the
// Output button. Diagnostics/badges are computed once by the parent (AppShell)
// and passed in.
//
// PR22 item 4: the Notices tab leads with the same friendly attention cards
// (AttentionItems.tsx) the Customize tab's consolidated chip and QuickStart's
// Review stage show — a visitor who opens Messages directly (the bell badge)
// gets the readable summary too, not just raw parsed lines. Mirrors how
// FriendlyError already leads on a render FAILURE; both can appear together
// (failure leads, attention cards next, then the raw list) — never suppressed
// or pattern-matched against each other, since the raw rows are the generic
// mechanism and stay authoritative.
import { useRef, useState } from "react";
import { type Diagnostic, type BadgeCount, type DiagnosticLevel } from "../lib/diagnostics";
import { type RenderMetrics, formatDuration } from "../lib/renderMetrics";
import type { FriendlyErrorInfo } from "../lib/friendlyErrors";
import type { AttentionItem } from "../lib/readiness";
import { t } from "../lib/i18n";
import { Tabs, TabsContent, TabsList, TabsTrigger, chipTabTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";
import { CountBadges } from "./CountBadges";
import { IconButton } from "./IconButton";
import { FriendlyError } from "./FriendlyError";
import { AttentionItems } from "./AttentionItems";
import { noteActionClass } from "./NoteBar";
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

// Stable default identities (mirrors AppShell's own EMPTY_LOG / QuickStart's
// EMPTY_ATTENTION_ITEMS precedent) so an omitted `attention`/
// `onGoToAttentionSetting` never hands AttentionItems a freshly-allocated
// value on every render.
const EMPTY_ATTENTION: AttentionItem[] = [];
const NOOP_GO_TO_SETTING = () => {};

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
  /** PR22: unresolved production-readiness gaps for the current render —
   *  the exact same list the Customize tab's attention chip shows, rendered
   *  here as friendly cards leading the raw diagnostics list. Empty/omitted
   *  renders nothing extra (AttentionItems itself no-ops on an empty list). */
  attention?: AttentionItem[];
  /** A font-fallback card's "Go to setting" action: closes Messages, switches
   *  to the Customize tab, and focuses the named param's control (AppShell's
   *  `handleGoToAttentionSetting`). */
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
  // A notice-kind attention card's "Open Messages" action, reused here for
  // "already IN Messages — jump to the matching raw row below" instead
  // (AttentionItems' own onOpenMessages prop is generic about what "opening"
  // means to its caller).
  const rawListRef = useRef<HTMLUListElement>(null);
  const scrollToRawList = () => rawListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  if (!open) return null;

  return (
    <div
      className={cn("output-console flex shrink-0 flex-col border-t bg-card", className)}
      role="region"
      aria-label={t("console.regionAria")}
    >
      <Tabs value={tab} onValueChange={setTab} className="gap-0">
        <div className="flex shrink-0 items-stretch border-b">
          <TabsList className="h-auto rounded-none border-0 bg-transparent p-0">
            <TabsTrigger value="notices" className={cn(chipTabTrigger, "px-3")}>
              {t("console.notices")}
              <CountBadges badges={badges} />
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
              onGoToSetting={onGoToAttentionSetting ?? NOOP_GO_TO_SETTING}
              onOpenMessages={scrollToRawList}
              className="console-attention flex flex-col gap-1 border-b bg-muted px-3 py-2"
              itemClassName="console-attention__item flex flex-wrap items-center gap-x-[0.4rem] gap-y-1 text-left text-[0.82rem] text-foreground"
              actionClassName={noteActionClass}
              showSummary
              summaryClassName="text-[0.82rem] font-semibold text-foreground"
            />
            {diagnostics.length ? (
              <ul className="px-3 py-[0.4rem]" aria-live="polite" ref={rawListRef}>
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
            ) : (
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
