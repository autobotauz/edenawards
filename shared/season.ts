/**
 * Season timeline logic. Every state is derived from timestamps and the current
 * (server) time — nothing depends on a scheduled job flipping a flag.
 */

export interface SeasonTimes {
  submissionStartsAt: number;
  submissionEndsAt: number;
  votingStartsAt: number;
  votingEndsAt: number;
  resultsPublishAt: number;
  resultsPublished: boolean;
}

export type WindowState = 'upcoming' | 'open' | 'closed';

/**
 * Overall phase of a season:
 *  - upcoming:   nothing has opened yet
 *  - submissions: submissions open, voting not yet open
 *  - intermission: submissions closed, voting not yet open
 *  - voting:     voting open
 *  - tallying:   voting closed, results not yet public
 *  - completed:  results are public
 */
export type SeasonPhase = 'upcoming' | 'submissions' | 'intermission' | 'voting' | 'tallying' | 'completed';

/** Windows are half-open: [start, end). At exactly `end` the window is closed. */
export function windowState(start: number, end: number, now: number): WindowState {
  if (now < start) return 'upcoming';
  if (now < end) return 'open';
  return 'closed';
}

export function submissionState(s: SeasonTimes, now: number): WindowState {
  return windowState(s.submissionStartsAt, s.submissionEndsAt, now);
}

export function votingState(s: SeasonTimes, now: number): WindowState {
  return windowState(s.votingStartsAt, s.votingEndsAt, now);
}

/** Results are public only when an admin published them AND the publish time AND voting end have passed. */
export function resultsVisible(s: SeasonTimes, now: number): boolean {
  return s.resultsPublished && now >= s.resultsPublishAt && now >= s.votingEndsAt;
}

export function seasonPhase(s: SeasonTimes, now: number): SeasonPhase {
  if (resultsVisible(s, now)) return 'completed';
  const voting = votingState(s, now);
  if (voting === 'open') return 'voting';
  if (voting === 'closed') return 'tallying';
  if (submissionState(s, now) === 'open') return 'submissions';
  if (now < s.submissionStartsAt) return 'upcoming';
  // Submissions closed, voting not yet open.
  return 'intermission';
}

export const PHASE_LABEL: Record<SeasonPhase, string> = {
  upcoming: 'Coming soon',
  submissions: 'Submissions open',
  intermission: 'Voting opens soon',
  voting: 'Voting open',
  tallying: 'Votes being tallied',
  completed: 'Results announced',
};
