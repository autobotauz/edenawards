import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Category, Season } from '../../shared/types';
import { useApi } from './hooks';
import { clockOffset } from './time';
import type { ApiError } from './api';

interface CurrentSeason {
  season: Season | null;
  categories: Category[];
  /** Server time minus client time in ms. */
  offset: number;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
}

const Ctx = createContext<CurrentSeason | null>(null);

export function CurrentSeasonProvider({ children }: { children: ReactNode }) {
  const { data, loading, error, reload } = useApi<{ season: Season | null; categories: Category[]; serverTime: string }>(
    '/api/seasons/current',
  );
  const value = useMemo<CurrentSeason>(
    () => ({
      season: data?.season ?? null,
      categories: data?.categories ?? [],
      offset: clockOffset(data?.serverTime),
      loading,
      error,
      reload,
    }),
    [data, loading, error, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrentSeason(): CurrentSeason {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCurrentSeason must be used inside CurrentSeasonProvider');
  return v;
}
