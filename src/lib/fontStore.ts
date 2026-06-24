// fontStore.ts — persist user-uploaded fonts in IndexedDB so they survive
// reloads and don't need re-uploading each session. Keyed by filename; values
// are the raw bytes. The database name is namespaced per configurator (appId).
import { APP_ID } from "./appId";

const DB_NAME = APP_ID;
const STORE = "fonts";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promiseFromRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) =>
    promiseFromRequest(run(db.transaction(STORE, mode).objectStore(STORE)))
  );
}

export async function saveFont(name: string, bytes: Uint8Array): Promise<void> {
  // Store a plain ArrayBuffer (structured-clone friendly, no view offset issues).
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await tx("readwrite", (s) => s.put(buf, name));
}

export async function deleteFont(name: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(name));
}

export async function loadFonts(): Promise<Record<string, Uint8Array>> {
  try {
    const db = await openDb();
    const store = db.transaction(STORE, "readonly").objectStore(STORE);
    // Keys and values come from one transaction (getAllKeys/getAll align by order).
    const [keys, values] = await Promise.all([
      promiseFromRequest(store.getAllKeys()),
      promiseFromRequest(store.getAll()),
    ]);
    const out: Record<string, Uint8Array> = {};
    (keys as string[]).forEach((k, i) => (out[k] = new Uint8Array(values[i])));
    return out;
  } catch {
    return {}; // private mode / unavailable IndexedDB — fonts are just session-only
  }
}
