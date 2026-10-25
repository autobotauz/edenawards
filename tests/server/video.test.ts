import { describe, expect, it } from 'vitest';
import { defaultThumbnail, embedUrl, isValidPlatformId, parseVideoUrl } from '../../shared/video';

const okVideo = (url: string) => {
  const r = parseVideoUrl(url);
  if (!r.ok) throw new Error(`expected ok for ${url}: ${r.error}`);
  return r.video;
};
const err = (url: string) => {
  const r = parseVideoUrl(url);
  if (r.ok) throw new Error(`expected failure for ${url}`);
  return r.error;
};

describe('parseVideoUrl — YouTube', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/abcdefghijk', 'abcdefghijk'],
    ['https://www.youtube.com/embed/abc-def_123', 'abc-def_123'],
    ['  https://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ  ', 'dQw4w9WgXcQ'],
  ])('accepts %s', (url, id) => {
    const v = okVideo(url);
    expect(v.platform).toBe('youtube');
    expect(v.videoId).toBe(id);
    expect(v.canonicalUrl).toBe(`https://www.youtube.com/watch?v=${id}`);
  });

  it('rejects invalid IDs', () => {
    expect(err('https://www.youtube.com/watch?v=short')).toMatch(/not valid/);
    expect(err('https://youtu.be/abc<script>')).toMatch(/not valid/);
    expect(err('https://www.youtube.com/watch')).toMatch(/Only YouTube/);
    expect(err('https://youtu.be/a/b')).toMatch(/Only YouTube/);
  });

  it('rejects channel and livestream pages', () => {
    expect(err('https://www.youtube.com/@EdenDAoC')).toMatch(/Channel and livestream/);
    expect(err('https://www.youtube.com/live/abcdefghijk')).toMatch(/Channel and livestream/);
    expect(err('https://www.youtube.com/channel/UC123')).toMatch(/Channel and livestream/);
    expect(err('https://www.youtube.com/playlist?list=PL1')).toMatch(/Only YouTube/);
  });
});

describe('parseVideoUrl — Twitch', () => {
  it('accepts VODs', () => {
    const v = okVideo('https://www.twitch.tv/videos/1234567890');
    expect(v).toEqual({ platform: 'twitch-video', videoId: '1234567890', canonicalUrl: 'https://www.twitch.tv/videos/1234567890' });
    expect(okVideo('https://m.twitch.tv/videos/123456?t=1h').videoId).toBe('123456');
  });

  it('accepts clips in both URL styles', () => {
    expect(okVideo('https://clips.twitch.tv/FancyClipSlug-abc123')).toMatchObject({
      platform: 'twitch-clip',
      videoId: 'FancyClipSlug-abc123',
      canonicalUrl: 'https://clips.twitch.tv/FancyClipSlug-abc123',
    });
    expect(okVideo('https://www.twitch.tv/edenstreamer/clip/FancyClipSlug-abc123').videoId).toBe('FancyClipSlug-abc123');
  });

  it('rejects channel pages, bad IDs and other paths', () => {
    expect(err('https://www.twitch.tv/edenstreamer')).toMatch(/channel pages/);
    expect(err('https://www.twitch.tv/')).toMatch(/channel pages/);
    expect(err('https://www.twitch.tv/videos/abc')).toMatch(/not valid/);
    expect(err('https://www.twitch.tv/edenstreamer/clip/x')).toMatch(/not valid/);
    expect(err('https://www.twitch.tv/directory/game/x')).toMatch(/Only YouTube/);
    expect(err('https://clips.twitch.tv/a/b')).toMatch(/Only YouTube/);
  });
});

describe('parseVideoUrl — safety', () => {
  it('requires https and a parseable URL', () => {
    expect(err('http://www.youtube.com/watch?v=dQw4w9WgXcQ')).toMatch(/https/);
    expect(err('youtube.com/watch?v=dQw4w9WgXcQ')).toMatch(/valid link/);
    expect(err('javascript:alert(1)')).toMatch(/https/);
    expect(err('')).toMatch(/paste/);
    expect(err('https://www.youtube.com/watch?v=' + 'a'.repeat(600))).toMatch(/too long/);
  });

  it('rejects credentials, ports and deceptive hosts', () => {
    expect(err('https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ')).toMatch(/credentials/);
    expect(err('https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ')).toMatch(/ports/);
    expect(err('https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ')).toMatch(/Only YouTube/);
    expect(err('https://evilyoutube.com/watch?v=dQw4w9WgXcQ')).toMatch(/Only YouTube/);
    expect(err('https://youtube.com@evil.example/watch?v=dQw4w9WgXcQ')).toMatch(/credentials/);
    expect(err('https://twitch.tv.evil.example/videos/123456')).toMatch(/Only YouTube/);
    expect(err('https://vimeo.com/123456')).toMatch(/Only YouTube/);
  });
});

describe('embed helpers', () => {
  it('builds official embed URLs from trusted IDs only', () => {
    expect(embedUrl('youtube', 'dQw4w9WgXcQ', 'eden-awards.com')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1',
    );
    expect(embedUrl('youtube', 'dQw4w9WgXcQ', 'x', true)).toContain('autoplay=1');
    expect(embedUrl('twitch-video', '123456', 'eden-awards.com')).toBe(
      'https://player.twitch.tv/?video=v123456&parent=eden-awards.com&autoplay=false',
    );
    expect(embedUrl('twitch-clip', 'SlugAbc', '')).toBe('https://clips.twitch.tv/embed?clip=SlugAbc&parent=localhost&autoplay=false');
    expect(embedUrl('youtube', '"><script>', 'x')).toBeNull();
  });

  it('validates stored IDs and gives YouTube thumbnails', () => {
    expect(isValidPlatformId('twitch-video', '123456')).toBe(true);
    expect(isValidPlatformId('twitch-clip', 'no spaces')).toBe(false);
    expect(defaultThumbnail('youtube', 'dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    expect(defaultThumbnail('twitch-clip', 'Slug')).toBeNull();
  });
});
