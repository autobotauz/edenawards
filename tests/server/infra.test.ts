import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { d1Db, isConstraintError, ConstraintError } from '../../server/db';
import { migrate, openSqlite, migrationsDir } from '../../server/sqlite';
import { loadConfig } from '../../server/config';
import { hit } from '../../server/lib/ratelimit';
import { randomToken, safeEqual, safeReturnTo, sha256 } from '../../server/lib/security';
import { cleanLongText, cleanText, parseTime } from '../../server/lib/validation';
import { avatarUrl } from '../../server/lib/mappers';
import { mentionsKeywords, resetTwitchToken, verifyVideo, type VerifyDeps } from '../../server/providers/verify';
import { seedStatements, toSqlScript, fakeYoutubeId } from '../../server/seed';
import { computeResults } from '../../server/lib/results';
import { json } from './helpers';

describe('migrations', () => {
  it('apply once and are tracked like D1', () => {
    const db = new DatabaseSync(':memory:');
    expect(migrate(db)).toEqual(['0001_init.sql']);
    expect(migrate(db)).toEqual([]);
    expect((db.prepare('SELECT name FROM d1_migrations').all() as any[]).map((r) => r.name)).toEqual(['0001_init.sql']);
  });

  it('roll back a failing migration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    try {
      writeFileSync(join(dir, '0001_ok.sql'), 'CREATE TABLE a (x INTEGER);');
      writeFileSync(join(dir, '0002_bad.sql'), 'CREATE TABLE b (x INTEGER); NOT VALID SQL;');
      writeFileSync(join(dir, 'README.md'), 'ignored');
      const db = new DatabaseSync(':memory:');
      expect(() => migrate(db, dir)).toThrow(/0002_bad.sql failed/);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'b'").get()).toBeUndefined();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'a'").get()).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('opens a file database with WAL and migrations applied', () => {
    const dir = mkdtempSync(join(tmpdir(), 'db-'));
    try {
      const { raw } = openSqlite(join(dir, 'nested', 'test.sqlite'));
      expect((raw.prepare('PRAGMA journal_mode').get() as any).journal_mode).toBe('wal');
      expect((raw.prepare('PRAGMA foreign_keys').get() as any).foreign_keys).toBe(1);
      raw.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(migrationsDir()).toMatch(/migrations$/);
  });
});

