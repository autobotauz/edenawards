import { Link } from 'react-router-dom';
import type { Season } from '../../../shared/types';
import { PHASE_LABEL } from '../../../shared/season';
import { ErrorState, Spinner } from '../../components/ui';
import { useApi } from '../../lib/hooks';
import { formatDateTime } from '../../lib/time';
import { Stat } from './common';

interface Overview {
  status: {
    serverTime: string;
    database: string;
    discordConfigured: boolean;
    devLoginEnabled: boolean;
    youtubeVerification: boolean;
    twitchVerification: boolean;
    adminCount: number;
  };
  pendingSubmissions: number;
  seasons: Array<{ season: Season; submissions: Record<'pending' | 'approved' | 'rejected' | 'hidden', number>; votes: number; voters: number }>;
}

/** The next thing an organizer should do for a season, based on where it is in its lifecycle. */
export function nextStep(s: Season, pending: number): string {
  if (!s.isPublished) return 'Draft. Check the dates and categories, then publish the season.';
  if (pending > 0 && s.votingState !== 'closed') return `${pending} submission${pending === 1 ? '' : 's'} waiting for review.`;
  switch (s.phase) {
    case 'upcoming':
      return 'Announced. Submissions open automatically at the scheduled time.';
    case 'submissions':
      return 'Submissions are open. Keep an eye on the moderation queue.';
    case 'intermission':
      return 'Submissions closed. Voting opens automatically.';
    case 'voting':
      return 'Voting is open. It closes automatically at the deadline.';
    case 'tallying':
      return s.resultsPublished
        ? `Results publish automatically ${formatDateTime(s.resultsPublishAt)}.`
        : 'Voting closed. Review the final standings, rehearse the presentation, then publish results.';
    default:
      return 'Complete. Results are public and archived.';
  }
}

export function AdminOverview() {
  const { data, loading, error, reload } = useApi<Overview>('/api/admin/overview');
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorState error={error ?? new Error('No data')} onRetry={reload} />;
  const { status } = data;
  const checks: Array<[string, boolean, string]> = [
    ['Discord login', status.discordConfigured, status.discordConfigured ? 'Configured' : 'Not configured — set DISCORD_CLIENT_ID / SECRET'],
    ['Development login', !status.devLoginEnabled, status.devLoginEnabled ? 'ENABLED — turn off in production' : 'Off'],
    ['YouTube verification', status.youtubeVerification, status.youtubeVerification ? 'Automatic' : 'Manual review only'],
    ['Twitch verification', status.twitchVerification, status.twitchVerification ? 'Automatic' : 'Manual review only'],
  ];

  return (
    <div className="space-y-10">
      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Submissions awaiting review" value={data.pendingSubmissions} tone={data.pendingSubmissions ? 'warn' : 'ok'} />
        <Stat label="Seasons" value={data.seasons.length} />
        <Stat label="Administrators" value={status.adminCount} />
      </section>
      {data.pendingSubmissions > 0 && (
        <Link to="/admin/moderation" className="btn-gold">
          Review {data.pendingSubmissions} pending submission{data.pendingSubmissions === 1 ? '' : 's'}
        </Link>
      )}

      <section aria-labelledby="seasons-h">
        <div className="flex items-center justify-between">
          <h2 id="seasons-h" className="text-2xl">
            Seasons
          </h2>
          <Link to="/admin/seasons/new" className="btn-ghost">
            Create season
          </Link>
        </div>
        <ul className="mt-4 space-y-3">
          {data.seasons.map(({ season, submissions, votes, voters }) => (
            <li key={season.id} className="panel p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <Link to={`/admin/seasons/${season.id}`} className="font-display text-xl text-parchment">
                  {season.name}
                </Link>
                <span className="text-gold">{season.isPublished ? PHASE_LABEL[season.phase] : 'Draft'}</span>
              </div>
              <p className="mt-1 text-parchment-dim">{nextStep(season, submissions.pending)}</p>
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-mist">
                <div>
                  <dt className="inline">Approved entries: </dt>
                  <dd className="inline text-parchment">{submissions.approved}</dd>
                </div>
                <div>
                  <dt className="inline">Pending: </dt>
                  <dd className="inline text-parchment">{submissions.pending}</dd>
                </div>
                <div>
                  <dt className="inline">Votes: </dt>
                  <dd className="inline text-parchment">{votes}</dd>
                </div>
                <div>
                  <dt className="inline">Voters: </dt>
                  <dd className="inline text-parchment">{voters}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="status-h">
        <h2 id="status-h" className="text-2xl">
          System status
        </h2>
        <p className="mt-1 text-sm text-mist">Server time {formatDateTime(status.serverTime)} · database {status.database}</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {checks.map(([name, good, text]) => (
            <li key={name} className="panel flex items-center justify-between gap-3 px-4 py-3">
              <span>{name}</span>
              <span className={good ? 'text-ok' : 'text-warn'}>{text}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
