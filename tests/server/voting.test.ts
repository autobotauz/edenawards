import { describe, expect, it } from 'vitest';
import { body, castVote, Client, DAY, HOUR, loggedIn, makeSeason, makeVideo, setup, T0 } from './helpers';

const VOTER = '444444444444444444';

async function arena(opts: Parameters<typeof makeSeason>[1] = {}) {
  const env = setup();
  const season = await makeSeason(env, { categories: ['Solo', 'Group', 'Funny'], ...opts });
  const [c1, c2, c3] = season.categoryIds;
  const v1a = await makeVideo(env, season.seasonId, c1, '700000000000000001');
  const v1b = await makeVideo(env, season.seasonId, c1, '700000000000000002');
  const v2a = await makeVideo(env, season.seasonId, c2, '700000000000000003');
  const v3a = await makeVideo(env, season.seasonId, c3, VOTER); // the voter's own entry
  const pending = await makeVideo(env, season.seasonId, c1, '700000000000000004', 'pending');
  const voter = await loggedIn(env, VOTER);
  return { env, season, voter, c1, c2, c3, v1a, v1b, v2a, v3a, pending };
}

const countVotes = (env: ReturnType<typeof setup>) =>
  (env.raw.prepare('SELECT COUNT(*) AS n FROM votes').get() as { n: number }).n;

describe('POST /api/votes', () => {
  it('records exactly one vote per category per season', async () => {
    const { env, voter, c1, v1a } = await arena();
    const res = await voter.post('/api/votes', { videoId: v1a, categoryId: c1 });
    expect(res.status).toBe(200);
    expect((await body(res)).vote).toMatchObject({ categoryId: c1, videoId: v1a, videoEligible: true });
    // Voting for the same video again is idempotent.
    expect((await voter.post('/api/votes', { videoId: v1a, categoryId: c1 })).status).toBe(200);
    expect(countVotes(env)).toBe(1);
  });

  it('allows one vote in each of several categories', async () => {
    const { env, voter, c1, c2, v1a, v2a } = await arena();
    await voter.post('/api/votes', { videoId: v1a, categoryId: c1 });
    await voter.post('/api/votes', { videoId: v2a, categoryId: c2 });
    expect(countVotes(env)).toBe(2);
    const mine = await body(await voter.get('/api/votes/mine'));
    expect(mine.votes.map((v: any) => v.videoId).sort()).toEqual([v1a, v2a].sort());
  });

  it('changing a vote replaces the previous selection', async () => {
    const { env, voter, c1, v1a, v1b } = await arena();
    await voter.post('/api/votes', { videoId: v1a, categoryId: c1 });
    env.clock.now += 1000;
    await voter.post('/api/votes', { videoId: v1b, categoryId: c1 });
    const rows = env.raw.prepare('SELECT video_id, created_at, updated_at FROM votes').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].video_id).toBe(v1b);
    expect(rows[0].updated_at).toBeGreaterThan(rows[0].created_at);
  });

  it('cannot create duplicate votes under concurrent requests', async () => {
    const { env, voter, c1, v1a, v1b } = await arena();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => voter.post('/api/votes', { videoId: i % 2 ? v1a : v1b, categoryId: c1 })),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(countVotes(env)).toBe(1);
  });

  it('the database itself rejects a second vote row for the same category', async () => {
    const { env, season, c1, v1a, v1b } = await arena();
    const insert = (vid: number) =>
      env.raw
        .prepare('INSERT INTO votes (season_id, category_id, video_id, voter_discord_id, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)')
        .run(season.seasonId, c1, vid, VOTER);
    insert(v1a);
    expect(() => insert(v1b)).toThrow(/UNIQUE constraint failed/);
  });

  it('the database rejects a vote whose video is in a different category or season', async () => {
    const { env, season, c2, v1a } = await arena();
    expect(() =>
      env.raw
        .prepare('INSERT INTO votes (season_id, category_id, video_id, voter_discord_id, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)')
        .run(season.seasonId, c2, v1a, VOTER),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('rejects a video submitted under the wrong category', async () => {
    const { voter, c2, v1a } = await arena();
    const res = await voter.post('/api/votes', { videoId: v1a, categoryId: c2 });
    expect(res.status).toBe(400);
  });

  it('rejects unapproved, unknown and malformed targets', async () => {
    const { voter, c1, pending } = await arena();
    const res = await voter.post('/api/votes', { videoId: pending, categoryId: c1 });
    expect(res.status).toBe(409);
    expect((await body(res)).error.code).toBe('video_not_eligible');
    expect((await voter.post('/api/votes', { videoId: 99999, categoryId: c1 })).status).toBe(404);
    expect((await voter.post('/api/votes', { videoId: '1', categoryId: c1 })).status).toBe(400);
    expect((await voter.post('/api/votes', {})).status).toBe(400);
  });

  it('rejects votes for one’s own submission by default', async () => {
    const { voter, c3, v3a } = await arena();
    const res = await voter.post('/api/votes', { videoId: v3a, categoryId: c3 });
    expect(res.status).toBe(409);
    expect((await body(res)).error.code).toBe('self_vote');
  });

  it('allows self-votes when the season policy permits them', async () => {
    const { voter, c3, v3a } = await arena({ allowSelfVote: true });
    expect((await voter.post('/api/votes', { videoId: v3a, categoryId: c3 })).status).toBe(200);
  });

  it('enforces the voting window on the server, at the exact boundaries', async () => {
    const { env, voter, c1, v1a, v1b } = await arena({ vote: [T0 + HOUR, T0 + 2 * HOUR] });
    let res = await voter.post('/api/votes', { videoId: v1a, categoryId: c1 });
    expect((await body(res)).error.code).toBe('voting_not_open');
    env.clock.now = T0 + HOUR;
    expect((await voter.post('/api/votes', { videoId: v1a, categoryId: c1 })).status).toBe(200);
    env.clock.now = T0 + 2 * HOUR - 1;
    expect((await voter.post('/api/votes', { videoId: v1b, categoryId: c1 })).status).toBe(200);
    env.clock.now = T0 + 2 * HOUR;
    res = await voter.post('/api/votes', { videoId: v1a, categoryId: c1 });
    expect(res.status).toBe(409);
    expect((await body(res)).error.code).toBe('voting_closed');
    // The vote is now immutable.
    expect((env.raw.prepare('SELECT video_id FROM votes').get() as any).video_id).toBe(v1b);
  });

  it('rejects votes in disabled categories and unpublished seasons', async () => {
    const { env, voter, c1, v1a } = await arena();
    await env.db.run('UPDATE categories SET enabled = 0 WHERE id = ?', [c1]);
    expect((await voter.post('/api/votes', { videoId: v1a, categoryId: c1 })).status).toBe(409);
    await env.db.run('UPDATE categories SET enabled = 1 WHERE id = ?', [c1]);
    await env.db.run('UPDATE seasons SET is_published = 0');
    expect((await voter.post('/api/votes', { videoId: v1a, categoryId: c1 })).status).toBe(404);
  });

  it('the atomic write refuses if a video is disqualified between the checks and the write', async () => {
    let hook: (() => void) | null = null;
    const env = setup({}, {
      wrapDb: (db) => ({
        ...db,
        run: (sql, params) => {
          if (sql.trimStart().startsWith('INSERT INTO votes') && hook) hook();
          return db.run(sql, params);
        },
      }),
    });
    const { seasonId, categoryIds } = await makeSeason(env);
    const vid = await makeVideo(env, seasonId, categoryIds[0], '700000000000000001');
    const voter = await loggedIn(env, VOTER);
    // A moderator hides the video after the pre-checks passed but before the INSERT runs.
    hook = () => env.raw.prepare("UPDATE videos SET moderation_status = 'hidden' WHERE id = ?").run(vid);
    const res = await voter.post('/api/votes', { videoId: vid, categoryId: categoryIds[0] });
    expect(res.status).toBe(409);
    expect((await body(res)).error.code).toBe('vote_rejected');
    expect(countVotes(env)).toBe(0);
  });

  it('requires login and blocks banned accounts', async () => {
    const { env, c1, v1a } = await arena();
    expect((await new Client(env).post('/api/votes', { videoId: v1a, categoryId: c1 })).status).toBe(401);
    const banned = await loggedIn(env, '555555555555555555');
    await env.db.run("UPDATE users SET is_banned = 1 WHERE discord_id = '555555555555555555'");
    expect((await banned.post('/api/votes', { videoId: v1a, categoryId: c1 })).status).toBe(403);
  });

  it('rate limits vote spam', async () => {
    const { voter, c1, v1a, v1b } = await arena();
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await voter.post('/api/votes', { videoId: i % 2 ? v1a : v1b, categoryId: c1 })).status;
    expect(last).toBe(429);
  });
});

