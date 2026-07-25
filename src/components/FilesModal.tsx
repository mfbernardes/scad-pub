// FilesModal.tsx — the imported-file manager (import button + imported-file
// list), reached from BarActions' "Files" action — a paperclip icon inline in
// CommandBar's cluster on desktop, a row in the mobile "⋮" popover. Files used
// to be a third panel tab (ParamPanel/SheetTabs) but felt out of place next to
// Presets/Customize, so it moved to the same modal pattern as Help/Licenses/
// DesignDoc (hosted in App.tsx, opened via AppActions' `showFiles`). Adapted
// from a donor branch's ImportedFilesModal, but this repo has one workflow
// (not a separate guided/tabs split with import moved inline elsewhere), so
// the modal keeps FileBar's import button alongside the list rather than
// splitting them across two surfaces.
import { Modal, MODAL_BODY } from "./Modal";
import { FileBar, type LoadedFile } from "./FileBar";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";
import type { FileImport } from "../openscad/types";

// FileBar already carries its own padding (it was designed to sit directly in
// a tab's content area) — drop MODAL_BODY's own so the two don't stack.
const FILES_BODY = cn(MODAL_BODY, "px-0 pt-0 pb-0");

interface Props {
  fileImport: FileImport | null;
  loadedFiles: LoadedFile[];
  onAddFile: (name: string, bytes: Uint8Array) => void;
  onRemoveFile: (name: string) => void;
  onClearFiles: () => void;
  onClose: () => void;
}

export function FilesModal({ fileImport, loadedFiles, onAddFile, onRemoveFile, onClearFiles, onClose }: Props) {
  return (
    <Modal title={t("files.title")} onClose={onClose}>
      <div className={FILES_BODY}>
        <FileBar
          fileImport={fileImport}
          loadedFiles={loadedFiles}
          onAddFile={onAddFile}
          onRemoveFile={onRemoveFile}
          onClearFiles={onClearFiles}
        />
      </div>
    </Modal>
  );
}
