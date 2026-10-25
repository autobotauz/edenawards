import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Video } from '../../shared/types';
import { defaultThumbnail, embedUrl, PLATFORM_LABEL } from '../../shared/video';
import { Avatar } from './ui';

/**
 * Click-to-play video. Shows a lightweight thumbnail first and only loads the official
 * YouTube/Twitch player when the viewer asks, so a page of 30 entries stays fast and
 * nothing autoplays. The embed URL is always rebuilt from the validated platform ID.
 */
export function VideoPlayer({ video, autoplay = false, startLoaded = false }: { video: Video; autoplay?: boolean; startLoaded?: boolean }) {
  const [loaded, setLoaded] = useState(startLoaded);
  const src = embedUrl(video.platform, video.platformVideoId, window.location.hostname, autoplay || !startLoaded);
  const thumb = video.thumbnailUrl ?? defaultThumbnail(video.platform, video.platformVideoId);
  const [thumbFailed, setThumbFailed] = useState(false);

  if (!src) return <div className="aspect-video rounded-md bg-night-deep" />;

  if (loaded) {
    return (
      <div className="aspect-video overflow-hidden rounded-md bg-black">
        <iframe
          src={src}
          title={`${video.title} — ${PLATFORM_LABEL[video.platform]} player`}
          className="h-full w-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setLoaded(true)}
      className="group relative block aspect-video w-full overflow-hidden rounded-md bg-night-deep text-left"
      aria-label={`Play “${video.title}”`}
    >
      {thumb && !thumbFailed ? (
        <img
          src={thumb}
          alt=""
          className="h-full w-full object-cover opacity-85 transition-opacity group-hover:opacity-100"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setThumbFailed(true)}
        />
      ) : (
        <div className="h-full w-full bg-[radial-gradient(circle_at_50%_40%,var(--color-keep-raised),var(--color-night-deep))]" />
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-gold bg-night/80 text-gold-bright transition-transform group-hover:scale-105">
          <svg viewBox="0 0 24 24" className="ml-1 h-6 w-6" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </span>
      <span className="absolute bottom-2 left-2 rounded bg-night/85 px-2 py-0.5 text-xs text-parchment-dim">
        {PLATFORM_LABEL[video.platform]}
      </span>
    </button>
  );
}

export function VideoCard({ video, footer, highlighted = false }: { video: Video; footer?: ReactNode; highlighted?: boolean }) {
  return (
    <article
      className={`panel flex flex-col overflow-hidden p-3 ${highlighted ? 'border-gold shadow-[0_0_0_1px_var(--color-gold)]' : ''}`}
      aria-label={video.title}
    >
      <VideoPlayer video={video} />
      <div className="flex flex-1 flex-col gap-2 px-1 pt-3">
        <h3 className="font-sans text-lg font-bold leading-snug tracking-normal">
          <Link to={`/videos/${video.id}`} className="text-parchment hover:text-gold-bright">
            {video.title}
          </Link>
        </h3>
        <div className="flex items-center gap-2 text-sm text-parchment-dim">
          <Avatar user={video.author} size={22} />
          <span>{video.author.displayName}</span>
        </div>
        {footer && <div className="mt-auto pt-2">{footer}</div>}
      </div>
    </article>
  );
}

const STATUS_STYLE = {
  pending: 'bg-warn/15 text-warn',
  approved: 'bg-ok/15 text-ok',
  rejected: 'bg-danger/15 text-danger',
  hidden: 'bg-rim/50 text-mist',
} as const;

const STATUS_LABEL = { pending: 'Awaiting review', approved: 'Approved', rejected: 'Rejected', hidden: 'Hidden' } as const;

export function StatusBadge({ status }: { status: keyof typeof STATUS_STYLE }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-sm ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}
