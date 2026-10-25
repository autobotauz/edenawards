import { describe, expect, it } from 'vitest';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { findText, harness } from './harness';
import { ADMIN_ID, castVote, DAY, HOUR, makeSeason, makeVideo, T0 } from '../server/helpers';
import { buildSlides, categoryStart, MAX_NOMINEES, nextCategoryStart, nomineesOf, slideLabel } from '../../src/pages/present/slides';
import { useShow } from '../../src/pages/present/Present';
import type { CategoryResult, RankedEntry, SeasonResults, Video } from '../../shared/types';

const video = (id: number, title: string): Video => ({
  id,
  seasonId: 1,
  categoryId: 1,
  categoryName: 'Cat',
  title,
  platform: 'youtube',
  platformVideoId: 'dQw4w9WgXcQ',
  canonicalUrl: '',
  thumbnailUrl: null,
  author: { discordId: String(id), username: `u${id}`, displayName: `Player ${id}`, avatarUrl: null },
  createdAt: '',
});
const entry = (id: number, rank: number, votes: number, title = `T${id}`): RankedEntry => ({ rank, votes, tied: false, video: video(id, title) });
const cat = (id: number, entries: RankedEntry[]): CategoryResult => ({
  category: { id, seasonId: 1, name: `Category ${id}`, description: '', enabled: true, displayOrder: id },
  entries,
  totalVotes: entries.reduce((a, e) => a + e.votes, 0),
  winners: entries.filter((e) => e.rank === 1 && e.votes > 0),
});
const results = (cats: CategoryResult[]): SeasonResults => ({ season: { name: 'S' } as SeasonResults['season'], categories: cats });

describe('slide sequence', () => {
  it('follows title → nominees → third → second → first → video for each award', () => {
    const r = results([cat(1, [entry(1, 1, 5, 'Zed'), entry(2, 2, 3, 'Alpha'), entry(3, 3, 1, 'Mid'), entry(4, 4, 0)])]);
    const slides = buildSlides(r);
    expect(slides.map((s) => s.kind)).toEqual(['intro', 'category', 'nominees', 'reveal', 'reveal', 'reveal', 'video', 'finale']);
    expect(slides.map((s) => slideLabel(s, r))).toEqual([
      'Opening title',
      'Category 1: title',
      'Category 1: nominees',
      'Category 1: reveal third place',
      'Category 1: reveal second place',
      'Category 1: reveal first place',
      'Category 1: winning video',
      'Closing: all winners',
    ]);
  });

  it('lists nominees alphabetically so their order never hints at the result', () => {
    const c = cat(1, [entry(1, 1, 5, 'Zed'), entry(2, 2, 3, 'Alpha'), entry(3, 3, 1, 'Mid')]);
    expect(nomineesOf(c).map((n) => n.video.title)).toEqual(['Alpha', 'Mid', 'Zed']);
  });

  it('caps nominees but keeps everyone tied at the cut', () => {
    const many = Array.from({ length: 9 }, (_, i) => entry(i + 1, i < 5 ? i + 1 : 6, i < 5 ? 20 - i : 2));
    expect(nomineesOf(cat(1, many))).toHaveLength(9);
    const distinct = Array.from({ length: 9 }, (_, i) => entry(i + 1, i + 1, 20 - i));
    expect(nomineesOf(cat(1, distinct))).toHaveLength(MAX_NOMINEES);
  });

  it('reveals tied places together and skips the missing place', () => {
    const tie = { ...entry(2, 1, 4), tied: true };
    const r = results([cat(1, [{ ...entry(1, 1, 4), tied: true }, tie, entry(3, 3, 1)])]);
    const slides = buildSlides(r);
    const reveals = slides.filter((s) => s.kind === 'reveal');
    expect(reveals).toHaveLength(2);
    expect(slideLabel(reveals[0], r)).toBe('Category 1: reveal third place');
    expect(slideLabel(reveals[1], r)).toBe('Category 1: reveal first place');
    const video = slides.find((s) => s.kind === 'video')!;
    expect(video.kind === 'video' && video.winners).toHaveLength(2);
  });

  it('handles categories without votes', () => {
    const r = results([cat(1, [entry(1, 1, 0)]), cat(2, [])]);
    const slides = buildSlides(r);
    expect(slides.map((s) => s.kind)).toEqual(['intro', 'category', 'empty', 'category', 'empty', 'finale']);
    expect(slideLabel(slides[2], r)).toBe('Category 1: no votes');
  });

  it('finds category boundaries for jumping and skipping', () => {
    const r = results([cat(1, [entry(1, 1, 2)]), cat(2, [entry(2, 1, 1)])]);
    const slides = buildSlides(r);
    expect(categoryStart(slides, 1)).toBe(slides.findIndex((s) => s.kind === 'category' && s.categoryIndex === 1));
    expect(categoryStart(slides, 7)).toBe(0);
    expect(nextCategoryStart(slides, 1)).toBe(categoryStart(slides, 1));
    expect(nextCategoryStart(slides, slides.length - 1)).toBe(slides.length - 1);
  });
});

