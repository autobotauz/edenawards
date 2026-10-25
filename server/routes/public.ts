import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { badRequest, fail, intParam, iso, notFound, optionalInt, pagination } from '../lib/http';
import { toCategory, toSeason, toVideo, VIDEO_SELECT, type SeasonRow, type VideoRow } from '../lib/mappers';
import { categoriesFor, currentSeasonRow, visibleSeason } from '../lib/seasons';
import { computeResults } from '../lib/results';
import { resultsVisible } from '../../shared/season';
import { seasonTimes } from '../lib/mappers';
import type { SqlValue } from '../db';

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get('/seasons', async (c) => {
  const { db, now } = c.var.deps;
  const rows = await db.all<SeasonRow>(
    'SELECT * FROM seasons WHERE is_published = 1 ORDER BY submission_starts_at DESC, id DESC',
  );
  return c.json({ seasons: rows.map((r) => toSeason(r, now())), serverTime: iso(now()) });
});

publicRoutes.get('/seasons/current', async (c) => {
  const { db, now } = c.var.deps;
  const t = now();
  const row = await currentSeasonRow(db, t);
  if (!row) return c.json({ season: null, categories: [], serverTime: iso(t) });
  const cats = await categoriesFor(db, row.id, false);
  return c.json({ season: toSeason(row, t), categories: cats.map(toCategory), serverTime: iso(t) });
});

publicRoutes.get('/seasons/:id', async (c) => {
  const { db, now } = c.var.deps;
  const row = await visibleSeason(c, intParam(c.req.param('id'), 'season id'));
  const cats = await categoriesFor(db, row.id, false);
  return c.json({ season: toSeason(row, now()), categories: cats.map(toCategory), serverTime: iso(now()) });
});

publicRoutes.get('/categories', async (c) => {
  const { db, now } = c.var.deps;
  const seasonId = optionalInt(c.req.query('seasonId'), 'season id');
  const row = seasonId ? await visibleSeason(c, seasonId) : await currentSeasonRow(db, now());
  if (!row) return c.json({ categories: [] });
  return c.json({ categories: (await categoriesFor(db, row.id, false)).map(toCategory) });
});

/** Approved videos only. Paginated. No vote totals are exposed here. */
publicRoutes.get('/videos', async (c) => {
  const { db, now } = c.var.deps;
  const seasonId = optionalInt(c.req.query('seasonId'), 'season id');
  const categoryId = optionalInt(c.req.query('categoryId'), 'category id');
  const season = seasonId ? await visibleSeason(c, seasonId) : await currentSeasonRow(db, now());
  if (!season) return c.json({ videos: [], page: 1, pageSize: 0, total: 0 });

  const { page, pageSize, offset } = pagination(c, 50, 100);
  const where = ["v.season_id = ?", "v.moderation_status = 'approved'", 'c.enabled = 1'];
  const params: SqlValue[] = [season.id];
  if (categoryId) {
    where.push('v.category_id = ?');
    params.push(categoryId);
  }
  const whereSql = where.join(' AND ');
  const [rows, total] = await Promise.all([
    db.all<VideoRow>(`${VIDEO_SELECT} WHERE ${whereSql} ORDER BY c.display_order, v.created_at, v.id LIMIT ? OFFSET ?`, [
      ...params,
      pageSize,
      offset,
    ]),
    db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM videos v JOIN categories c ON c.id = v.category_id WHERE ${whereSql}`,
      params,
    ),
  ]);
  return c.json({ videos: rows.map((r) => toVideo(r, false)), page, pageSize, total: Number(total?.n ?? 0) });
});

/** A single entry. Approved entries are public; authors and admins can also see pending/rejected ones. */
publicRoutes.get('/videos/:id', async (c) => {
  const { db } = c.var.deps;
  const id = intParam(c.req.param('id'), 'video id');
  const row = await db.first<VideoRow & { season_published: number }>(
    `${VIDEO_SELECT.replace('FROM videos v', ', s.is_published AS season_published FROM videos v')}
     JOIN seasons s ON s.id = v.season_id WHERE v.id = ?`,
    [id],
  );
  if (!row) throw notFound('Video');
  const s = c.var.session;
  const privileged = !!s && (s.isAdmin || s.user.discord_id === row.author_discord_id);
  if (!privileged && (row.moderation_status !== 'approved' || row.season_published !== 1)) throw notFound('Video');
  return c.json({ video: toVideo(row, privileged) });
});

/** Public results. Refused until the season configuration allows publication. */
publicRoutes.get('/results', async (c) => {
  const { db, now } = c.var.deps;
  const seasonId = optionalInt(c.req.query('seasonId'), 'season id');
  if (!seasonId) throw badRequest('seasonId is required.');
  const season = await visibleSeason(c, seasonId);
  const t = now();
  if (!resultsVisible(seasonTimes(season), t)) {
    throw fail(403, 'results_not_published', 'Results for this season have not been published yet.', {
      season: toSeason(season, t),
    });
  }
  c.header('Cache-Control', 'no-store');
  return c.json(await computeResults(db, season, t));
});
