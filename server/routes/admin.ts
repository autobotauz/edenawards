import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../context';
import type { ModerationStatus } from '../../shared/types';
import { resultsVisible, votingState } from '../../shared/season';
import { badRequest, fail, intParam, iso, jsonBody, notFound, optionalInt, pagination } from '../lib/http';
import { requireAdmin } from '../lib/session';
import {
  seasonTimes,
  toCategory,
  toPublicUser,
  toSeason,
  toVideo,
  VIDEO_SELECT,
  type CategoryRow,
  type SeasonRow,
  type UserRow,
  type VideoRow,
} from '../lib/mappers';
import {
  checkLockedTimes,
  checkTimeOrder,
  cleanLongText,
  cleanText,
  parseTime,
  TIME_FIELDS,
  type FieldErrors,
  type SeasonTimesInput,
} from '../lib/validation';
import { audit, categoriesFor, getSeasonRow } from '../lib/seasons';
import { computeResults } from '../lib/results';
import { isConstraintError, type SqlValue, type Statement } from '../db';

export const admin = new Hono<AppEnv>();

// Every admin route requires an allow-listed Discord ID, checked server-side.
admin.use('*', async (c, next) => {
  requireAdmin(c);
  c.header('Cache-Control', 'no-store');
  await next();
});

const actor = (c: Ctx) => c.var.session!.user.discord_id;

async function seasonOr404(c: Ctx, id: number): Promise<SeasonRow> {
  const row = await getSeasonRow(c.var.deps.db, id);
  if (!row) throw notFound('Season');
  return row;
}

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

/* ------------------------------------------------------------------- overview */

admin.get('/overview', async (c) => {
  const { db, config, now } = c.var.deps;
  const t = now();
  const [seasons, subs, votes, pending] = await Promise.all([
    db.all<SeasonRow>('SELECT * FROM seasons ORDER BY submission_starts_at DESC, id DESC'),
    db.all<{ season_id: number; moderation_status: ModerationStatus; n: number }>(
      'SELECT season_id, moderation_status, COUNT(*) AS n FROM videos GROUP BY season_id, moderation_status',
    ),
    db.all<{ season_id: number; votes: number; voters: number }>(
      'SELECT season_id, COUNT(*) AS votes, COUNT(DISTINCT voter_discord_id) AS voters FROM votes GROUP BY season_id',
    ),
    db.first<{ n: number }>("SELECT COUNT(*) AS n FROM videos WHERE moderation_status = 'pending'"),
  ]);
  return c.json({
    status: {
      serverTime: iso(t),
      database: 'ok',
      discordConfigured: config.discord !== null,
      devLoginEnabled: config.devLogin,
      youtubeVerification: config.youtubeApiKey !== null,
      twitchVerification: config.twitch !== null,
      adminCount: config.adminIds.size,
    },
    pendingSubmissions: Number(pending?.n ?? 0),
    seasons: seasons.map((s) => {
      const counts = { pending: 0, approved: 0, rejected: 0, hidden: 0 };
      for (const r of subs) if (r.season_id === s.id) counts[r.moderation_status] = Number(r.n);
      const v = votes.find((r) => r.season_id === s.id);
      return {
        season: toSeason(s, t),
        submissions: counts,
        votes: Number(v?.votes ?? 0),
        voters: Number(v?.voters ?? 0),
      };
    }),
  });
});

/* -------------------------------------------------------------------- seasons */

admin.get('/seasons', async (c) => {
  const { db, now } = c.var.deps;
  const rows = await db.all<SeasonRow>('SELECT * FROM seasons ORDER BY submission_starts_at DESC, id DESC');
  return c.json({ seasons: rows.map((r) => toSeason(r, now())) });
});

