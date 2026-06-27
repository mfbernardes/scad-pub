// FileBar.tsx — the generic file manager (fonts, SVGs, data files, …): a list of
// imported files with sizes + per-file remove, plus "Import file" and "Clear all"
// actions. Shown as the Files tab on mobile and at the bottom of the desktop
// parameter panel. All copy is config-driven (see `fileImport`); uploads are
// stored client-side and mounted by the renderer.
import type { FileImport } from "../openscad/types";
import { FileInput } from "./FileInput";
import { IconButton } from "./IconButton";
import { Button } from "./ui/button";
import { FolderIcon, TrashIcon, FileIcon, XIcon } from "./Icons";

/** A user-imported file, with its byte size for display. */
export type LoadedFile = { name: string; size: number };

interface Props {
  /** Generic file-import config, or null to hide the control entirely. */
  fileImport: FileImport | null;
  /** Every user-supplied file currently loaded (name + byte size). */
  loadedFiles: LoadedFile[];
  onAddFile: (name: string, bytes: Uint8Array) => void;
  /** Remove a single imported file by name. */
  onRemoveFile: (name: string) => void;
  /** Remove every imported file (and drop the render cache). */
  onClearFiles: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileBar({ fileImport, loadedFiles, onAddFile, onRemoveFile, onClearFiles }: Props) {
  if (!fileImport) return null;

  const onUploadFile = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    onAddFile(file.name, bytes);
  };

  return (
    <div className="file-manager">
      <p className="file-manager__intro">
        {fileImport.note ??
          "Fonts, SVGs & data files referenced by this design. Stored on-device and re-applied next visit."}
      </p>

      {loadedFiles.length > 0 && (
        <ul className="file-manager__list">
          {loadedFiles.map((f) => (
            <li className="file-manager__item" key={f.name}>
              <FileIcon size={16} />
              <span className="file-manager__name" title={f.name}>{f.name}</span>
              <span className="file-manager__size">{formatSize(f.size)}</span>
              <IconButton
                className="file-manager__remove"
                onClick={() => onRemoveFile(f.name)}
                label={`Remove ${f.name}`}
                title={`Remove ${f.name}`}
              >
                <XIcon size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <FileInput accept={fileImport.accept} onFile={onUploadFile}>
        {(open) => (
          <Button
            type="button"
            variant="outline"
            className="file-manager__action w-full"
            title={
              fileImport.note ??
              "Import a file your design references (a font, an SVG, a data file…)"
            }
            onClick={open}
          >
            <FolderIcon size={16} /> {fileImport.label ?? "Import file"}…
          </Button>
        )}
      </FileInput>
      <Button
        type="button"
        variant="outline"
        className="file-manager__action w-full"
        title="Remove all imported files and clear the render cache"
        onClick={onClearFiles}
        disabled={loadedFiles.length === 0}
      >
        <TrashIcon size={16} /> Clear all imported files
      </Button>
    </div>
  );
}
