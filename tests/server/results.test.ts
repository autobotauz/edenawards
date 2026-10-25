import { describe, expect, it } from 'vitest';
import { ADMIN_ID, body, castVote, Client, DAY, HOUR, loggedIn, makeSeason, makeVideo, setup, T0 } from './helpers';

/** A season whose voting closed an hour ago, with results due at `publish`. */
async function finished(publishOffset = HOUR, resultsPublished = true) {
  const env = setup();
  const season = await makeSeason(env, {
    name: 'Eden Season 3 Awards',
    sub: [T0 - 10 * DAY, T0 - 5 * DAY],
    vote: [T0 - 5 * DAY, T0 - HOUR],
    publish: T0 + publishOffset,
    resultsPublished,
    categories: ['Solo', 'Group'],
  });
  const [c1, c2] = season.categoryIds;
  const a = await makeVideo(env, season.seasonId, c1, '700000000000000001', 'approved', T0 - 9 * DAY);
  const b = await makeVideo(env, season.seasonId, c1, '700000000000000002', 'approved', T0 - 8 * DAY);
  const c = await makeVideo(env, season.seasonId, c1, '700000000000000003', 'approved', T0 - 7 * DAY);
  const d = await makeVideo(env, season.seasonId, c2, '700000000000000004');
  const hidden = await makeVideo(env, season.seasonId, c2, '700000000000000005', 'hidden');
  // Solo: a=2, b=2 (tie for first), c=1.  Group: d=1; hidden video has 3 votes that must not count.
  let n = 0;
  const voter = () => `61000000000000000${n++}`;
  for (const vid of [a, a, b, b, c]) await castVote(env, season.seasonId, c1, vid, voter());
  await castVote(env, season.seasonId, c2, d, voter());
  for (let i = 0; i < 3; i++) await castVote(env, season.seasonId, c2, hidden, voter());
  return { env, season, c1, c2, a, b, c, d, hidden };
}

describe('public results', () => {
  it('stay hidden until the configured publication time', async () => {
    const { env, season } = await finished(HOUR);
    const anon = new Client(env);
    let res = await anon.get(`/api/results?seasonId=${season.seasonId}`);
    expect(res.status).toBe(403);
    const err = await body(res);
    expect(err.error.code).toBe('results_not_published');
    expect(JSON.stringify(err)).not.toMatch(/"votes"/);
    env.clock.now = T0 + HOUR;
    res = await anon.get(`/api/results?seasonId=${season.seasonId}`);
    expect(res.status).toBe(200);
  });

  it('stay hidden when the admin has not published them, even after the publish time', async () => {
    const { env, season } = await finished(-30 * 60_000, false);
    expect((await new Client(env).get(`/api/results?seasonId=${season.seasonId}`)).status).toBe(403);
    // Admins included: the public endpoint never leaks early.
    const admin = await loggedIn(env, ADMIN_ID);
    expect((await admin.get(`/api/results?seasonId=${season.seasonId}`)).status).toBe(403);
  });

  it('rank entries, show ties as shared winners, and ignore disqualified videos', async () => {
    const { env, season, a, b, c, d, hidden } = await finished(-1);
    const res = await body(await new Client(env).get(`/api/results?seasonId=${season.seasonId}`));
    expect(res.season.phase).toBe('completed');
    const [solo, group] = res.categories;
    expect(solo.entries.map((e: any) => [e.video.id, e.rank, e.votes, e.tied])).toEqual([
      [a, 1, 2, true],
      [b, 1, 2, true],
      [c, 3, 1, false],
    ]);
    expect(solo.winners.map((w: any) => w.video.id)).toEqual([a, b]);
    expect(solo.totalVotes).toBe(5);
    expect(group.entries.map((e: any) => e.video.id)).toEqual([d]);
    expect(group.entries.map((e: any) => e.video.id)).not.toContain(hidden);
    expect(group.winners[0].video.id).toBe(d);
  });

  it('do not count votes from banned accounts', async () => {
    const { env, season, a, b } = await finished(-1);
    await env.db.run("UPDATE users SET is_banned = 1 WHERE discord_id = '610000000000000000'"); // one of a's voters
    const res = await body(await new Client(env).get(`/api/results?seasonId=${season.seasonId}`));
    expect(res.categories[0].winners.map((w: any) => w.video.id)).toEqual([b]);
    expect(res.categories[0].entries.find((e: any) => e.video.id === a).votes).toBe(1);
  });

  it('remain available for historical seasons after a new season starts', async () => {
    const { env, season } = await finished(-1);
    const next = await makeSeason(env, { name: 'Eden Season 4 Awards', sub: [T0 + DAY, T0 + 3 * DAY], vote: [T0 + 3 * DAY, T0 + 5 * DAY] });
    const anon = new Client(env);
    const current = await body(await anon.get('/api/seasons/current'));
    expect(current.season.id).toBe(next.seasonId);
    expect(current.season.phase).toBe('upcoming');
    const list = await body(await anon.get('/api/seasons'));
    expect(list.seasons.map((s: any) => s.name)).toEqual(['Eden Season 4 Awards', 'Eden Season 3 Awards']);
    env.clock.now = T0 + 400 * DAY;
    expect((await anon.get(`/api/results?seasonId=${season.seasonId}`)).status).toBe(200);
  });

  it('validates the season parameter', async () => {
    const env = setup();
    expect((await new Client(env).get('/api/results')).status).toBe(400);
    expect((await new Client(env).get('/api/results?seasonId=999')).status).toBe(404);
  });

  it('exclude disabled categories', async () => {
    const { env, season, c2 } = await finished(-1);
    await env.db.run('UPDATE categories SET enabled = 0 WHERE id = ?', [c2]);
    const res = await body(await new Client(env).get(`/api/results?seasonId=${season.seasonId}`));
    expect(res.categories).toHaveLength(1);
  });
});

