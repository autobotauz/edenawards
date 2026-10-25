import { describe, expect, it } from 'vitest';
import { ADMIN_ID, body, Client, DAY, json, loggedIn, ORIGIN, setup } from './helpers';
import { sha256 } from '../../server/lib/security';

const DISCORD_ENV = {
  DISCORD_CLIENT_ID: 'client123',
  DISCORD_CLIENT_SECRET: 'secret456',
  DEV_LOGIN: 'false',
};

function mockDiscord(env: ReturnType<typeof setup>, identity: Record<string, unknown> = { id: '123456789012345678', username: 'thane', global_name: 'Thane', avatar: 'a'.repeat(32) }) {
  const seen: Array<{ url: string; body?: string; auth?: string | null }> = [];
  env.setFetch(async (url, init) => {
    seen.push({ url, body: init?.body?.toString(), auth: new Headers(init?.headers).get('authorization') });
    if (url === 'https://discord.com/api/oauth2/token') return json({ access_token: 'tok_abc', token_type: 'Bearer' });
    if (url === 'https://discord.com/api/users/@me') return json(identity);
    return json({}, 404);
  });
  return seen;
}

async function startLogin(client: Client, returnTo = '/vote') {
  const res = await client.get(`/api/auth/discord?returnTo=${encodeURIComponent(returnTo)}`);
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get('location')!);
  return location;
}

