/**
 * Video URL parsing and normalization.
 *
 * Shared by the browser (live preview while typing) and the server (authoritative
 * validation). Only exact, allow-listed hosts are accepted, and embed URLs are always
 * built from a validated platform ID — never from the submitted string.
 */

export type Platform = 'youtube' | 'twitch-video' | 'twitch-clip';

export interface ParsedVideo {
  platform: Platform;
  videoId: string;
  canonicalUrl: string;
}

export type ParseResult = { ok: true; video: ParsedVideo } | { ok: false; error: string };

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const YOUTUBE_SHORT_HOSTS = new Set(['youtu.be']);
const TWITCH_HOSTS = new Set(['twitch.tv', 'www.twitch.tv', 'm.twitch.tv']);
const TWITCH_CLIP_HOSTS = new Set(['clips.twitch.tv']);

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const TWITCH_VIDEO_ID = /^\d{5,15}$/;
const TWITCH_CLIP_SLUG = /^[A-Za-z0-9_-]{3,100}$/;
const TWITCH_CHANNEL = /^[A-Za-z0-9_]{2,25}$/;

export const MAX_URL_LENGTH = 500;

const fail = (error: string): ParseResult => ({ ok: false, error });

const UNSUPPORTED =
  'Only YouTube videos (youtube.com/watch, youtu.be, Shorts) and Twitch VODs or clips are supported.';

export function parseVideoUrl(input: string): ParseResult {
  const raw = (input ?? '').trim();
  if (!raw) return fail('Please paste a YouTube or Twitch link.');
  if (raw.length > MAX_URL_LENGTH) return fail('That link is too long.');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail('That does not look like a valid link. It should start with https://');
  }

  if (url.protocol !== 'https:') return fail('Links must use https://');
  if (url.username || url.password) return fail('Links containing credentials are not allowed.');
  if (url.port) return fail('Links with custom ports are not allowed.');

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  if (YOUTUBE_HOSTS.has(host)) {
    let id: string | null = null;
    if (segments.length === 1 && segments[0] === 'watch') id = url.searchParams.get('v');
    else if (segments.length === 2 && (segments[0] === 'shorts' || segments[0] === 'embed')) id = segments[1];
    else if (segments[0] === 'live' || segments[0] === 'channel' || segments[0]?.startsWith('@'))
      return fail('Channel and livestream links are not supported. Please link a specific video.');
    if (!id) return fail(UNSUPPORTED);
    return youtube(id);
  }

  if (YOUTUBE_SHORT_HOSTS.has(host)) {
    if (segments.length !== 1) return fail(UNSUPPORTED);
    return youtube(segments[0]);
  }

  if (TWITCH_HOSTS.has(host)) {
    // https://www.twitch.tv/videos/123456789
    if (segments.length === 2 && segments[0] === 'videos') {
      const id = segments[1];
      if (!TWITCH_VIDEO_ID.test(id)) return fail('That Twitch video ID is not valid.');
      return ok('twitch-video', id, `https://www.twitch.tv/videos/${id}`);
    }
    // https://www.twitch.tv/<channel>/clip/<slug>
    if (segments.length === 3 && segments[1] === 'clip' && TWITCH_CHANNEL.test(segments[0])) {
      return twitchClip(segments[2]);
    }
    if (segments.length <= 1)
      return fail('Twitch channel pages and livestreams are not supported. Please link a VOD or clip.');
    return fail(UNSUPPORTED);
  }

  if (TWITCH_CLIP_HOSTS.has(host)) {
    // https://clips.twitch.tv/<slug>
    if (segments.length !== 1) return fail(UNSUPPORTED);
    return twitchClip(segments[0]);
  }

  return fail(UNSUPPORTED);
}

function youtube(id: string): ParseResult {
  if (!YOUTUBE_ID.test(id)) return fail('That YouTube video ID is not valid.');
  return ok('youtube', id, `https://www.youtube.com/watch?v=${id}`);
}

function twitchClip(slug: string): ParseResult {
  if (!TWITCH_CLIP_SLUG.test(slug)) return fail('That Twitch clip ID is not valid.');
  return ok('twitch-clip', slug, `https://clips.twitch.tv/${slug}`);
}

function ok(platform: Platform, videoId: string, canonicalUrl: string): ParseResult {
  return { ok: true, video: { platform, videoId, canonicalUrl } };
}

/** Validates an ID that came back from the database before it is used in an embed. */
export function isValidPlatformId(platform: Platform, id: string): boolean {
  if (platform === 'youtube') return YOUTUBE_ID.test(id);
  if (platform === 'twitch-video') return TWITCH_VIDEO_ID.test(id);
  return TWITCH_CLIP_SLUG.test(id);
}

/**
 * Builds the official embed URL from a trusted platform ID.
 * Twitch requires the `parent` parameter to equal the embedding page's hostname.
 */
export function embedUrl(platform: Platform, id: string, parentHost: string, autoplay = false): string | null {
  if (!isValidPlatformId(platform, id)) return null;
  const enc = encodeURIComponent;
  if (platform === 'youtube') {
    return `https://www.youtube-nocookie.com/embed/${enc(id)}?rel=0&modestbranding=1${autoplay ? '&autoplay=1' : ''}`;
  }
  const parent = enc(parentHost || 'localhost');
  if (platform === 'twitch-video') {
    return `https://player.twitch.tv/?video=v${enc(id)}&parent=${parent}&autoplay=${autoplay}`;
  }
  return `https://clips.twitch.tv/embed?clip=${enc(id)}&parent=${parent}&autoplay=${autoplay}`;
}

/** A static thumbnail that can be shown before the (heavier) player is loaded. */
export function defaultThumbnail(platform: Platform, id: string): string | null {
  if (platform === 'youtube' && YOUTUBE_ID.test(id)) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  return null;
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: 'YouTube',
  'twitch-video': 'Twitch VOD',
  'twitch-clip': 'Twitch Clip',
};
