// SvgPrepareControl.tsx: the field control for an `// @svg` parameter. Instead
// of a raw path text box, it offers a drop zone / "Prepare SVG…" button that
// loads a drawing into the SvgWizard. On completion it writes the fixed SVG into
// the render's virtual filesystem, points this parameter at it, and (when the
// field binds `layers=<param>`) writes the derived colour string into that
// second parameter: then the normal auto-render picks it up.
import { lazy, Suspense, useState } from "react";
import { Upload as UploadIcon, FileCode as FileCodeIcon } from "lucide-react";
import type { SvgFieldMeta } from "../openscad/types";
import { useAppActions } from "../lib/appActions";
import { isSvgMissing } from "../lib/svgFiles";
import { t, type Vars } from "../lib/i18n";
import { useLocale } from "../lib/localeStore";
import { FileInput } from "./FileInput";
import { ErrorBoundary } from "./ErrorBoundary";
import { Spinner } from "./ui/spinner";
import { Button } from "./ui/button";
import type { SvgWizardResult } from "./SvgWizard";

function loadSvgWizard() {
  return import("./SvgWizard").then((m) => ({ default: m.SvgWizard }));
}

// A single module-scope `lazy()` component (created once, not per render, so
// `react-hooks/static-components` is satisfied). A rejected chunk load
// (offline, build-hash drift after a deploy, an ad blocker on the chunk URL, …)
// is cached by the browser's module map for the document's lifetime: re-running
// the same dynamic `import()` (even from a freshly minted `lazy()` wrapper)
// re-throws the cached rejection, so there is no in-place re-fetch. The
// only reliable recovery is a full reload, which re-requests every chunk from
// the network; the error fallback below offers exactly that (see finding #14).
const SvgWizardLazy = lazy(loadSvgWizard);

// Preload on user intent (hover/focus of the trigger button) so the chunk is
// likely already fetched by the time `pending` mounts it. The dynamic import
// is already deduped by the module loader, so repeat calls are free.
function preloadSvgWizard() {
  void import("./SvgWizard");
}

interface Props {
  name: string;
  svg: SvgFieldMeta;
  value: string;
  label: string;
  onChange: (v: string) => void;
  /**
   * SVG basenames the renderer can resolve right now (bundled assets ∪ imported
   * `.svg`). When the current value names a file that isn't in it: e.g. an
   * imported drawing the user later removed. An actionable "not imported" hint
   * is shown, mirroring ParamForm's missing-font hint.
   */
  availableSvgFiles?: Set<string>;
  /**
   * Current value of the parameter named by the field's `height=` binding: the
   * relief height a region falls back to, so the wizard can show it. Null when
   * the field binds none.
   */
  defaultHeight?: number | null;
}

/** Strip any directory part from a dropped file's name (it mounts at the FS root). */
function baseName(name: string): string {
  return name.split(/[\\/]/).pop() || name;
}

/** Reject an unreasonably large upload before reading it into memory. */
const MAX_SVG_BYTES = 2 * 1024 * 1024; // 2 MB

/** A rejection reason as a catalogue key + its interpolation vars, resolved
 *  through `t()` at RENDER time (not when the rejection happens): storing the
 *  already-resolved English string in state would go stale across a locale
 *  switch while the message is still on screen (review finding 15, Phase 2). */
interface RejectionReason {
  key: string;
  vars?: Vars;
}

/** A dropped/picked file must look like an SVG. The native picker's `accept`
 *  filters its own dialog, but a drag-drop bypasses it, so re-check here. */
function svgRejectionReason(file: File): RejectionReason | null {
  const isSvg =
    file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  if (!isSvg) return { key: "svg.rejectNotSvg" };
  if (file.size > MAX_SVG_BYTES)
    return { key: "svg.rejectTooLarge", vars: { size: (file.size / 1024 / 1024).toFixed(1) } };
  return null;
}

