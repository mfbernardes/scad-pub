// SvgWizard.tsx — the in-app "Prepare SVG" wizard. Walks a dropped/loaded SVG
// through check → fix → colours using the generic engine in src/lib/svgPrep,
// then hands the host a fixed SVG plus (when the field binds colours) a derived
// layers string. The configurator's own 3D viewer is the preview — this dialog
// only reports what it checked, fixed and derived.
import { useMemo, useState } from "react";
import {
  check,
  isRenderableColor,
  MAX_RELIABLE_REGIONS,
  parseSvg,
  prepareSvg,
  type Finding,
  type Region,
} from "../lib/svgPrep";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

/** The wizard's plain-value output; the host applies it to the parameters. */
export interface SvgWizardResult {
  /** The fixed, serialised SVG. */
  svg: string;
  /** The derived layers string (possibly "") when colours are bound, else null. */
  layers: string | null;
}

interface Props {
  /** SVG text from the dropped / uploaded file. */
  svgText: string;
  /** The file's name, reused for the prepared file. */
  fileName: string;
  /** True iff the field carries a `layers=` binding (derive per-region colours). */
  deriveColours: boolean;
  onCancel: () => void;
  onComplete: (result: SvgWizardResult) => void;
}

const LEVEL_BADGE: Record<Finding["level"], "destructive" | "warn" | "secondary"> = {
  ERROR: "destructive",
  WARN: "warn",
  INFO: "secondary",
};

// Blocking problems first, then warnings, then informational notes.
const LEVEL_ORDER: Record<Finding["level"], number> = { ERROR: 0, WARN: 1, INFO: 2 };

