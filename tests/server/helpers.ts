import { createApp } from '../../server/app';
import { loadConfig, type EnvLike } from '../../server/config';
import { openSqlite } from '../../server/sqlite';
import type { Db } from '../../server/db';

export const ORIGIN = 'http://localhost:5173';
export const ADMIN_ID = '900000000000000001';
export const T0 = Date.UTC(2026, 5, 1, 12, 0, 0); // 2026-06-01 12:00 UTC
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export type FetchMock = (url: string, init?: RequestInit) => Promise<Response> | Response;

export interface TestEnv {
  app: ReturnType<typeof createApp>;
  db: Db;
  raw: ReturnType<typeof openSqlite>['raw'];
  clock: { now: number };
  setFetch(fn: FetchMock): void;
  fetchCalls: string[];
}

export function setup(env: EnvLike = {}, opts: { wrapDb?: (db: Db) => Db } = {}): TestEnv {
  const opened = openSqlite(':memory:');
  const raw = opened.raw;
  const db = opts.wrapDb ? opts.wrapDb(opened.db) : opened.db;
  const clock = { now: T0 };
  let fetchImpl: FetchMock = () => {
    throw new Error('Unexpected network call in test');
  };
  const fetchCalls: string[] = [];
  const config = loadConfig({
    APP_ORIGIN: ORIGIN,
    ADMIN_DISCORD_IDS: ADMIN_ID,
    DEV_LOGIN: 'true',
    ...env,
  });
  const app = createApp({
    db,
    config,
    now: () => clock.now,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push(url);
      return fetchImpl(url, init);
    }) as typeof fetch,
  });
  return {
    app,
    db,
    raw,
    clock,
    fetchCalls,
    setFetch: (fn) => {
      fetchImpl = fn;
    },
  };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A browser-like client: keeps cookies and sends the CSRF token on writes. */
export class Client {
  cookies = new Map<string, string>();
  csrf = '';
  constructor(private env: TestEnv) {}

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private store(res: Response) {
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const [pair, ...attrs] = sc.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      const expired = attrs.some((a) => /max-age=0/i.test(a)) || value === '';
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { Origin: ORIGIN, ...headers };
    if (this.cookies.size) h.Cookie = this.cookieHeader();
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (method !== 'GET' && this.csrf && !('X-CSRF-Token' in headers)) h['X-CSRF-Token'] = this.csrf;
    const res = await this.env.app.request(path, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.store(res);
    return res;
  }

  get(path: string) {
    return this.request('GET', path);
  }
  post(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request('POST', path, body ?? {}, headers);
  }
  patch(path: string, body: unknown) {
    return this.request('PATCH', path, body);
  }
  delete(path: string) {
    return this.request('DELETE', path);
  }

  async login(discordId: string, username = `user${discordId.slice(-4)}`) {
    const res = await this.post('/api/auth/dev-login', { discordId, username });
    if (res.status !== 200) throw new Error(`login failed ${res.status} ${await res.text()}`);
    const me = (await (await this.get('/api/auth/me')).json()) as { user: { csrfToken: string } };
    this.csrf = me.user.csrfToken;
    return this;
  }
}

export async function loggedIn(env: TestEnv, discordId: string, username?: string) {
  return new Client(env).login(discordId, username);
}

/** Creates a published season with categories directly in the database. */
export async function makeSeason(
  env: TestEnv,
  opts: {
    name?: string;
    sub?: [number, number];
    vote?: [number, number];
    publish?: number;
    published?: boolean;
    resultsPublished?: boolean;
    allowSelfVote?: boolean;
    categories?: string[];
  } = {},
) {
  const sub = opts.sub ?? [T0 - DAY, T0 + DAY];
  const vote = opts.vote ?? [T0 - HOUR, T0 + 2 * DAY];
  const publish = opts.publish ?? vote[1] + HOUR;
  const res = await env.db.run(
    `INSERT INTO seasons (name, description, submission_starts_at, submission_ends_at, voting_starts_at, voting_ends_at,
      results_publish_at, is_published, results_published, allow_self_vote, created_at, updated_at)
     VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.name ?? `Season ${Math.random().toString(36).slice(2, 8)}`,
      sub[0],
      sub[1],
      vote[0],
      vote[1],
      publish,
      opts.published === false ? 0 : 1,
      opts.resultsPublished ? 1 : 0,
      opts.allowSelfVote ? 1 : 0,
      T0 - 10 * DAY,
      T0 - 10 * DAY,
    ],
  );
  const seasonId = res.lastRowId;
  const categoryIds: number[] = [];
  for (const [i, name] of (opts.categories ?? ['Best Solo PvP', 'Funniest Moment']).entries()) {
    const c = await env.db.run(
      'INSERT INTO categories (season_id, name, description, enabled, display_order, created_at) VALUES (?, ?, ?, 1, ?, ?)',
      [seasonId, name, '', i + 1, T0 - 10 * DAY],
    );
    categoryIds.push(c.lastRowId);
  }
  return { seasonId, categoryIds };
}

let userCounter = 0;
export async function makeUser(env: TestEnv, id?: string, banned = false) {
  const discordId = id ?? String(800000000000000000n + BigInt(++userCounter));
  await env.db.run(
    `INSERT INTO users (discord_id, username, global_name, avatar, is_banned, created_at, updated_at)
     VALUES (?, ?, NULL, NULL, ?, ?, ?) ON CONFLICT(discord_id) DO NOTHING`,
    [discordId, `u${discordId.slice(-5)}`, banned ? 1 : 0, T0, T0],
  );
  return discordId;
}

let ytCounter = 0;
export function ytId() {
  return `vid${String(++ytCounter).padStart(8, '0')}`;
}

export async function makeVideo(
  env: TestEnv,
  seasonId: number,
  categoryId: number,
  authorId: string,
  status: 'approved' | 'pending' | 'rejected' | 'hidden' = 'approved',
  createdAt = T0 - HOUR,
) {
  await makeUser(env, authorId);
  const id = ytId();
  const res = await env.db.run(
    `INSERT INTO videos (season_id, category_id, author_discord_id, title, platform, platform_video_id, canonical_url,
       moderation_status, created_at) VALUES (?, ?, ?, ?, 'youtube', ?, ?, ?, ?)`,
    [seasonId, categoryId, authorId, `Video ${id}`, id, `https://www.youtube.com/watch?v=${id}`, status, createdAt],
  );
  return res.lastRowId;
}

export async function castVote(env: TestEnv, seasonId: number, categoryId: number, videoId: number, voterId: string) {
  await makeUser(env, voterId);
  await env.db.run(
    'INSERT INTO votes (season_id, category_id, video_id, voter_discord_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [seasonId, categoryId, videoId, voterId, T0, T0],
  );
}

export async function body<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
