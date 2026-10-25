import { useEffect, useRef } from 'react';
import type { Season } from '../../shared/types';
import type { WindowState } from '../../shared/season';
import { useNow } from '../lib/hooks';
import { formatDateTime, remaining } from '../lib/time';

interface Props {
  title: string;
  state: WindowState;
  startsAt: string;
  endsAt: string;
  offset: number;
  /** Called once when the countdown crosses a boundary so the page can refresh server state. */
  onBoundary?: () => void;
}

const UNITS = ['days', 'hours', 'minutes', 'seconds'] as const;

/**
 * Displays time remaining until a window opens or closes. Display only — the server
 * enforces every deadline. Uses the server clock offset so a wrong PC clock doesn't matter.
 */
export function Countdown({ title, state, startsAt, endsAt, offset, onBoundary }: Props) {
  const now = useNow(1000, offset);
  // The state from the server may be slightly stale; recompute from the server-adjusted clock.
  const live: WindowState = now < Date.parse(startsAt) ? 'upcoming' : now < Date.parse(endsAt) ? 'open' : 'closed';
  const fired = useRef<WindowState | null>(null);
  useEffect(() => {
    if (live !== state && fired.current !== live && onBoundary) {
      fired.current = live;
      onBoundary();
    }
  }, [live, state, onBoundary]);
  const target = live === 'upcoming' ? startsAt : endsAt;
  const r = remaining(target, now);
  const caption = live === 'upcoming' ? 'Opens in' : live === 'open' ? 'Closes in' : 'Closed';
  const status = live === 'upcoming' ? 'Not open yet' : live === 'open' ? 'Open now' : 'Closed';

  return (
    <section aria-label={`${title} countdown`} className="panel relative overflow-hidden p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg">{title}</h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-sm ${
            live === 'open' ? 'bg-ok/15 text-ok' : live === 'upcoming' ? 'bg-warn/15 text-warn' : 'bg-rim/40 text-mist'
          }`}
        >
          {status}
        </span>
      </div>
      {live === 'closed' ? (
        <p className="mt-4 font-display text-2xl text-parchment-dim">Closed</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-mist">{caption}</p>
          <div className="mt-1 grid grid-cols-4 gap-2" role="timer" aria-live="off">
            {UNITS.map((u) => (
              <div key={u} className="rounded-md bg-night-deep/70 px-2 py-2 text-center">
                <div className="font-display text-2xl tabular-nums text-gold-bright sm:text-3xl">{String(r[u]).padStart(2, '0')}</div>
                <div className="text-xs text-mist">{u}</div>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="mt-3 text-sm text-parchment-dim">
        {live === 'upcoming' ? 'Opens ' : live === 'open' ? 'Closes ' : 'Closed '}
        <time dateTime={target}>{formatDateTime(target)}</time>
      </p>
    </section>
  );
}

export function SeasonCountdowns({ season, offset, onBoundary }: { season: Season; offset: number; onBoundary?: () => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Countdown
        title="Submissions"
        state={season.submissionState}
        startsAt={season.submissionStartsAt}
        endsAt={season.submissionEndsAt}
        offset={offset}
        onBoundary={onBoundary}
      />
      <Countdown
        title="Voting"
        state={season.votingState}
        startsAt={season.votingStartsAt}
        endsAt={season.votingEndsAt}
        offset={offset}
        onBoundary={onBoundary}
      />
    </div>
  );
}