admin.get('/seasons/:id', async (c) => {
  const { db, now } = c.var.deps;
  const season = await seasonOr404(c, intParam(c.req.param('id'), 'season id'));
  const cats = await categoriesFor(db, season.id, true);
  const counts = await db.all<{ category_id: number; videos: number; approved: number }>(
    `SELECT category_id, COUNT(*) AS videos, SUM(moderation_status = 'approved') AS approved
     FROM videos WHERE season_id = ? GROUP BY category_id`,
    [season.id],
  );
  const voteCounts = await db.all<{ category_id: number; votes: number }>(
    'SELECT category_id, COUNT(*) AS votes FROM votes WHERE season_id = ? GROUP BY category_id',
    [season.id],
  );
  return c.json({
    season: toSeason(season, now()),
    categories: cats.map((cat) => ({
      ...toCategory(cat),
      videoCount: Number(counts.find((r) => r.category_id === cat.id)?.videos ?? 0),
      approvedCount: Number(counts.find((r) => r.category_id === cat.id)?.approved ?? 0),
      voteCount: Number(voteCounts.find((r) => r.category_id === cat.id)?.votes ?? 0),
    })),
  });
});

function readTimes(body: Record<string, unknown>, base: SeasonTimesInput | null): { times: SeasonTimesInput; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const times = { ...(base ?? {}) } as SeasonTimesInput;
  for (const [col, field] of TIME_FIELDS) {
    if (body[field] === undefined) {
      if (!base) errors[field] = 'This date is required.';
      continue;
    }
    const ms = parseTime(body[field]);
    if (ms === null) errors[field] = 'Invalid date.';
    else times[col] = ms;
  }
  return { times, errors };
}

