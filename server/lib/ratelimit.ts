import type { Db } from '../db';
import { fail } from './http';

export interface Limit {
  limit: number;
  windowMs: number;
}

export const LIMITS = {
  login: { limit: 20, windowMs: 10 * 60_000 },
  submit: { limit: 10, windowMs: 60 * 60_000 },
  vote: { limit: 60, windowMs: 60_000 },
} satisfies Record<string, Limit>;

/**
 * Fixed-window counter stored in the database (works identically on D1 and SQLite,
 * no extra infrastructure). A single atomic UPSERT increments or resets the window.
 */
export async function hit(db: Db, key: string, { limit, windowMs }: Limit, now: number): Promise<boolean> {
  const threshold = now - windowMs;
  const row = await db.first<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN window_start <= ? THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start <= ? THEN ? ELSE window_start END
     RETURNING count`,
    [key, now, threshold, threshold, now],
  );
  return (row?.count ?? 1) <= limit;
}

export async function enforce(db: Db, key: string, limit: Limit, now: number): Promise<void> {
  if (!(await hit(db, key, limit, now))) {
    throw fail(429, 'rate_limited', 'You are doing that too often. Please wait a moment and try again.');
  }
}
