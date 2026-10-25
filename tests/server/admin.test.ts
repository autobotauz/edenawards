import { describe, expect, it } from 'vitest';
import { ADMIN_ID, body, castVote, Client, DAY, HOUR, loggedIn, makeSeason, makeUser, makeVideo, setup, T0 } from './helpers';

const iso = (ms: number) => new Date(ms).toISOString();
const schedule = (start = T0 + DAY) => ({
  submissionStartsAt: iso(start),
  submissionEndsAt: iso(start + 7 * DAY),
  votingStartsAt: iso(start + 7 * DAY),
  votingEndsAt: iso(start + 14 * DAY),
  resultsPublishAt: iso(start + 15 * DAY),
});

async function adminEnv() {
  const env = setup();
  const admin = await loggedIn(env, ADMIN_ID, 'admin');
  return { env, admin };
}

describe('admin authorization', () => {
  it('rejects anonymous and non-admin users on every admin endpoint', async () => {
    const env = setup();
    const anon = new Client(env);
    const user = await loggedIn(env, '111111111111111111');
    const endpoints: Array<[string, string, unknown?]> = [
      ['GET', '/api/admin/overview'],
      ['GET', '/api/admin/seasons'],
      ['GET', '/api/admin/seasons/1'],
      ['GET', '/api/admin/seasons/1/results'],
      ['POST', '/api/admin/seasons', schedule()],
      ['PATCH', '/api/admin/seasons/1', { name: 'x' }],
      ['POST', '/api/admin/categories', { seasonId: 1, name: 'x' }],
      ['PATCH', '/api/admin/categories/1', { name: 'x' }],
      ['DELETE', '/api/admin/categories/1'],
      ['GET', '/api/admin/videos'],
      ['PATCH', '/api/admin/videos/1/moderation', { status: 'approved' }],
      ['GET', '/api/admin/users'],
      ['PATCH', '/api/admin/users/111111111111111111', { banned: true }],
      ['GET', '/api/admin/audit'],
    ];
    for (const [method, path, payload] of endpoints) {
      expect((await anon.request(method, path, payload)).status, `${method} ${path}`).toBe(401);
      expect((await user.request(method, path, payload)).status, `${method} ${path}`).toBe(403);
    }
  });
});

