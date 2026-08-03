// SvgWizard.tsx: the in-app "Prepare SVG" wizard. Walks a dropped/loaded SVG
// through check → fix → colours using the generic engine in src/lib/svgPrep,
// then hands the host a fixed SVG plus (when the field binds colours) a derived
// layers string. The configurator's own 3D viewer is the preview: this dialog
// only reports what it checked, fixed and derived.
import { useMemo, useRef, useState } from "react";
import {
  check,
  formatLayerSpec,
  isRenderableColor,
  parseLayerSpec,
  parseSvg,
  unusableHeightRegions,
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
import { useScrollFocusedIntoView } from "../lib/useScrollFocusedIntoView";
import { useReturnFocus } from "../lib/useReturnFocus";

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
  /**
   * The design's own relief height (from the field's `height=` binding), shown as
   * the placeholder each per-region height falls back to. Null when the field
   * binds none, in which case the heights are still editable, but without a
   * number to show.
   */
  defaultHeight?: number | null;
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

export function SvgWizard({
  svgText,
  fileName,
  deriveColours,
  defaultHeight = null,
  onCancel,
  onComplete,
}: Props) {
  // Mounted only while open, like Modal's callers, so Radix cannot restore
  // focus on its own.
  useReturnFocus();

  // Parse once. A parse failure is a terminal state with a retry via cancel.
  const parsed = useMemo(() => {
    try {
      const root = parseSvg(svgText);
      return { root, error: null as string | null, before: check(root) };
    } catch (e) {
      return { root: null, error: (e as Error).message, before: [] as Finding[] };
    }
  }, [svgText]);

  // The scroll area, so a focused field (step 3's editable region colours) is
  // kept clear of the on-screen keyboard on touch devices.
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollFocusedIntoView(scrollRef);

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
  // A preparation failure the drawing itself caused (formatLayerSpec refusing a
  // region id or colour that would corrupt the spec). Terminal like a parse
  // failure, with the same retry via cancel.
  const [prepError, setPrepError] = useState<string | null>(null);
  // Set once the visitor changes the layers string themselves (a per-region
  // height, or a hand edit of the field), so a re-fix doesn't overwrite it.
  const layersEditedRef = useRef(false);

  const lastStep: Step = deriveColours ? 3 : 2;
  const terminalError = parsed.error ?? prepError;
  // Residual ERROR findings (e.g. no importable geometry) mean the drawing can't
  // be imported as-is, so block advancing past the check step and completing.
  const blockedByError = (fixed?.findings ?? []).some((f) => f.level === "ERROR");

  const applyAndAdvance = () => {
    // The engine's one-call host contract: fix, (optionally) derive colours,
    // re-check, and serialise. The same result the host applies on finish.
    //
    // From a FRESH parse of the original text, not `parsed.root`: prepareSvg
    // mutates its argument in place, so Back → "Fix & continue" again re-fixed
    // an already-fixed drawing — a second viewBox-translate wrapper around the
    // first, colour regions grouped inside colour regions — and reported the
    // changes as though they were new.
    let res;
    try {
      res = prepareSvg(parseSvg(svgText), { deriveColours });
    } catch (e) {
      setPrepError((e as Error).message);
      return;
    }
    setFixed({ svg: res.svg, changes: res.changes, findings: res.findings, regions: res.regions });
    // A hand-edited layers string survives the round trip. Re-deriving would
    // silently discard per-region heights the visitor had already typed, which
    // is the whole reason they went Back.
    if (!layersEditedRef.current) setLayers(res.layers ?? "");
    setStep(2);
  };

  // The layers string stays the single source of truth: the per-region height
  // fields read their value out of it and write an edited one back, so a
  // hand-edit of the string below is never silently overwritten.
  const spec = parseLayerSpec(layers);
  // A height a design's own parser can't use is caught here rather than at
  // render time: the number input happily accepts 0, -2 and 1e3, and a design
  // hard-fails on those instead of falling back to its relief height.
  const badHeights = new Set(deriveColours ? unusableHeightRegions(layers) : []);
  const blockedByHeight = badHeights.size > 0;

  const finish = () => {
    if (blockedByError || blockedByHeight) return;
    onComplete({
      svg: fixed!.svg,
      layers: deriveColours ? layers.trim() : null,
    });
  };

  const close = (open: boolean) => {
    if (!open) onCancel();
  };

  const heightOf = (id: string) => spec.entries.find((e) => e.id === id)?.height ?? "";
  const setHeight = (id: string, height: string) => {
    layersEditedRef.current = true;
    setLayers(
      formatLayerSpec(
        spec.canvas,
        spec.entries.map((e) => (e.id === id ? { ...e, height: height.trim() } : e)),
      ),
    );
  };

  return (
    <Dialog open onOpenChange={close}>
      <DialogContent className="max-w-[34rem]">
        <DialogHeader>
          <DialogTitle>Prepare SVG</DialogTitle>
          <DialogDescription>
            {parsed.error
              ? "This file could not be read as an SVG."
              : prepError
                ? "This drawing could not be prepared."
                : `Step ${step} of ${lastStep}: ${STEP_NAMES[step]} · ${fileName}`}
          </DialogDescription>
        </DialogHeader>

        {terminalError ? (
          <p className="svg-wizard__error text-sm text-destructive">{terminalError}</p>
        ) : (
          <div ref={scrollRef} className="max-h-[55vh] overflow-y-auto overscroll-contain pr-1">
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
                      colour on export, and can stand at its own height:
                    </p>
                    <ul className="flex flex-col gap-1 text-sm">
                      {fixed.regions.map((r) => {
                        const showable = isRenderableColor(r.color);
                        return (
                          <li key={r.id} className="svg-wizard__region flex items-center gap-2">
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
                            <code className="min-w-0 truncate font-mono text-[0.8rem]">{r.id}</code>
                            <span className="min-w-0 truncate text-muted-foreground">
                              {r.color}
                              {r.count > 0 && ` · ${r.count} shape(s)`}
                            </span>
                            <span className="ml-auto flex shrink-0 items-center gap-1">
                              <Input
                                type="number"
                                min={0}
                                step={0.1}
                                inputMode="decimal"
                                className={`h-7 w-20 text-right ${
                                  badHeights.has(r.id) ? "border-destructive" : ""
                                }`}
                                value={heightOf(r.id)}
                                placeholder={defaultHeight === null ? "" : String(defaultHeight)}
                                aria-label={`Height of region ${r.id} in millimetres`}
                                aria-invalid={badHeights.has(r.id) || undefined}
                                onChange={(e) => setHeight(r.id, e.target.value)}
                              />
                              <span className="text-muted-foreground">mm</span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="text-[0.78rem] text-muted-foreground">
                      {defaultHeight === null
                        ? "Leave a height blank to raise that region by the design's relief height."
                        : `Leave a height blank to raise that region by the design's relief height (${defaultHeight} mm).`}
                    </p>
                    {fixed.regions.some((r) => !isRenderableColor(r.color)) && (
                      <p className="text-[0.78rem] text-muted-foreground">
                        Colours marked <span aria-hidden="true">?</span> can't be
                        previewed here, but are still applied — check them when you print.
                      </p>
                    )}
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">
                        Region colours and heights (editable):
                      </span>
                      <Input
                        value={layers}
                        aria-label="Region colours and heights"
                        onChange={(e) => {
                          layersEditedRef.current = true;
                          setLayers(e.target.value);
                        }}
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

            {blockedByHeight && !blockedByError && (
              <p className="svg-wizard__height-error mt-3 text-sm font-medium text-destructive">
                {badHeights.size === 1
                  ? `The height for “${[...badHeights][0]}” isn't usable — `
                  : `The heights for ${[...badHeights].map((id) => `“${id}”`).join(", ")} aren't usable — `}
                enter a plain positive number of millimetres (like 2 or 1.5), or leave
                it blank to use the design's relief height.
              </p>
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
          {terminalError ? (
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
                <Button onClick={finish} disabled={blockedByError || blockedByHeight}>
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
