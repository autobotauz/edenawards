/**
 * Ranking and tie handling.
 *
 * Standard competition ranking ("1224"): entries with equal votes share a rank and the
 * next rank skips accordingly. Ties are never broken to invent a winner — tied entries
 * share the place. Display order within a tie is deterministic (earlier submission first,
 * then lower id) but carries no meaning.
 */

export interface Rankable {
  votes: number;
  createdAt: number;
  id: number;
}

export interface Ranked<T> {
  rank: number;
  tied: boolean;
  item: T;
}

export function rankEntries<T extends Rankable>(items: T[]): Ranked<T>[] {
  const sorted = [...items].sort((a, b) => b.votes - a.votes || a.createdAt - b.createdAt || a.id - b.id);
  const counts = new Map<number, number>();
  for (const it of sorted) counts.set(it.votes, (counts.get(it.votes) ?? 0) + 1);
  let rank = 0;
  let prevVotes: number | null = null;
  return sorted.map((item, index) => {
    if (item.votes !== prevVotes) {
      rank = index + 1;
      prevVotes = item.votes;
    }
    return { rank, tied: (counts.get(item.votes) ?? 0) > 1, item };
  });
}

/** Winners are every entry at rank 1 — but an entry with zero votes never wins. */
export function winnersOf<T extends { rank: number; votes: number }>(entries: T[]): T[] {
  return entries.filter((e) => e.rank === 1 && e.votes > 0);
}

export interface PodiumPlace<T> {
  /** 1, 2 or 3 — the rank shared by every entry in this place. */
  rank: number;
  entries: T[];
}

/**
 * Podium places for the live reveal, ordered for announcement: third → second → first.
 * Only ranks 1–3 with at least one vote are included. With ties, a rank may be missing
 * (e.g. two entries tied for first means there is no second place; the next is third).
 */
export function podium<T extends { rank: number; votes: number }>(entries: T[]): PodiumPlace<T>[] {
  const places = new Map<number, T[]>();
  for (const e of entries) {
    if (e.rank > 3 || e.votes <= 0) continue;
    const list = places.get(e.rank) ?? [];
    list.push(e);
    places.set(e.rank, list);
  }
  return [...places.entries()].sort((a, b) => b[0] - a[0]).map(([rank, list]) => ({ rank, entries: list }));
}

export function placeLabel(rank: number, tiedCount = 1): string {
  const base = rank === 1 ? 'First place' : rank === 2 ? 'Second place' : rank === 3 ? 'Third place' : `Rank ${rank}`;
  return tiedCount > 1 ? `${base} (tie)` : base;
}