describe('seasons', () => {
  it('creates a draft season, copying categories from a previous season', async () => {
    const { env, admin } = await adminEnv();
    const prev = await makeSeason(env, { categories: ['Best Solo PvP', 'Funniest Moment', 'Best Comeback'] });
    const res = await admin.post('/api/admin/seasons', { name: 'Eden Season 9', description: 'Next one', ...schedule(), copyCategoriesFrom: prev.seasonId });
    expect(res.status).toBe(201);
    const { season } = await body(res);
    expect(season).toMatchObject({ name: 'Eden Season 9', isPublished: false, resultsPublished: false, allowSelfVote: false, phase: 'upcoming' });
    const detail = await body(await admin.get(`/api/admin/seasons/${season.id}`));
    expect(detail.categories.map((c: any) => c.name)).toEqual(['Best Solo PvP', 'Funniest Moment', 'Best Comeback']);
    // Drafts are invisible to the public.
    expect((await new Client(env).get(`/api/seasons/${season.id}`)).status).toBe(404);
    expect((await body(await new Client(env).get('/api/seasons'))).seasons.map((s: any) => s.id)).not.toContain(season.id);
    // But visible to admins.
    expect((await admin.get(`/api/seasons/${season.id}`)).status).toBe(200);
  });

  it('validates required fields and the schedule order', async () => {
    const { admin } = await adminEnv();
    let res = await admin.post('/api/admin/seasons', { name: 'x' });
    expect(res.status).toBe(400);
    const fields = (await body(res)).error.details.fields;
    expect(Object.keys(fields)).toEqual(expect.arrayContaining(['name', 'submissionStartsAt', 'votingEndsAt']));

    const bad = { ...schedule(), name: 'Bad order' };
    bad.submissionEndsAt = bad.submissionStartsAt;
    bad.votingStartsAt = iso(Date.parse(bad.submissionStartsAt) - HOUR);
    bad.resultsPublishAt = iso(Date.parse(bad.votingEndsAt) - HOUR);
    res = await admin.post('/api/admin/seasons', bad);
    expect(Object.keys((await body(res)).error.details.fields).sort()).toEqual(['resultsPublishAt', 'submissionEndsAt', 'votingStartsAt']);

    const voting = { ...schedule(), name: 'Voting order', votingEndsAt: schedule().votingStartsAt };
    res = await admin.post('/api/admin/seasons', voting);
    expect((await body(res)).error.details.fields).toHaveProperty('votingEndsAt');

    res = await admin.post('/api/admin/seasons', { ...schedule(), name: 'Bad date', votingStartsAt: 'tomorrow-ish', description: 5, copyCategoriesFrom: 'x' });
    expect(Object.keys((await body(res)).error.details.fields).sort()).toEqual(['copyCategoriesFrom', 'description', 'votingStartsAt']);
  });

  it('rejects duplicate season names', async () => {
    const { admin } = await adminEnv();
    expect((await admin.post('/api/admin/seasons', { name: 'Same', ...schedule() })).status).toBe(201);
    expect((await admin.post('/api/admin/seasons', { name: 'Same', ...schedule() })).status).toBe(409);
  });

  it('updates names, schedule and flags of a future season', async () => {
    const { admin } = await adminEnv();
    const { season } = await body(await admin.post('/api/admin/seasons', { name: 'Draft', ...schedule() }));
    const res = await admin.patch(`/api/admin/seasons/${season.id}`, {
      name: 'Renamed',
      description: 'New text',
      isPublished: true,
      allowSelfVote: true,
      votingEndsAt: iso(T0 + 20 * DAY),
      resultsPublishAt: iso(T0 + 21 * DAY),
    });
    expect(res.status).toBe(200);
    expect((await body(res)).season).toMatchObject({ name: 'Renamed', description: 'New text', isPublished: true, allowSelfVote: true, votingEndsAt: iso(T0 + 20 * DAY) });
    // A no-op patch is fine.
    expect((await admin.patch(`/api/admin/seasons/${season.id}`, {})).status).toBe(200);
  });

  it('locks times that have already passed, and never moves a time into the past', async () => {
    const { env, admin } = await adminEnv();
    const { seasonId } = await makeSeason(env, { sub: [T0 - DAY, T0 + DAY], vote: [T0 - HOUR, T0 + 2 * DAY] });
    let res = await admin.patch(`/api/admin/seasons/${seasonId}`, { submissionStartsAt: iso(T0 - 2 * DAY) });
    expect((await body(res)).error.details.fields.submissionStartsAt).toMatch(/already passed/);
    res = await admin.patch(`/api/admin/seasons/${seasonId}`, { votingEndsAt: iso(T0 - 10 * HOUR) });
    expect(res.status).toBe(400);
    // Extending a running window is allowed, and closing it "now" is allowed.
    expect((await admin.patch(`/api/admin/seasons/${seasonId}`, { votingEndsAt: iso(T0 + 3 * DAY), resultsPublishAt: iso(T0 + 4 * DAY) })).status).toBe(200);
    expect((await admin.patch(`/api/admin/seasons/${seasonId}`, { submissionEndsAt: iso(T0) })).status).toBe(200);
  });

  it('locks the self-vote rule once voting opens and blocks unpublishing a live season', async () => {
    const { env, admin } = await adminEnv();
    const { seasonId } = await makeSeason(env);
    let res = await admin.patch(`/api/admin/seasons/${seasonId}`, { allowSelfVote: true });
    expect((await body(res)).error.details.fields.allowSelfVote).toMatch(/cannot change/);
    res = await admin.patch(`/api/admin/seasons/${seasonId}`, { isPublished: false });
    expect((await body(res)).error.details.fields.isPublished).toBeTruthy();
    res = await admin.patch(`/api/admin/seasons/${seasonId}`, { isPublished: 'yes', allowSelfVote: 1, resultsPublished: 'no', name: '', description: 7 });
    expect(Object.keys((await body(res)).error.details.fields).sort()).toEqual(['allowSelfVote', 'description', 'isPublished', 'name', 'resultsPublished']);
    res = await admin.patch(`/api/admin/seasons/${seasonId}`, { votingStartsAt: 'garbage' });
    expect((await body(res)).error.details.fields.votingStartsAt).toBe('Invalid date.');
  });

  it('only publishes results after voting closes, and only for published seasons', async () => {
    const { env, admin } = await adminEnv();
    const live = await makeSeason(env);
    let res = await admin.patch(`/api/admin/seasons/${live.seasonId}`, { resultsPublished: true });
    expect((await body(res)).error.details.fields.resultsPublished).toMatch(/after voting closes/);

    const draft = await makeSeason(env, { published: false, sub: [T0 - 5 * DAY, T0 - 4 * DAY], vote: [T0 - 4 * DAY, T0 - 3 * DAY] });
    res = await admin.patch(`/api/admin/seasons/${draft.seasonId}`, { resultsPublished: true });
    expect((await body(res)).error.details.fields.resultsPublished).toMatch(/Publish the season/);
    res = await admin.patch(`/api/admin/seasons/${draft.seasonId}`, { resultsPublished: true, isPublished: true });
    expect(res.status).toBe(200);
    // Results can be retracted.
    expect((await admin.patch(`/api/admin/seasons/${draft.seasonId}`, { resultsPublished: false })).status).toBe(200);
  });

  it('maps constraint conflicts (duplicate name on rename) to 409', async () => {
    const { env, admin } = await adminEnv();
    await makeSeason(env, { name: 'Taken' });
    const { seasonId } = await makeSeason(env, { name: 'Other' });
    expect((await admin.patch(`/api/admin/seasons/${seasonId}`, { name: 'Taken' })).status).toBe(409);
    expect((await admin.patch('/api/admin/seasons/9999', { name: 'Nope' })).status).toBe(404);
    expect((await admin.get('/api/admin/seasons/9999')).status).toBe(404);
  });

  it('lists all seasons (drafts included) and an overview with participation', async () => {
    const { env, admin } = await adminEnv();
    const live = await makeSeason(env);
    await makeSeason(env, { published: false });
    const v = await makeVideo(env, live.seasonId, live.categoryIds[0], '700000000000000001');
    await makeVideo(env, live.seasonId, live.categoryIds[0], '700000000000000002', 'pending');
    await castVote(env, live.seasonId, live.categoryIds[0], v, '700000000000000003');
    expect((await body(await admin.get('/api/admin/seasons'))).seasons).toHaveLength(2);
    const ov = await body(await admin.get('/api/admin/overview'));
    expect(ov.pendingSubmissions).toBe(1);
    expect(ov.status).toMatchObject({ database: 'ok', discordConfigured: false, devLoginEnabled: true, adminCount: 1 });
    const row = ov.seasons.find((s: any) => s.season.id === live.seasonId);
    expect(row).toMatchObject({ submissions: { approved: 1, pending: 1, rejected: 0, hidden: 0 }, votes: 1, voters: 1 });
    const detail = await body(await admin.get(`/api/admin/seasons/${live.seasonId}`));
    expect(detail.categories[0]).toMatchObject({ videoCount: 2, approvedCount: 1, voteCount: 1 });
  });
});

