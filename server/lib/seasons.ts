import type { Db } from '../db';
import type { Ctx } from '../context';
import { resultsVisible } from '../../shared/season';
import { seasonTimes, type CategoryRow, type SeasonRow } from './mappers';
import { notFound } from './http';

export async function getSeasonRow(db: Db, id: number): Promise<SeasonRow | null> {
  return db.first<SeasonRow>('SELECT * FROM seasons WHERE id = ?', [id]);
}

/** A season that the current viewer may see: published, or any season for admins. */
export async function visibleSeason(c: Ctx, id: number): Promise<SeasonRow> {
  const row = await getSeasonRow(c.var.deps.db, id);
  if (!row || (row.is_published !== 1 && !c.var.session?.isAdmin)) throw notFound('Season');
  return row;
}

/**
 * The "current" season shown on the home page:
 *  1. The oldest published season whose results are not yet public (the one in progress),
 *  2. otherwise the most recently finished published season.
 */
export async function currentSeasonRow(db: Db, now: number): Promise<SeasonRow | null> {
  const rows = await db.all<SeasonRow>(
    'SELECT * FROM seasons WHERE is_published = 1 ORDER BY submission_starts_at ASC, id ASC',
  );
  const active = rows.find((r) => !resultsVisible(seasonTimes(r), now));
  if (active) return active;
  return rows.length ? [...rows].sort((a, b) => b.voting_ends_at - a.voting_ends_at)[0] : null;
}

export async function categoriesFor(db: Db, seasonId: number, includeDisabled: boolean): Promise<CategoryRow[]> {
  return db.all<CategoryRow>(
    `SELECT * FROM categories WHERE season_id = ? ${includeDisabled ? '' : 'AND enabled = 1'}
     ORDER BY display_order, id`,
    [seasonId],
  );
}

export async function audit(db: Db, actor: string, action: string, target: string | null, details: unknown, now: number) {
  await db.run('INSERT INTO audit_log (actor_id, action, target, details, created_at) VALUES (?, ?, ?, ?, ?)', [
    actor,
    action,
    target,
    details === undefined ? null : JSON.stringify(details),
    now,
  ]);
}
