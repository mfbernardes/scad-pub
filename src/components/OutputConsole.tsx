// OutputConsole.tsx — bottom drawer with Notices + Log tabs (shadcn/ui Tabs).
// Auto-opens when a render first surfaces a notice/assert; also toggled by the
// Output button. Diagnostics/badges are computed once by the parent (AppShell)
// and passed in.
import { useState } from "react";
import { type Diagnostic, type BadgeCount, type DiagnosticLevel } from "../lib/diagnostics";
import { Tabs, TabsContent, TabsList, TabsTrigger, chipTabTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";
import { CountBadges } from "./CountBadges";
import { IconButton } from "./IconButton";
import { X as XIcon } from "lucide-react";

const ICON: Record<DiagnosticLevel, string> = { notice: "ⓘ", warning: "⚠", assert: "✗" };
/* The ⓘ/⚠/✗ glyph colour per diagnostic level (config categories may override
   per-notice via inline style). */
const ICON_COLOR: Record<DiagnosticLevel, string> = {
  notice: "text-brand",
  warning: "text-warn",
  assert: "text-warn",
};

interface Props {
  log: string[];
  diagnostics: Diagnostic[];
  badges: BadgeCount[];
  open: boolean;
  onClose: () => void;
  /** Layout-specific sizing/positioning (desktop band vs mobile overlay). */
  className?: string;
}

export function OutputConsole({ log, diagnostics, badges, open, onClose, className }: Props) {
  const [tab, setTab] = useState("notices");

  if (!open) return null;

  return (
    <div
      className={cn("output-console flex shrink-0 flex-col border-t bg-card", className)}
      role="region"
      aria-label="OpenSCAD output"
    >
      <Tabs value={tab} onValueChange={setTab} className="gap-0">
        <div className="flex shrink-0 items-stretch border-b">
          <TabsList className="h-auto rounded-none border-0 bg-transparent p-0">
            <TabsTrigger value="notices" className={cn(chipTabTrigger, "px-3")}>
              Notices
              <CountBadges badges={badges} />
            </TabsTrigger>
            <TabsTrigger value="log" className={cn(chipTabTrigger, "px-3")}>
              Log
            </TabsTrigger>
          </TabsList>
          <IconButton
            label="Close output console"
            className="output-console__close my-1 ml-auto mr-[0.4rem] shrink-0 self-center"
            onClick={onClose}
          >
            <XIcon size={16} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="notices" className="mt-0">
            {diagnostics.length ? (
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
        </div>
      </Tabs>
    </div>
  );
}