describe('categories', () => {
  it('creates, renames, reorders and toggles categories before voting', async () => {
    const { admin } = await adminEnv();
    const { season } = await body(await admin.post('/api/admin/seasons', { name: 'Season S', ...schedule() }));
    let res = await admin.post('/api/admin/categories', { seasonId: season.id, name: 'Best Solo PvP', description: 'Solo' });
    expect(res.status).toBe(201);
    const { category } = await body(res);
    expect(category).toMatchObject({ name: 'Best Solo PvP', enabled: true, displayOrder: 1 });
    const secondRes = await body(await admin.post('/api/admin/categories', { seasonId: season.id, name: 'Funniest' }));
    const second = secondRes.category;
    expect(second.displayOrder).toBe(2);

    res = await admin.patch(`/api/admin/categories/${category.id}`, { name: 'Best Solo Fight', displayOrder: 5, enabled: false, description: 'd' });
    expect((await body(res)).category).toMatchObject({ name: 'Best Solo Fight', displayOrder: 5, enabled: false });

    expect((await admin.post('/api/admin/categories', { seasonId: season.id, name: 'Funniest' })).status).toBe(409);
    expect((await admin.patch(`/api/admin/categories/${category.id}`, { name: 'Funniest' })).status).toBe(409);
    expect((await admin.post('/api/admin/categories', { seasonId: season.id, name: '' })).status).toBe(400);
    expect((await admin.post('/api/admin/categories', { name: 'No season' })).status).toBe(400);
    expect((await admin.post('/api/admin/categories', { seasonId: 9999, name: 'Nope' })).status).toBe(404);
    expect((await admin.patch(`/api/admin/categories/${category.id}`, { displayOrder: 1.5, enabled: 'no', name: 'x', description: 1 })).status).toBe(400);
    expect((await admin.patch('/api/admin/categories/9999', { name: 'Nope' })).status).toBe(404);
    // No-op patch is fine.
    expect((await admin.patch(`/api/admin/categories/${category.id}`, {})).status).toBe(200);
  });

  it('protects categories of a running competition', async () => {
    const { env, admin } = await adminEnv();
    const { seasonId, categoryIds } = await makeSeason(env); // voting is open
    let res = await admin.patch(`/api/admin/categories/${categoryIds[0]}`, { enabled: false });
    expect((await body(res)).error.details.fields.enabled).toMatch(/voting has opened/);
    // Renaming keeps the identity and stays allowed.
    expect((await admin.patch(`/api/admin/categories/${categoryIds[0]}`, { name: 'Renamed' })).status).toBe(200);
    // No new categories after submissions close.
    env.clock.now = T0 + DAY;
    res = await admin.post('/api/admin/categories', { seasonId, name: 'Late' });
    expect(res.status).toBe(409);
  });

  it('only deletes categories without submissions', async () => {
    const { env, admin } = await adminEnv();
    const { seasonId, categoryIds } = await makeSeason(env);
    await makeVideo(env, seasonId, categoryIds[0], '700000000000000001');
    expect((await admin.delete(`/api/admin/categories/${categoryIds[0]}`)).status).toBe(409);
    expect((await admin.delete(`/api/admin/categories/${categoryIds[1]}`)).status).toBe(200);
    expect((await admin.delete(`/api/admin/categories/${categoryIds[1]}`)).status).toBe(404);
  });
});

