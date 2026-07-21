// OutputConsole.tsx — bottom drawer with Notices + Log tabs (shadcn/ui Tabs).
// Auto-opens when a render first surfaces a notice/assert; also toggled by the
// Output button. Diagnostics/badges are computed once by the parent (AppShell)
// and passed in.
import { useState } from "react";
import { type Diagnostic, type BadgeCount, type DiagnosticLevel } from "../lib/diagnostics";
import { type RenderMetrics, formatDuration } from "../lib/renderMetrics";
import type { FriendlyErrorInfo } from "../lib/friendlyErrors";
import { Tabs, TabsContent, TabsList, TabsTrigger, chipTabTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";
import { CountBadges } from "./CountBadges";
import { FriendlyFailureCard } from "./FriendlyFailureCard";
import { IconButton } from "./IconButton";
import { X as XIcon } from "lucide-react";
import { t } from "../lib/i18n";

const ICON: Record<DiagnosticLevel, string> = { notice: "ⓘ", warning: "⚠", assert: "✗" };
/* The ⓘ/⚠/✗ glyph colour per diagnostic level (config categories may override
   per-notice via inline style). An assert reads as an error, matching the
   destructive count chip CountBadges already gives it on the console tab. */
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
  /** friendlyRenderError(result) — when set, the Notices tab leads with this
   *  {title, body} instead of the raw diagnostics list, with the technical
   *  tail tucked into a collapsed "Raw output" details block (the Log tab
   *  stays raw either way). Null on a missing/successful result. */
  failure?: FriendlyErrorInfo | null;
  /** Layout-specific sizing/positioning (desktop band vs mobile overlay). */
  className?: string;
}

export function OutputConsole({ log, diagnostics, badges, metrics, open, onClose, failure, className }: Props) {
  const [tab, setTab] = useState("notices");

  if (!open) return null;

  return (
    <div
      className={cn("output-console flex shrink-0 flex-col border-t bg-card", className)}
      role="region"
      aria-label={t("console.title")}
    >
      <Tabs value={tab} onValueChange={setTab} className="gap-0">
        <div className="flex shrink-0 items-center border-b">
          <span className="output-console__title self-center pl-3 pr-1 font-display text-[0.8rem] font-semibold text-foreground">
            {t("console.title")}
          </span>
          <TabsList className="h-auto rounded-none border-0 bg-transparent p-0">
            <TabsTrigger value="notices" className={cn(chipTabTrigger, "px-3")}>
              Notices
              <CountBadges badges={badges} />
            </TabsTrigger>
            <TabsTrigger value="log" className={cn(chipTabTrigger, "px-3")}>
              Log
            </TabsTrigger>
            <TabsTrigger value="metrics" className={cn(chipTabTrigger, "px-3")}>
              Metrics
            </TabsTrigger>
          </TabsList>
          <IconButton
            label="Close Messages"
            className="output-console__close my-1 ml-auto mr-[0.4rem] shrink-0 self-center"
            onClick={onClose}
          >
            <XIcon size={16} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="notices" className="mt-0">
            {failure ? (
              <div className="px-3 py-[0.5rem]">
                <FriendlyFailureCard info={failure} />
              </div>
            ) : diagnostics.length ? (
              <ul className="px-3 py-[0.4rem]" aria-live="polite">
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
              <p className="px-3 py-2 text-[0.85rem] text-muted-foreground">No notices or warnings.</p>
            )}
          </TabsContent>
          <TabsContent value="log" className="mt-0">
            <pre className="log m-0 max-h-44 overflow-auto whitespace-pre-wrap bg-code px-4 py-[0.6rem] font-mono text-xs leading-[1.4] text-muted-foreground">
              {log.length ? log.join("\n") : "(no output yet)"}
            </pre>
          </TabsContent>
          <TabsContent value="metrics" className="mt-0">
            <div className="render-metrics px-3 py-[0.4rem] text-[0.82rem]">
              {!metrics.last ? (
                <p className="text-muted-foreground">No renders yet.</p>
              ) : (
                <dl className="m-0 flex flex-col gap-[0.3rem]">
                  <div className="flex gap-1">
                    <dt className="text-muted-foreground">Last render:</dt>
                    <dd className="m-0 text-foreground">
                      {formatDuration(metrics.last.ms)}
                      {metrics.last.cached ? " (cached)" : ""}
                    </dd>
                  </div>
                  {metrics.slowest && (
                    <>
                      <div className="flex gap-1">
                        <dt className="text-muted-foreground">Slowest this session:</dt>
                        <dd className="m-0 text-foreground">{formatDuration(metrics.slowest.ms)}</dd>
                      </div>
                      {metrics.slowest.changed.length > 0 && (
                        <div className="flex gap-1">
                          <dt className="text-muted-foreground">Changed:</dt>
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
