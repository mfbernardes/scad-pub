import { useCallback, useEffect, useRef } from "react";

/** Batches a hot-path value stream (e.g. pointer-move) into at most one
 *  imperative `write` per animation frame, bypassing React state entirely.
 *  Call `schedule(value)` on every update; call `cancel()` to drop any
 *  pending frame before a caller commits the value through React state —
 *  otherwise a frame queued just before commit can fire afterward and
 *  clobber the just-committed DOM state with a stale value. */
export function useRafBatchedWrite<T>(write: (value: T) => void) {
  const rafRef = useRef<number | null>(null);
  const valueRef = useRef<T>(undefined as T);
  const writeRef = useRef(write);
  writeRef.current = write;

  const cancel = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const schedule = useCallback((value: T) => {
    valueRef.current = value;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      writeRef.current(valueRef.current);
    });
  }, []);

  useEffect(() => cancel, [cancel]);

  return { schedule, cancel };
}
