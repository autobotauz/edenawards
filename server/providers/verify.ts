/**
 * Automatic video verification against the YouTube Data API and Twitch Helix API.
 *
 * Requests are only ever made to fixed API hosts with an already-validated platform ID,
 * so user input can never steer a server-side fetch (no SSRF).
 *
 * Outcomes:
 *  - approved: the video exists, is public/embeddable, and mentions DAoC/Eden.
 *  - pending:  it exists but relevance is uncertain, or verification is not configured
 *              or temporarily failed — a moderator decides.
 *  - rejected: the video does not exist, is private, or cannot be embedded.
 */
import type { ParsedVideo } from '../../shared/video';

export type Decision = 'approved' | 'pending' | 'rejected';

export interface Verification {
  decision: Decision;
  reason: string;
  thumbnailUrl?: string | null;
}

export interface VerifyDeps {
  fetch: typeof fetch;
  youtubeApiKey: string | null;
  twitch: { clientId: string; clientSecret: string } | null;
  keywords: string[];
  now: () => number;
}

export function mentionsKeywords(keywords: string[], ...texts: Array<string | null | undefined>): string | null {
  const haystack = texts.filter(Boolean).join(' \n ').toLowerCase();
  for (const k of keywords) {
    const re = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
    if (re.test(haystack)) return k;
  }
  return null;
}

export async function verifyVideo(video: ParsedVideo, deps: VerifyDeps): Promise<Verification> {
  try {
    if (video.platform === 'youtube') return await verifyYouTube(video.videoId, deps);
    return await verifyTwitch(video, deps);
  } catch {
    return { decision: 'pending', reason: 'Automatic verification was unavailable; awaiting moderator review.' };
  }
}

async function verifyYouTube(id: string, deps: VerifyDeps): Promise<Verification> {
  if (!deps.youtubeApiKey) {
    return { decision: 'pending', reason: 'YouTube verification is not configured; awaiting moderator review.' };
  }
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=${encodeURIComponent(id)}&key=${encodeURIComponent(deps.youtubeApiKey)}`;
  const res = await deps.fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`YouTube API ${res.status}`);
  const data = (await res.json()) as {
    items?: Array<{
      snippet?: { title?: string; description?: string; tags?: string[]; thumbnails?: Record<string, { url?: string }> };
      status?: { privacyStatus?: string; embeddable?: boolean; uploadStatus?: string };
    }>;
  };
  const item = data.items?.[0];
  if (!item) return { decision: 'rejected', reason: 'This YouTube video does not exist or is private.' };
  if (item.status?.privacyStatus === 'private')
    return { decision: 'rejected', reason: 'This YouTube video is private.' };
  if (item.status?.embeddable === false)
    return { decision: 'rejected', reason: 'The owner has disabled embedding for this YouTube video.' };
  const thumb = item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.medium?.url ?? null;
  const thumbnailUrl = thumb && thumb.startsWith('https://i.ytimg.com/') ? thumb : null;
  const match = mentionsKeywords(
    deps.keywords,
    item.snippet?.title,
    item.snippet?.description,
    (item.snippet?.tags ?? []).join(' '),
  );
  if (match) return { decision: 'approved', reason: `Verified on YouTube (mentions "${match}").`, thumbnailUrl };
  return {
    decision: 'pending',
    reason: 'Video exists, but its title, description and tags do not mention DAoC or Eden. Needs a moderator.',
    thumbnailUrl,
  };
}

let twitchToken: { value: string; expiresAt: number; clientId: string } | null = null;

/** Exposed for tests. */
export function resetTwitchToken() {
  twitchToken = null;
}

async function getTwitchToken(deps: VerifyDeps): Promise<string> {
  const t = deps.twitch!;
  if (twitchToken && twitchToken.clientId === t.clientId && twitchToken.expiresAt > deps.now() + 60_000) {
    return twitchToken.value;
  }
  const res = await deps.fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: t.clientId, client_secret: t.clientSecret, grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error(`Twitch token ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  twitchToken = { value: data.access_token, expiresAt: deps.now() + data.expires_in * 1000, clientId: t.clientId };
  return data.access_token;
}

async function verifyTwitch(video: ParsedVideo, deps: VerifyDeps): Promise<Verification> {
  if (!deps.twitch) {
    return { decision: 'pending', reason: 'Twitch verification is not configured; awaiting moderator review.' };
  }
  const token = await getTwitchToken(deps);
  const endpoint = video.platform === 'twitch-video' ? 'videos' : 'clips';
  const res = await deps.fetch(`https://api.twitch.tv/helix/${endpoint}?id=${encodeURIComponent(video.videoId)}`, {
    headers: { 'Client-Id': deps.twitch.clientId, Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return { decision: 'rejected', reason: 'This Twitch video does not exist.' };
  if (!res.ok) throw new Error(`Twitch API ${res.status}`);
  const data = (await res.json()) as {
    data?: Array<{ title?: string; description?: string; thumbnail_url?: string }>;
  };
  const item = data.data?.[0];
  if (!item) return { decision: 'rejected', reason: 'This Twitch video does not exist or has expired.' };
  let thumbnailUrl: string | null = null;
  if (item.thumbnail_url) {
    const t = item.thumbnail_url.replace('%{width}', '480').replace('%{height}', '272');
    if (/^https:\/\/(static-cdn\.jtvnw\.net|clips-media-assets2\.twitch\.tv)\//.test(t)) thumbnailUrl = t;
  }
  // Twitch exposes no tags for VODs/clips; title and description are all we can check.
  const match = mentionsKeywords(deps.keywords, item.title, item.description);
  if (match) return { decision: 'approved', reason: `Verified on Twitch (mentions "${match}").`, thumbnailUrl };
  return {
    decision: 'pending',
    reason: 'Video exists on Twitch, but relevance could not be confirmed automatically. Needs a moderator.',
    thumbnailUrl,
  };
}
