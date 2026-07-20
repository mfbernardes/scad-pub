// ImportedFilesModal.tsx — guided workflow's "Imported files" secondary
// screen: reached from the overflow menu (mobile GuidedMobileHeader / the
// desktop command bar's own "Imported files" icon in guided mode — see
// CommandBar.tsx), never from primary navigation. Font/SVG import itself
// moved INLINE to their own param controls in guided mode (FontSelect's own
// in-dropdown "Import font…" row, SvgPrepareControl's own drop zone) — this
// screen is management only: the same imported-file list, per-file remove,
// "Clear all" and the shared on-device privacy line FileBar.tsx's Files tab
// shows in "tabs" workflow, factored out as `ImportedFilesList` so the two
// can never drift apart.
import { Modal, MODAL_BODY } from "./Modal";
import { ImportedFilesList, type LoadedFile } from "./FileBar";
import { t } from "../lib/i18n";

interface Props {
  loadedFiles: LoadedFile[];
  onRemoveFile: (name: string) => void;
  onClearFiles: () => void;
  onClose: () => void;
}

export function ImportedFilesModal({ loadedFiles, onRemoveFile, onClearFiles, onClose }: Props) {
  return (
    <Modal title={t("files.importedTitle")} label={t("files.importedTitle")} onClose={onClose}>
      <div className={MODAL_BODY}>
        <ImportedFilesList loadedFiles={loadedFiles} onRemoveFile={onRemoveFile} onClearFiles={onClearFiles} />
      </div>
    </Modal>
  );
}
