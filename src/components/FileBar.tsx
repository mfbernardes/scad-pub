// FileBar.tsx — the generic "Import file" control (fonts, SVGs, data files, …)
// plus a Clear button, shown at the bottom of the parameter panel. Kept separate
// from PresetBar so it can sit below the parameters. All copy is config-driven
// (see `fileImport`); uploads are stored client-side and mounted by the renderer.
import type { FileImport } from "../openscad/types";
import { FileInput } from "./FileInput";
import { UploadIcon, TrashIcon } from "./Icons";

interface Props {
  /** Generic file-import config, or null to hide the control entirely. */
  fileImport: FileImport | null;
  /** Filenames of every user-supplied file currently loaded. */
  loadedFiles: string[];
  onAddFile: (name: string, bytes: Uint8Array) => void;
  /** Remove every imported file (and drop the render cache). */
  onClearFiles: () => void;
}

export function FileBar({ fileImport, loadedFiles, onAddFile, onClearFiles }: Props) {
  if (!fileImport) return null;

  const onUploadFile = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    onAddFile(file.name, bytes);
  };

  return (
    <div className="preset-bar file-bar">
      <div className="grp-label">Files</div>
      <div className="row btn-row">
        <FileInput accept={fileImport.accept} onFile={onUploadFile}>
          {(open) => (
            <button
              type="button"
              className="btn-labeled"
              title={
                fileImport.note ??
                "Import a file your design references (a font, an SVG, a data file…)"
              }
              onClick={open}
            >
              <UploadIcon size={16} /> {fileImport.label ?? "Import file"}…
            </button>
          )}
        </FileInput>
        <button
          type="button"
          className="btn-labeled"
          title="Remove all imported files and clear the render cache"
          onClick={onClearFiles}
          disabled={loadedFiles.length === 0}
        >
          <TrashIcon size={16} /> Clear
        </button>
      </div>
      {loadedFiles.length > 0 && (
        <div className="row">
          <span className="hint">added: {loadedFiles.join(", ")}</span>
        </div>
      )}
    </div>
  );
}
