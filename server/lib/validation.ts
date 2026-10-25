import type { SeasonRow } from './mappers';

export type FieldErrors = Record<string, string>;

// Control characters (except none) and bidi overrides that can be used to spoof text.
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/;

export const TITLE_MIN = 3;
export const TITLE_MAX = 100;

/** Normalizes and validates a user-supplied single-line text field. */
export function cleanText(
  value: unknown,
  { field, min, max, required = true }: { field: string; min: number; max: number; required?: boolean },
): { value: string } | { error: string } {
  if (value === undefined || value === null || value === '') {
    return required ? { error: `${field} is required.` } : { value: '' };
  }
  if (typeof value !== 'string') return { error: `${field} must be text.` };
  if (BAD_CHARS.test(value.replace(/[\n\r\t]/g, ' '))) return { error: `${field} contains invalid characters.` };
  const v = value.replace(/\s+/g, ' ').trim();
  if (required && v.length === 0) return { error: `${field} is required.` };
  if (v.length < min) return { error: `${field} must be at least ${min} characters.` };
  if (v.length > max) return { error: `${field} must be at most ${max} characters.` };
  return { value: v };
}

/** Multi-line text (descriptions). Keeps newlines, strips other control characters. */
export function cleanLongText(value: unknown, field: string, max: number): { value: string } | { error: string } {
  if (value === undefined || value === null) return { value: '' };
  if (typeof value !== 'string') return { error: `${field} must be text.` };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/.test(value))
    return { error: `${field} contains invalid characters.` };
  const v = value.replace(/\r\n/g, '\n').trim();
  if (v.length > max) return { error: `${field} must be at most ${max} characters.` };
  return { value: v };
}

export function parseTime(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export interface SeasonTimesInput {
  submission_starts_at: number;
  submission_ends_at: number;
  voting_starts_at: number;
  voting_ends_at: number;
  results_publish_at: number;
}

export const TIME_FIELDS: Array<[keyof SeasonTimesInput, string]> = [
  ['submission_starts_at', 'submissionStartsAt'],
  ['submission_ends_at', 'submissionEndsAt'],
  ['voting_starts_at', 'votingStartsAt'],
  ['voting_ends_at', 'votingEndsAt'],
  ['results_publish_at', 'resultsPublishAt'],
];

/** Ordering rules shared by create and update. Mirrors the CHECK constraints in the schema. */
export function checkTimeOrder(t: SeasonTimesInput): FieldErrors {
  const e: FieldErrors = {};
  if (t.submission_ends_at <= t.submission_starts_at)
    e.submissionEndsAt = 'Submissions must close after they open.';
  if (t.voting_starts_at < t.submission_starts_at)
    e.votingStartsAt = 'Voting cannot open before submissions open.';
  if (t.voting_ends_at <= t.voting_starts_at) e.votingEndsAt = 'Voting must close after it opens.';
  if (t.results_publish_at < t.voting_ends_at)
    e.resultsPublishAt = 'Results cannot be published before voting closes.';
  return e;
}

/** Grace period so an admin can set a deadline to "now" without racing the clock. */
const CLOCK_GRACE_MS = 60_000;

/**
 * Rules that protect a running competition from edits that would corrupt it:
 *  - A timestamp that has already passed is locked (history cannot be rewritten,
 *    closed windows cannot be silently reopened).
 *  - A future timestamp may move, but not into the past.
 *  - The self-vote policy is locked once voting opens.
 */
export function checkLockedTimes(existing: SeasonRow, next: SeasonTimesInput, now: number): FieldErrors {
  const e: FieldErrors = {};
  for (const [col, field] of TIME_FIELDS) {
    const before = existing[col];
    const after = next[col];
    if (before === after) continue;
    if (before <= now) e[field] = 'This time has already passed and can no longer be changed.';
    else if (after < now - CLOCK_GRACE_MS) e[field] = 'This time cannot be moved into the past.';
  }
  return e;
}
