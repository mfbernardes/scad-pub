// FontPromptModal.tsx — a one-time startup nudge shown when the configured
// designs expect an external font (e.g. the license-restricted DIN profile
// font) that can't be bundled, and the user hasn't uploaded one yet. It links
// to the download and lets the user upload the TTF straight away, or carry on
// with the bundled fallback font.
import type { Schema } from "../openscad/types";
import { Modal } from "./Modal";
import { FileInput } from "./FileInput";
import { safeUrl } from "../lib/safeUrl";

type FontPrompt = NonNullable<Schema["fontPrompt"]>;

interface Props {
  prompt: FontPrompt;
  onUpload: (name: string, bytes: Uint8Array) => void;
  onDismissForever: () => void;
  onClose: () => void;
}

export function FontPromptModal({
  prompt,
  onUpload,
  onDismissForever,
  onClose,
}: Props) {
  const label = prompt.label ?? "the recommended font";
  // The download URL comes from config; only follow it if it's a safe protocol.
  const downloadUrl = safeUrl(prompt.url);

  const onFontFile = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    onUpload(file.name, bytes);
    onClose();
  };

  return (
    <Modal title={`Add ${label}`} label="Font upload" onClose={onClose}>
      <p className="modal-intro">
        Some designs use <strong>{label}</strong>
        {prompt.family && (
          <>
            {" "}
            (font family <code>{prompt.family}</code>)
          </>
        )}
        , which is licensed and can't be bundled with this app. Add it once and
        it's stored in your browser for next time.
      </p>
      <div className="modal-body font-prompt-body">
        <ol>
          <li>
            {downloadUrl ? (
              <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
                Download the font ↗
              </a>
            ) : (
              "Download the font"
            )}{" "}
            from the publisher.
          </li>
          <li>Upload the TTF here — it's used immediately, nothing leaves your browser.</li>
        </ol>
        <p className="hint">
          Without it, an open-license fallback font stands in. The output is then
          not asserted to meet the font's stroke/spacing — the log panel says so.
        </p>
      </div>
      <div className="modal-actions">
        <FileInput accept=".ttf,.otf,font/ttf" onFile={onFontFile}>
          {(open) => (
            <button className="primary" onClick={open}>
              Upload font (TTF)
            </button>
          )}
        </FileInput>
        <button onClick={onClose}>Continue with the fallback</button>
        <button className="link-btn" onClick={onDismissForever}>
          Don't remind me again
        </button>
      </div>
    </Modal>
  );
}
