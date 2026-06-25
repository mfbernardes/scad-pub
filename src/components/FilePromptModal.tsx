// FilePromptModal.tsx — a one-time startup nudge shown when the configured
// designs expect an external file the app can't bundle (a license-restricted
// font, an SVG to import(), …) and the user hasn't supplied one yet. It links to
// the download (when configured) and lets the user upload the file straight
// away, or carry on without it. All copy is config-driven (see `filePrompts`).
import type { FilePrompt } from "../openscad/types";
import { Modal } from "./Modal";
import { FileInput } from "./FileInput";
import { safeUrl } from "../lib/safeUrl";

interface Props {
  prompt: FilePrompt;
  onUpload: (name: string, bytes: Uint8Array) => void;
  onDismissForever: () => void;
  onClose: () => void;
}

// Sensible default file-picker filter per kind; overridable via prompt.accept.
function acceptFor(prompt: FilePrompt): string | undefined {
  return prompt.accept ?? (prompt.kind === "font" ? ".ttf,.otf,font/ttf" : undefined);
}

export function FilePromptModal({
  prompt,
  onUpload,
  onDismissForever,
  onClose,
}: Props) {
  const isFont = prompt.kind === "font";
  const label = prompt.label ?? (isFont ? "the recommended font" : "the required file");
  // The download URL comes from config; only follow it if it's a safe protocol.
  const downloadUrl = safeUrl(prompt.url);
  const noun = isFont ? "font" : "file";

  const onFile = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    onUpload(file.name, bytes);
    onClose();
  };

  return (
    <Modal title={`Add ${label}`} label="File upload" onClose={onClose}>
      <p className="modal-intro">
        Some designs use <strong>{label}</strong>
        {isFont && prompt.family && (
          <>
            {" "}
            (font family <code>{prompt.family}</code>)
          </>
        )}
        , which can't be bundled with this app. Add it once and it's stored in
        your browser for next time.
      </p>
      <div className="modal-body file-prompt-body">
        <ol>
          <li>
            {downloadUrl ? (
              <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
                Download the {noun} ↗
              </a>
            ) : (
              `Get the ${noun}`
            )}{" "}
            from the publisher.
          </li>
          <li>
            Upload it here — it's used immediately, nothing leaves your browser.
          </li>
        </ol>
        {isFont && (
          <p className="hint">
            Without it, an open-license fallback font stands in. The output is
            then not asserted to meet the font's stroke/spacing — the log panel
            says so.
          </p>
        )}
      </div>
      <div className="modal-actions">
        <FileInput accept={acceptFor(prompt)} onFile={onFile}>
          {(open) => (
            <button className="primary" onClick={open}>
              Upload {noun}
            </button>
          )}
        </FileInput>
        <button onClick={onClose}>
          {isFont ? "Continue with the fallback" : "Continue without it"}
        </button>
        <button className="link-btn" onClick={onDismissForever}>
          Don't remind me again
        </button>
      </div>
    </Modal>
  );
}
