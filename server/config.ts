/** Server configuration, loaded from environment variables / Worker bindings. Never sent to the browser. */

export interface Config {
  /** Public origin of the site, e.g. https://eden-awards.com or http://localhost:5173 */
  appOrigin: string;
  /** Extra origins allowed for state-changing requests (e.g. preview deployments). */
  allowedOrigins: string[];
  discord: { clientId: string; clientSecret: string; redirectUri: string } | null;
  adminIds: Set<string>;
  /** Development-only login that bypasses Discord. Never enable in production. */
  devLogin: boolean;
  youtubeApiKey: string | null;
  twitch: { clientId: string; clientSecret: string } | null;
  sessionTtlMs: number;
  /** Trust X-Forwarded-For for client IPs (only behind a trusted proxy). */
  trustProxy: boolean;
  relevanceKeywords: string[];
  /** Secure cookies. Defaults to true when appOrigin is https. */
  secureCookies: boolean;
}

export type EnvLike = Record<string, string | undefined>;

const DEFAULT_KEYWORDS = ['daoc', 'dark age of camelot', 'eden', 'eden server', 'eden daoc', 'camelot'];

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const bool = (v: string | undefined) => v === 'true' || v === '1';

export function loadConfig(env: EnvLike): Config {
  const appOrigin = (env.APP_ORIGIN ?? 'http://localhost:5173').replace(/\/+$/, '');
  const discord =
    env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET
      ? {
          clientId: env.DISCORD_CLIENT_ID,
          clientSecret: env.DISCORD_CLIENT_SECRET,
          redirectUri: env.DISCORD_REDIRECT_URI ?? `${appOrigin}/api/auth/callback`,
        }
      : null;
  const twitch =
    env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET
      ? { clientId: env.TWITCH_CLIENT_ID, clientSecret: env.TWITCH_CLIENT_SECRET }
      : null;
  const ttlDays = Number(env.SESSION_TTL_DAYS ?? '14');
  return {
    appOrigin,
    allowedOrigins: [appOrigin, ...list(env.ALLOWED_ORIGINS)],
    discord,
    adminIds: new Set(list(env.ADMIN_DISCORD_IDS)),
    devLogin: bool(env.DEV_LOGIN),
    youtubeApiKey: env.YOUTUBE_API_KEY || null,
    twitch,
    sessionTtlMs: (Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 14) * 86_400_000,
    trustProxy: bool(env.TRUST_PROXY),
    relevanceKeywords: env.RELEVANCE_KEYWORDS ? list(env.RELEVANCE_KEYWORDS).map((k) => k.toLowerCase()) : DEFAULT_KEYWORDS,
    secureCookies: env.SECURE_COOKIES ? bool(env.SECURE_COOKIES) : appOrigin.startsWith('https://'),
  };
}
