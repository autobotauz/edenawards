import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

export interface Resource<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
  setData: (fn: (prev: T | null) => T | null) => void;
}

/** Loads JSON from the API whenever `path` changes. Pass null to skip. */
export function useApi<T>(path: string | null): Resource<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api<T>(path, { signal: ctrl.signal })
      .then((d) => {
        setDataState(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === 'AbortError') return;
        setError(e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e)));
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((fn: (prev: T | null) => T | null) => setDataState(fn), []);
  return { data, error, loading, reload, setData };
}

/** Re-renders every `ms` milliseconds (for countdowns). */
export function useNow(ms = 1000, offset = 0): number {
  const [now, setNow] = useState(() => Date.now() + offset);
  const off = useRef(offset);
  off.current = offset;
  useEffect(() => {
    setNow(Date.now() + off.current);
    const id = setInterval(() => setNow(Date.now() + off.current), ms);
    return () => clearInterval(id);
  }, [ms, offset]);
  return now;
}
