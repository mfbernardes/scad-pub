// FontImportActions.tsx: the shared "import a font" affordance: a hidden
// `.ttf/.otf/.ttc` file input, reading the picked file into bytes and handing
// it to AppActions' `addFile`. The same conversion ParamForm's inline
// missing-font hint does. Used by AttentionItems' font-fallback warning card.
// Ported from a donor branch's design-reference component; the copy itself
// lives at each call site (both of which take it from the `t()` catalogue).
import type { ReactNode } from "react";
import { useAppActions } from "../lib/appActions";
import { FileInput } from "./FileInput";

interface Props {
  /** Renders the import trigger, given FileInput's `open()` callback. */
  renderImport: (open: () => void) => ReactNode;
  /** Renders the optional "switch to a loaded family" fallback action. Omit
   *  for a card with no fallback to offer. */
  renderFallback?: () => ReactNode;
  className: string;
}

export function FontImportActions({ renderImport, renderFallback, className }: Props) {
  const { addFile } = useAppActions();
  const handleFile = async (file: File) => addFile(file.name, new Uint8Array(await file.arrayBuffer()));
  return (
    <div className={className}>
      <FileInput accept=".ttf,.otf,.ttc" onFile={handleFile}>
        {renderImport}
      </FileInput>
      {renderFallback?.()}
    </div>
  );
}
