// safeStorage.ts — localStorage access that degrades to a no-op when storage
// is unavailable (private mode, quota, storage-blocking policies). Every
// caller in the app treats persistence as best-effort, so the try/catch
// idiom lives here once instead of at each call site. Semantics callers rely
// on: readLocal returns null on failure (indistinguishable from "not set" —
// callers' defaults apply), writeLocal reports success for the rare caller
// that must not proceed after a failed write (e.g. the one-time install hint).

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Remove a key. Best-effort like the two above — a blocked/unavailable
 *  store just leaves nothing to remove, so this never throws. */
export function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable — nothing to remove */
  }
}