describe('GET /api/votes/mine', () => {
  it('flags votes for videos that were later disqualified', async () => {
    const { env, voter, c1, v1a, season } = await arena();
    await voter.post('/api/votes', { videoId: v1a, categoryId: c1 });
    await env.db.run("UPDATE videos SET moderation_status = 'hidden' WHERE id = ?", [v1a]);
    const { votes } = await body(await voter.get(`/api/votes/mine?seasonId=${season.seasonId}`));
    expect(votes).toEqual([expect.objectContaining({ videoId: v1a, videoEligible: false })]);
  });

  it('can recast after a disqualification, replacing the old vote', async () => {
    const { env, voter, c1, v1a, v1b } = await arena();
    await voter.post('/api/votes', { videoId: v1a, categoryId: c1 });
    await env.db.run("UPDATE videos SET moderation_status = 'rejected' WHERE id = ?", [v1a]);
    expect((await voter.post('/api/votes', { videoId: v1b, categoryId: c1 })).status).toBe(200);
    expect(countVotes(env)).toBe(1);
  });

  it('requires authentication', async () => {
    const env = setup();
    expect((await new Client(env).get('/api/votes/mine')).status).toBe(401);
  });

  it('keeps votes in separate seasons independent', async () => {
    const env = setup();
    const a = await makeSeason(env, { sub: [T0 - 10 * DAY, T0 - 9 * DAY], vote: [T0 - 9 * DAY, T0 - 8 * DAY] });
    const b = await makeSeason(env);
    const va = await makeVideo(env, a.seasonId, a.categoryIds[0], '700000000000000001');
    const vb = await makeVideo(env, b.seasonId, b.categoryIds[0], '700000000000000001');
    await castVote(env, a.seasonId, a.categoryIds[0], va, '700000000000000009');
    const voter = await loggedIn(env, '700000000000000009');
    expect((await voter.post('/api/votes', { videoId: vb, categoryId: b.categoryIds[0] })).status).toBe(200);
    expect((await body(await voter.get('/api/votes/mine'))).votes).toHaveLength(2);
  });
});
