// SvgPrepareControl.tsx — the field control for an `// @svg` parameter. Instead
// of a raw path text box, it offers a drop zone / "Prepare SVG…" button that
// loads a drawing into the SvgWizard. On completion it writes the fixed SVG into
// the render's virtual filesystem, points this parameter at it, and (when the
// field binds `layers=<param>`) writes the derived colour string into that
// second parameter — then the normal auto-render picks it up.
import { useState } from "react";
import { Upload as UploadIcon, FileCode as FileCodeIcon } from "lucide-react";
import type { SvgFieldMeta } from "../openscad/types";
import { useAppActions } from "../lib/appActions";
import { FileInput } from "./FileInput";
import { SvgWizard, type SvgWizardResult } from "./SvgWizard";

interface Props {
  name: string;
  svg: SvgFieldMeta;
  value: string;
  label: string;
  onChange: (v: string) => void;
}

/** Strip any directory part from a dropped file's name (it mounts at the FS root). */
function baseName(name: string): string {
  return name.split(/[\\/]/).pop() || name;
}

/** Reject an unreasonably large upload before reading it into memory. */
const MAX_SVG_BYTES = 2 * 1024 * 1024; // 2 MB

/** A dropped/picked file must look like an SVG. The native picker's `accept`
 *  filters its own dialog, but a drag-drop bypasses it — so re-check here. */
function svgRejectionReason(file: File): string | null {
  const isSvg =
    file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  if (!isSvg) return "That's not an SVG — choose a .svg file.";
  if (file.size > MAX_SVG_BYTES)
    return `That SVG is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). The limit is 2 MB — simplify the drawing and try again.`;
  return null;
}

export function SvgPrepareControl({ name, svg, value, label, onChange }: Props) {
  const { change, addFile } = useAppActions();
  const [pending, setPending] = useState<{ text: string; fileName: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
                "No SVG chosen"
              )}
            </span>
            <button
              type="button"
              onClick={open}
              className="inline-flex cursor-pointer items-center gap-[0.4rem] rounded-(--radius-sm) border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground focus-visible:outline-offset-2"
              aria-label={`Prepare SVG for ${label}`}
            >
              <UploadIcon size={14} aria-hidden="true" /> Prepare SVG…
            </button>
            <span className="text-[0.78rem] text-muted-foreground">
              Drop an SVG here or choose a file to check &amp; fix it for printing.
            </span>
          </div>
        )}
      </FileInput>

      {error && (
        <p role="alert" className="text-[0.78rem] text-destructive">
          {error}
        </p>
      )}

      {pending && (
        <SvgWizard
          svgText={pending.text}
          fileName={pending.fileName}
          deriveColours={Boolean(svg.layers)}
          onCancel={() => setPending(null)}
          onComplete={onComplete}
        />
      )}
    </div>
  );
}
