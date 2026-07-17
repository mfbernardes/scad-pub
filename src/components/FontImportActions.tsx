// FontImportActions.tsx — the shared "import a font" affordance behind three
// call sites that each independently rendered the same FileInput wiring:
// ParamRows.tsx's FontMissingHint, FileBar.tsx's font TaskCard, and
// QuickStart.tsx's FontStatusRow. All three accept the same `.ttf/.otf/.ttc`
// filter and (ParamRows/QuickStart) the same "read the file into bytes and
// hand it to AppActions' addFile" conversion — that duplication lives here
// now, as the default `onImportFile`. FileBar keeps passing its own
// size-capped handler instead (it validates against `fileImport.maxBytes`
// before reading), so `onImportFile` stays overridable rather than baked in.
//
// The three hosts' button CHROME and copy genuinely differ (ParamRows and
// QuickStart use different action-link classes; FileBar uses a full
// shadcn Button with different icon/copy and has no fallback action at all),
// so this component doesn't render buttons itself — each host supplies its
// own trigger/fallback via render props and keeps its own card shell/copy
// exactly as before.
import type { ReactNode } from "react";
import { useAppActions } from "../lib/appActions";
import { FileInput } from "./FileInput";

interface Props {
  /** Handles the picked file. Defaults to reading it into bytes and calling
   *  AppActions' `addFile` — the exact conversion ParamRows/QuickStart both
   *  did inline. Pass an override (e.g. FileBar's size-capped importer) when
   *  the host needs its own validation first. */
  onImportFile?: (file: File) => void | Promise<void>;
  /** Renders the import trigger, given FileInput's `open()` callback. */
  renderImport: (open: () => void) => ReactNode;
  /** Renders the optional "switch to a loaded family" fallback action. Omit
   *  for a card with no fallback to offer (e.g. FileBar's font card). */
  renderFallback?: () => ReactNode;
  /** The row wrapping both actions — defaults to the flex-wrap row
   *  ParamRows/QuickStart both used verbatim. */
  className?: string;
}

export function FontImportActions({
  onImportFile,
  renderImport,
  renderFallback,
  className = "flex flex-wrap gap-x-4 gap-y-1",
}: Props) {
  const { addFile } = useAppActions();
  const handleFile =
    onImportFile ?? (async (file: File) => addFile(file.name, new Uint8Array(await file.arrayBuffer())));
  return (
    <div className={className}>
      <FileInput accept=".ttf,.otf,.ttc" onFile={handleFile}>
        {renderImport}
      </FileInput>
      {renderFallback?.()}
    </div>
  );
}
