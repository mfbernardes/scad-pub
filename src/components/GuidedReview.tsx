// GuidedReview.tsx — automatic final check for the lightweight guided flow.
// It is entirely schema-driven: no deployment-specific labels or review maps.
import type { Design } from "../openscad/types";
import type { Values } from "../lib/presets";
import type { Dimensions } from "./Viewer";
import { reviewDimensions, reviewRows } from "../lib/reviewSummary";
import { AlertTriangle as AlertIcon, CheckCircle2 as ReadyIcon, LoaderCircle as LoadingIcon } from "lucide-react";

interface Props {
  design: Design;
  values: Values;
  presetName: string | null;
  measured: Dimensions | null;
  attentionIssues: string[];
  rendering: boolean;
  stalePreview: boolean;
  exportable: boolean;
}

export function GuidedReview({
  design,
  values,
  presetName,
  measured,
  attentionIssues,
  rendering,
  stalePreview,
  exportable,
}: Props) {
  const rows = reviewRows(design, values);
  const dimensions = reviewDimensions(measured);
  const needsUpdate = stalePreview || rendering || !exportable;
  const status = attentionIssues.length
    ? `${attentionIssues.length} ${attentionIssues.length === 1 ? "issue" : "issues"} to review`
    : needsUpdate
      ? "Preview is updating"
      : "Ready to download";
  const StatusIcon = attentionIssues.length ? AlertIcon : needsUpdate ? LoadingIcon : ReadyIcon;

  return (
    <div className="guided-review flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
      <div
        className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${attentionIssues.length ? "border-warn text-foreground" : "border-(color:--line) text-foreground"}`}
        role="status"
        aria-live="polite"
      >
        <StatusIcon className={`mt-0.5 size-4 shrink-0 ${attentionIssues.length ? "text-warn" : "text-brand"}`} aria-hidden="true" />
        <span>
          <strong className="font-semibold">{status}</strong>
          <span className="mt-0.5 block text-muted-foreground">
            Inspect the preview, then use the Download button beside it.
          </span>
        </span>
      </div>

      <section className="mb-3 rounded-lg border bg-background/50 p-3" aria-labelledby="guided-review-summary">
        <h3 id="guided-review-summary" className="font-display mb-2 text-sm font-semibold text-brand">
          Summary
        </h3>
        <dl className="space-y-2 text-sm">
          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">Design</dt>
            <dd className="m-0 text-right font-medium text-foreground">{design.label}</dd>
          </div>
          {presetName && (
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">Starting point</dt>
              <dd className="m-0 text-right text-foreground">{presetName}</dd>
            </div>
          )}
          {dimensions && (
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">Dimensions</dt>
              <dd className="m-0 text-right tabular-nums text-foreground">{dimensions}</dd>
            </div>
          )}
          {rows.map((row) => (
            <div className="flex items-start justify-between gap-3" key={row.name}>
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="m-0 max-w-[62%] break-words text-right text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {attentionIssues.length > 0 && (
        <section className="rounded-lg border border-warn p-3" aria-labelledby="guided-review-issues">
          <h3 id="guided-review-issues" className="font-display mb-2 text-sm font-semibold text-foreground">
            Check before downloading
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
            {attentionIssues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
