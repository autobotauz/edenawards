import { Hono } from 'hono';
import type { AppEnv } from '../context';
import type { MyVote } from '../../shared/types';
import { parseVideoUrl } from '../../shared/video';
import { submissionState, votingState } from '../../shared/season';
import { badRequest, fail, iso, jsonBody, notFound, optionalInt } from '../lib/http';
import { requireActiveUser, requireUser } from '../lib/session';
import { enforce, LIMITS } from '../lib/ratelimit';
import { cleanText, TITLE_MAX, TITLE_MIN } from '../lib/validation';
import { seasonTimes, toVideo, VIDEO_SELECT, type CategoryRow, type SeasonRow, type VideoRow } from '../lib/mappers';
import { verifyVideo } from '../providers/verify';
import { isConstraintError } from '../db';

export const participate = new Hono<AppEnv>();

/* ------------------------------------------------------------------ submissions */

participate.post('/videos', async (c) => {
  const session = requireActiveUser(c);
  const { db, now, config, fetch } = c.var.deps;
  const body = await jsonBody(c);

  const errors: Record<string, string> = {};
  const title = cleanText(body.title, { field: 'Title', min: TITLE_MIN, max: TITLE_MAX });
  if ('error' in title) errors.title = title.error;
  const parsed = parseVideoUrl(typeof body.url === 'string' ? body.url : '');
  if (!parsed.ok) errors.url = parsed.error;
  const categoryId = typeof body.categoryId === 'number' && Number.isSafeInteger(body.categoryId) ? body.categoryId : null;
  if (!categoryId) errors.categoryId = 'Please choose an award category.';
  if (Object.keys(errors).length) throw badRequest('Please fix the highlighted fields.', { fields: errors });

  // The season is derived from the category — the client cannot pick a different one.
  const category = await db.first<CategoryRow & { is_published: number }>(
    'SELECT c.*, s.is_published FROM categories c JOIN seasons s ON s.id = c.season_id WHERE c.id = ?',
    [categoryId!],
  );
  if (!category || category.enabled !== 1 || category.is_published !== 1) {
    throw badRequest('That award category is not available.', { fields: { categoryId: 'Choose a valid category.' } });
  }
  const season = (await db.first<SeasonRow>('SELECT * FROM seasons WHERE id = ?', [category.season_id]))!;

  const t = now();
  const state = submissionState(seasonTimes(season), t);
  if (state === 'upcoming') throw fail(409, 'submissions_not_open', 'Submissions for this season have not opened yet.');
  if (state === 'closed') throw fail(409, 'submissions_closed', 'Submissions for this season are closed.');

  await enforce(db, `submit:${session.user.discord_id}`, LIMITS.submit, t);

  const video = (parsed as Extract<typeof parsed, { ok: true }>).video;
  const dup = await db.first<{ id: number }>(
    'SELECT id FROM videos WHERE season_id = ? AND platform = ? AND platform_video_id = ?',
    [season.id, video.platform, video.videoId],
  );
  if (dup) throw fail(409, 'duplicate_video', 'This video has already been submitted this season.', { videoId: dup.id });

  const check = await verifyVideo(video, {
    fetch,
    youtubeApiKey: config.youtubeApiKey,
    twitch: config.twitch,
    keywords: config.relevanceKeywords,
    now,
  });
  if (check.decision === 'rejected') {
    throw badRequest(check.reason, { fields: { url: check.reason } });
  }

  // Re-check the deadline after the (possibly slow) external verification.
  const t2 = now();
  if (submissionState(seasonTimes(season), t2) !== 'open')
    throw fail(409, 'submissions_closed', 'Submissions for this season are closed.');

  let id: number;
  try {
    const res = await db.run(
      `INSERT INTO videos (season_id, category_id, author_discord_id, title, platform, platform_video_id,
                           canonical_url, thumbnail_url, moderation_status, moderation_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        season.id,
        category.id,
        session.user.discord_id,
        (title as { value: string }).value,
        video.platform,
        video.videoId,
        video.canonicalUrl,
        check.thumbnailUrl ?? null,
        check.decision,
        check.reason,
        t2,
      ],
    );
    id = res.lastRowId;
  } catch (err) {
    // Two simultaneous submissions of the same video: the UNIQUE constraint decides.
    if (isConstraintError(err)) throw fail(409, 'duplicate_video', 'This video has already been submitted this season.');
    throw err;
  }
  const row = (await db.first<VideoRow>(`${VIDEO_SELECT} WHERE v.id = ?`, [id]))!;
  return c.json({ video: toVideo(row, true) }, 201);
});

participate.get('/videos/mine', async (c) => {
  const session = requireUser(c);
  const seasonId = optionalInt(c.req.query('seasonId'), 'season id');
  const rows = await c.var.deps.db.all<VideoRow>(
    `${VIDEO_SELECT} WHERE v.author_discord_id = ? ${seasonId ? 'AND v.season_id = ?' : ''}
     ORDER BY v.created_at DESC, v.id DESC`,
    seasonId ? [session.user.discord_id, seasonId] : [session.user.discord_id],
  );
  return c.json({ videos: rows.map((r) => toVideo(r, true)) });
});

/* ------------------------------------------------------------------------ votes */

participate.post('/votes', async (c) => {
  const session = requireActiveUser(c);
  const { db, now } = c.var.deps;
  const body = await jsonBody(c);
  const videoId = typeof body.videoId === 'number' && Number.isSafeInteger(body.videoId) ? body.videoId : null;
  const categoryId = typeof body.categoryId === 'number' && Number.isSafeInteger(body.categoryId) ? body.categoryId : null;
  if (!videoId || !categoryId) throw badRequest('videoId and categoryId are required.');

  const t = now();
  await enforce(db, `vote:${session.user.discord_id}`, LIMITS.vote, t);

  const target = await db.first<{
    season_id: number;
    category_id: number;
    moderation_status: string;
    author_discord_id: string;
    enabled: number;
  } & SeasonRow>(
    `SELECT s.*, v.season_id, v.category_id, v.moderation_status, v.author_discord_id, c.enabled
     FROM videos v JOIN categories c ON c.id = v.category_id JOIN seasons s ON s.id = v.season_id
     WHERE v.id = ? AND s.is_published = 1`,
    [videoId],
  );
  if (!target) throw notFound('Video');
  if (target.category_id !== categoryId)
    throw badRequest('That video is not in the selected category.');
  if (target.enabled !== 1) throw fail(409, 'category_disabled', 'This category is not open for voting.');
  if (target.moderation_status !== 'approved')
    throw fail(409, 'video_not_eligible', 'This video is not eligible for votes.');

  const vs = votingState(seasonTimes(target), t);
  if (vs === 'upcoming') throw fail(409, 'voting_not_open', 'Voting has not opened yet.');
  if (vs === 'closed') throw fail(409, 'voting_closed', 'Voting has closed. Votes can no longer be cast or changed.');

  if (target.allow_self_vote !== 1 && target.author_discord_id === session.user.discord_id)
    throw fail(409, 'self_vote', 'You cannot vote for your own submission.');

  /*
   * One atomic statement does the write. The INSERT ... SELECT re-checks every rule in the
   * database itself (approved video, category, voting window, self-vote policy), and the
   * UNIQUE(season_id, category_id, voter_discord_id) constraint turns a second vote into an
   * update of the existing one. Concurrent requests therefore can never create two votes.
   */
  const res = await db.run(
    `INSERT INTO votes (season_id, category_id, video_id, voter_discord_id, created_at, updated_at)
     SELECT v.season_id, v.category_id, v.id, ?, ?, ?
     FROM videos v JOIN seasons s ON s.id = v.season_id JOIN categories c ON c.id = v.category_id
     WHERE v.id = ? AND v.category_id = ? AND v.moderation_status = 'approved' AND c.enabled = 1
       AND s.is_published = 1 AND s.voting_starts_at <= ? AND ? < s.voting_ends_at
       AND (s.allow_self_vote = 1 OR v.author_discord_id <> ?)
     ON CONFLICT (season_id, category_id, voter_discord_id)
     DO UPDATE SET video_id = excluded.video_id, updated_at = excluded.updated_at`,
    [session.user.discord_id, t, t, videoId, categoryId, t, t, session.user.discord_id],
  );
  if (res.changes === 0) throw fail(409, 'vote_rejected', 'Your vote could not be recorded. Please refresh and try again.');

  return c.json({ vote: { seasonId: target.season_id, categoryId, videoId, videoEligible: true, updatedAt: iso(t) } });
});

participate.get('/votes/mine', async (c) => {
  const session = requireUser(c);
  const seasonId = optionalInt(c.req.query('seasonId'), 'season id');
  const rows = await c.var.deps.db.all<{
    season_id: number;
    category_id: number;
    video_id: number;
    updated_at: number;
    moderation_status: string;
  }>(
    `SELECT vo.season_id, vo.category_id, vo.video_id, vo.updated_at, v.moderation_status
     FROM votes vo JOIN videos v ON v.id = vo.video_id
     WHERE vo.voter_discord_id = ? ${seasonId ? 'AND vo.season_id = ?' : ''}
     ORDER BY vo.season_id DESC, vo.category_id`,
    seasonId ? [session.user.discord_id, seasonId] : [session.user.discord_id],
  );
  const votes: MyVote[] = rows.map((r) => ({
    seasonId: r.season_id,
    categoryId: r.category_id,
    videoId: r.video_id,
    videoEligible: r.moderation_status === 'approved',
    updatedAt: iso(r.updated_at)!,
  }));
  return c.json({ votes });
});
