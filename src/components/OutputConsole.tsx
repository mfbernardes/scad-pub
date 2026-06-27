// OutputConsole.tsx — bottom drawer with Notices + Log tabs (shadcn/ui Tabs).
// Opened via the AdvisoryBadge or the Output button. Diagnostics/badges are
// computed once by the parent (AppShell) and passed in.
import { useState, type CSSProperties } from "react";
import { type Diagnostic, type BadgeCount, type DiagnosticLevel } from "../lib/diagnostics";
import { Tabs, TabsContent, TabsList, TabsTrigger, underlineTabTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";
import { CountBadges } from "./CountBadges";
import { IconButton } from "./IconButton";
import { XIcon } from "./Icons";

const ICON: Record<DiagnosticLevel, string> = { notice: "ⓘ", warning: "⚠", assert: "✗" };

interface Props {
  log: string[];
  diagnostics: Diagnostic[];
  badges: BadgeCount[];
  open: boolean;
  onClose: () => void;
  /** Inline positioning (mobile sits it just above the bottom sheet). */
  style?: CSSProperties;
}

export function OutputConsole({ log, diagnostics, badges, open, onClose, style }: Props) {
  const [tab, setTab] = useState("advisories");

  if (!open) return null;

  return (
    <div className="output-console" role="region" aria-label="OpenSCAD output" style={style}>
      <Tabs value={tab} onValueChange={setTab} className="gap-0">
        <div className="output-console__header">
          <TabsList className="h-auto rounded-none border-0 bg-transparent p-0">
            <TabsTrigger value="advisories" className={cn(underlineTabTrigger, "px-3")}>
              Notices
              <CountBadges badges={badges} />
            </TabsTrigger>
            <TabsTrigger value="log" className={cn(underlineTabTrigger, "px-3")}>
              Log
            </TabsTrigger>
          </TabsList>
          <IconButton label="Close output console" className="output-console__close" onClick={onClose}>
            <XIcon size={16} />
          </IconButton>
        </div>
        <div className="output-console__body">
          <TabsContent value="advisories" className="mt-0">
            {diagnostics.length ? (
              <ul className="output-console__diag-list" aria-live="polite">
                {diagnostics.map((d, i) => (
                  <li key={i} className={`diag diag-${d.level}`}>
                    <span className="diag-icon" aria-hidden style={d.color ? { color: d.color } : undefined}>
                      {ICON[d.level]}
                    </span>
                    <span className="diag-text">{d.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="output-console__empty">No notices or warnings.</p>
            )}
          </TabsContent>
          <TabsContent value="log" className="mt-0">
            <pre className="log">{log.length ? log.join("\n") : "(no output yet)"}</pre>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