admin.post('/seasons', async (c) => {
  const { db, now } = c.var.deps;
  const body = await jsonBody(c);
  const t = now();
  const errors: FieldErrors = {};
  const name = cleanText(body.name, { field: 'Name', min: 3, max: 80 });
  if ('error' in name) errors.name = name.error;
  const description = cleanLongText(body.description, 'Description', 2000);
  if ('error' in description) errors.description = description.error;
  const { times, errors: timeErrors } = readTimes(body, null);
  Object.assign(errors, timeErrors);
  if (!Object.keys(timeErrors).length) Object.assign(errors, checkTimeOrder(times));
  const copyFrom = body.copyCategoriesFrom === undefined || body.copyCategoriesFrom === null ? null : Number(body.copyCategoriesFrom);
  if (copyFrom !== null && !Number.isSafeInteger(copyFrom)) errors.copyCategoriesFrom = 'Invalid season.';
  if (Object.keys(errors).length) throw badRequest('Please fix the highlighted fields.', { fields: errors });

  if (await db.first('SELECT id FROM seasons WHERE name = ?', [(name as { value: string }).value]))
    throw fail(409, 'duplicate_name', 'A season with this name already exists.', { fields: { name: 'Name already used.' } });

  const res = await db.run(
    `INSERT INTO seasons (name, description, submission_starts_at, submission_ends_at, voting_starts_at,
                          voting_ends_at, results_publish_at, is_published, results_published, allow_self_vote,
                          created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      (name as { value: string }).value,
      (description as { value: string }).value,
      times.submission_starts_at,
      times.submission_ends_at,
      times.voting_starts_at,
      times.voting_ends_at,
      times.results_publish_at,
      body.isPublished === true ? 1 : 0,
      body.allowSelfVote === true ? 1 : 0,
      t,
      t,
    ],
  );
  const id = res.lastRowId;

  if (copyFrom !== null) {
    // "Prepare the next season": copy the category list (names, descriptions, order) — never entries or votes.
    await db.run(
      `INSERT INTO categories (season_id, name, description, enabled, display_order, created_at)
       SELECT ?, name, description, enabled, display_order, ? FROM categories WHERE season_id = ?`,
      [id, t, copyFrom],
    );
  }
  await audit(db, actor(c), 'season.create', `season:${id}`, { name: (name as { value: string }).value, copyFrom }, t);
  return c.json({ season: toSeason((await getSeasonRow(db, id))!, t) }, 201);
});

admin.patch('/seasons/:id', async (c) => {
  const { db, now } = c.var.deps;
  const existing = await seasonOr404(c, intParam(c.req.param('id'), 'season id'));
  const body = await jsonBody(c);
  const t = now();
  const errors: FieldErrors = {};
  const sets: string[] = [];
  const params: SqlValue[] = [];
  const set = (col: string, v: SqlValue) => {
    sets.push(`${col} = ?`);
    params.push(v);
  };

  if (body.name !== undefined) {
    const name = cleanText(body.name, { field: 'Name', min: 3, max: 80 });
    if ('error' in name) errors.name = name.error;
    else set('name', name.value);
  }
  if (body.description !== undefined) {
    const d = cleanLongText(body.description, 'Description', 2000);
    if ('error' in d) errors.description = d.error;
    else set('description', d.value);
  }

  const base: SeasonTimesInput = {
    submission_starts_at: existing.submission_starts_at,
    submission_ends_at: existing.submission_ends_at,
    voting_starts_at: existing.voting_starts_at,
    voting_ends_at: existing.voting_ends_at,
    results_publish_at: existing.results_publish_at,
  };
  const { times, errors: timeErrors } = readTimes(body, base);
  Object.assign(errors, timeErrors);
  if (!Object.keys(timeErrors).length) {
    Object.assign(errors, checkTimeOrder(times), checkLockedTimes(existing, times, t));
    for (const [col] of TIME_FIELDS) if (times[col] !== existing[col]) set(col, times[col]);
  }

  if (body.isPublished !== undefined) {
    if (!isBool(body.isPublished)) errors.isPublished = 'Must be true or false.';
    else if (!body.isPublished && existing.is_published === 1 && t >= existing.submission_starts_at)
      errors.isPublished = 'A season cannot be unpublished after submissions have opened.';
    else set('is_published', body.isPublished ? 1 : 0);
  }
  if (body.allowSelfVote !== undefined) {
    if (!isBool(body.allowSelfVote)) errors.allowSelfVote = 'Must be true or false.';
    else if ((body.allowSelfVote ? 1 : 0) !== existing.allow_self_vote && t >= existing.voting_starts_at)
      errors.allowSelfVote = 'Voting rules cannot change once voting has opened.';
    else set('allow_self_vote', body.allowSelfVote ? 1 : 0);
  }
  if (body.resultsPublished !== undefined) {
    if (!isBool(body.resultsPublished)) errors.resultsPublished = 'Must be true or false.';
    else if (body.resultsPublished && t < times.voting_ends_at)
      errors.resultsPublished = 'Results can only be published after voting closes.';
    else if (body.resultsPublished && existing.is_published !== 1 && body.isPublished !== true)
      errors.resultsPublished = 'Publish the season before publishing its results.';
    else set('results_published', body.resultsPublished ? 1 : 0);
  }

  if (Object.keys(errors).length) throw badRequest('Please fix the highlighted fields.', { fields: errors });
  if (sets.length === 0) return c.json({ season: toSeason(existing, t) });

  set('updated_at', t);
  try {
    await db.run(`UPDATE seasons SET ${sets.join(', ')} WHERE id = ?`, [...params, existing.id]);
  } catch (err) {
    if (isConstraintError(err))
      throw fail(409, 'conflict', 'That change conflicts with another season or the schedule rules.');
    throw err;
  }
  const changed = Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'description'));
  await audit(db, actor(c), 'season.update', `season:${existing.id}`, changed, t);
  return c.json({ season: toSeason((await getSeasonRow(db, existing.id))!, t) });
});

/** Private standings: available to admins at any time for review and presentation rehearsal. */
admin.get('/seasons/:id/results', async (c) => {
  const { db, now } = c.var.deps;
  const season = await seasonOr404(c, intParam(c.req.param('id'), 'season id'));
  const results = await computeResults(db, season, now());
  const participation = await db.first<{ voters: number; votes: number }>(
    'SELECT COUNT(DISTINCT voter_discord_id) AS voters, COUNT(*) AS votes FROM votes WHERE season_id = ?',
    [season.id],
  );
  return c.json({
    ...results,
    participation: { voters: Number(participation?.voters ?? 0), votes: Number(participation?.votes ?? 0) },
    final: votingState(seasonTimes(season), now()) === 'closed',
    public: resultsVisible(seasonTimes(season), now()),
  });
});

/* ----------------------------------------------------------------- categories */

admin.post('/categories', async (c) => {
  const { db, now } = c.var.deps;
  const body = await jsonBody(c);
  const t = now();
  const seasonId = typeof body.seasonId === 'number' ? body.seasonId : NaN;
  if (!Number.isSafeInteger(seasonId)) throw badRequest('seasonId is required.');
  const season = await seasonOr404(c, seasonId);
  const errors: FieldErrors = {};
  const name = cleanText(body.name, { field: 'Name', min: 2, max: 60 });
  if ('error' in name) errors.name = name.error;
  const description = cleanLongText(body.description, 'Description', 500);
  if ('error' in description) errors.description = description.error;
  if (Object.keys(errors).length) throw badRequest('Please fix the highlighted fields.', { fields: errors });
  if (t >= season.submission_ends_at)
    throw fail(409, 'season_locked', 'Categories cannot be added after submissions have closed.');

  const order =
    typeof body.displayOrder === 'number' && Number.isSafeInteger(body.displayOrder)
      ? body.displayOrder
      : Number((await db.first<{ n: number }>('SELECT COALESCE(MAX(display_order), 0) + 1 AS n FROM categories WHERE season_id = ?', [season.id]))?.n ?? 1);
  try {
    const res = await db.run(
      'INSERT INTO categories (season_id, name, description, enabled, display_order, created_at) VALUES (?, ?, ?, 1, ?, ?)',
      [season.id, (name as { value: string }).value, (description as { value: string }).value, order, t],
    );
    await audit(db, actor(c), 'category.create', `category:${res.lastRowId}`, { seasonId: season.id, name: (name as { value: string }).value }, t);
    const row = (await db.first<CategoryRow>('SELECT * FROM categories WHERE id = ?', [res.lastRowId]))!;
    return c.json({ category: toCategory(row) }, 201);
  } catch (err) {
    if (isConstraintError(err))
      throw fail(409, 'duplicate_name', 'This season already has a category with that name.', { fields: { name: 'Name already used.' } });
    throw err;
  }
});

async function categoryOr404(c: Ctx, id: number) {
  const row = await c.var.deps.db.first<CategoryRow>('SELECT * FROM categories WHERE id = ?', [id]);
  if (!row) throw notFound('Category');
  return row;
}

admin.patch('/categories/:id', async (c) => {
  const { db, now } = c.var.deps;
  const cat = await categoryOr404(c, intParam(c.req.param('id'), 'category id'));
  const season = (await getSeasonRow(db, cat.season_id))!;
  const body = await jsonBody(c);
  const t = now();
  const errors: FieldErrors = {};
  const sets: string[] = [];
  const params: SqlValue[] = [];

  // Renaming keeps the category's identity (its id), so votes and entries stay attached.
  if (body.name !== undefined) {
    const name = cleanText(body.name, { field: 'Name', min: 2, max: 60 });
    if ('error' in name) errors.name = name.error;
    else (sets.push('name = ?'), params.push(name.value));
  }
  if (body.description !== undefined) {
    const d = cleanLongText(body.description, 'Description', 500);
    if ('error' in d) errors.description = d.error;
    else (sets.push('description = ?'), params.push(d.value));
  }
  if (body.displayOrder !== undefined) {
    if (typeof body.displayOrder !== 'number' || !Number.isSafeInteger(body.displayOrder)) errors.displayOrder = 'Must be a whole number.';
    else (sets.push('display_order = ?'), params.push(body.displayOrder));
  }
  if (body.enabled !== undefined) {
    if (!isBool(body.enabled)) errors.enabled = 'Must be true or false.';
    else if ((body.enabled ? 1 : 0) !== cat.enabled && t >= season.voting_starts_at)
      errors.enabled = 'Categories cannot be enabled or disabled once voting has opened.';
    else (sets.push('enabled = ?'), params.push(body.enabled ? 1 : 0));
  }
  if (Object.keys(errors).length) throw badRequest('Please fix the highlighted fields.', { fields: errors });
  if (sets.length) {
    try {
      await db.run(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`, [...params, cat.id]);
    } catch (err) {
      if (isConstraintError(err))
        throw fail(409, 'duplicate_name', 'This season already has a category with that name.', { fields: { name: 'Name already used.' } });
      throw err;
    }
    await audit(db, actor(c), 'category.update', `category:${cat.id}`, body, t);
  }
  return c.json({ category: toCategory((await db.first<CategoryRow>('SELECT * FROM categories WHERE id = ?', [cat.id]))!) });
});

