import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { MyVote, Season, Video } from '../../shared/types';
import { PLATFORM_LABEL } from '../../shared/video';
import { DevLogin, LoginButton } from '../components/Login';
import { Avatar, EmptyState, ErrorState, Spinner } from '../components/ui';
import { StatusBadge, VideoPlayer } from '../components/Video';
import { useAuth } from '../lib/auth';
import { useApi } from '../lib/hooks';
import { formatDate } from '../lib/time';
import { safeReturnPath } from '../lib/paths';
import { VoteButton } from './Browse';

export function VideoPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi<{ video: Video }>(`/api/videos/${id}`);
  const seasonRes = useApi<{ season: Season }>(data ? `/api/seasons/${data.video.seasonId}` : null);
  const votes = useApi<{ votes: MyVote[] }>(user && data ? `/api/votes/mine?seasonId=${data.video.seasonId}` : null);

  if (loading) return <Spinner />;
  if (error)
    return error.status === 404 ? (
      <EmptyState title="Video not found">It may still be awaiting review, or it was removed.</EmptyState>
    ) : (
      <ErrorState error={error} onRetry={reload} />
    );
  if (!data) return null;
  const v = data.video;
  const myVote = votes.data?.votes.find((x) => x.categoryId === v.categoryId);
  const season = seasonRes.data?.season;

  return (
    <article className="mx-auto max-w-4xl">
      <p className="text-gold">
        <Link to={`/vote?category=${v.categoryId}`}>{v.categoryName}</Link>
      </p>
      <h1 className="mt-1 text-3xl sm:text-4xl">{v.title}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-parchment-dim">
        <span className="flex items-center gap-2">
          <Avatar user={v.author} size={26} />
          {v.author.displayName}
        </span>
        <span>Submitted {formatDate(v.createdAt)}</span>
        <a href={v.canonicalUrl} target="_blank" rel="noopener noreferrer nofollow">
          Open on {PLATFORM_LABEL[v.platform]}
        </a>
        {v.moderationStatus && <StatusBadge status={v.moderationStatus} />}
      </div>
      {v.moderationStatus && v.moderationStatus !== 'approved' && (
        <p className="mt-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-warn">
          Only you and the moderators can see this entry until it is approved.
          {v.moderationReason ? ` Note: ${v.moderationReason}` : ''}
        </p>
      )}
      <div className="mt-6">
        <VideoPlayer video={v} />
      </div>
      {season && v.moderationStatus !== 'pending' && (!v.moderationStatus || v.moderationStatus === 'approved') && (
        <div className="mt-5 max-w-xs">
          <VoteButton season={season} video={v} myVote={myVote} onVoted={() => votes.reload()} />
        </div>
      )}
    </article>
  );
}

export function LoginPage() {
  const { user, config } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = safeReturnPath(params.get('returnTo'));
  if (user)
    return (
      <EmptyState title={`You're logged in as ${user.displayName}`}>
        <Link to={returnTo}>Continue</Link>
      </EmptyState>
    );
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-3xl">Log in</h1>
      {config.discordEnabled && (
        <div className="panel p-6">
          <p className="text-parchment-dim">Sign in with your Discord account. We only read your username and avatar.</p>
          <LoginButton returnTo={returnTo} className="mt-4" />
        </div>
      )}
      <DevLogin onDone={() => navigate(returnTo)} />
      {!config.discordEnabled && !config.devLoginEnabled && (
        <EmptyState title="Login is not configured">The site administrator needs to set up Discord login.</EmptyState>
      )}
    </div>
  );
}

export function NotFound() {
  return (
    <EmptyState title="Page not found">
      That page doesn't exist. <Link to="/">Go to the home page</Link>.
    </EmptyState>
  );
}
