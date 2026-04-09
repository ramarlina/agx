import { useEffect, useRef, useCallback } from "react";

export function useDebounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): T {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const debounced = useCallback(
    (...args: Parameters<T>) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        fnRef.current(...args);
      }, delay);
    },
    [delay]
  ) as T;

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return debounced;
}
