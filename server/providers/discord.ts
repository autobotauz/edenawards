/** Discord OAuth2 (authorization code flow). Only the `identify` scope is requested. */

export const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
export const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
export const DISCORD_ME_URL = 'https://discord.com/api/users/@me';

export interface DiscordIdentity {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export interface DiscordSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function authorizeUrl(s: DiscordSettings, state: string): string {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: s.clientId,
    scope: 'identify',
    state,
    redirect_uri: s.redirectUri,
    prompt: 'none',
  });
  return `${DISCORD_AUTHORIZE_URL}?${p}`;
}

export class DiscordError extends Error {}

/** Exchanges the code for a token, fetches the identity, and discards the token immediately. */
export async function fetchIdentity(s: DiscordSettings, code: string, fetchFn: typeof fetch): Promise<DiscordIdentity> {
  const tokenRes = await fetchFn(DISCORD_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: s.clientId,
      client_secret: s.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: s.redirectUri,
    }),
  });
  if (!tokenRes.ok) throw new DiscordError(`Discord token exchange failed (${tokenRes.status})`);
  const token = (await tokenRes.json()) as { access_token?: string; token_type?: string };
  if (!token.access_token) throw new DiscordError('Discord did not return an access token');

  const meRes = await fetchFn(DISCORD_ME_URL, {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
  });
  if (!meRes.ok) throw new DiscordError(`Discord identity request failed (${meRes.status})`);
  const me = (await meRes.json()) as Partial<DiscordIdentity>;
  if (typeof me.id !== 'string' || !/^\d{5,25}$/.test(me.id) || typeof me.username !== 'string') {
    throw new DiscordError('Discord returned an unexpected identity');
  }
  return {
    id: me.id,
    username: me.username.slice(0, 64),
    global_name: typeof me.global_name === 'string' ? me.global_name.slice(0, 64) : null,
    avatar: typeof me.avatar === 'string' ? me.avatar : null,
  };
}
