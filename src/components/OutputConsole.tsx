// OutputConsole.tsx: bottom drawer with Notices + Log tabs (shadcn/ui Tabs).
// Auto-opens when a render first surfaces a notice/assert; also toggled by the
// Output button. Diagnostics/badges are computed once by the parent (AppShell)
// and passed in. The active tab is owned by useOutputConsole.ts, not a local
// `useState` here: this component unmounts on close, so a local tab state
// would forget which tab was active every time the console reopens.
import { type Diagnostic, type BadgeCount, type DiagnosticLevel, badgeTextColor } from "../lib/diagnostics";
import { type RenderMetrics, formatDuration } from "../lib/renderMetrics";
import type { FriendlyErrorInfo } from "../lib/friendlyErrors";
import { Tabs, TabsContent, TabsList, TabsTrigger, chipTabTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
import { FriendlyFailureCard } from "./FriendlyFailureCard";
import { IconButton } from "./IconButton";
import { X as XIcon } from "lucide-react";
import { t, formatList } from "../lib/i18n";
import { useLocale } from "../lib/localeStore";

const ICON: Record<DiagnosticLevel, string> = { notice: "ⓘ", warning: "⚠", assert: "✗" };
/* The ⓘ/⚠/✗ glyph colour per diagnostic level (config categories may override
   per-notice via inline style). An assert reads as an error, matching the
   destructive tint the tab's own count pill gets when an assert contributes
   to it (see noticeTotal/hasAssert below). */
const ICON_COLOR: Record<DiagnosticLevel, string> = {
  notice: "text-brand",
  warning: "text-warn",
  assert: "text-destructive",
};

interface Props {
  log: string[];
  diagnostics: Diagnostic[];
  badges: BadgeCount[];
  /** Local-only render performance telemetry (see lib/renderMetrics.ts). */
  metrics: RenderMetrics;
  open: boolean;
  onClose: () => void;
  /** The active tab ("notices" | "log" | "metrics"), lifted to
   *  useOutputConsole.ts so it survives close/reopen. */
  tab: string;
  onTabChange: (tab: string) => void;
  /** friendlyRenderError(result): when set, the Notices tab leads with this
   *  {title, body} instead of the raw diagnostics list, with the technical
   *  tail tucked into a collapsed "Raw output" details block (the Log tab
   *  stays raw either way). Null on a missing/successful result. */
  failure?: FriendlyErrorInfo | null;
  /** Layout-specific sizing/positioning (desktop band vs mobile overlay). */
  className?: string;
}

export function OutputConsole({
  log,
  diagnostics,
  badges,
  metrics,
  open,
  onClose,
  tab,
  onTabChange,
  failure,
  className,
}: Props) {
  useLocale(); // subscription only: re-render this component's t() calls on a locale switch
  if (!open) return null;

  // One pill on the Notices tab, not one per category (a `fontnote` advisory
  // alongside an `advisory` marker used to render as two adjacent "1"s,
  // reading as a typo rather than "2 things"). Destructive wins over warn
  // over neutral, matching CountBadges' old per-badge variant choice; a
  // category colour override only survives the sum when it's the only
  // category actually contributing to the count, since a mixed sum has no
  // single colour to speak for it.
  const noticeTotal = badges.reduce((sum, b) => sum + b.count, 0);
  const contributing = badges.filter((b) => b.count > 0);
  const hasAssert = contributing.some((b) => b.key === "assert");
  const anyAttention = contributing.some((b) => b.attention);
  const soleColor = contributing.length === 1 ? contributing[0].color : undefined;

  return (
    <div
      className={cn("output-console flex shrink-0 flex-col border-t bg-card", className)}
      role="region"
      aria-label={t("console.title")}
    >
      <Tabs value={tab} onValueChange={onTabChange} className="gap-0">
        {/* The close button must survive a narrow viewport. At 320px the
            title + three tabs measured 355px against a 320px row, and since
            nothing here could shrink, `ml-auto` pushed Close clean off the
            right edge: leaving no way to dismiss the console on the smallest
            phones. Two changes fix it and keep every tab reachable: the title
            (redundant: the region carries the same accessible name, and the
            bell that opens this says "Messages") drops out below 360px, and
            the tab strip may shrink and scroll rather than forcing the row
            wider than its container. Close itself stays `shrink-0`. */}
        <div className="flex shrink-0 items-center border-b">
          <span className="output-console__title self-center pl-3 pr-1 font-display text-[0.8rem] font-semibold text-foreground max-[359px]:hidden">
            {t("console.title")}
          </span>
          <TabsList className="h-auto min-w-0 shrink overflow-x-auto rounded-none border-0 bg-transparent p-0">
            {/* Summing the categories costs the reader WHICH ones the number
                is made of, and the count chip is a bare numeral by design.
                The per-category nouns countBadges already resolves (plural
                form included) go in the trigger's title, so the breakdown is
                one hover away instead of gone. */}
            <TabsTrigger
              value="notices"
              className={cn(chipTabTrigger, "px-3")}
              title={contributing.length > 1 ? contributing.map((b) => `${b.count} ${b.label}`).join(", ") : undefined}
            >
              {t("console.notices")}
              {noticeTotal > 0 && (
                <Badge
                  variant={hasAssert ? "destructive" : anyAttention ? "warn" : "secondary"}
                  className={cn("px-2 min-w-5 justify-center", hasAssert && "badge-assert")}
                  style={soleColor ? { background: soleColor, color: badgeTextColor(soleColor) } : undefined}
                >
                  {noticeTotal}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="log" className={cn(chipTabTrigger, "px-3")}>
              {t("console.log")}
            </TabsTrigger>
            <TabsTrigger value="metrics" className={cn(chipTabTrigger, "px-3")}>
              {t("console.metrics")}
            </TabsTrigger>
          </TabsList>
          <IconButton
            label={t("console.close")}
            className="output-console__close my-1 ml-auto mr-[0.4rem] shrink-0 self-center"
            onClick={onClose}
          >
            <XIcon size={16} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <TabsContent value="notices" className="mt-0">
            {failure ? (
              <div className="px-3 py-[0.5rem]">
                <FriendlyFailureCard info={failure} />
              </div>
            ) : diagnostics.length ? (
              // No aria-live here: OutputToggle's own persistent live region
              // (always mounted, unlike this list) already announces a rise
              // in the notice count.
              <ul className="px-3 py-[0.4rem]">
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
              <p className="px-3 py-2 text-[0.85rem] text-muted-foreground">{t("console.noNotices")}</p>
            )}
          </TabsContent>
          <TabsContent value="log" className="mt-0">
            <pre className="log m-0 max-h-44 overflow-auto overscroll-contain whitespace-pre-wrap bg-code px-4 py-[0.6rem] font-mono text-xs leading-[1.4] text-muted-foreground">
              {log.length ? log.join("\n") : t("console.noOutput")}
            </pre>
          </TabsContent>
          <TabsContent value="metrics" className="mt-0">
            <div className="render-metrics px-3 py-[0.4rem] text-[0.82rem]">
              {!metrics.last ? (
                <p className="text-muted-foreground">{t("metrics.noRenders")}</p>
              ) : (
                <dl className="m-0 flex flex-col gap-[0.3rem]">
                  <div className="flex gap-1">
                    <dt className="text-muted-foreground">{t("metrics.lastRender")}</dt>
                    <dd className="m-0 text-foreground">
                      {metrics.last.cached
                        ? t("metrics.cachedDuration", { duration: formatDuration(metrics.last.ms) })
                        : formatDuration(metrics.last.ms)}
                    </dd>
                  </div>
                  {metrics.slowest && (
                    <>
                      <div className="flex gap-1">
                        <dt className="text-muted-foreground">{t("metrics.slowest")}</dt>
                        <dd className="m-0 text-foreground">{formatDuration(metrics.slowest.ms)}</dd>
                      </div>
                      {metrics.slowest.changed.length > 0 && (
                        <div className="flex gap-1">
                          <dt className="text-muted-foreground">{t("metrics.changed")}</dt>
                          <dd className="m-0 text-foreground">{formatList(metrics.slowest.changed)}</dd>
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
