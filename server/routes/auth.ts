import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv, Ctx } from '../context';
import type { AuthConfig, Me } from '../../shared/types';
import { authorizeUrl, fetchIdentity, type DiscordIdentity } from '../providers/discord';
import { createSession, destroySession, OAUTH_COOKIE } from '../lib/session';
import { randomToken, safeEqual, safeReturnTo } from '../lib/security';
import { badRequest, fail, jsonBody, notFound } from '../lib/http';
import { enforce, LIMITS } from '../lib/ratelimit';
import { toPublicUser } from '../lib/mappers';
import { clientIp } from '../lib/ip';
import { cleanText } from '../lib/validation';

export const auth = new Hono<AppEnv>();

async function upsertUser(c: Ctx, id: DiscordIdentity) {
  const t = c.var.deps.now();
  await c.var.deps.db.run(
    `INSERT INTO users (discord_id, username, global_name, avatar, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(discord_id) DO UPDATE SET
       username = excluded.username, global_name = excluded.global_name,
       avatar = excluded.avatar, updated_at = excluded.updated_at`,
    [id.id, id.username, id.global_name, id.avatar, t, t],
  );
}

auth.get('/config', (c) => {
  const { config } = c.var.deps;
  const body: AuthConfig = { discordEnabled: config.discord !== null, devLoginEnabled: config.devLogin };
  return c.json(body);
});

auth.get('/me', (c) => {
  const s = c.var.session;
  if (!s) return c.json({ user: null });
  const u = s.user;
  const me: Me = {
    ...toPublicUser(u.discord_id, u.username, u.global_name, u.avatar),
    isAdmin: s.isAdmin,
    isBanned: u.is_banned === 1,
    csrfToken: s.csrfToken,
  };
  c.header('Cache-Control', 'no-store');
  return c.json({ user: me });
});

/** Step 1: redirect the browser to Discord with an unguessable `state` bound to a cookie. */
auth.get('/discord', async (c) => {
  const { config, db, now } = c.var.deps;
  if (!config.discord) throw fail(503, 'discord_not_configured', 'Discord login is not configured on this server.');
  await enforce(db, `login:${clientIp(c)}`, LIMITS.login, now());
  const state = randomToken(24);
  const returnTo = safeReturnTo(c.req.query('returnTo'));
  setCookie(c, OAUTH_COOKIE, `${state}|${returnTo}`, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Lax',
    path: '/api/auth',
    maxAge: 600,
  });
  return c.redirect(authorizeUrl(config.discord, state), 302);
});

/** Step 2: Discord redirects back here. Verify state, exchange the code, start a session. */
auth.get('/callback', async (c) => {
  const { config, fetch } = c.var.deps;
  if (!config.discord) throw fail(503, 'discord_not_configured', 'Discord login is not configured on this server.');

  const cookie = getCookie(c, OAUTH_COOKIE) ?? '';
  deleteCookie(c, OAUTH_COOKIE, { path: '/api/auth', secure: config.secureCookies });
  const [expectedState = '', rawReturn] = cookie.split('|');
  const returnTo = safeReturnTo(rawReturn);
  const state = c.req.query('state') ?? '';

  if (!expectedState || !safeEqual(state, expectedState)) {
    return c.redirect('/?login=invalid_state', 302);
  }
  if (c.req.query('error')) return c.redirect('/?login=cancelled', 302);
  const code = c.req.query('code');
  if (!code || code.length > 200) return c.redirect('/?login=failed', 302);

  let identity: DiscordIdentity;
  try {
    identity = await fetchIdentity(config.discord, code, fetch);
  } catch {
    return c.redirect('/?login=failed', 302);
  }
  await upsertUser(c, identity);
  await createSession(c, identity.id);
  return c.redirect(returnTo, 302);
});

auth.post('/logout', async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

/**
 * DEVELOPMENT ONLY: sign in as any user without Discord. Disabled unless DEV_LOGIN=true.
 * Returns 404 when disabled so the endpoint is indistinguishable from not existing.
 */
auth.post('/dev-login', async (c) => {
  const { config } = c.var.deps;
  if (!config.devLogin) throw notFound('Endpoint');
  const body = await jsonBody(c);
  const id = typeof body.discordId === 'string' ? body.discordId : '';
  if (!/^\d{5,25}$/.test(id)) throw badRequest('discordId must be a numeric Discord ID.');
  const name = cleanText(body.username, { field: 'Username', min: 2, max: 32 });
  if ('error' in name) throw badRequest(name.error);
  await upsertUser(c, { id, username: name.value, global_name: null, avatar: null });
  await createSession(c, id);
  return c.json({ ok: true });
});
