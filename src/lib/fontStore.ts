// fontStore.ts — persist user-uploaded fonts in IndexedDB so they survive
// reloads and don't need re-uploading each session. Keyed by filename; values
// are the raw bytes. The database is shared (see idb.ts) and namespaced per
// configurator (appId).
import { FONTS_STORE, openDb, reqToPromise } from "./idb";

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) =>
    reqToPromise(run(db.transaction(FONTS_STORE, mode).objectStore(FONTS_STORE)))
  );
}

// Persistence is best-effort: a failure (private mode, blocked upgrade, quota)
// just means the font is session-only, so swallow it rather than surface an
// unhandled rejection to callers that fire-and-forget these writes.
export async function saveFont(name: string, bytes: Uint8Array): Promise<void> {
  // Store a plain ArrayBuffer (structured-clone friendly, no view offset issues).
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  try {
    await tx("readwrite", (s) => s.put(buf, name));
  } catch {
    /* session-only */
  }
}

export async function deleteFont(name: string): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(name));
  } catch {
    /* nothing persisted to remove, or storage unavailable */
  }
}

export async function loadFonts(): Promise<Record<string, Uint8Array>> {
  try {
    const db = await openDb();
    const store = db.transaction(FONTS_STORE, "readonly").objectStore(FONTS_STORE);
    // Keys and values come from one transaction (getAllKeys/getAll align by order).
    const [keys, values] = await Promise.all([
      reqToPromise(store.getAllKeys()),
      reqToPromise(store.getAll()),
    ]);
    const out: Record<string, Uint8Array> = {};
    (keys as string[]).forEach((k, i) => (out[k] = new Uint8Array(values[i])));
    return out;
  } catch {
    return {}; // private mode / unavailable IndexedDB — fonts are just session-only
  }
}
