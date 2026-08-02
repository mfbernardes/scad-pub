// useFileImports.ts: user-imported files (fonts, SVGs): the in-memory map,
// its IndexedDB persistence (fileStore), and the render-cache invalidation an
// import implies. Extracted from App.tsx; composed with useRenderPipeline,
// whose invalidate() is passed in.
//
// TRUST BOUNDARY. Everything in this map is UNTRUSTED: it comes from whoever is
// using the site, not from the operator (docs/config.md, "SVG asset trust
// model", third class). The bytes are stored verbatim and handed to the render
// worker, which mounts them into the OpenSCAD-WASM filesystem — where markup is
// read as geometry and nothing else. That is the whole safety argument, and
// this module is where it would be broken: DO NOT render one of these files in
// the DOM (an <img src=blob:>, an innerHTML preview, a thumbnail) without
// sanitizing it first. The wizard strips scripts, SMIL and stylesheet fetches
// from an SVG it prepares, but nothing sanitizes a font, and nothing sanitizes
// an SVG that reaches this map by another route.
import { useCallback, useEffect, useRef, useState } from "react";
import { loadFiles, saveFile, deleteFile, clearFiles } from "./fileStore";
import { t } from "./i18n";

export interface FileImportsArgs {
  /** Imported files are render inputs: every change invalidates the cache. */
  invalidate: () => void;
  setAnnouncement: (msg: string) => void;
}

export function useFileImports({ invalidate, setAnnouncement }: FileImportsArgs) {
  const [userFiles, setUserFiles] = useState<Record<string, Uint8Array>>({});

  // The mount-time restore below is async, so a remove/clear that happens
  // while it's in flight must not be undone once the stored copy lands. Track
  // what changed during the restore window and exclude it from the merge.
  const restoring = useRef(true);
  const removedDuringRestore = useRef<Set<string>>(new Set());
  const clearedDuringRestore = useRef(false);

  // Restore persisted imports once on mount; anything imported in the meantime
  // wins over the stored copy of the same name, and anything removed/cleared
  // in the meantime stays removed.
  useEffect(() => {
    loadFiles()
      .then((f) => {
        if (clearedDuringRestore.current) return;
        const restored = Object.fromEntries(
          Object.entries(f).filter(([name]) => !removedDuringRestore.current.has(name))
        );
        if (Object.keys(restored).length > 0)
          setUserFiles((prev) => ({ ...restored, ...prev }));
      })
      .catch(() => {})
      .finally(() => {
        restoring.current = false;
      });
  }, []);

  const addFile = useCallback(
    (name: string, bytes: Uint8Array) => {
      // Re-imported after being removed during the restore window: the new
      // bytes should win, not the exclusion.
      removedDuringRestore.current.delete(name);
      setUserFiles((f) => ({ ...f, [name]: bytes }));
      void saveFile(name, bytes);
      invalidate();
      setAnnouncement(t("files.added", { name }));
    },
    [invalidate, setAnnouncement]
  );

  const removeFile = useCallback(
    (name: string) => {
      if (restoring.current) removedDuringRestore.current.add(name);
      setUserFiles((f) => {
        const next = { ...f };
        delete next[name];
        return next;
      });
      void deleteFile(name);
      invalidate();
      setAnnouncement(t("files.removed", { name }));
    },
    [invalidate, setAnnouncement]
  );

  const clearImportedFiles = useCallback(() => {
    if (restoring.current) clearedDuringRestore.current = true;
    setUserFiles({});
    void clearFiles();
    invalidate();
    setAnnouncement(t("files.cleared"));
  }, [invalidate, setAnnouncement]);

  return { userFiles, addFile, removeFile, clearImportedFiles };
}