/** Deleting is only possible while a category is still empty; otherwise disable it. */
admin.delete('/categories/:id', async (c) => {
  const { db, now } = c.var.deps;
  const cat = await categoryOr404(c, intParam(c.req.param('id'), 'category id'));
  const used = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM videos WHERE category_id = ?', [cat.id]);
  if (Number(used?.n ?? 0) > 0)
    throw fail(409, 'category_in_use', 'This category has submissions and cannot be deleted. Disable it instead.');
  await db.run('DELETE FROM categories WHERE id = ?', [cat.id]);
  await audit(db, actor(c), 'category.delete', `category:${cat.id}`, { name: cat.name }, now());
  return c.json({ ok: true });
});

/* ----------------------------------------------------------------- moderation */

admin.get('/videos', async (c) => {
  const { db } = c.var.deps;
  const { page, pageSize, offset } = pagination(c, 25, 100);
  const where: string[] = [];
  const params: SqlValue[] = [];
  const status = c.req.query('status');
  if (status) {
    if (!['pending', 'approved', 'rejected', 'hidden'].includes(status)) throw badRequest('Invalid status filter.');
    where.push('v.moderation_status = ?');
    params.push(status);
  }
  const seasonId = optionalInt(c.req.query('seasonId'), 'season id');
  if (seasonId) (where.push('v.season_id = ?'), params.push(seasonId));
  const categoryId = optionalInt(c.req.query('categoryId'), 'category id');
  if (categoryId) (where.push('v.category_id = ?'), params.push(categoryId));
  const q = (c.req.query('q') ?? '').trim().slice(0, 100);
  if (q) {
    where.push("(v.title LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    params.push(like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows, total] = await Promise.all([
    db.all<VideoRow & { votes: number }>(
      `${VIDEO_SELECT.replace('FROM videos v', ', (SELECT COUNT(*) FROM votes vo WHERE vo.video_id = v.id) AS votes FROM videos v')}
       ${whereSql} ORDER BY v.created_at DESC, v.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    ),
    db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM videos v JOIN users u ON u.discord_id = v.author_discord_id ${whereSql}`,
      params,
    ),
  ]);
  return c.json({
    videos: rows.map((r) => ({ ...toVideo(r, true), votes: Number(r.votes) })),
    page,
    pageSize,
    total: Number(total?.n ?? 0),
  });
});

