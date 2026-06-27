// idb.ts — the single IndexedDB database for this configurator, namespaced by
// APP_ID so two configs on one origin don't clobber each other. Every store
// (user files, the STL render cache) lives in this one database; opening always
// requests the current DB_VERSION so a single onupgradeneeded creates whatever
// stores are missing. When adding a store, bump DB_VERSION and create it below.
import { APP_ID } from "./appId";

const DB_VERSION = 2;

// Holds arbitrary user-uploaded files (fonts, SVGs, …) keyed by filename. The
// store name stays "fonts" (its original purpose) so files persisted by older
// builds still load without a DB upgrade.
export const USER_FILES_STORE = "fonts";
export const STL_DATA_STORE = "stl-data";
export const STL_META_STORE = "stl-meta";

let dbPromise: Promise<IDBDatabase> | undefined;

export function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined")
    return Promise.reject(new Error("IndexedDB unavailable"));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(APP_ID, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(USER_FILES_STORE)) db.createObjectStore(USER_FILES_STORE);
        if (!db.objectStoreNames.contains(STL_DATA_STORE)) db.createObjectStore(STL_DATA_STORE);
        // Small {bytes,lastAccess} records; eviction reads them all and sorts in JS.
        if (!db.objectStoreNames.contains(STL_META_STORE)) db.createObjectStore(STL_META_STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        // Don't hold the DB at an old version: if another tab (e.g. a newer
        // deploy) needs to upgrade, close so its upgrade isn't blocked. The next
        // openDb() reopens — dbPromise is reset on the resulting close/error.
        db.onversionchange = () => {
          db.close();
          dbPromise = undefined;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      // A pending upgrade in another tab blocks ours; fail soft rather than hang.
      req.onblocked = () => reject(req.error ?? new Error("IndexedDB upgrade blocked"));
    });
    // Don't cache a rejected open — let the next caller retry.
    dbPromise.catch(() => {
      dbPromise = undefined;
    });
  }
  return dbPromise;
}

/** Resolve/reject a single IDBRequest as a promise. */
export function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Resolve when a transaction commits; reject if it aborts or errors. */
export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

