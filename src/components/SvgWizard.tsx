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
  SvgPrepError,
  type Change,
  type Finding,
  type Region,
} from "../lib/svgPrep";
import { changeText, findingText, prepErrorText } from "../lib/svgPrepText";
import { t, tn, formatList, formatNumber } from "../lib/i18n";
import { useLocale } from "../lib/localeStore";
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

// Indirection tables (D4): store catalogue KEYS, resolved via t() at render.
const LEVEL_KEY: Record<Finding["level"], string> = {
  ERROR: "svgWizard.levelError",
  WARN: "svgWizard.levelWarn",
  INFO: "svgWizard.levelInfo",
};

// Blocking problems first, then warnings, then informational notes.
const LEVEL_ORDER: Record<Finding["level"], number> = { ERROR: 0, WARN: 1, INFO: 2 };

function FindingList({ findings, empty }: { findings: Finding[]; empty: string }) {
  if (findings.length === 0)
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  const sorted = [...findings].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return (
    <ul className="flex flex-col gap-2">
      {sorted.map((f, i) => {
        const { message, hint } = findingText(f);
        return (
          <li key={`${f.code}-${i}`} className="flex gap-2 text-sm leading-[1.4]">
            <Badge variant={LEVEL_BADGE[f.level]} className="mt-[1px] shrink-0">
              {t(LEVEL_KEY[f.level])}
            </Badge>
            <span className="min-w-0">
              <span className="text-foreground">{message}</span>
              {hint && <span className="block text-muted-foreground">{hint}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// Steps: 1 = check, 2 = fix, 3 = colours (only when deriveColours).
type Step = 1 | 2 | 3;

const STEP_NAME_KEY: Record<Step, string> = {
  1: "svgWizard.stepCheck",
  2: "svgWizard.stepFix",
  3: "svgWizard.stepColours",
};

export function SvgWizard({
  svgText,
  fileName,
  deriveColours,
  defaultHeight = null,
  onCancel,
  onComplete,
}: Props) {
  useLocale(); // subscription only: re-render this component's t()/tn() calls on a locale switch

  // Parse once. A parse failure is a terminal state with a retry via cancel.
  const parsed = useMemo(() => {
    try {
      const root = parseSvg(svgText);
      return { root, error: null as SvgPrepError | null, before: check(root) };
    } catch (e) {
      return { root: null, error: e as SvgPrepError, before: [] as Finding[] };
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
    changes: Change[];
    findings: Finding[];
    regions: Region[];
  } | null>(null);
  const [layers, setLayers] = useState("");
  // A preparation failure the drawing itself caused (formatLayerSpec refusing a
  // region id or colour that would corrupt the spec). Terminal like a parse
  // failure, with the same retry via cancel.
  const [prepError, setPrepError] = useState<SvgPrepError | null>(null);
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
      setPrepError(e as SvgPrepError);
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
          <DialogTitle>{t("svgWizard.title")}</DialogTitle>
          <DialogDescription>
            {parsed.error
              ? t("svgWizard.parseErrorDescription")
              : prepError
                ? t("svgWizard.prepErrorDescription")
                : t("svgWizard.step", {
                    n: step,
                    m: lastStep,
                    name: t(STEP_NAME_KEY[step]),
                    fileName,
                  })}
          </DialogDescription>
        </DialogHeader>

        {terminalError ? (
          <p className="svg-wizard__error text-sm text-destructive">{prepErrorText(terminalError)}</p>
        ) : (
          <div ref={scrollRef} className="max-h-[55vh] overflow-y-auto overscroll-contain pr-1">
            {step === 1 && (
              <section className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">{t("svgWizard.checkIntro")}</p>
                <FindingList findings={parsed.before} empty={t("svgWizard.checkEmpty")} />
              </section>
            )}

            {step === 2 && fixed && (
              <section className="flex flex-col gap-3">
                <div>
                  <h3 className="mb-1 font-display text-sm font-semibold text-foreground">
                    {t("svgWizard.fixesHeading")}
                  </h3>
                  {fixed.changes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("svgWizard.noChanges")}</p>
                  ) : (
                    <ul className="list-disc pl-5 text-sm text-foreground">
                      {fixed.changes.map((c, i) => (
                        <li key={i}>{changeText(c)}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="mb-1 font-display text-sm font-semibold text-foreground">
                    {t("svgWizard.notesHeading")}
                  </h3>
                  <FindingList findings={fixed.findings} empty={t("svgWizard.fixEmpty")} />
                </div>
              </section>
            )}

            {step === 3 && fixed && (
              <section className="flex flex-col gap-3">
                {fixed.regions.length >= 2 ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {t("svgWizard.regionsIntro", { count: fixed.regions.length })}
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
                              {r.count > 0 && tn("svgWizard.regionShapeCount", r.count)}
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
                                // The placeholder mirrors what this SAME <input type="number">
                                // expects to receive back: locale-invariant on purpose (D3),
                                // like every other number-input value in this app.
                                placeholder={defaultHeight === null ? "" : String(defaultHeight)}
                                aria-label={t("svgWizard.regionHeightAria", { id: r.id })}
                                aria-invalid={badHeights.has(r.id) || undefined}
                                onChange={(e) => setHeight(r.id, e.target.value)}
                              />
                              <span className="text-muted-foreground">{t("common.mm")}</span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="text-[0.78rem] text-muted-foreground">
                      {defaultHeight === null
                        ? t("svgWizard.heightHintNoDefault")
                        : t("svgWizard.heightHintDefault", {
                            heightMm: `${formatNumber(defaultHeight)} ${t("common.mm")}`,
                          })}
                    </p>
                    {fixed.regions.some((r) => !isRenderableColor(r.color)) && (
                      <p className="text-[0.78rem] text-muted-foreground">
                        {t("svgWizard.unpreviewableColours", { mark: "?" })}
                      </p>
                    )}
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">{t("svgWizard.layersLabel")}</span>
                      <Input
                        value={layers}
                        aria-label={t("svgWizard.layersAria")}
                        onChange={(e) => {
                          layersEditedRef.current = true;
                          setLayers(e.target.value);
                        }}
                      />
                    </label>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("svgWizard.singleColour")}</p>
                )}
              </section>
            )}

            {blockedByHeight && !blockedByError && (
              <p className="svg-wizard__height-error mt-3 text-sm font-medium text-destructive">
                {tn("svgWizard.heightError", badHeights.size, {
                  names: formatList([...badHeights].map((id) => `“${id}”`)),
                })}
              </p>
            )}

            {blockedByError && (
              <p className="mt-3 text-sm font-medium text-destructive">{t("svgWizard.blockedByError")}</p>
            )}
          </div>
        )}

        <DialogFooter>
          {terminalError ? (
            <Button variant="outline" className="svg-wizard__choose-file" onClick={onCancel}>
              {t("svgWizard.chooseAnotherFile")}
            </Button>
          ) : (
            <div className="flex w-full items-center justify-between gap-2">
              <Button
                variant="ghost"
                className="svg-wizard__back"
                onClick={() => (step === 1 ? onCancel() : setStep((step - 1) as Step))}
              >
                {step === 1 ? t("svgWizard.cancel") : t("svgWizard.back")}
              </Button>
              {step < lastStep ? (
                <Button
                  className="svg-wizard__advance"
                  onClick={step === 1 ? applyAndAdvance : () => setStep((step + 1) as Step)}
                  disabled={step !== 1 && blockedByError}
                >
                  {step === 1 ? t("svgWizard.fixAndContinue") : t("svgWizard.next")}
                </Button>
              ) : (
                <Button className="svg-wizard__finish" onClick={finish} disabled={blockedByError || blockedByHeight}>
                  {t("svgWizard.useThisSvg")}
                </Button>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