admin.patch('/videos/:id/moderation', async (c) => {
  const { db, now } = c.var.deps;
  const id = intParam(c.req.param('id'), 'video id');
  const body = await jsonBody(c);
  const status = body.status;
  if (status !== 'approved' && status !== 'rejected' && status !== 'hidden' && status !== 'pending')
    throw badRequest('status must be approved, rejected, hidden or pending.');
  const reason = cleanLongText(body.reason, 'Reason', 300);
  if ('error' in reason) throw badRequest(reason.error);

  const video = await db.first<{ id: number; season_id: number; moderation_status: string }>(
    'SELECT id, season_id, moderation_status FROM videos WHERE id = ?',
    [id],
  );
  if (!video) throw notFound('Video');
  const season = (await getSeasonRow(db, video.season_id))!;
  const t = now();
  if (resultsVisible(seasonTimes(season), t))
    throw fail(409, 'results_published', 'Results for this season are public. Unpublish the results before changing moderation.');

  await db.batch([
    {
      sql: 'UPDATE videos SET moderation_status = ?, moderation_reason = ?, moderated_by = ?, moderated_at = ? WHERE id = ?',
      params: [status, reason.value || null, actor(c), t, id],
    },
    {
      sql: 'INSERT INTO audit_log (actor_id, action, target, details, created_at) VALUES (?, ?, ?, ?, ?)',
      params: [actor(c), 'video.moderate', `video:${id}`, JSON.stringify({ from: video.moderation_status, to: status, reason: reason.value }), t],
    },
  ] satisfies Statement[]);
  const row = (await db.first<VideoRow>(`${VIDEO_SELECT} WHERE v.id = ?`, [id]))!;
  return c.json({ video: toVideo(row, true) });
});

