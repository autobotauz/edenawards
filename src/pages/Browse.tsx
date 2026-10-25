import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Category, MyVote, Season, Video } from '../../shared/types';
import { Countdown } from '../components/Countdown';
import { LoginButton } from '../components/Login';
import { EmptyState, ErrorState, PageTitle, Spinner, useToast } from '../components/ui';
import { VideoCard } from '../components/Video';
import { ApiError, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi } from '../lib/hooks';
import { useCurrentSeason } from '../lib/season';
import { formatDateTime } from '../lib/time';

const PAGE = 24;

export function Browse() {
  const { season, categories, offset, loading, reload } = useCurrentSeason();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const votes = useApi<{ votes: MyVote[] }>(user && season ? `/api/votes/mine?seasonId=${season.id}` : null);
  const myVotes = useMemo(() => new Map((votes.data?.votes ?? []).map((v) => [v.categoryId, v])), [votes.data]);

  const requested = Number(params.get('category'));
  const active = categories.find((c) => c.id === requested) ?? categories[0];

  if (loading) return <Spinner />;
  if (!season) return <EmptyState title="No season is running">Entries appear here once a season opens.</EmptyState>;
  if (!categories.length) return <EmptyState title="No categories yet">The organizers haven't set up this season's awards.</EmptyState>;

  const votedCount = categories.filter((c) => myVotes.get(c.id)?.videoEligible).length;
  const select = (c: Category) => setParams({ category: String(c.id) }, { replace: false });

  return (
    <div>
      <PageTitle title="Browse & vote">
        Watch the entries in each category and pick your favorite. You get one vote per category
        {season.votingState === 'open' ? ', and you can change it until voting closes.' : '.'}
      </PageTitle>

      <div className="mb-8 grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
        <VotingStatus season={season} votedCount={votedCount} total={categories.length} signedIn={!!user} />
        <div className="md:w-96">
          <Countdown
            title="Voting"
            state={season.votingState}
            startsAt={season.votingStartsAt}
            endsAt={season.votingEndsAt}
            offset={offset}
            onBoundary={reload}
          />
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Award categories" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          <ul className="flex gap-2 lg:flex-col">
            {categories.map((c) => {
              const voted = myVotes.get(c.id);
              const isActive = c.id === active.id;
              return (
                <li key={c.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => select(c)}
                    aria-current={isActive ? 'true' : undefined}
                    className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                      isActive ? 'border-gold bg-keep-raised text-gold-bright' : 'border-rim/60 text-parchment-dim hover:text-parchment'
                    }`}
                  >
                    <span>{c.name}</span>
                    {voted && (
                      <span
                        className={voted.videoEligible ? 'text-ok' : 'text-warn'}
                        aria-label={voted.videoEligible ? 'You voted here' : 'Your vote needs attention'}
                      >
                        {voted.videoEligible ? '✓' : '!'}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <CategoryEntries
          key={active.id}
          season={season}
          category={active}
          myVote={myVotes.get(active.id)}
          onVoted={(v) => votes.setData((prev) => ({ votes: [...(prev?.votes ?? []).filter((x) => x.categoryId !== v.categoryId), v] }))}
        />
      </div>
    </div>
  );
}

function VotingStatus({ season, votedCount, total, signedIn }: { season: Season; votedCount: number; total: number; signedIn: boolean }) {
  if (season.votingState === 'upcoming')
    return (
      <div className="panel p-5">
        <h2 className="text-xl">Voting hasn’t opened yet</h2>
        <p className="mt-1 text-parchment-dim">You can watch the entries now. Voting opens {formatDateTime(season.votingStartsAt)}.</p>
      </div>
    );
  if (season.votingState === 'closed')
    return (
      <div className="panel p-5">
        <h2 className="text-xl">Voting is closed</h2>
        <p className="mt-1 text-parchment-dim">
          {season.resultsVisible ? (
            <>
              The results are in. <Link to={`/results/${season.id}`}>See the winners</Link>.
            </>
          ) : (
            <>Votes are final. Results will be announced {formatDateTime(season.resultsPublishAt)}.</>
          )}
        </p>
      </div>
    );
  if (!signedIn)
    return (
      <div className="panel flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <h2 className="text-xl">Voting is open</h2>
          <p className="mt-1 text-parchment-dim">Log in with Discord to cast your votes.</p>
        </div>
        <LoginButton returnTo="/vote" />
      </div>
    );
  const pct = total ? Math.round((votedCount / total) * 100) : 0;
  return (
    <div className="panel p-5">
      <h2 className="text-xl">
        You’ve voted in {votedCount} of {total} categories
      </h2>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-night-deep" role="progressbar" aria-valuenow={votedCount} aria-valuemin={0} aria-valuemax={total} aria-label="Voting progress">
        <div className="h-full bg-gold transition-all" style={{ width: `${pct}%` }} />
      </div>
      {votedCount === total && <p className="mt-2 text-ok">All done. Thanks for voting!</p>}
    </div>
  );
}

function CategoryEntries({
  season,
  category,
  myVote,
  onVoted,
}: {
  season: Season;
  category: Category;
  myVote: MyVote | undefined;
  onVoted: (v: MyVote) => void;
}) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Video[]>([]);
  const { data, loading, error, reload } = useApi<{ videos: Video[]; total: number }>(
    `/api/videos?seasonId=${season.id}&categoryId=${category.id}&page=${page}&pageSize=${PAGE}`,
  );
  useEffect(() => {
    if (data) setItems((prev) => (page === 1 ? data.videos : [...prev, ...data.videos.filter((v) => !prev.some((p) => p.id === v.id))]));
  }, [data, page]);

  return (
    <section aria-labelledby="cat-title">
      <h2 id="cat-title" className="text-2xl">
        {category.name}
      </h2>
      {category.description && <p className="mt-1 text-parchment-dim">{category.description}</p>}
      {myVote && !myVote.videoEligible && season.votingState === 'open' && (
        <p role="alert" className="mt-4 rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-warn">
          The entry you voted for was disqualified, so your vote no longer counts. Please choose another entry.
        </p>
      )}
      <div className="mt-6">
        {loading && !items.length ? (
          <Spinner />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : !items.length ? (
          <EmptyState title="No entries yet">
            {season.submissionState === 'open' ? (
              <>
                Be the first: <Link to="/submit">submit a video</Link> for this award.
              </>
            ) : (
              'No approved entries in this category.'
            )}
          </EmptyState>
        ) : (
          <>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((v) => (
                <VideoCard
                  key={v.id}
                  video={v}
                  highlighted={myVote?.videoId === v.id && myVote.videoEligible}
                  footer={<VoteButton season={season} video={v} myVote={myVote} onVoted={onVoted} />}
                />
              ))}
            </div>
            {data && items.length < data.total && (
              <button type="button" className="btn-ghost mt-6" onClick={() => setPage((p) => p + 1)} disabled={loading}>
                {loading ? 'Loading…' : `Show more (${data.total - items.length} left)`}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function VoteButton({
  season,
  video,
  myVote,
  onVoted,
}: {
  season: Season;
  video: Video;
  myVote: MyVote | undefined;
  onVoted: (v: MyVote) => void;
}) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const isMine = myVote?.videoId === video.id && myVote.videoEligible;

  if (season.votingState !== 'open') {
    return isMine ? <p className="font-bold text-gold-bright">Your vote</p> : null;
  }
  if (!user) {
    return <LoginButton returnTo={`/vote?category=${video.categoryId}`} className="w-full text-sm" label="Log in to vote" />;
  }
  if (!season.allowSelfVote && video.author.discordId === user.discordId) {
    return <p className="text-sm text-mist">This is your entry. You can't vote for your own video.</p>;
  }
  if (isMine) {
    return (
      <p className="flex items-center gap-2 font-bold text-gold-bright" aria-live="polite">
        <span aria-hidden="true">✓</span> Your vote
      </p>
    );
  }

  const cast = async () => {
    setBusy(true);
    try {
      const res = await post<{ vote: MyVote }>('/api/votes', { videoId: video.id, categoryId: video.categoryId });
      onVoted(res.vote);
      toast(myVote ? `Vote changed to “${video.title}”.` : `Voted for “${video.title}”.`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Your vote could not be recorded.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className={myVote ? 'btn-ghost w-full' : 'btn-gold w-full'} onClick={cast} disabled={busy} aria-label={`${myVote ? 'Change vote to' : 'Vote for'} ${video.title}`}>
      {busy ? 'Saving…' : myVote ? 'Change vote to this' : 'Vote for this'}
    </button>
  );
}
