// useDebounce — the value, delayed: returns `value` but only after it has held
// steady for `ms`. Each change resets the timer, so rapid updates collapse into
// one. Used for the parameter search box so filtering doesn't run per keystroke.
import { useEffect, useState } from "react";

export function useDebounce<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