describe('moderation', () => {
  it('lists the queue with filters and search', async () => {
    const { env, admin } = await adminEnv();
    const { seasonId, categoryIds } = await makeSeason(env);
    await makeVideo(env, seasonId, categoryIds[0], '700000000000000001', 'pending');
    await makeVideo(env, seasonId, categoryIds[1], '700000000000000002', 'approved');
    const pending = await body(await admin.get('/api/admin/videos?status=pending'));
    expect(pending.total).toBe(1);
    expect(pending.videos[0]).toHaveProperty('moderationStatus', 'pending');
    expect(pending.videos[0]).toHaveProperty('votes', 0);
    expect((await body(await admin.get(`/api/admin/videos?seasonId=${seasonId}&categoryId=${categoryIds[1]}`))).total).toBe(1);
    expect((await body(await admin.get('/api/admin/videos?q=u00002'))).total).toBe(1);
    expect((await body(await admin.get('/api/admin/videos?q=%25'))).total).toBe(0);
    expect((await admin.get('/api/admin/videos?status=bogus')).status).toBe(400);
  });

  it('approves, rejects and hides with a reason, and audits each change', async () => {
    const { env, admin } = await adminEnv();
    const { seasonId, categoryIds } = await makeSeason(env);
    const vid = await makeVideo(env, seasonId, categoryIds[0], '700000000000000001', 'pending');
    let res = await admin.patch(`/api/admin/videos/${vid}/moderation`, { status: 'approved' });
    expect((await body(res)).video.moderationStatus).toBe('approved');
    res = await admin.patch(`/api/admin/videos/${vid}/moderation`, { status: 'hidden', reason: 'Inappropriate language' });
    expect((await body(res)).video).toMatchObject({ moderationStatus: 'hidden', moderationReason: 'Inappropriate language' });
    expect((await admin.patch(`/api/admin/videos/${vid}/moderation`, { status: 'deleted' })).status).toBe(400);
    expect((await admin.patch(`/api/admin/videos/${vid}/moderation`, { status: 'approved', reason: 5 })).status).toBe(400);
    expect((await admin.patch('/api/admin/videos/99999/moderation', { status: 'approved' })).status).toBe(404);
    const audit = await body(await admin.get('/api/admin/audit'));
    expect(audit.entries.filter((e: any) => e.action === 'video.moderate')).toHaveLength(2);
    expect(audit.entries[0].actor).toBe('admin');
  });

  it('freezes moderation once results are public', async () => {
    const { env, admin } = await adminEnv();
    const s = await makeSeason(env, { sub: [T0 - 5 * DAY, T0 - 4 * DAY], vote: [T0 - 4 * DAY, T0 - 3 * DAY], resultsPublished: true });
    const vid = await makeVideo(env, s.seasonId, s.categoryIds[0], '700000000000000001');
    const res = await admin.patch(`/api/admin/videos/${vid}/moderation`, { status: 'hidden' });
    expect(res.status).toBe(409);
  });
});

describe('users', () => {
  it('lists users, bans and unbans them, and ends banned sessions', async () => {
    const { env, admin } = await adminEnv();
    const player = await loggedIn(env, '111111111111111111', 'player');
    const list = await body(await admin.get('/api/admin/users?q=play'));
    expect(list.users).toEqual([expect.objectContaining({ discordId: '111111111111111111', isBanned: false, submissions: 0, votes: 0 })]);
    expect((await body(await admin.get('/api/admin/users'))).total).toBe(2);

    expect((await admin.patch('/api/admin/users/111111111111111111', { banned: true })).status).toBe(200);
    expect((await body(await player.get('/api/auth/me'))).user).toBeNull();
    expect((await body(await admin.get('/api/admin/users?q=111111111111111111'))).users[0].isBanned).toBe(true);
    expect((await admin.patch('/api/admin/users/111111111111111111', { banned: false })).status).toBe(200);

    expect((await admin.patch(`/api/admin/users/${ADMIN_ID}`, { banned: true })).status).toBe(409);
    expect((await admin.patch('/api/admin/users/123456789', { banned: true })).status).toBe(404);
    expect((await admin.patch('/api/admin/users/abc', { banned: true })).status).toBe(400);
    expect((await admin.patch('/api/admin/users/111111111111111111', { banned: 'yes' })).status).toBe(400);
    await makeUser(env);
  });
});