function FindingList({ findings, empty }: { findings: Finding[]; empty: string }) {
  if (findings.length === 0)
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  const sorted = [...findings].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return (
    <ul className="flex flex-col gap-2">
      {sorted.map((f, i) => (
        <li key={`${f.code}-${i}`} className="flex gap-2 text-sm leading-[1.4]">
          <Badge variant={LEVEL_BADGE[f.level]} className="mt-[1px] shrink-0">
            {f.level}
          </Badge>
          <span className="min-w-0">
            <span className="text-foreground">{f.message}</span>
            {f.hint && <span className="block text-muted-foreground">{f.hint}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Steps: 1 = check, 2 = fix, 3 = colours (only when deriveColours).
type Step = 1 | 2 | 3;

const STEP_NAMES: Record<Step, string> = { 1: "Check", 2: "Fix", 3: "Colours" };

export function SvgWizard({ svgText, fileName, deriveColours, onCancel, onComplete }: Props) {
  // Parse once. A parse failure is a terminal state with a retry via cancel.
  const parsed = useMemo(() => {
    try {
      const root = parseSvg(svgText);
      return { root, error: null as string | null, before: check(root) };
    } catch (e) {
      return { root: null, error: (e as Error).message, before: [] as Finding[] };
    }
  }, [svgText]);

  const [step, setStep] = useState<Step>(1);
  // Populated when leaving the check step: the fixed/serialised SVG plus the
  // changes, residual findings and regions the wizard reports (`parsed.root` is
  // mutated in place by prepareSvg).
  const [fixed, setFixed] = useState<{
    svg: string;
    changes: string[];
    findings: Finding[];
    regions: Region[];
  } | null>(null);
  const [layers, setLayers] = useState("");

  const lastStep: Step = deriveColours ? 3 : 2;
  // Residual ERROR findings (e.g. no importable geometry) mean the drawing can't
  // be imported as-is, so block advancing past the check step and completing.
  const blockedByError = (fixed?.findings ?? []).some((f) => f.level === "ERROR");

  const applyAndAdvance = () => {
    // The engine's one-call host contract: fix, (optionally) derive colours,
    // re-check, and serialise — the same result the host applies on finish.
    const res = prepareSvg(parsed.root!, { deriveColours });
    setFixed({ svg: res.svg, changes: res.changes, findings: res.findings, regions: res.regions });
    setLayers(res.layers ?? "");
    setStep(2);
  };

  const finish = () => {
    if (blockedByError) return;
    onComplete({
      svg: fixed!.svg,
      layers: deriveColours ? layers.trim() : null,
    });
  };

  const close = (open: boolean) => {
    if (!open) onCancel();
  };

  return (
    <Dialog open onOpenChange={close}>
      <DialogContent className="max-w-[34rem]">
        <DialogHeader>
          <DialogTitle>Prepare SVG</DialogTitle>
          <DialogDescription>
            {parsed.error
              ? "This file could not be read as an SVG."
              : `Step ${step} of ${lastStep}: ${STEP_NAMES[step]} · ${fileName}`}
          </DialogDescription>
        </DialogHeader>

        {parsed.error ? (
          <p className="svg-wizard__error text-sm text-destructive">{parsed.error}</p>
        ) : (
          <div className="max-h-[55vh] overflow-y-auto pr-1">
            {step === 1 && (
              <section className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  Only shapes are raised into relief — text, colours and a few other
                  things aren't. Here's what to expect from this drawing:
                </p>
                <FindingList
                  findings={parsed.before}
                  empty="No problems found — this drawing is ready to use."
                />
              </section>
            )}

            {step === 2 && fixed && (
              <section className="flex flex-col gap-3">
                <div>
                  <h3 className="mb-1 font-display text-sm font-semibold text-foreground">
                    Fixes applied
                  </h3>
                  {fixed.changes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nothing needed changing.
                    </p>
                  ) : (
                    <ul className="list-disc pl-5 text-sm text-foreground">
                      {fixed.changes.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="mb-1 font-display text-sm font-semibold text-foreground">
                    Remaining notes
                  </h3>
                  <FindingList
                    findings={fixed.findings}
                    empty="No problems remain — this drawing is ready to use."
                  />
                </div>
              </section>
            )}

            {step === 3 && fixed && (
              <section className="flex flex-col gap-3">
                {fixed.regions.length >= 2 ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Found {fixed.regions.length} colour regions. Each keeps its own
                      colour on export:
                    </p>
                    <ul className="flex flex-col gap-1 text-sm">
                      {fixed.regions.map((r) => {
                        const showable = isRenderableColor(r.color);
                        return (
                          <li key={r.id} className="flex items-center gap-2">
                            {showable ? (
                              <span
                                className="inline-block size-3 shrink-0 rounded-[3px] border"
                                style={{ background: r.color }}
                                aria-hidden="true"
                              />
                            ) : (
                              <span
                                className="inline-flex size-3 shrink-0 items-center justify-center rounded-[3px] border border-dashed text-[0.6rem] leading-none text-muted-foreground"
                                aria-hidden="true"
                              >
                                ?
                              </span>
                            )}
                            <code className="font-mono text-[0.8rem]">{r.id}</code>
                            <span className="text-muted-foreground">
                              {r.color}
                              {r.count > 0 && ` · ${r.count} shape(s)`}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {fixed.regions.some((r) => !isRenderableColor(r.color)) && (
                      <p className="text-[0.78rem] text-muted-foreground">
                        Colours marked <span aria-hidden="true">?</span> can't be
                        previewed here, but are still applied — check them when you print.
                      </p>
                    )}
                    {fixed.regions.length > MAX_RELIABLE_REGIONS && (
                      <p className="text-sm text-warn">
                        {fixed.regions.length} regions is a lot: a few large colour
                        regions print reliably, but many small ones can merge or print
                        unpredictably. Consider fewer, larger regions.
                      </p>
                    )}
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">
                        Region colours (editable):
                      </span>
                      <Input
                        value={layers}
                        aria-label="Region colours"
                        onChange={(e) => setLayers(e.target.value)}
                      />
                    </label>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This drawing has a single colour, so it comes out as one solid — no
                    per-region colours to set.
                  </p>
                )}
              </section>
            )}

            {blockedByError && (
              <p className="mt-3 text-sm font-medium text-destructive">
                This drawing can't be used as-is — resolve the errors above (e.g. add some
                filled shapes), then try again.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {parsed.error ? (
            <Button variant="outline" onClick={onCancel}>
              Choose another file
            </Button>
          ) : (
            <div className="flex w-full items-center justify-between gap-2">
              <Button
                variant="ghost"
                onClick={() => (step === 1 ? onCancel() : setStep((step - 1) as Step))}
              >
                {step === 1 ? "Cancel" : "Back"}
              </Button>
              {step < lastStep ? (
                <Button
                  onClick={step === 1 ? applyAndAdvance : () => setStep((step + 1) as Step)}
                  disabled={step !== 1 && blockedByError}
                >
                  {step === 1 ? "Fix & continue" : "Next"}
                </Button>
              ) : (
                <Button onClick={finish} disabled={blockedByError}>
                  Use this SVG
                </Button>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