describe('private admin results (rehearsal)', () => {
  it('lets admins preview standings before publication, flagged as non-public', async () => {
    const { env, season, a, b } = await finished(DAY, false);
    const admin = await loggedIn(env, ADMIN_ID);
    const res = await body(await admin.get(`/api/admin/seasons/${season.seasonId}/results`));
    expect(res).toMatchObject({ final: true, public: false, participation: { voters: 9, votes: 9 } });
    expect(res.categories[0].winners.map((w: any) => w.video.id)).toEqual([a, b]);
  });

  it('reports non-final standings while voting is still open', async () => {
    const env = setup();
    const { seasonId } = await makeSeason(env);
    const admin = await loggedIn(env, ADMIN_ID);
    const res = await body(await admin.get(`/api/admin/seasons/${seasonId}/results`));
    expect(res.final).toBe(false);
    expect(res.participation).toEqual({ voters: 0, votes: 0 });
    // The public browsing API never exposes vote counts during voting.
    const vid = await makeVideo(env, seasonId, (await body(await admin.get(`/api/admin/seasons/${seasonId}`))).categories[0].id, '700000000000000001');
    const videos = await body(await new Client(env).get(`/api/videos?seasonId=${seasonId}`));
    expect(videos.videos.find((v: any) => v.id === vid)).not.toHaveProperty('votes');
  });
});

describe('seasons API', () => {
  it('returns no current season when none is published', async () => {
    const env = setup();
    await makeSeason(env, { published: false });
    expect(await body(await new Client(env).get('/api/seasons/current'))).toMatchObject({ season: null, categories: [] });
    expect(await body(await new Client(env).get('/api/categories'))).toEqual({ categories: [] });
  });

  it('prefers the season in progress over a finished one', async () => {
    const { env } = await finished(-1);
    const live = await makeSeason(env, { name: 'Live' });
    const cur = await body(await new Client(env).get('/api/seasons/current'));
    expect(cur.season.id).toBe(live.seasonId);
    expect(cur.categories).toHaveLength(2);
    expect(typeof cur.serverTime).toBe('string');
  });

  it('falls back to the most recently finished season', async () => {
    const { env, season } = await finished(-1);
    expect((await body(await new Client(env).get('/api/seasons/current'))).season.id).toBe(season.seasonId);
  });

  it('lists enabled categories for a season', async () => {
    const env = setup();
    const { seasonId, categoryIds } = await makeSeason(env, { categories: ['A', 'B', 'C'] });
    await env.db.run('UPDATE categories SET enabled = 0 WHERE id = ?', [categoryIds[1]]);
    const res = await body(await new Client(env).get(`/api/categories?seasonId=${seasonId}`));
    expect(res.categories.map((c: any) => c.name)).toEqual(['A', 'C']);
    expect((await body(await new Client(env).get(`/api/seasons/${seasonId}`))).categories).toHaveLength(2);
    expect((await new Client(env).get('/api/seasons/abc')).status).toBe(400);
  });
});
