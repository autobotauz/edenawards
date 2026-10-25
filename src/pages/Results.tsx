import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CategoryResult, Season, SeasonResults } from '../../shared/types';
import { placeLabel } from '../../shared/ranking';
import { plural } from '../../shared/format';
import { EmptyState, ErrorState, PageTitle, Spinner } from '../components/ui';
import { VideoPlayer } from '../components/Video';
import { Avatar } from '../components/ui';
import { useApi } from '../lib/hooks';
import { formatDate, formatDateTime } from '../lib/time';

export function Results() {
  const { seasonId } = useParams();
  const navigate = useNavigate();
  const seasons = useApi<{ seasons: Season[] }>('/api/seasons');

  if (seasons.loading) return <Spinner />;
  if (seasons.error) return <ErrorState error={seasons.error} onRetry={seasons.reload} />;
  const list = seasons.data?.seasons ?? [];
  if (!list.length) return <EmptyState title="No seasons yet">Results appear here after the first awards ceremony.</EmptyState>;

  const chosen =
    list.find((s) => String(s.id) === seasonId) ?? list.find((s) => s.resultsVisible) ?? list[0];

  return (
    <div>
      <PageTitle title="Results">Winners and final standings for every Eden Awards season.</PageTitle>
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <label htmlFor="season-select" className="text-parchment-dim">
          Season
        </label>
        <select
          id="season-select"
          className="field w-auto"
          value={chosen.id}
          onChange={(e) => navigate(`/results/${e.target.value}`)}
        >
          {list.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.resultsVisible ? '' : ' (results pending)'}
            </option>
          ))}
        </select>
      </div>
      {chosen.resultsVisible ? <SeasonResultsView seasonId={chosen.id} /> : <Pending season={chosen} />}
    </div>
  );
}

function Pending({ season }: { season: Season }) {
  return (
    <EmptyState title={`${season.name} results aren't out yet`}>
      {season.votingState === 'closed'
        ? `Voting has closed. Results will be announced ${formatDateTime(season.resultsPublishAt)}.`
        : season.votingState === 'open'
          ? (
            <>
              Voting is still open until {formatDateTime(season.votingEndsAt)}. <Link to="/vote">Cast your votes</Link>.
            </>
          )
          : `Voting opens ${formatDateTime(season.votingStartsAt)}.`}
    </EmptyState>
  );
}

function SeasonResultsView({ seasonId }: { seasonId: number }) {
  const { data, loading, error, reload } = useApi<SeasonResults>(`/api/results?seasonId=${seasonId}`);
  if (loading) return <Spinner />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  return (
    <div className="space-y-12">
      <p className="text-parchment-dim">
        Voting closed {formatDate(data.season.votingEndsAt)}. Tied entries share their place; no tie is broken artificially.
      </p>
      {data.categories.map((c) => (
        <CategoryResultView key={c.category.id} result={c} />
      ))}
    </div>
  );
}

function CategoryResultView({ result }: { result: CategoryResult }) {
  const { category, winners, entries, totalVotes } = result;
  return (
    <section aria-labelledby={`cat-${category.id}`} className="panel overflow-hidden">
      <div className="realm-rule opacity-70" />
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={`cat-${category.id}`} className="text-2xl">
            {category.name}
          </h2>
          <span className="text-sm text-mist">{plural(totalVotes, 'vote')}</span>
        </div>
        {winners.length === 0 ? (
          <p className="mt-4 text-parchment-dim">No votes were cast in this category.</p>
        ) : (
          <div className={`mt-5 grid gap-6 ${winners.length > 1 ? 'md:grid-cols-2' : 'md:grid-cols-[1.4fr_1fr]'}`}>
            {winners.map((w) => (
              <div key={w.video.id}>
                <VideoPlayer video={w.video} />
                <p className="mt-3 text-gold">{winners.length > 1 ? 'Winner (tie)' : 'Winner'}</p>
                <h3 className="font-sans text-xl font-bold tracking-normal">
                  <Link to={`/videos/${w.video.id}`} className="text-parchment">
                    {w.video.title}
                  </Link>
                </h3>
                <p className="mt-1 flex items-center gap-2 text-parchment-dim">
                  <Avatar user={w.video.author} size={22} /> {w.video.author.displayName}
                  <span className="text-mist">({plural(w.votes, 'vote')})</span>
                </p>
              </div>
            ))}
            {winners.length === 1 && <Standings entries={entries} />}
          </div>
        )}
        {winners.length > 1 && <Standings entries={entries} className="mt-6" />}
      </div>
    </section>
  );
}

function Standings({ entries, className = '' }: { entries: CategoryResult['entries']; className?: string }) {
  return (
    <div className={className}>
      <h3 className="font-sans text-base font-bold tracking-normal text-parchment-dim">Final standings</h3>
      <ol className="mt-2 divide-y divide-rim/50">
        {entries.map((e) => (
          <li key={e.video.id} className="flex items-center gap-3 py-2">
            <span className="w-8 shrink-0 font-display text-lg text-gold" aria-label={placeLabel(e.rank, e.tied ? 2 : 1)}>
              {e.rank}
              {e.tied && <span className="text-xs text-mist">=</span>}
            </span>
            <span className="min-w-0 flex-1">
              <Link to={`/videos/${e.video.id}`} className="block truncate text-parchment">
                {e.video.title}
              </Link>
              <span className="text-sm text-mist">{e.video.author.displayName}</span>
            </span>
            <span className="tabular-nums text-parchment-dim">{e.votes}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
