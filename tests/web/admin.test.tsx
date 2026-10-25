import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { findText, harness } from './harness';
import { ADMIN_ID, castVote, DAY, HOUR, makeSeason, makeVideo, T0 } from '../server/helpers';
import { nextStep } from '../../src/pages/admin/Overview';
import type { Season } from '../../shared/types';

const user = () => userEvent.setup();

async function asAdmin() {
  const h = harness();
  await h.login(ADMIN_ID, 'Boss');
  return h;
}

describe('admin gate', () => {
  it('asks visitors to log in and refuses non-admins', async () => {
    const h = harness();
    h.render('/admin');
    expect(await findText('Log in to open the admin area')).toBeInTheDocument();

    const h2 = harness();
    await h2.login('111111111111111111');
    h2.render('/admin');
    expect(await findText('Administrators only')).toBeInTheDocument();
  });
});

describe('overview', () => {
  it('summarises seasons, the moderation queue and system status', async () => {
    const h = await asAdmin();
    const s = await makeSeason(h.env, { name: 'Live Season' });
    await makeVideo(h.env, s.seasonId, s.categoryIds[0], '700000000000000001', 'pending');
    await makeSeason(h.env, { name: 'Draft Season', published: false });
    h.render('/admin');
    expect(await screen.findByRole('link', { name: 'Review 1 pending submission' })).toHaveAttribute('href', '/admin/moderation');
    expect(screen.getByText('1 submission waiting for review.')).toBeInTheDocument();
    expect(screen.getByText(/Draft\. Check the dates/)).toBeInTheDocument();
    expect(screen.getByText('ENABLED — turn off in production')).toBeInTheDocument();
    expect(screen.getAllByText('Manual review only')).toHaveLength(2);
  });

  it('suggests the next step for every phase', () => {
    const base = { isPublished: true, resultsPublished: false, votingState: 'open', resultsPublishAt: new Date(T0).toISOString() } as Season;
    expect(nextStep({ ...base, phase: 'upcoming' }, 0)).toMatch(/Announced/);
    expect(nextStep({ ...base, phase: 'submissions' }, 0)).toMatch(/Submissions are open/);
    expect(nextStep({ ...base, phase: 'intermission' }, 0)).toMatch(/Voting opens automatically/);
    expect(nextStep({ ...base, phase: 'voting' }, 0)).toMatch(/Voting is open/);
    expect(nextStep({ ...base, phase: 'voting' }, 3)).toBe('3 submissions waiting for review.');
    expect(nextStep({ ...base, votingState: 'closed', phase: 'tallying' }, 2)).toMatch(/rehearse the presentation/);
    expect(nextStep({ ...base, votingState: 'closed', phase: 'tallying', resultsPublished: true }, 0)).toMatch(/publish automatically/);
    expect(nextStep({ ...base, phase: 'completed' }, 0)).toMatch(/Complete/);
  });
});