describe('schema constraints', () => {
  it('reject invalid schedules, statuses and cross-season categories', () => {
    const { raw } = openSqlite();
    const ins = (a: number, b: number, c: number, d: number, e: number) =>
      raw
        .prepare(
          `INSERT INTO seasons (name, submission_starts_at, submission_ends_at, voting_starts_at, voting_ends_at, results_publish_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
        )
        .run(`s${Math.random()}`, a, b, c, d, e);
    expect(() => ins(10, 5, 10, 20, 30)).toThrow(/CHECK/);
    expect(() => ins(10, 20, 5, 30, 40)).toThrow(/CHECK/);
    expect(() => ins(10, 20, 20, 15, 40)).toThrow(/CHECK/);
    expect(() => ins(10, 20, 20, 30, 25)).toThrow(/CHECK/);
    const s1 = Number(ins(10, 20, 20, 30, 40).lastInsertRowid);
    const s2 = Number(ins(10, 20, 20, 30, 40).lastInsertRowid);
    const cat = Number(raw.prepare("INSERT INTO categories (season_id, name, created_at) VALUES (?, 'A', 0)").run(s1).lastInsertRowid);
    raw.prepare("INSERT INTO users (discord_id, username, created_at, updated_at) VALUES ('123456', 'u', 0, 0)").run();
    const video = (season: number, status = 'approved') =>
      raw
        .prepare(
          `INSERT INTO videos (season_id, category_id, author_discord_id, title, platform, platform_video_id, canonical_url, moderation_status, created_at)
           VALUES (?, ?, '123456', 't', 'youtube', ?, 'u', ?, 0)`,
        )
        .run(season, cat, `id${Math.random()}`, status);
    expect(() => video(s2)).toThrow(/FOREIGN KEY/);
    expect(() => video(s1, 'deleted')).toThrow(/CHECK/);
    expect(() => raw.prepare("INSERT INTO categories (season_id, name, created_at) VALUES (?, 'A', 0)").run(s1)).toThrow(/UNIQUE/);
    video(s1);
  });
});

describe('database adapters', () => {
  it('rolls back a failed batch atomically', async () => {
    const { db, raw } = openSqlite();
    await expect(
      db.batch([
        { sql: "INSERT INTO users (discord_id, username, created_at, updated_at) VALUES ('1', 'a', 0, 0)" },
        { sql: "INSERT INTO users (discord_id, username, created_at, updated_at) VALUES ('1', 'dup', 0, 0)" },
      ]),
    ).rejects.toThrow(/UNIQUE/);
    expect((raw.prepare('SELECT COUNT(*) AS n FROM users').get() as any).n).toBe(0);
    expect(await db.batch([])).toEqual([]);
    expect(await db.first('SELECT * FROM users WHERE discord_id = ?', ['nope'])).toBeNull();
  });

  it('detects constraint errors', () => {
    expect(isConstraintError(new ConstraintError('x'))).toBe(true);
    expect(isConstraintError(new Error('UNIQUE constraint failed: votes'))).toBe(true);
    expect(isConstraintError('D1_ERROR: FOREIGN KEY constraint failed')).toBe(true);
    expect(isConstraintError(new Error('disk full'))).toBe(false);
  });

  it('adapts the Cloudflare D1 API', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const stmt = (sql: string) => {
      const s: any = {
        sql,
        params: [] as unknown[],
        bind(...p: unknown[]) {
          s.params = p;
          calls.push({ sql, params: p });
          return s;
        },
        all: async () => ({ results: [{ a: 1 }] }),
        first: async () => (sql.includes('none') ? null : { a: 2 }),
        run: async () => ({ meta: { changes: 3, last_row_id: 7 } }),
      };
      return s;
    };
    const fake = {
      prepare: stmt,
      batch: async (list: any[]) => list.map(() => ({ meta: { changes: 1, last_row_id: 0 } })),
    } as unknown as D1Database;
    const db = d1Db(fake);
    expect(await db.all('SELECT ?', [1])).toEqual([{ a: 1 }]);
    expect(await db.first('SELECT 2')).toEqual({ a: 2 });
    expect(await db.first('SELECT none')).toBeNull();
    expect(await db.run('UPDATE x', ['y'])).toEqual({ changes: 3, lastRowId: 7 });
    expect(await db.batch([{ sql: 'A' }, { sql: 'B', params: [1] }])).toHaveLength(2);
    expect(await db.batch([])).toEqual([]);
    expect(calls.find((c) => c.sql === 'UPDATE x')?.params).toEqual(['y']);

    const empty = d1Db({ prepare: () => ({ bind: () => ({ all: async () => ({}), run: async () => ({ meta: {} }) }) }) } as unknown as D1Database);
    expect(await empty.all('x')).toEqual([]);
    expect(await empty.run('x')).toEqual({ changes: 0, lastRowId: 0 });
  });
});

describe('config', () => {
  it('has safe defaults', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ appOrigin: 'http://localhost:5173', discord: null, devLogin: false, twitch: null, youtubeApiKey: null, secureCookies: false, trustProxy: false });
    expect(c.adminIds.size).toBe(0);
    expect(c.sessionTtlMs).toBe(14 * 86_400_000);
  });

  it('parses production settings', () => {
    const c = loadConfig({
      APP_ORIGIN: 'https://eden-awards.com/',
      ALLOWED_ORIGINS: 'https://preview.eden-awards.com, ',
      DISCORD_CLIENT_ID: 'id',
      DISCORD_CLIENT_SECRET: 'secret',
      ADMIN_DISCORD_IDS: '1, 2',
      TWITCH_CLIENT_ID: 't',
      TWITCH_CLIENT_SECRET: 's',
      YOUTUBE_API_KEY: 'y',
      SESSION_TTL_DAYS: 'abc',
      RELEVANCE_KEYWORDS: 'DAoC, Albion',
      TRUST_PROXY: '1',
    });
    expect(c.appOrigin).toBe('https://eden-awards.com');
    expect(c.allowedOrigins).toEqual(['https://eden-awards.com', 'https://preview.eden-awards.com']);
    expect(c.discord?.redirectUri).toBe('https://eden-awards.com/api/auth/callback');
    expect([...c.adminIds]).toEqual(['1', '2']);
    expect(c.secureCookies).toBe(true);
    expect(c.sessionTtlMs).toBe(14 * 86_400_000);
    expect(c.relevanceKeywords).toEqual(['daoc', 'albion']);
    expect(c.twitch).toEqual({ clientId: 't', clientSecret: 's' });
    expect(loadConfig({ SECURE_COOKIES: 'true' }).secureCookies).toBe(true);
    expect(loadConfig({ SESSION_TTL_DAYS: '2' }).sessionTtlMs).toBe(2 * 86_400_000);
  });
});

describe('rate limiter', () => {
  it('counts within a window and resets after it', async () => {
    const { db } = openSqlite();
    const lim = { limit: 2, windowMs: 1000 };
    expect(await hit(db, 'k', lim, 0)).toBe(true);
    expect(await hit(db, 'k', lim, 500)).toBe(true);
    expect(await hit(db, 'k', lim, 900)).toBe(false);
    expect(await hit(db, 'other', lim, 900)).toBe(true);
    expect(await hit(db, 'k', lim, 1000)).toBe(true);
  });
});

describe('security helpers', () => {
  it('generates random tokens and hashes', async () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
    expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('compares strings safely', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
    expect(safeEqual(undefined as unknown as string, 'a')).toBe(false);
  });

  it('sanitizes return paths', () => {
    expect(safeReturnTo('/vote?c=1')).toBe('/vote?c=1');
    for (const bad of [undefined, '', 'https://x', '//x', '/\\x', '/a\nb', `/${'a'.repeat(300)}`]) expect(safeReturnTo(bad)).toBe('/');
  });

  it('builds Discord avatar URLs only from valid hashes', () => {
    expect(avatarUrl('123456789012345678', 'a_' + 'b'.repeat(32))).toContain('/avatars/123456789012345678/a_');
    expect(avatarUrl('123456789012345678', '../../evil')).toMatch(/embed\/avatars\/\d\.png$/);
    expect(avatarUrl('not-an-id', null)).toBeNull();
  });
});

describe('text validation', () => {
  it('cleans single-line text', () => {
    expect(cleanText('  a   b  ', { field: 'T', min: 1, max: 10 })).toEqual({ value: 'a b' });
    expect(cleanText('   ', { field: 'T', min: 1, max: 10 })).toEqual({ error: 'T is required.' });
    expect(cleanText('', { field: 'T', min: 0, max: 10, required: false })).toEqual({ value: '' });
    expect(cleanText('a\u0007b', { field: 'T', min: 1, max: 10 })).toEqual({ error: 'T contains invalid characters.' });
    expect(cleanText('line\nbreak', { field: 'T', min: 1, max: 20 })).toEqual({ value: 'line break' });
  });

  it('cleans multi-line text', () => {
    expect(cleanLongText(undefined, 'D', 10)).toEqual({ value: '' });
    expect(cleanLongText('a\r\nb', 'D', 10)).toEqual({ value: 'a\nb' });
    expect(cleanLongText('x'.repeat(11), 'D', 10)).toHaveProperty('error');
    expect(cleanLongText('‮', 'D', 10)).toHaveProperty('error');
  });

  it('parses times', () => {
    expect(parseTime('2026-01-01T00:00:00Z')).toBe(Date.UTC(2026, 0, 1));
    expect(parseTime(5)).toBe(5);
    expect(parseTime('nope')).toBeNull();
    expect(parseTime({})).toBeNull();
  });
});

describe('video verification', () => {
  const deps = (over: Partial<VerifyDeps>): VerifyDeps => ({
    fetch: (() => {
      throw new Error('no fetch');
    }) as unknown as typeof fetch,
    youtubeApiKey: null,
    twitch: null,
    keywords: ['daoc', 'dark age of camelot', 'eden'],
    now: () => 1_000_000,
    ...over,
  });
  const yt = { platform: 'youtube' as const, videoId: 'dQw4w9WgXcQ', canonicalUrl: '' };
  const vod = { platform: 'twitch-video' as const, videoId: '123456', canonicalUrl: '' };
  const clip = { platform: 'twitch-clip' as const, videoId: 'SlugAbc', canonicalUrl: '' };
  afterEach(() => resetTwitchToken());

  it('matches keywords on word boundaries', () => {
    expect(mentionsKeywords(['eden'], 'Best of Eden!')).toBe('eden');
    expect(mentionsKeywords(['eden'], 'Edenic gardens')).toBeNull();
    expect(mentionsKeywords(['dark age of camelot'], null, 'playing Dark Age of Camelot')).toBe('dark age of camelot');
  });

  it('YouTube: approves relevant, queues uncertain, rejects private/unembeddable/missing', async () => {
    const respond = (item: unknown) => deps({ youtubeApiKey: 'k', fetch: (async () => json({ items: item ? [item] : [] })) as unknown as typeof fetch });
    expect((await verifyVideo(yt, respond({ snippet: { title: 'x', tags: ['DAoC'] }, status: {} }))).decision).toBe('approved');
    const unsure = await verifyVideo(yt, respond({ snippet: { title: 'My cat', thumbnails: { high: { url: 'https://evil.example/x.jpg' } } }, status: {} }));
    expect(unsure).toMatchObject({ decision: 'pending', thumbnailUrl: null });
    expect((await verifyVideo(yt, respond({ snippet: {}, status: { privacyStatus: 'private' } }))).decision).toBe('rejected');
    expect((await verifyVideo(yt, respond({ snippet: {}, status: { embeddable: false } }))).reason).toMatch(/embedding/);
    expect((await verifyVideo(yt, respond(null))).decision).toBe('rejected');
  });

  it('falls back to moderation when an API is unavailable or not configured', async () => {
    expect((await verifyVideo(yt, deps({}))).decision).toBe('pending');
    expect((await verifyVideo(vod, deps({}))).reason).toMatch(/Twitch verification is not configured/);
    const down = deps({ youtubeApiKey: 'k', fetch: (async () => json({}, 500)) as unknown as typeof fetch });
    expect((await verifyVideo(yt, down)).reason).toMatch(/unavailable/);
  });

  it('Twitch: uses an app token (cached), checks VODs and clips', async () => {
    const calls: string[] = [];
    let item: unknown = { title: 'Eden keep fight', thumbnail_url: 'https://static-cdn.jtvnw.net/cf_vods/x-%{width}x%{height}.jpg' };
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.startsWith('https://id.twitch.tv/')) return json({ access_token: 'app', expires_in: 3600 });
      if (url.includes('missing')) return json({}, 404);
      return json({ data: item ? [item] : [] });
    });
    const d = deps({ twitch: { clientId: 'c', clientSecret: 's' }, fetch: fetchFn as unknown as typeof fetch });
    const r1 = await verifyVideo(vod, d);
    expect(r1).toMatchObject({ decision: 'approved', thumbnailUrl: 'https://static-cdn.jtvnw.net/cf_vods/x-480x272.jpg' });
    item = { title: 'random', thumbnail_url: 'https://evil.example/t.jpg' };
    expect(await verifyVideo(clip, d)).toMatchObject({ decision: 'pending', thumbnailUrl: null });
    expect(calls.filter((u) => u.startsWith('https://id.twitch.tv/'))).toHaveLength(1);
    expect(calls).toContain('https://api.twitch.tv/helix/clips?id=SlugAbc');
    item = null;
    expect((await verifyVideo(vod, d)).decision).toBe('rejected');
    expect((await verifyVideo({ ...clip, videoId: 'missing' }, d)).decision).toBe('rejected');
  });

  it('Twitch: queues for moderation if the token request fails', async () => {
    const d = deps({ twitch: { clientId: 'c', clientSecret: 's' }, fetch: (async () => json({}, 400)) as unknown as typeof fetch });
    expect((await verifyVideo(vod, d)).decision).toBe('pending');
    const helixDown = deps({
      twitch: { clientId: 'c', clientSecret: 's' },
      fetch: (async (url: string) => (url.includes('id.twitch.tv') ? json({ access_token: 'a', expires_in: 10 }) : json({}, 503))) as unknown as typeof fetch,
    });
    expect((await verifyVideo(vod, helixDown)).decision).toBe('pending');
  });
});

describe('seed data', () => {
  it('loads cleanly, produces a valid SQL script, and includes a tie', async () => {
    const { db, raw } = openSqlite();
    const now = Date.UTC(2026, 9, 1);
    await db.batch(seedStatements(now));
    expect((raw.prepare('SELECT COUNT(*) AS n FROM seasons').get() as any).n).toBe(3);
    const s3 = (await db.first<any>('SELECT * FROM seasons WHERE id = 1'))!;
    const results = await computeResults(db, s3, now);
    expect(results.categories.some((c) => c.winners.length > 1)).toBe(true);
    // No seeded vote is for the voter's own entry.
    expect(raw.prepare('SELECT COUNT(*) AS n FROM votes vo JOIN videos v ON v.id = vo.video_id WHERE v.author_discord_id = vo.voter_discord_id').get()).toMatchObject({ n: 0 });

    const sql = toSqlScript(seedStatements(now));
    const other = new DatabaseSync(':memory:');
    migrate(other);
    other.exec(sql);
    expect((other.prepare('SELECT COUNT(*) AS n FROM votes').get() as any).n).toBe((raw.prepare('SELECT COUNT(*) AS n FROM votes').get() as any).n);
    expect(new Set(Array.from({ length: 50 }, (_, i) => fakeYoutubeId(i))).size).toBe(50);
    expect(fakeYoutubeId(3)).toMatch(/^[A-Za-z0-9_-]{11}$/);
  });
});
