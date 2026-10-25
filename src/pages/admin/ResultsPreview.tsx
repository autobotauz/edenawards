import { Link } from 'react-router-dom';
import type { Season, SeasonResults } from '../../../shared/types';
import { ErrorState, Spinner } from '../../components/ui';
import { useApi } from '../../lib/hooks';

export type AdminResults = SeasonResults & { participation: { voters: number; votes: number }; final: boolean; public: boolean };

/** Private standings for organizers. Never shown to players until results are published. */
export function SeasonResultsPreview({ season }: { season: Season }) {
  const { data, loading, error, reload } = useApi<AdminResults>(`/api/admin/seasons/${season.id}/results`);
  return (
    <section className="panel p-6" aria-labelledby="preview-h">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="preview-h" className="text-2xl">
          Standings (private)
        </h2>
        <button type="button" className="btn-ghost px-3 py-1 text-sm" onClick={reload}>
          Refresh
        </button>
      </div>
      {loading ? (
        <Spinner />
      ) : error || !data ? (
        <ErrorState error={error ?? new Error('No data')} onRetry={reload} />
      ) : (
        <>
          <p className="mt-1 text-parchment-dim">
            {data.final ? 'Voting is closed: these standings are final.' : 'Voting is still open: these numbers will change.'}{' '}
            {data.participation.voters} players cast {data.participation.votes} votes.{' '}
            {data.public ? 'Results are public.' : 'Only admins can see this.'}
          </p>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            {data.categories.map((c) => (
              <div key={c.category.id} className="rounded-md border border-rim/60 p-4">
                <h3 className="font-sans text-lg font-bold tracking-normal">{c.category.name}</h3>
                {c.entries.length === 0 ? (
                  <p className="text-sm text-mist">No approved entries.</p>
                ) : (
                  <ol className="mt-2 space-y-1 text-sm">
                    {c.entries.slice(0, 5).map((e) => (
                      <li key={e.video.id} className="flex gap-3">
                        <span className="w-8 text-gold">
                          {e.rank}
                          {e.tied ? '=' : ''}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{e.video.title}</span>
                        <span className="tabular-nums text-parchment-dim">{e.votes}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
          <Link to={`/present/${season.id}`} className="btn-gold mt-6">
            Rehearse the presentation
          </Link>
        </>
      )}
    </section>
  );
}