/* ---------------------------------------------------------------------- users */

admin.get('/users', async (c) => {
  const { db, config } = c.var.deps;
  const { page, pageSize, offset } = pagination(c, 25, 100);
  const q = (c.req.query('q') ?? '').trim().slice(0, 100);
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const where = q ? "WHERE u.username LIKE ? ESCAPE '\\' OR u.global_name LIKE ? ESCAPE '\\' OR u.discord_id = ?" : '';
  const params: SqlValue[] = q ? [like, like, q] : [];
  const rows = await db.all<UserRow & { submissions: number; votes: number }>(
    `SELECT u.*,
       (SELECT COUNT(*) FROM videos v WHERE v.author_discord_id = u.discord_id) AS submissions,
       (SELECT COUNT(*) FROM votes vo WHERE vo.voter_discord_id = u.discord_id) AS votes
     FROM users u ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );
  const total = await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM users u ${where}`, params);
  return c.json({
    users: rows.map((u) => ({
      ...toPublicUser(u.discord_id, u.username, u.global_name, u.avatar),
      isAdmin: config.adminIds.has(u.discord_id),
      isBanned: u.is_banned === 1,
      submissions: Number(u.submissions),
      votes: Number(u.votes),
      createdAt: iso(u.created_at),
    })),
    page,
    pageSize,
    total: Number(total?.n ?? 0),
  });
});

admin.patch('/users/:id', async (c) => {
  const { db, config, now } = c.var.deps;
  const id = c.req.param('id');
  if (!/^\d{5,25}$/.test(id)) throw badRequest('Invalid Discord ID.');
  const body = await jsonBody(c);
  if (!isBool(body.banned)) throw badRequest('banned must be true or false.');
  if (body.banned && config.adminIds.has(id)) throw fail(409, 'cannot_ban_admin', 'Administrators cannot be banned.');
  const res = await db.run('UPDATE users SET is_banned = ?, updated_at = ? WHERE discord_id = ?', [body.banned ? 1 : 0, now(), id]);
  if (res.changes === 0) throw notFound('User');
  if (body.banned) await db.run('DELETE FROM sessions WHERE discord_id = ?', [id]);
  await audit(db, actor(c), body.banned ? 'user.ban' : 'user.unban', `user:${id}`, undefined, now());
  return c.json({ ok: true });
});

/* ---------------------------------------------------------------------- audit */

admin.get('/audit', async (c) => {
  const { db } = c.var.deps;
  const { page, pageSize, offset } = pagination(c, 50, 200);
  const rows = await db.all<{ id: number; actor_id: string; action: string; target: string | null; details: string | null; created_at: number; username: string | null }>(
    `SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON u.discord_id = a.actor_id
     ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
    [pageSize, offset],
  );
  return c.json({
    entries: rows.map((r) => ({
      id: r.id,
      actor: r.username ?? r.actor_id,
      action: r.action,
      target: r.target,
      details: r.details,
      createdAt: iso(r.created_at),
    })),
    page,
    pageSize,
  });
});
