// useFileImports.ts — user-imported files (fonts, SVGs): the in-memory map,
// its IndexedDB persistence (fileStore), and the render-cache invalidation an
// import implies. Extracted from App.tsx; composed with useRenderPipeline,
// whose invalidate() is passed in.
import { useCallback, useEffect, useState } from "react";
import { loadFiles, saveFile, deleteFile, clearFiles } from "./fileStore";

export interface FileImportsArgs {
  /** Imported files are render inputs — every change invalidates the cache. */
  invalidate: () => void;
  setAnnouncement: (msg: string) => void;
}

export function useFileImports({ invalidate, setAnnouncement }: FileImportsArgs) {
  const [userFiles, setUserFiles] = useState<Record<string, Uint8Array>>({});

  // Restore persisted imports once on mount; anything imported in the meantime
  // wins over the stored copy of the same name.
  useEffect(() => {
    loadFiles().then((f) => {
      if (Object.keys(f).length > 0) setUserFiles((prev) => ({ ...f, ...prev }));
    });
  }, []);

  const addFile = useCallback(
    (name: string, bytes: Uint8Array) => {
      setUserFiles((f) => ({ ...f, [name]: bytes }));
      void saveFile(name, bytes);
      invalidate();
      setAnnouncement(`File added: ${name}`);
    },
    [invalidate, setAnnouncement]
  );

  const removeFile = useCallback(
    (name: string) => {
      setUserFiles((f) => {
        const next = { ...f };
        delete next[name];
        return next;
      });
      void deleteFile(name);
      invalidate();
      setAnnouncement(`File removed: ${name}`);
    },
    [invalidate, setAnnouncement]
  );

  const clearImportedFiles = useCallback(() => {
    setUserFiles({});
    void clearFiles();
    invalidate();
    setAnnouncement("Imported files cleared");
  }, [invalidate, setAnnouncement]);

  return { userFiles, addFile, removeFile, clearImportedFiles };
}
