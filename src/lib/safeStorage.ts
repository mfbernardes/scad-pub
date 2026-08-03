// safeStorage.ts: localStorage access that degrades to a no-op when storage
// is unavailable (private mode, quota, storage-blocking policies). Every
// caller in the app treats persistence as best-effort, so the try/catch
// idiom lives here once instead of at each call site. Semantics callers rely
// on: readLocal returns null on failure (indistinguishable from "not set":
// callers' defaults apply); writeLocal's boolean return is there for a caller
// that wants to know, but none currently gate on it — a failed write just
// means the fallback (a session-scoped in-memory flag, an unpersisted
// default) takes over next time.

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
