/**
 * Builds the ordered slide sequence for the live awards ceremony.
 *
 * Per category:  title → nominees → (third → second → first) → winning video
 * Nominees are shown alphabetically, never in rank order, so the nominee slide
 * cannot give the result away. Ties share a place and are revealed together.
 */
import type { CategoryResult, RankedEntry, SeasonResults } from '../../../shared/types';
import { podium, type PodiumPlace } from '../../../shared/ranking';

export const MAX_NOMINEES = 6;

export type Slide =
  | { kind: 'intro' }
  | { kind: 'category'; categoryIndex: number }
  | { kind: 'nominees'; categoryIndex: number; nominees: RankedEntry[] }
  | { kind: 'reveal'; categoryIndex: number; places: PodiumPlace<RankedEntry>[]; revealed: number }
  | { kind: 'video'; categoryIndex: number; winners: RankedEntry[] }
  | { kind: 'empty'; categoryIndex: number }
  | { kind: 'finale' };

/** Finalists: everyone ranked within the top MAX_NOMINEES (ties at the cut are all included). */
export function nomineesOf(result: CategoryResult): RankedEntry[] {
  const withVotes = result.entries.filter((e) => e.votes > 0);
  const pool = withVotes.length ? withVotes : result.entries;
  const cutRank = pool[Math.min(MAX_NOMINEES, pool.length) - 1]?.rank ?? 0;
  return pool
    .filter((e) => e.rank <= cutRank)
    .slice()
    .sort((a, b) => a.video.title.localeCompare(b.video.title) || a.video.id - b.video.id);
}

export function buildSlides(results: SeasonResults): Slide[] {
  const slides: Slide[] = [{ kind: 'intro' }];
  results.categories.forEach((cat, categoryIndex) => {
    slides.push({ kind: 'category', categoryIndex });
    const places = podium(cat.entries);
    if (!places.length) {
      slides.push({ kind: 'empty', categoryIndex });
      return;
    }
    slides.push({ kind: 'nominees', categoryIndex, nominees: nomineesOf(cat) });
    places.forEach((_, i) => slides.push({ kind: 'reveal', categoryIndex, places, revealed: i + 1 }));
    slides.push({ kind: 'video', categoryIndex, winners: cat.winners });
  });
  slides.push({ kind: 'finale' });
  return slides;
}

export function slideLabel(slide: Slide, results: SeasonResults): string {
  const name = 'categoryIndex' in slide ? results.categories[slide.categoryIndex]?.category.name : '';
  switch (slide.kind) {
    case 'intro':
      return 'Opening title';
    case 'category':
      return `${name}: title`;
    case 'nominees':
      return `${name}: nominees`;
    case 'reveal': {
      const place = slide.places[slide.revealed - 1];
      return `${name}: reveal ${place.rank === 1 ? 'first' : place.rank === 2 ? 'second' : 'third'} place`;
    }
    case 'video':
      return `${name}: winning video`;
    case 'empty':
      return `${name}: no votes`;
    case 'finale':
      return 'Closing: all winners';
  }
}

/** Index of the first slide of the category after the current one (for "skip category"). */
export function nextCategoryStart(slides: Slide[], from: number): number {
  for (let i = from + 1; i < slides.length; i++) if (slides[i].kind === 'category' || slides[i].kind === 'finale') return i;
  return slides.length - 1;
}

export function categoryStart(slides: Slide[], categoryIndex: number): number {
  const i = slides.findIndex((s) => s.kind === 'category' && s.categoryIndex === categoryIndex);
  return i < 0 ? 0 : i;
}