describe('Discord OAuth2', () => {
  it('redirects to Discord with identify scope and a state bound to a cookie', async () => {
    const env = setup(DISCORD_ENV);
    const client = new Client(env);
    const loc = await startLogin(client);
    expect(loc.origin + loc.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(loc.searchParams.get('scope')).toBe('identify');
    expect(loc.searchParams.get('client_id')).toBe('client123');
    expect(loc.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback`);
    expect(loc.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(client.cookies.get('eden_oauth')).toContain(loc.searchParams.get('state')!);
    // The client secret never leaves the server.
    expect(loc.toString()).not.toContain('secret456');
  });

  it('completes the callback, creates the user and a hashed session, and redirects back', async () => {
    const env = setup(DISCORD_ENV);
    const seen = mockDiscord(env);
    const client = new Client(env);
    const loc = await startLogin(client, '/submit');
    const res = await client.get(`/api/auth/callback?code=abc&state=${loc.searchParams.get('state')}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/submit');

    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('eden_session='))!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(seen[0].body).toContain('client_secret=secret456');
    expect(seen[0].body).toContain('grant_type=authorization_code');
    expect(seen[1].auth).toBe('Bearer tok_abc');

    const me = await body(await client.get('/api/auth/me'));
    expect(me.user).toMatchObject({ discordId: '123456789012345678', username: 'thane', displayName: 'Thane', isAdmin: false });
    expect(me.user.avatarUrl).toBe(`https://cdn.discordapp.com/avatars/123456789012345678/${'a'.repeat(32)}.png?size=128`);

    // Only the hash of the session token is stored.
    const token = client.cookies.get('eden_session')!;
    const rows = env.raw.prepare('SELECT id_hash FROM sessions').all() as Array<{ id_hash: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id_hash).toBe(await sha256(token));
    expect(rows[0].id_hash).not.toBe(token);
    // No OAuth token is persisted anywhere.
    expect(JSON.stringify(env.raw.prepare('SELECT * FROM users').all())).not.toContain('tok_abc');
  });

  it('updates the stored username on later logins (identity is the Discord ID)', async () => {
    const env = setup(DISCORD_ENV);
    mockDiscord(env, { id: '123456789012345678', username: 'old', global_name: null, avatar: null });
    const c1 = new Client(env);
    let loc = await startLogin(c1);
    await c1.get(`/api/auth/callback?code=a&state=${loc.searchParams.get('state')}`);
    mockDiscord(env, { id: '123456789012345678', username: 'renamed', global_name: null, avatar: null });
    const c2 = new Client(env);
    loc = await startLogin(c2);
    await c2.get(`/api/auth/callback?code=a&state=${loc.searchParams.get('state')}`);
    const users = env.raw.prepare('SELECT * FROM users').all() as Array<{ username: string }>;
    expect(users).toHaveLength(1);
    expect(users[0].username).toBe('renamed');
  });

  it('rejects an invalid or missing state (OAuth CSRF)', async () => {
    const env = setup(DISCORD_ENV);
    const seen = mockDiscord(env);
    const client = new Client(env);
    await startLogin(client);
    const res = await client.get('/api/auth/callback?code=abc&state=forged');
    expect(res.headers.get('location')).toBe('/?login=invalid_state');
    const noCookie = await new Client(env).get('/api/auth/callback?code=abc&state=anything');
    expect(noCookie.headers.get('location')).toBe('/?login=invalid_state');
    expect(seen).toHaveLength(0);
    expect(env.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toMatchObject({ n: 0 });
  });

  it('handles the user cancelling, a missing code and Discord failures', async () => {
    const env = setup(DISCORD_ENV);
    let client = new Client(env);
    let loc = await startLogin(client);
    let res = await client.get(`/api/auth/callback?error=access_denied&state=${loc.searchParams.get('state')}`);
    expect(res.headers.get('location')).toBe('/?login=cancelled');

    client = new Client(env);
    loc = await startLogin(client);
    res = await client.get(`/api/auth/callback?state=${loc.searchParams.get('state')}`);
    expect(res.headers.get('location')).toBe('/?login=failed');

    env.setFetch(() => json({ error: 'invalid_grant' }, 400));
    client = new Client(env);
    loc = await startLogin(client);
    res = await client.get(`/api/auth/callback?code=bad&state=${loc.searchParams.get('state')}`);
    expect(res.headers.get('location')).toBe('/?login=failed');

    for (const responder of [
      (url: string) => (url.includes('token') ? json({}) : json({})),
      (url: string) => (url.includes('token') ? json({ access_token: 't' }) : json({}, 401)),
      (url: string) => (url.includes('token') ? json({ access_token: 't' }) : json({ id: 'not-numeric', username: 'x' })),
    ]) {
      env.setFetch(responder);
      client = new Client(env);
      loc = await startLogin(client);
      res = await client.get(`/api/auth/callback?code=c&state=${loc.searchParams.get('state')}`);
      expect(res.headers.get('location')).toBe('/?login=failed');
    }
    expect(env.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toMatchObject({ n: 0 });
  });

  it('never redirects off-site after login (open-redirect protection)', async () => {
    const env = setup(DISCORD_ENV);
    mockDiscord(env);
    for (const evil of ['https://evil.example', '//evil.example', '/\\evil.example']) {
      const client = new Client(env);
      const loc = await startLogin(client, evil);
      const res = await client.get(`/api/auth/callback?code=abc&state=${loc.searchParams.get('state')}`);
      expect(res.headers.get('location')).toBe('/');
    }
  });

  it('replaces any existing session on login (session fixation)', async () => {
    const env = setup(DISCORD_ENV);
    mockDiscord(env);
    const client = new Client(env);
    client.cookies.set('eden_session', 'attacker-chosen-value');
    const loc = await startLogin(client);
    await client.get(`/api/auth/callback?code=abc&state=${loc.searchParams.get('state')}`);
    expect(client.cookies.get('eden_session')).not.toBe('attacker-chosen-value');

    // Logging in again from an authenticated browser destroys the previous session row.
    const before = client.cookies.get('eden_session')!;
    const loc2 = await startLogin(client);
    await client.get(`/api/auth/callback?code=abc&state=${loc2.searchParams.get('state')}`);
    expect(client.cookies.get('eden_session')).not.toBe(before);
    expect(env.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toMatchObject({ n: 1 });
  });

  it('returns 503 when Discord is not configured', async () => {
    const env = setup({ DEV_LOGIN: 'false' });
    expect((await new Client(env).get('/api/auth/discord')).status).toBe(503);
    expect((await new Client(env).get('/api/auth/callback?code=x&state=y')).status).toBe(503);
    expect(await body(await new Client(env).get('/api/auth/config'))).toEqual({ discordEnabled: false, devLoginEnabled: false });
  });

  it('rate limits login attempts', async () => {
    const env = setup({ ...DISCORD_ENV, TRUST_PROXY: 'true' });
    const client = new Client(env);
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) {
      statuses.push((await client.request('GET', '/api/auth/discord', undefined, { 'CF-Connecting-IP': '203.0.113.9' })).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 302)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
    // A different client IP is not affected.
    expect((await client.request('GET', '/api/auth/discord', undefined, { 'X-Forwarded-For': '198.51.100.1, 10.0.0.1' })).status).toBe(302);
  });
});

describe('sessions', () => {
  it('reports anonymous users as null', async () => {
    const env = setup();
    expect(await body(await new Client(env).get('/api/auth/me'))).toEqual({ user: null });
  });

  it('expires sessions and clears the cookie', async () => {
    const env = setup();
    const client = await loggedIn(env, '111111111111111111');
    expect((await body(await client.get('/api/auth/me'))).user).not.toBeNull();
    env.clock.now += 15 * DAY;
    const res = await client.get('/api/auth/me');
    expect((await body(res)).user).toBeNull();
    expect(client.cookies.has('eden_session')).toBe(false);
    expect(env.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toMatchObject({ n: 0 });
  });

  it('ignores unknown or oversized session cookies', async () => {
    const env = setup();
    const client = new Client(env);
    client.cookies.set('eden_session', 'nope');
    expect((await body(await client.get('/api/auth/me'))).user).toBeNull();
    client.cookies.set('eden_session', 'x'.repeat(300));
    expect((await body(await client.get('/api/auth/me'))).user).toBeNull();
  });

  it('logs out by deleting the session', async () => {
    const env = setup();
    const client = await loggedIn(env, '111111111111111111');
    const token = client.cookies.get('eden_session')!;
    const res = await client.post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(client.cookies.has('eden_session')).toBe(false);
    // The old token is useless even if replayed.
    const replay = new Client(env);
    replay.cookies.set('eden_session', token);
    expect((await body(await replay.get('/api/auth/me'))).user).toBeNull();
  });

  it('identifies admins only from the server-side allowlist', async () => {
    const env = setup();
    const admin = await loggedIn(env, ADMIN_ID);
    expect((await body(await admin.get('/api/auth/me'))).user.isAdmin).toBe(true);
    const user = await loggedIn(env, '222222222222222222');
    expect((await body(await user.get('/api/auth/me'))).user.isAdmin).toBe(false);
    // A client-supplied admin flag means nothing.
    const res = await user.request('GET', '/api/admin/overview', undefined, { 'X-Admin': 'true' });
    expect(res.status).toBe(403);
  });
});

describe('dev login', () => {
  it('is unavailable unless explicitly enabled', async () => {
    const env = setup({ DEV_LOGIN: 'false' });
    const res = await new Client(env).post('/api/auth/dev-login', { discordId: ADMIN_ID, username: 'x' });
    expect(res.status).toBe(404);
  });

  it('validates its input', async () => {
    const env = setup();
    const c = new Client(env);
    expect((await c.post('/api/auth/dev-login', { discordId: 'abc', username: 'test' })).status).toBe(400);
    expect((await c.post('/api/auth/dev-login', { discordId: '123456789', username: '' })).status).toBe(400);
    expect(await body(await c.get('/api/auth/config'))).toEqual({ discordEnabled: false, devLoginEnabled: true });
  });
});

describe('CSRF and origin protection', () => {
  it('rejects state-changing requests without the session CSRF token', async () => {
    const env = setup();
    const client = await loggedIn(env, '111111111111111111');
    const res = await client.request('POST', '/api/auth/logout', {}, { 'X-CSRF-Token': 'wrong' });
    expect(res.status).toBe(403);
    expect((await body(res)).error.code).toBe('csrf');
    const missing = await client.request('POST', '/api/auth/logout', {}, { 'X-CSRF-Token': '' });
    expect(missing.status).toBe(403);
  });

  it('rejects cross-origin writes', async () => {
    const env = setup();
    const res = await new Client(env).request('POST', '/api/auth/dev-login', { discordId: '123456789', username: 'abc' }, { Origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect((await body(res)).error.code).toBe('bad_origin');
  });

  it('requires JSON bodies', async () => {
    const env = setup();
    const res = await env.app.request('/api/auth/dev-login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' }, body: 'x' });
    expect(res.status).toBe(415);
    const bad = await env.app.request('/api/auth/dev-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
    expect(bad.status).toBe(400);
    const arr = await env.app.request('/api/auth/dev-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[1]' });
    expect(arr.status).toBe(400);
  });
});

describe('general API behaviour', () => {
  it('sends security headers and JSON 404s', async () => {
    const env = setup();
    const res = await env.app.request('/api/nope');
    expect(res.status).toBe(404);
    expect((await body(res)).error.code).toBe('not_found');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const health = await env.app.request('/api/health');
    expect((await body(health)).ok).toBe(true);
  });

  it('adds HSTS when running on https', async () => {
    const env = setup({ APP_ORIGIN: 'https://eden-awards.com' });
    const res = await env.app.request('/api/health');
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
  });

  it('hides internal errors behind a generic 500', async () => {
    const env = setup();
    env.raw.exec('DROP TABLE seasons');
    const res = await env.app.request('/api/seasons');
    expect(res.status).toBe(500);
    const b = await body(res);
    expect(b.error.code).toBe('server_error');
    expect(JSON.stringify(b)).not.toMatch(/sqlite|no such table/i);
  });
});