describe('presenter ↔ audience sync', () => {
  it('mirrors navigation between two windows over BroadcastChannel', async () => {
    const a = renderHook(() => useShow('42', 10));
    const b = renderHook(() => useShow('42', 10));
    act(() => a.result.current.next());
    await waitFor(() => expect(b.result.current.state.index).toBe(1));
    act(() => b.result.current.goTo(5));
    await waitFor(() => expect(a.result.current.state.index).toBe(5));
    act(() => a.result.current.goTo(99));
    await waitFor(() => expect(b.result.current.state.index).toBe(9));
    act(() => a.result.current.playVideo());
    await waitFor(() => expect(b.result.current.state.play).toBe(1));
    act(() => a.result.current.prev());
    await waitFor(() => expect(b.result.current.state).toMatchObject({ index: 8, play: 0 }));
    // A late-joining window asks for and receives the current state.
    const c = renderHook(() => useShow('42', 10));
    await waitFor(() => expect(c.result.current.state.index).toBe(8));
    // Other seasons are isolated.
    const other = renderHook(() => useShow('7', 10));
    act(() => a.result.current.replay());
    await new Promise((r) => setTimeout(r, 50));
    expect(other.result.current.state.index).toBe(0);
    [a, b, c, other].forEach((h) => h.unmount());
  });
});

describe('presentation pages', () => {
  async function ceremony() {
    const h = harness();
    await h.login(ADMIN_ID, 'Boss');
    const s = await makeSeason(h.env, { name: 'Eden Season 3 Awards', sub: [T0 - 3 * DAY, T0 - 2 * DAY], vote: [T0 - 2 * DAY, T0 - HOUR], categories: ['Best Solo PvP'] });
    const vids = [];
    for (let i = 0; i < 3; i++) vids.push(await makeVideo(h.env, s.seasonId, s.categoryIds[0], `70000000000000000${i}`));
    let n = 0;
    for (const [vid, count] of [[vids[0], 3], [vids[1], 2], [vids[2], 1]] as const)
      for (let i = 0; i < count; i++) await castVote(h.env, s.seasonId, s.categoryIds[0], vid, `61000000000000000${n++}`);
    return { h, s };
  }

  it('walks the presenter through the reveal with buttons and keys, in rehearsal mode', async () => {
    const { h, s } = await ceremony();
    h.render(`/present/${s.seasonId}`);
    expect(await findText(/Rehearsal mode/)).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 8/)).toBeInTheDocument();
    const u = user();
    await u.click(screen.getByRole('button', { name: 'Next: Best Solo PvP: title' }));
    expect(await findText(/Step 2 of 8/)).toBeInTheDocument();
    await u.keyboard('{ArrowRight}{ArrowRight}');
    expect(await findText(/reveal third place\. Keys/)).toBeInTheDocument();
    expect(screen.getByText('Third place')).toBeInTheDocument();
    expect(screen.queryByText('First place')).not.toBeInTheDocument();
    await u.keyboard('{ArrowLeft}');
    expect(await findText(/Best Solo PvP: nominees\. Keys/)).toBeInTheDocument();
    await u.keyboard('{End}');
    expect(await findText(/Closing: all winners/)).toBeInTheDocument();
    await u.keyboard('{Home}');
    await u.click(screen.getByRole('button', { name: 'Skip to next award' }));
    expect(await findText(/Step 2 of 8/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Best Solo PvP' }));
    await u.keyboard('r');
    for (let i = 0; i < 5; i++) await u.keyboard('{ArrowRight}');
    expect(await findText(/winning video\. Keys/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Play winning video on screen' }));
    await waitFor(() => expect(document.querySelector('iframe')?.src).toContain('autoplay=1'));
    await u.click(screen.getByRole('button', { name: 'Opening' }));
    await u.click(screen.getByRole('button', { name: 'Closing' }));
    expect(await findText(/Congratulations to the winners/)).toBeInTheDocument();
  });

  it('renders the audience screen without controls', async () => {
    const { h, s } = await ceremony();
    h.render(`/present/${s.seasonId}/screen`);
    expect(await screen.findByTestId('audience-screen')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Eden Season 3 Awards' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    const u = user();
    await u.keyboard('{ArrowRight}');
    expect(await screen.findByRole('heading', { name: 'Best Solo PvP' })).toBeInTheDocument();
    await u.keyboard('{PageUp}');
    await u.keyboard('f');
  });

  it('is only available to administrators', async () => {
    const { s } = await ceremony();
    const h2 = harness();
    await h2.login('111111111111111111');
    h2.render(`/present/${s.seasonId}/screen`);
    expect(await findText('Administrators only')).toBeInTheDocument();
    const h3 = harness();
    h3.render(`/present/${s.seasonId}`);
    expect(await findText('Log in to present the awards')).toBeInTheDocument();
  });
});

const user = () => userEvent.setup();
