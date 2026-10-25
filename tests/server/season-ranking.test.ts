import { describe, expect, it } from 'vitest';
import { resultsVisible, seasonPhase, submissionState, votingState, windowState, type SeasonTimes } from '../../shared/season';
import { placeLabel, podium, rankEntries, winnersOf } from '../../shared/ranking';

const s: SeasonTimes = {
  submissionStartsAt: 100,
  submissionEndsAt: 200,
  votingStartsAt: 250,
  votingEndsAt: 300,
  resultsPublishAt: 350,
  resultsPublished: true,
};

describe('season windows', () => {
  it('uses half-open windows: open at start, closed exactly at end', () => {
    expect(windowState(100, 200, 99)).toBe('upcoming');
    expect(windowState(100, 200, 100)).toBe('open');
    expect(windowState(100, 200, 199)).toBe('open');
    expect(windowState(100, 200, 200)).toBe('closed');
  });

  it('keeps submission and voting countdowns independent', () => {
    expect([submissionState(s, 150), votingState(s, 150)]).toEqual(['open', 'upcoming']);
    expect([submissionState(s, 260), votingState(s, 260)]).toEqual(['closed', 'open']);
    const overlap = { ...s, votingStartsAt: 150 };
    expect([submissionState(overlap, 160), votingState(overlap, 160)]).toEqual(['open', 'open']);
  });

  it('derives every phase of a season transition', () => {
    expect(seasonPhase(s, 50)).toBe('upcoming');
    expect(seasonPhase(s, 150)).toBe('submissions');
    expect(seasonPhase(s, 220)).toBe('intermission');
    expect(seasonPhase(s, 260)).toBe('voting');
    expect(seasonPhase(s, 320)).toBe('tallying');
    expect(seasonPhase(s, 350)).toBe('completed');
  });

  it('only shows results when published AND after the publish time AND after voting', () => {
    expect(resultsVisible(s, 349)).toBe(false);
    expect(resultsVisible(s, 350)).toBe(true);
    expect(resultsVisible({ ...s, resultsPublished: false }, 1000)).toBe(false);
    expect(seasonPhase({ ...s, resultsPublished: false }, 1000)).toBe('tallying');
    // Even a misconfigured publish time before voting ends cannot leak results early.
    expect(resultsVisible({ ...s, resultsPublishAt: 0 }, 299)).toBe(false);
  });
});

describe('ranking', () => {
  const e = (id: number, votes: number, createdAt = id) => ({ id, votes, createdAt });

  it('uses competition ranking with shared ranks for ties', () => {
    const ranked = rankEntries([e(1, 2), e(2, 5), e(3, 5), e(4, 1), e(5, 0)]);
    expect(ranked.map((r) => [r.item.id, r.rank, r.tied])).toEqual([
      [2, 1, true],
      [3, 1, true],
      [1, 3, false],
      [4, 4, false],
      [5, 5, false],
    ]);
  });

  it('orders ties deterministically by submission time then id', () => {
    const ranked = rankEntries([e(9, 3, 50), e(4, 3, 50), e(1, 3, 60)]);
    expect(ranked.map((r) => r.item.id)).toEqual([4, 9, 1]);
    expect(ranked.every((r) => r.rank === 1 && r.tied)).toBe(true);
  });

  it('declares every tied first place a winner, but never a zero-vote entry', () => {
    const entries = rankEntries([e(1, 4), e(2, 4), e(3, 1)]).map((r) => ({ ...r, votes: r.item.votes }));
    expect(winnersOf(entries).map((w) => w.item.id)).toEqual([1, 2]);
    const none = rankEntries([e(1, 0), e(2, 0)]).map((r) => ({ ...r, votes: r.item.votes }));
    expect(winnersOf(none)).toEqual([]);
    expect(winnersOf([])).toEqual([]);
  });

  it('builds the podium in reveal order (third, second, first) and skips missing places', () => {
    const entries = rankEntries([e(1, 9), e(2, 7), e(3, 5), e(4, 5), e(5, 1)]).map((r) => ({ ...r, votes: r.item.votes }));
    expect(podium(entries).map((p) => [p.rank, p.entries.map((x) => x.item.id)])).toEqual([
      [3, [3, 4]],
      [2, [2]],
      [1, [1]],
    ]);
    const tiedFirst = rankEntries([e(1, 3), e(2, 3), e(3, 1)]).map((r) => ({ ...r, votes: r.item.votes }));
    expect(podium(tiedFirst).map((p) => p.rank)).toEqual([3, 1]);
    const zeros = rankEntries([e(1, 2), e(2, 0)]).map((r) => ({ ...r, votes: r.item.votes }));
    expect(podium(zeros).map((p) => p.rank)).toEqual([1]);
  });

  it('labels places', () => {
    expect(placeLabel(1)).toBe('First place');
    expect(placeLabel(2)).toBe('Second place');
    expect(placeLabel(3, 2)).toBe('Third place (tie)');
    expect(placeLabel(5)).toBe('Rank 5');
  });
});
