import { describe, expect, it } from 'vitest';
import { ADMIN_ID, body, Client, DAY, HOUR, json, loggedIn, makeSeason, makeUser, makeVideo, setup, T0 } from './helpers';

const URL_A = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

async function ready(env = setup()) {
  const season = await makeSeason(env);
  const user = await loggedIn(env, '111111111111111111', 'thane');
  return { env, season, user, categoryId: season.categoryIds[0] };
}

describe('POST /api/videos', () => {
  it('accepts a valid YouTube submission and keeps it pending without API verification', async () => {
    const { env, user, categoryId, season } = await ready();
    const res = await user.post('/api/videos', { title: '  Solo   Shadowblade run ', url: 'https://youtu.be/dQw4w9WgXcQ?t=3', categoryId });
    expect(res.status).toBe(201);
    const { video } = await body(res);
    expect(video).toMatchObject({
      title: 'Solo Shadowblade run',
      platform: 'youtube',
      platformVideoId: 'dQw4w9WgXcQ',
      canonicalUrl: URL_A,
      seasonId: season.seasonId,
      categoryId,
      moderationStatus: 'pending',
      author: { discordId: '111111111111111111', username: 'thane' },
    });
    expect(video.moderationReason).toMatch(/not configured/);
    expect(env.fetchCalls).toHaveLength(0);
  });

  it('accepts Twitch VODs and clips', async () => {
    const { user, categoryId } = await ready();
    const vod = await user.post('/api/videos', { title: 'Keep siege', url: 'https://www.twitch.tv/videos/1234567890', categoryId });
    expect(vod.status).toBe(201);
    expect((await body(vod)).video.platform).toBe('twitch-video');
    const clip = await user.post('/api/videos', { title: 'Funny clip', url: 'https://clips.twitch.tv/AwkwardFunnyClip-xyz', categoryId });
    expect(clip.status).toBe(201);
    expect((await body(clip)).video.platform).toBe('twitch-clip');
  });

  it('always uses the session identity as the author', async () => {
    const { user, categoryId } = await ready();
    const res = await user.post('/api/videos', { title: 'Mine', url: URL_A, categoryId, authorDiscordId: ADMIN_ID, author: ADMIN_ID });
    expect((await body(res)).video.author.discordId).toBe('111111111111111111');
  });

  it('auto-approves relevant videos when YouTube verification is configured', async () => {
    const env = setup({ YOUTUBE_API_KEY: 'yt-key' });
    const { user, categoryId } = await ready(env);
    env.setFetch((url) => {
      expect(url).toContain('https://www.googleapis.com/youtube/v3/videos');
      expect(url).toContain('id=dQw4w9WgXcQ');
      return json({ items: [{ snippet: { title: 'Eden DAoC solo', thumbnails: { high: { url: 'https://i.ytimg.com/vi/x/hq.jpg' } } }, status: { privacyStatus: 'public', embeddable: true } }] });
    });
    const { video } = await body(await user.post('/api/videos', { title: 'Solo', url: URL_A, categoryId }));
    expect(video.moderationStatus).toBe('approved');
    expect(video.thumbnailUrl).toBe('https://i.ytimg.com/vi/x/hq.jpg');
  });

  it('rejects videos that verification proves unavailable', async () => {
    const env = setup({ YOUTUBE_API_KEY: 'yt-key' });
    const { user, categoryId } = await ready(env);
    env.setFetch(() => json({ items: [] }));
    const res = await user.post('/api/videos', { title: 'Gone', url: URL_A, categoryId });
    expect(res.status).toBe(400);
    expect((await body(res)).error.details.fields.url).toMatch(/does not exist/);
    expect(env.raw.prepare('SELECT COUNT(*) AS n FROM videos').get()).toMatchObject({ n: 0 });
  });

  it('validates the title, URL and category with field errors', async () => {
    const { user, categoryId } = await ready();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ url: URL_A, categoryId }, 'title'],
      [{ title: 'ab', url: URL_A, categoryId }, 'title'],
      [{ title: 'x'.repeat(101), url: URL_A, categoryId }, 'title'],
      [{ title: 'Bad‮Title', url: URL_A, categoryId }, 'title'],
      [{ title: 42, url: URL_A, categoryId }, 'title'],
      [{ title: 'Good title', url: 'https://vimeo.com/1234', categoryId }, 'url'],
      [{ title: 'Good title', url: 'http://www.youtube.com/watch?v=dQw4w9WgXcQ', categoryId }, 'url'],
      [{ title: 'Good title', url: URL_A }, 'categoryId'],
      [{ title: 'Good title', url: URL_A, categoryId: '1' }, 'categoryId'],
    ];
    for (const [payload, field] of cases) {
      const res = await user.post('/api/videos', payload);
      expect(res.status, JSON.stringify(payload)).toBe(400);
      expect((await body(res)).error.details.fields).toHaveProperty(field);
    }
  });

  it('rejects unknown, disabled or unpublished categories', async () => {
    const { env, user, categoryId } = await ready();
    expect((await user.post('/api/videos', { title: 'Good', url: URL_A, categoryId: 9999 })).status).toBe(400);
    await env.db.run('UPDATE categories SET enabled = 0 WHERE id = ?', [categoryId]);
    expect((await user.post('/api/videos', { title: 'Good', url: URL_A, categoryId })).status).toBe(400);
    const draft = await makeSeason(env, { published: false });
    expect((await user.post('/api/videos', { title: 'Good', url: URL_A, categoryId: draft.categoryIds[0] })).status).toBe(400);
  });

  it('rejects duplicates within a season (even via a different URL form) but allows them in another season', async () => {
    const { env, user, categoryId, season } = await ready();
    expect((await user.post('/api/videos', { title: 'First', url: URL_A, categoryId })).status).toBe(201);
    const other = await loggedIn(env, '222222222222222222');
    const dup = await other.post('/api/videos', { title: 'Copy', url: 'https://youtu.be/dQw4w9WgXcQ', categoryId: season.categoryIds[1] });
    expect(dup.status).toBe(409);
    expect((await body(dup)).error.code).toBe('duplicate_video');
    const next = await makeSeason(env);
    expect((await user.post('/api/videos', { title: 'Again', url: URL_A, categoryId: next.categoryIds[0] })).status).toBe(201);
  });

  it('enforces the submission window on the server, at the exact boundaries', async () => {
    const env = setup();
    const { categoryIds } = await makeSeason(env, { sub: [T0 + HOUR, T0 + 2 * HOUR], vote: [T0 + 2 * HOUR, T0 + 3 * HOUR] });
    const user = await loggedIn(env, '111111111111111111');
    const submit = (n: number) => user.post('/api/videos', { title: `Entry ${n}`, url: `https://www.twitch.tv/videos/1000000${n}`, categoryId: categoryIds[0] });

    let res = await submit(1);
    expect(res.status).toBe(409);
    expect((await body(res)).error.code).toBe('submissions_not_open');

    env.clock.now = T0 + HOUR; // exactly at opening
    expect((await submit(2)).status).toBe(201);

    env.clock.now = T0 + 2 * HOUR - 1; // last millisecond
    expect((await submit(3)).status).toBe(201);

    env.clock.now = T0 + 2 * HOUR; // exactly at closing
    res = await submit(4);
    expect(res.status).toBe(409);
    expect((await body(res)).error.code).toBe('submissions_closed');
  });

  it('re-checks the deadline after slow external verification', async () => {
    const env = setup({ YOUTUBE_API_KEY: 'k' });
    const { categoryIds } = await makeSeason(env, { sub: [T0 - HOUR, T0 + 1000], vote: [T0, T0 + DAY] });
    const user = await loggedIn(env, '111111111111111111');
    env.setFetch(() => {
      env.clock.now += 5000; // verification "takes" 5 seconds and crosses the deadline
      return json({ items: [{ snippet: { title: 'eden' }, status: {} }] });
    });
    const res = await user.post('/api/videos', { title: 'Late', url: URL_A, categoryId: categoryIds[0] });
    expect(res.status).toBe(409);
  });

  it('requires authentication, and bans block participation', async () => {
    const { env, categoryId } = await ready();
    const anon = new Client(env);
    expect((await anon.post('/api/videos', { title: 'Anon', url: URL_A, categoryId })).status).toBe(401);
    const banned = await loggedIn(env, '333333333333333333');
    await env.db.run('UPDATE users SET is_banned = 1 WHERE discord_id = ?', ['333333333333333333']);
    const res = await banned.post('/api/videos', { title: 'Banned', url: URL_A, categoryId });
    expect(res.status).toBe(403);
  });

  it('rate limits submissions per user', async () => {
    const { user, categoryId } = await ready();
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      codes.push((await user.post('/api/videos', { title: `Clip ${i}`, url: `https://www.twitch.tv/videos/2000000${i}`, categoryId })).status);
    }
    expect(codes.slice(0, 10).every((c) => c === 201)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('maps a concurrent duplicate insert onto the UNIQUE constraint', async () => {
    const { env, user, categoryId, season } = await ready();
    // Simulate a racing request that inserts the same video between our duplicate check and insert.
    env.raw.exec(`CREATE TRIGGER race BEFORE INSERT ON videos WHEN NEW.title = 'Racer' BEGIN
      INSERT INTO videos (season_id, category_id, author_discord_id, title, platform, platform_video_id, canonical_url, created_at)
      VALUES (${season.seasonId}, ${categoryId}, '111111111111111111', 'Other', NEW.platform, NEW.platform_video_id, NEW.canonical_url, 0);
    END`);
    const res = await user.post('/api/videos', { title: 'Racer', url: URL_A, categoryId });
    expect(res.status).toBe(409);
    expect((await body(res)).error.code).toBe('duplicate_video');
  });
});

