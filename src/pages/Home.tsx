import { Link } from 'react-router-dom';
import { PHASE_LABEL } from '../../shared/season';
import { SeasonCountdowns } from '../components/Countdown';
import { EmptyState, ErrorState, Pennants, Spinner } from '../components/ui';
import { LoginButton } from '../components/Login';
import { useAuth } from '../lib/auth';
import { useCurrentSeason } from '../lib/season';
import { formatDateTime, localZoneName } from '../lib/time';

const STEPS = [
  {
    title: 'Submit your clip',
    text: 'Paste a YouTube or Twitch link, give it a title and pick the award it belongs in.',
  },
  {
    title: 'Vote for the best',
    text: 'Watch the entries and cast one vote in every category. You can change your mind until voting closes.',
  },
  {
    title: 'Watch the ceremony',
    text: 'Winners and runners-up are revealed live on Discord, then published here for good.',
  },
];

export function Home() {
  const { season, categories, offset, loading, error, reload } = useCurrentSeason();
  const { user } = useAuth();

  if (loading) return <Spinner />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!season)
    return (
      <EmptyState title="The next awards season hasn't been announced">
        Check back soon, or ask in the Eden Discord when submissions open.
      </EmptyState>
    );

  const primary =
    season.phase === 'completed'
      ? { to: `/results/${season.id}`, label: 'See the winners' }
      : season.votingState === 'open'
        ? { to: '/vote', label: 'Browse & vote' }
        : season.submissionState === 'open'
          ? { to: '/submit', label: 'Submit a video' }
          : null;
  const secondary =
    season.submissionState === 'open' && season.votingState === 'open' ? { to: '/submit', label: 'Submit a video' } : null;

  return (
    <div className="space-y-14">
      <section className="relative grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <Pennants className="mb-6 h-14 w-28" />
          <p className="text-lg text-gold">{PHASE_LABEL[season.phase]}</p>
          <h1 className="mt-2 text-4xl leading-tight sm:text-5xl lg:text-6xl">{season.name}</h1>
          <p className="mt-5 max-w-xl text-lg text-parchment-dim">{season.description}</p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            {primary && (
              <Link to={primary.to} className="btn-gold px-5 py-2.5 text-lg">
                {primary.label}
              </Link>
            )}
            {secondary && (
              <Link to={secondary.to} className="btn-ghost px-5 py-2.5 text-lg">
                {secondary.label}
              </Link>
            )}
            {!user && !primary && <LoginButton className="px-5 py-2.5" />}
          </div>
        </div>
        <div className="space-y-3">
          <SeasonCountdowns season={season} offset={offset} onBoundary={reload} />
          <p className="text-sm text-mist">
            Times shown in your time zone ({localZoneName()}). Results are published{' '}
            {formatDateTime(season.resultsPublishAt)}.
          </p>
        </div>
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="text-2xl">
          How the awards work
        </h2>
        <ol className="mt-5 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="panel flex gap-4 p-5">
              <span className="font-display text-3xl text-gold" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <h3 className="font-sans text-lg font-bold tracking-normal">{s.title}</h3>
                <p className="mt-1 text-parchment-dim">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {categories.length > 0 && (
        <section aria-labelledby="cats">
          <h2 id="cats" className="text-2xl">
            This season’s awards
          </h2>
          <ul className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {categories.map((c) => (
              <li key={c.id} className="border-l-2 border-gold-deep pl-4">
                <Link to={`/vote?category=${c.id}`} className="font-display text-lg text-parchment">
                  {c.name}
                </Link>
                {c.description && <p className="text-parchment-dim">{c.description}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