export function SvgPrepareControl({ name, svg, value, label, onChange, availableSvgFiles, defaultHeight = null }: Props) {
  useLocale(); // subscription only: re-render this component's t() calls on a locale switch
  const { change, addFile } = useAppActions();
  const [pending, setPending] = useState<{ text: string; fileName: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<RejectionReason | null>(null);
  // The value points at a drawing the renderer can't resolve (usually an
  // imported SVG the user has since removed). The drop zone below is the fix:
  // prepare/import it again, so the hint names what's gone.
  const missing = availableSvgFiles ? isSvgMissing(value, availableSvgFiles) : false;

  const loadFile = async (file: File) => {
    const reason = svgRejectionReason(file);
    if (reason) {
      setError(reason);
      return;
    }
    setError(null);
    setPending({ text: await file.text(), fileName: baseName(file.name) });
  };

  const onComplete = ({ svg: fixedSvg, layers }: SvgWizardResult) => {
    const fileName = pending!.fileName;
    addFile(fileName, new TextEncoder().encode(fixedSvg));
    // Point this @svg parameter at the freshly mounted file…
    onChange(fileName);
    // …and, when the field binds colours, write the derived layers string into
    // the target parameter (blank string for a single-colour drawing).
    if (svg.layers && layers !== null) change(svg.layers, layers);
    setPending(null);
  };

  return (
    <div className="svg-prepare flex flex-col gap-[0.4rem]" data-svg-field={name}>
      <FileInput accept=".svg,image/svg+xml" onFile={loadFile}>
        {(open) => (
          <div
            className={`svg-prepare__drop flex flex-col items-center gap-2 rounded-(--radius-sm) border border-dashed px-3 py-4 text-center transition-colors ${
              dragOver ? "border-brand bg-accent" : "border-border bg-muted/40"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void loadFile(file);
            }}
          >
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileCodeIcon size={16} aria-hidden="true" />
              {value ? (
                <span className="min-w-0 [overflow-wrap:anywhere]">{value}</span>
              ) : (
                t("svg.notChosen")
              )}
            </span>
            <button
              type="button"
              onClick={open}
              onPointerEnter={preloadSvgWizard}
              onFocus={preloadSvgWizard}
              className="inline-flex cursor-pointer items-center gap-[0.4rem] rounded-(--radius-sm) border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground focus-visible:outline-offset-2"
              aria-label={t("svg.prepareForAria", { label })}
            >
              <UploadIcon size={14} aria-hidden="true" /> {t("svg.prepareCta")}
            </button>
            <span className="text-[0.78rem] text-muted-foreground">
              {t("svg.dropHint")}
            </span>
          </div>
        )}
      </FileInput>

      {missing && (
        <p
          className="svg-prepare__missing mt-[0.1rem] rounded-(--radius-sm) border border-l-[3px] border-l-warn bg-muted px-[0.6rem] py-2 text-[0.82rem] leading-[1.4] text-foreground"
          role="status"
        >
          {t("svg.missing", { name: value })}
        </p>
      )}

      {error && (
        <p role="alert" className="text-[0.78rem] text-destructive">
          {t(error.key, error.vars)}
        </p>
      )}

      {pending && (
        <ErrorBoundary
          fallback={
            <div
              role="alert"
              className="svg-prepare__wizard-error flex flex-col items-center gap-2 rounded-(--radius-sm) border border-dashed border-destructive/60 bg-destructive/5 px-3 py-4 text-center"
            >
              <p className="text-sm text-foreground">
                The SVG editor couldn't be loaded.
              </p>
              <p className="text-[0.78rem] text-muted-foreground">
                Check your connection, then reload to try again.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  // The browser caches the failed chunk load for the page's
                  // life, so an in-place retry can't re-fetch it (see #14): a
                  // reload re-requests every chunk from the network.
                  onClick={() => window.location.reload()}
                >
                  Reload
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setPending(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          }
        >
          <Suspense
            fallback={
              <div
                role="status"
                aria-live="polite"
                aria-busy="true"
                className="svg-prepare__wizard-loading flex items-center justify-center gap-2 rounded-(--radius-sm) border border-dashed border-border bg-muted/40 px-3 py-4 text-sm text-muted-foreground"
              >
                <Spinner className="size-4" aria-hidden="true" />
                Loading SVG editor…
              </div>
            }
          >
            <SvgWizardLazy
              svgText={pending.text}
              fileName={pending.fileName}
              deriveColours={Boolean(svg.layers)}
              defaultHeight={defaultHeight}
              onCancel={() => setPending(null)}
              onComplete={onComplete}
            />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}