describe('reading submissions', () => {
  it('lists my submissions with moderation status, per season', async () => {
    const { env, user, season } = await ready();
    await makeVideo(env, season.seasonId, season.categoryIds[0], '111111111111111111', 'pending');
    await makeVideo(env, season.seasonId, season.categoryIds[1], '111111111111111111', 'rejected');
    await makeVideo(env, season.seasonId, season.categoryIds[1], '999999999999999999', 'approved');
    const all = await body(await user.get('/api/videos/mine'));
    expect(all.videos).toHaveLength(2);
    expect(all.videos.map((v: any) => v.moderationStatus).sort()).toEqual(['pending', 'rejected']);
    const scoped = await body(await user.get(`/api/videos/mine?seasonId=${season.seasonId + 99}`));
    expect(scoped.videos).toHaveLength(0);
    expect((await new Client(env).get('/api/videos/mine')).status).toBe(401);
  });

  it('only shows approved videos publicly and paginates by category', async () => {
    const env = setup();
    const { seasonId, categoryIds } = await makeSeason(env);
    for (let i = 0; i < 3; i++) await makeVideo(env, seasonId, categoryIds[0], `55555555555555555${i}`);
    await makeVideo(env, seasonId, categoryIds[0], '555555555555555559', 'pending');
    await makeVideo(env, seasonId, categoryIds[0], '555555555555555558', 'hidden');
    await makeVideo(env, seasonId, categoryIds[1], '555555555555555557');
    const anon = new Client(env);
    const all = await body(await anon.get(`/api/videos?seasonId=${seasonId}`));
    expect(all.total).toBe(4);
    expect(all.videos.every((v: any) => v.moderationStatus === undefined)).toBe(true);
    const cat = await body(await anon.get(`/api/videos?seasonId=${seasonId}&categoryId=${categoryIds[0]}&page=2&pageSize=2`));
    expect(cat).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(cat.videos).toHaveLength(1);
    // Defaults to the current season.
    expect((await body(await anon.get('/api/videos'))).total).toBe(4);
    expect((await anon.get('/api/videos?seasonId=abc')).status).toBe(400);
  });

  it('hides videos in disabled categories from browsing', async () => {
    const env = setup();
    const { seasonId, categoryIds } = await makeSeason(env);
    await makeVideo(env, seasonId, categoryIds[0], '555555555555555551');
    await env.db.run('UPDATE categories SET enabled = 0 WHERE id = ?', [categoryIds[0]]);
    expect((await body(await new Client(env).get(`/api/videos?seasonId=${seasonId}`))).total).toBe(0);
  });

  it('shows a single entry: approved to everyone, pending only to its author and admins', async () => {
    const env = setup();
    const { seasonId, categoryIds } = await makeSeason(env);
    const approved = await makeVideo(env, seasonId, categoryIds[0], '111111111111111111');
    const pending = await makeVideo(env, seasonId, categoryIds[0], '111111111111111111', 'pending');
    const anon = new Client(env);
    expect((await anon.get(`/api/videos/${approved}`)).status).toBe(200);
    expect((await anon.get(`/api/videos/${pending}`)).status).toBe(404);
    expect((await anon.get('/api/videos/99999')).status).toBe(404);
    expect((await anon.get('/api/videos/abc')).status).toBe(400);
    const author = await loggedIn(env, '111111111111111111');
    expect((await body(await author.get(`/api/videos/${pending}`))).video.moderationStatus).toBe('pending');
    const stranger = await loggedIn(env, '222222222222222222');
    expect((await stranger.get(`/api/videos/${pending}`)).status).toBe(404);
    const admin = await loggedIn(env, ADMIN_ID);
    expect((await admin.get(`/api/videos/${pending}`)).status).toBe(200);
  });

  it('hides entries of unpublished seasons from the public', async () => {
    const env = setup();
    const draft = await makeSeason(env, { published: false });
    const vid = await makeVideo(env, draft.seasonId, draft.categoryIds[0], '111111111111111111');
    expect((await new Client(env).get(`/api/videos/${vid}`)).status).toBe(404);
    await makeUser(env, '111111111111111111');
  });
});
