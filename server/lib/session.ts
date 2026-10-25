import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Ctx, SessionInfo } from '../context';
import type { UserRow } from './mappers';
import { randomToken, safeEqual, sha256 } from './security';
import { fail, forbidden, unauthorized } from './http';

export const SESSION_COOKIE = 'eden_session';
export const OAUTH_COOKIE = 'eden_oauth';

/** Looks up the session from its cookie. Only the SHA-256 hash of the token is stored. */
export async function loadSession(c: Ctx): Promise<SessionInfo | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || token.length > 200) return null;
  const { db, config, now } = c.var.deps;
  const idHash = await sha256(token);
  const row = await db.first<UserRow & { id_hash: string; csrf_token: string; expires_at: number }>(
    `SELECT s.id_hash, s.csrf_token, s.expires_at, u.*
     FROM sessions s JOIN users u ON u.discord_id = s.discord_id
     WHERE s.id_hash = ?`,
    [idHash],
  );
  if (!row) {
    clearSessionCookie(c);
    return null;
  }
  if (row.expires_at <= now()) {
    await db.run('DELETE FROM sessions WHERE id_hash = ?', [idHash]);
    clearSessionCookie(c);
    return null;
  }
  const { id_hash, csrf_token, expires_at: _e, ...user } = row;
  return {
    idHash: id_hash,
    csrfToken: csrf_token,
    user: user as UserRow,
    isAdmin: config.adminIds.has(row.discord_id),
  };
}

/**
 * Creates a brand-new session (fresh random ID) and sets the cookie. Any session the
 * browser already had is destroyed first, preventing session fixation.
 */
export async function createSession(c: Ctx, discordId: string): Promise<void> {
  const { db, config, now } = c.var.deps;
  const existing = getCookie(c, SESSION_COOKIE);
  if (existing) await db.run('DELETE FROM sessions WHERE id_hash = ?', [await sha256(existing)]);

  const token = randomToken(32);
  const t = now();
  await db.batch([
    // Opportunistic cleanup of expired sessions keeps the table small without a cron job.
    { sql: 'DELETE FROM sessions WHERE expires_at <= ?', params: [t] },
    { sql: 'DELETE FROM rate_limits WHERE window_start < ?', params: [t - 86_400_000] },
    {
      sql: 'INSERT INTO sessions (id_hash, discord_id, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      params: [await sha256(token), discordId, randomToken(24), t + config.sessionTtlMs, t],
    },
  ]);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  });
}

export async function destroySession(c: Ctx): Promise<void> {
  const s = c.var.session;
  if (s) await c.var.deps.db.run('DELETE FROM sessions WHERE id_hash = ?', [s.idHash]);
  clearSessionCookie(c);
}

export function clearSessionCookie(c: Ctx) {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: c.var.deps.config.secureCookies });
}

export function requireUser(c: Ctx): SessionInfo {
  const s = c.var.session;
  if (!s) throw unauthorized();
  return s;
}

/** Banned accounts can still browse but cannot submit or vote. */
export function requireActiveUser(c: Ctx): SessionInfo {
  const s = requireUser(c);
  if (s.user.is_banned === 1) throw forbidden('Your account has been suspended from participating.');
  return s;
}

export function requireAdmin(c: Ctx): SessionInfo {
  const s = requireUser(c);
  // The allowlist lives in server configuration; nothing from the client is trusted.
  if (!s.isAdmin) throw forbidden('Administrator access required.');
  return s;
}

/**
 * CSRF protection for state-changing requests:
 *  1. The Origin header (when sent) must be an allowed origin.
 *  2. Authenticated requests must echo the per-session CSRF token in X-CSRF-Token.
 * SameSite=Lax cookies provide a further layer of defense.
 */
export function checkCsrf(c: Ctx) {
  const origin = c.req.header('origin');
  if (origin && !c.var.deps.config.allowedOrigins.includes(origin)) {
    throw fail(403, 'bad_origin', 'Request origin not allowed.');
  }
  const s = c.var.session;
  if (s) {
    const token = c.req.header('x-csrf-token') ?? '';
    if (!safeEqual(token, s.csrfToken)) throw fail(403, 'csrf', 'Your session token is missing or out of date. Please refresh the page.');
  }
}
