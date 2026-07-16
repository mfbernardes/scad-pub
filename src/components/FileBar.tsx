// FileBar.tsx — the generic file manager (fonts, SVGs, data files, …): a list of
// imported files with sizes + per-file remove, plus "Import file" and "Clear all"
// actions. Shown as the Files tab on mobile and at the bottom of the desktop
// parameter panel. All copy is config-driven (see `fileImport`); uploads are
// stored client-side and mounted by the renderer.
import { toast } from "sonner";
import type { FileImport } from "../openscad/types";
import { t } from "../lib/i18n";
import { FileInput } from "./FileInput";
import { Markdown } from "./Markdown";
import { IconButton } from "./IconButton";
import { Button } from "./ui/button";
import { Folder as FolderIcon, Trash2 as TrashIcon, File as FileIcon, X as XIcon } from "lucide-react";

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
    // Reject an over-cap upload before reading it — a friendly toast, no store.
    if (fileImport.maxBytes !== undefined && file.size > fileImport.maxBytes) {
      toast.error(
        t("files.tooLarge", { name: file.name, size: formatSize(file.size), limit: formatSize(fileImport.maxBytes) }),
        { id: "file-too-large" }
      );
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    onAddFile(file.name, bytes);
  };

  return (
    <div className="file-manager flex flex-col gap-2 px-3 pt-2 pb-3">
      <div className="text-[0.85rem] leading-[1.4] text-muted-foreground [&_:is(p,ul)]:m-0 [&_:is(p,ul)+:is(p,ul)]:mt-2 [&_ul]:pl-[1.1rem]">
        <Markdown
          body={fileImport.note ?? t("files.defaultNote")}
        />
      </div>

      {loadedFiles.length > 0 && (
        <ul className="flex flex-col gap-[0.4rem]">
          {loadedFiles.map((f) => (
            <li
              className="flex items-center gap-2 rounded-(--radius-sm) border bg-muted px-[0.6rem] py-2"
              key={f.name}
            >
              <FileIcon size={16} className="shrink-0 text-brand" />
              <span className="file-manager__name min-w-0 flex-1 truncate text-[0.9rem]" title={f.name}>
                {f.name}
              </span>
              <span className="shrink-0 text-[0.82rem] text-muted-foreground tabular-nums">
                {formatSize(f.size)}
              </span>
              <IconButton
                className="shrink-0 border-transparent bg-transparent text-brand hover:border-border hover:bg-card"
                onClick={() => onRemoveFile(f.name)}
                label={t("files.removeAria", { name: f.name })}
                title={t("files.removeAria", { name: f.name })}
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
            className="w-full"
            title={t("files.importTitle")}
            onClick={open}
          >
            <FolderIcon size={16} /> {fileImport.label ?? t("files.importDefaultLabel")}…
          </Button>
        )}
      </FileInput>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        title={t("files.clearAllTitle")}
        onClick={onClearFiles}
        disabled={loadedFiles.length === 0}
      >
        <TrashIcon size={16} /> {t("files.clearAll")}
      </Button>
    </div>
  );
}