describe('seasons', () => {
  it('creates a draft season, copying categories, then lands in its editor', async () => {
    const h = await asAdmin();
    await makeSeason(h.env, { name: 'Eden Season 3 Awards', categories: ['Best Solo PvP', 'Funniest Moment'] });
    h.render('/admin/seasons');
    const u = user();
    await u.click(await screen.findByRole('link', { name: 'Create season' }));
    await u.type(await screen.findByLabelText('Name'), 'Eden Season 4 Awards');
    await u.type(screen.getByLabelText('Description'), 'Next season');
    await waitFor(() => expect(screen.getByLabelText('Copy categories from')).toHaveTextContent('Eden Season 3 Awards'));
    await u.selectOptions(screen.getByLabelText('Copy categories from'), 'Eden Season 3 Awards');
    await u.click(screen.getByRole('button', { name: 'Create draft season' }));
    expect(await findText('Season created as a draft.')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Award categories' })).toBeInTheDocument();
    expect(screen.getAllByText('Best Solo PvP').length).toBeGreaterThan(0);
    const row = h.env.raw.prepare("SELECT is_published FROM seasons WHERE name = 'Eden Season 4 Awards'").get() as { is_published: number };
    expect(row.is_published).toBe(0);
  });

  it('shows server validation errors next to the fields', async () => {
    const h = await asAdmin();
    h.render('/admin/seasons/new');
    const u = user();
    await u.type(await screen.findByLabelText('Name'), 'ab');
    await u.click(screen.getByRole('button', { name: 'Create draft season' }));
    expect(await findText('Name must be at least 3 characters.')).toBeInTheDocument();
  });

  it('edits a running season, locks passed times, and publishes after confirmation', async () => {
    const h = await asAdmin();
    const s = await makeSeason(h.env, { name: 'Draft', published: false, sub: [T0 + DAY, T0 + 2 * DAY], vote: [T0 + 2 * DAY, T0 + 3 * DAY] });
    h.render(`/admin/seasons/${s.seasonId}`);
    const u = user();
    const name = await screen.findByLabelText('Name');
    await u.clear(name);
    await u.type(name, 'Eden Season 9');
    await u.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await findText('Season saved.')).toBeInTheDocument();
    // Wait for the editor to reload the saved season before acting again.
    expect(await screen.findByRole('heading', { name: 'Eden Season 9' })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Publish season' }));
    expect(screen.getByText('Announce this season to everyone?')).toBeInTheDocument();
    await u.click(within(screen.getByRole('group', { name: 'Confirm action' })).getByRole('button', { name: 'Publish season' }));
    expect(await findText('Season published.')).toBeInTheDocument();
    expect((h.env.raw.prepare('SELECT name, is_published FROM seasons').get() as any)).toEqual({ name: 'Eden Season 9', is_published: 1 });
  });

  it('cancels a confirmation without acting', async () => {
    const h = await asAdmin();
    const s = await makeSeason(h.env, { name: 'Draft', published: false });
    h.render(`/admin/seasons/${s.seasonId}`);
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Publish season' }));
    await u.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Confirm action' })).not.toBeInTheDocument();
    expect((h.env.raw.prepare('SELECT is_published FROM seasons').get() as any).is_published).toBe(0);
  });

  it('publishes results after voting, shows private standings, and links to the presentation', async () => {
    const h = await asAdmin();
    const s = await makeSeason(h.env, { name: 'Done', sub: [T0 - 3 * DAY, T0 - 2 * DAY], vote: [T0 - 2 * DAY, T0 - HOUR], publish: T0 - 1 });
    const v = await makeVideo(h.env, s.seasonId, s.categoryIds[0], '700000000000000001');
    await castVote(h.env, s.seasonId, s.categoryIds[0], v, '610000000000000001');
    h.render(`/admin/seasons/${s.seasonId}`);
    expect(await findText(/these standings are final/)).toBeInTheDocument();
    expect(screen.getByText(/Hidden\. Rehearse the presentation/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Rehearse the presentation' })).toHaveAttribute('href', `/present/${s.seasonId}`);
    const u = user();
    await u.click(screen.getByRole('button', { name: 'Publish results' }));
    await u.click(within(screen.getByRole('group', { name: 'Confirm action' })).getByRole('button', { name: 'Publish results' }));
    expect(await findText('Results published.')).toBeInTheDocument();
    expect(await findText('Public now.')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Unpublish results' }));
    await u.click(within(screen.getByRole('group', { name: 'Confirm action' })).getByRole('button', { name: 'Unpublish results' }));
    expect(await findText('Results hidden.')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Refresh' }));
  });

  it('surfaces a refused publish (e.g. voting still open)', async () => {
    const h = await asAdmin();
    const s = await makeSeason(h.env, { name: 'Live' });
    h.render(`/admin/seasons/${s.seasonId}`);
    expect(await screen.findByRole('button', { name: 'Publish results' })).toBeDisabled();
    expect(await findText(/these numbers will change/)).toBeInTheDocument();
  });

  it('manages categories: add, rename, reorder, disable and delete', async () => {
    const h = await asAdmin();
    const s = await makeSeason(h.env, { name: 'Future', published: false, sub: [T0 + DAY, T0 + 2 * DAY], vote: [T0 + 2 * DAY, T0 + 3 * DAY], categories: ['Alpha', 'Beta'] });
    h.render(`/admin/seasons/${s.seasonId}`);
    const u = user();
    await u.type(await screen.findByLabelText('New category name'), 'Gamma');
    await u.click(screen.getByRole('button', { name: 'Add category' }));
    expect(await findText('Category added.')).toBeInTheDocument();
    await screen.findByText('Gamma');

    await u.click(screen.getAllByRole('button', { name: 'Rename' })[0]);
    const nameInput = screen.getAllByLabelText('Name').at(-1)!;
    await u.clear(nameInput);
    await u.type(nameInput, 'Alpha Prime');
    await u.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Alpha Prime')).toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'Move Alpha Prime down' }));
    expect(await findText('Order updated.')).toBeInTheDocument();
    await waitFor(() => {
      const names = (h.env.raw.prepare('SELECT name FROM categories ORDER BY display_order, id').all() as any[]).map((r) => r.name);
      expect(names).toEqual(['Beta', 'Alpha Prime', 'Gamma']);
    });

    await u.click(screen.getAllByRole('button', { name: 'Disable' })[0]);
    expect(await screen.findByText('(disabled)')).toBeInTheDocument();

    await u.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!);
    await u.click(within(screen.getByRole('group', { name: 'Confirm action' })).getByRole('button', { name: 'Delete' }));
    expect(await findText('Category deleted.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Gamma')).not.toBeInTheDocument());

    await u.type(screen.getByLabelText('New category name'), 'Beta');
    await u.click(screen.getByRole('button', { name: 'Add category' }));
    expect(await findText('Name already used.')).toBeInTheDocument();
  });
});

describe('moderation', () => {
  it('approves pending entries and requires a reason to reject', async () => {
    const h = await asAdmin();
    const s = await makeSeason(h.env, { name: 'Live' });
    await makeVideo(h.env, s.seasonId, s.categoryIds[0], '700000000000000001', 'pending');
    await makeVideo(h.env, s.seasonId, s.categoryIds[0], '700000000000000002', 'pending');
    h.render('/admin/moderation');
    const u = user();
    const items = await screen.findAllByRole('listitem');
    const first = items[0];
    await u.click(within(first).getByRole('button', { name: 'Reject' }));
    expect(within(first).getByText('Add a short reason so the player knows why.')).toBeInTheDocument();
    await u.type(within(first).getByLabelText(/Reason/), 'Not DAoC');
    await u.click(within(first).getByRole('button', { name: 'Reject' }));
    expect(await findText(/^Rejected “/)).toBeInTheDocument();
    const second = (await screen.findAllByRole('listitem'))[1];
    await u.click(within(second).getByRole('button', { name: 'Approve' }));
    expect(await findText(/^Approved “/)).toBeInTheDocument();
    const statuses = (h.env.raw.prepare('SELECT moderation_status FROM videos ORDER BY id').all() as any[]).map((r) => r.moderation_status);
    expect(statuses.sort()).toEqual(['approved', 'rejected']);
  });

  it('filters by status, season and search, and paginates', async () => {
    const h = await asAdmin();
    const s = await makeSeason(h.env, { name: 'Live' });
    for (let i = 0; i < 22; i++) await makeVideo(h.env, s.seasonId, s.categoryIds[0], `70000000000000020${i}`, 'approved');
    const voted = await makeVideo(h.env, s.seasonId, s.categoryIds[1], '700000000000000001', 'approved');
    await castVote(h.env, s.seasonId, s.categoryIds[1], voted, '610000000000000001');
    h.render('/admin/moderation');
    const u = user();
    expect(await findText('Nothing waiting for review')).toBeInTheDocument();
    await u.click(screen.getByRole('tab', { name: 'Approved' }));
    expect(await findText('23 submissions')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByText(/This entry has 1 votes/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Next' }));
    expect(await findText('Page 2 of 2')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Previous' }));
    await u.click(screen.getByRole('tab', { name: 'All' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true'));
    await u.selectOptions(screen.getByLabelText('Season'), 'Live');
    await u.type(screen.getByLabelText('Search title or player'), 'nothing-matches{enter}');
    expect(await findText('No submissions match')).toBeInTheDocument();
  });
});

describe('users and activity', () => {
  it('bans and unbans a player, refusing admins', async () => {
    const h = await asAdmin();
    await h.env.db.run("INSERT INTO users (discord_id, username, created_at, updated_at) VALUES ('111111111111111111', 'altaccount', ?, ?)", [T0, T0]);
    h.render('/admin/users');
    const u = user();
    const row = (await screen.findAllByText('altaccount', { exact: false }))[0].closest('tr')!;
    await u.click(within(row).getByRole('button', { name: 'Ban' }));
    await u.click(within(row).getByRole('button', { name: 'Ban' }));
    expect(await findText(/is banned from submitting and voting/)).toBeInTheDocument();
    expect(within(row).getByText('Banned')).toBeInTheDocument();
    await u.click(within(row).getByRole('button', { name: 'Unban' }));
    expect(await findText(/is unbanned/)).toBeInTheDocument();
    const adminRow = within(screen.getByRole('table')).getAllByText('Boss')[0].closest('tr')!;
    expect(within(adminRow).queryByRole('button', { name: 'Ban' })).not.toBeInTheDocument();
    await u.type(screen.getByLabelText('Search users'), 'zzz');
    await u.click(screen.getByRole('button', { name: 'Search' }));
    expect(await findText('No players found.')).toBeInTheDocument();
  });

  it('lists the activity log in plain language', async () => {
    const h = await asAdmin();
    const s = await makeSeason(h.env, { name: 'Live' });
    const v = await makeVideo(h.env, s.seasonId, s.categoryIds[0], '700000000000000001', 'pending');
    await act(async () => {
      await fetch(`/api/admin/videos/${v}/moderation`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': ((await (await fetch('/api/auth/me')).json()) as { user: { csrfToken: string } }).user.csrfToken },
        body: JSON.stringify({ status: 'approved' }),
      });
    });
    h.render('/admin/audit');
    expect(await findText('moderated a submission')).toBeInTheDocument();
  });
});
