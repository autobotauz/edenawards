import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { findText, harness } from './harness';
import { castVote, DAY, HOUR, makeSeason, makeVideo, T0 } from '../server/helpers';

const user = () => userEvent.setup();

describe('Home page', () => {
  it('shows the current season, both countdowns, the categories and the right call to action', async () => {
    const h = harness();
    await makeSeason(h.env, { name: 'Eden Season 4 Awards', categories: ['Best Solo PvP', 'Funniest Moment'] });
    h.render('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Eden Season 4 Awards' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Submissions countdown' })).toHaveTextContent('Open now');
    expect(screen.getByRole('region', { name: 'Voting countdown' })).toHaveTextContent('Closes in');
    expect(screen.getByRole('link', { name: 'Best Solo PvP' })).toHaveAttribute('href', '/vote?category=' + 1);
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Browse & vote' })).toHaveAttribute('href', '/vote');
    expect(screen.getAllByRole('link', { name: 'Submit a video' }).length).toBeGreaterThan(0);
  });

  it('shows upcoming countdowns before anything opens', async () => {
    const h = harness();
    await makeSeason(h.env, { sub: [T0 + DAY, T0 + 2 * DAY], vote: [T0 + 2 * DAY, T0 + 3 * DAY] });
    h.render('/');
    const sub = await screen.findByRole('region', { name: 'Submissions countdown' });
    expect(sub).toHaveTextContent('Not open yet');
    expect(sub).toHaveTextContent('Opens in');
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });

  it('links to the winners when a season is complete', async () => {
    const h = harness();
    await makeSeason(h.env, { sub: [T0 - 9 * DAY, T0 - 8 * DAY], vote: [T0 - 8 * DAY, T0 - 7 * DAY], resultsPublished: true });
    h.render('/');
    expect(await screen.findByRole('link', { name: 'See the winners' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Voting countdown' })).toHaveTextContent('Closed');
  });

  it('explains when no season exists', async () => {
    const h = harness();
    h.render('/');
    expect(await findText("The next awards season hasn't been announced")).toBeInTheDocument();
  });

  it('reports failed Discord logins from the callback redirect', async () => {
    const h = harness();
    await makeSeason(h.env);
    h.render('/?login=invalid_state');
    expect(await findText(/Login expired/)).toBeInTheDocument();
  });
});

describe('Browse & vote', () => {
  async function arena() {
    const h = harness();
    const s = await makeSeason(h.env, { categories: ['Best Solo PvP', 'Funniest Moment'] });
    const a = await makeVideo(h.env, s.seasonId, s.categoryIds[0], '700000000000000001');
    const b = await makeVideo(h.env, s.seasonId, s.categoryIds[0], '700000000000000002');
    const mine = await makeVideo(h.env, s.seasonId, s.categoryIds[1], '444444444444444444');
    return { h, s, a, b, mine };
  }

  it('lets visitors browse without logging in', async () => {
    const { h } = await arena();
    h.render('/vote');
    expect(await screen.findByRole('heading', { name: 'Voting is open' })).toBeInTheDocument();
    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByRole('link', { name: 'Log in to vote' })).toHaveAttribute('href', expect.stringContaining('/login?returnTo='));
  });

  it('casts, shows and changes a vote, tracking progress across categories', async () => {
    const { h, b } = await arena();
    await h.login('444444444444444444', 'Voter');
    h.render('/vote');
    expect(await findText('You’ve voted in 0 of 2 categories')).toBeInTheDocument();
    const buttons = await screen.findAllByRole('button', { name: /^Vote for / });
    await user().click(buttons[0]);
    expect(await findText('You’ve voted in 1 of 2 categories')).toBeInTheDocument();
    expect(await findText(/^Voted for/)).toBeInTheDocument();
    const cards = screen.getAllByRole('article');
    expect(within(cards[0]).getByText('Your vote')).toBeInTheDocument();
    await user().click(within(cards[1]).getByRole('button', { name: /Change vote to/ }));
    await waitFor(() => expect(within(cards[1]).getByText('Your vote')).toBeInTheDocument());
    expect(await findText(/^Vote changed to/)).toBeInTheDocument();
    const rows = h.env.raw.prepare('SELECT video_id FROM votes').all() as Array<{ video_id: number }>;
    expect(rows).toEqual([{ video_id: b }]);
  });

  it("prevents voting for one's own entry and switches categories", async () => {
    const { h } = await arena();
    await h.login('444444444444444444', 'Voter');
    h.render('/vote');
    await user().click(await screen.findByRole('button', { name: 'Funniest Moment' }));
    expect(await findText(/This is your entry/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Vote for/ })).not.toBeInTheDocument();
  });

  it('warns when a voted entry was disqualified', async () => {
    const { h, s, a } = await arena();
    await castVote(h.env, s.seasonId, s.categoryIds[0], a, '444444444444444444');
    await h.env.db.run("UPDATE videos SET moderation_status = 'hidden' WHERE id = ?", [a]);
    await h.login('444444444444444444', 'Voter');
    h.render('/vote');
    expect(await findText(/was disqualified/)).toBeInTheDocument();
  });

  it('shows an error toast when the server refuses a vote', async () => {
    const { h, a } = await arena();
    await h.login('444444444444444444', 'Voter');
    h.render('/vote');
    await screen.findAllByRole('button', { name: /^Vote for / });
    await h.env.db.run("UPDATE videos SET moderation_status = 'rejected' WHERE id = ?", [a]);
    await user().click(screen.getAllByRole('button', { name: /^Vote for / })[0]);
    expect(await findText('This video is not eligible for votes.')).toBeInTheDocument();
  });

  it('explains closed and not-yet-open voting', async () => {
    const h = harness();
    const s = await makeSeason(h.env, { sub: [T0 - 2 * DAY, T0 - DAY], vote: [T0 - DAY, T0 - HOUR] });
    await makeVideo(h.env, s.seasonId, s.categoryIds[0], '700000000000000001');
    h.render('/vote');
    expect(await findText('Voting is closed')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Log in to vote' })).not.toBeInTheDocument();

    const h2 = harness();
    await makeSeason(h2.env, { vote: [T0 + DAY, T0 + 2 * DAY] });
    h2.render('/vote');
    expect((await screen.findAllByText('Voting hasn’t opened yet')).length).toBeGreaterThan(0);
  });

  it('shows an empty category with a prompt to submit', async () => {
    const h = harness();
    await makeSeason(h.env);
    h.render('/vote');
    expect(await findText('No entries yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'submit a video' })).toBeInTheDocument();
  });

  it('pages through long categories', async () => {
    const h = harness();
    const s = await makeSeason(h.env);
    for (let i = 0; i < 26; i++) await makeVideo(h.env, s.seasonId, s.categoryIds[0], `70000000000000010${i}`);
    h.render('/vote');
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(24));
    await user().click(screen.getByRole('button', { name: 'Show more (2 left)' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(26));
  });
});

describe('Submit page', () => {
  it('asks visitors to log in', async () => {
    const h = harness();
    await makeSeason(h.env);
    h.render('/submit');
    expect(await findText('Log in to submit a video')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Development login' })).toBeInTheDocument();
  });

  it('logs in via the dev form and submits a video end to end', async () => {
    const h = harness();
    await makeSeason(h.env, { categories: ['Best Solo PvP'] });
    h.render('/submit');
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Midgard Skald' }));
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    const url = await screen.findByLabelText('Video link');
    await u.type(url, 'https://example.com/x');
    expect(screen.getByText(/Only YouTube videos/)).toBeInTheDocument();
    await u.clear(url);
    await u.type(url, 'https://youtu.be/dQw4w9WgXcQ');
    expect(screen.getByText('Recognized: YouTube dQw4w9WgXcQ')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Submit video' }));
    expect(await findText('Give your video a title of at least 3 characters.')).toBeInTheDocument();
    expect(screen.getByText('Please choose an award category.')).toBeInTheDocument();
    await u.type(screen.getByLabelText('Title'), 'Midgard solo run');
    await u.selectOptions(screen.getByLabelText('Award category'), 'Best Solo PvP');
    await u.click(screen.getByRole('button', { name: 'Submit video' }));
    expect(await findText('Your video is entered')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View your entry' })).toHaveAttribute('href', '/videos/1');
    const aside = screen.getByRole('complementary');
    await waitFor(() => expect(within(aside).getByText('Midgard solo run')).toBeInTheDocument());
    expect(within(aside).getByText('Awaiting review')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Submit another video' }));
    expect(screen.getByLabelText('Video link')).toHaveValue('');
  });

  it('shows server-side field errors such as duplicates', async () => {
    const h = harness();
    const s = await makeSeason(h.env, { categories: ['Best Solo PvP'] });
    await h.env.db.run(
      `INSERT INTO users (discord_id, username, created_at, updated_at) VALUES ('700000000000000001', 'x', 0, 0)`,
    );
    await h.env.db.run(
      `INSERT INTO videos (season_id, category_id, author_discord_id, title, platform, platform_video_id, canonical_url, created_at)
       VALUES (?, ?, '700000000000000001', 'Taken', 'youtube', 'dQw4w9WgXcQ', 'u', 0)`,
      [s.seasonId, s.categoryIds[0]],
    );
    await h.login('444444444444444444');
    h.render('/submit');
    const u = user();
    await u.type(await screen.findByLabelText('Video link'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await u.type(screen.getByLabelText('Title'), 'Copy');
    await u.selectOptions(screen.getByLabelText('Award category'), 'Best Solo PvP');
    await u.click(screen.getByRole('button', { name: 'Submit video' }));
    expect(await findText('This video has already been submitted this season.')).toBeInTheDocument();
  });

  it('shows closed and upcoming submission states', async () => {
    const h = harness();
    await makeSeason(h.env, { sub: [T0 - 2 * DAY, T0 - DAY], vote: [T0 - DAY, T0 + DAY] });
    h.render('/submit');
    expect(await findText('Submissions are closed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'browse the entries and vote' })).toBeInTheDocument();

    const h2 = harness();
    await makeSeason(h2.env, { sub: [T0 + DAY, T0 + 2 * DAY], vote: [T0 + 2 * DAY, T0 + 3 * DAY] });
    h2.render('/submit');
    expect(await findText("Submissions haven't opened yet")).toBeInTheDocument();
  });

  it('tells banned players they cannot submit, and lists rejection reasons', async () => {
    const h = harness();
    const s = await makeSeason(h.env);
    const vid = await makeVideo(h.env, s.seasonId, s.categoryIds[0], '444444444444444444', 'rejected');
    await h.env.db.run("UPDATE videos SET moderation_reason = 'Not DAoC footage' WHERE id = ?", [vid]);
    await h.login('444444444444444444');
    await h.env.db.run("UPDATE users SET is_banned = 1 WHERE discord_id = '444444444444444444'");
    h.render('/submit');
    expect(await findText("Your account can't submit")).toBeInTheDocument();
    expect(await findText('Reason: Not DAoC footage')).toBeInTheDocument();
  });

  it('handles no current season', async () => {
    const h = harness();
    h.render('/submit');
    expect(await findText('No season is running')).toBeInTheDocument();
  });
});

describe('Results page', () => {
  async function finished(published = true) {
    const h = harness();
    const s = await makeSeason(h.env, {
      name: 'Eden Season 3 Awards',
      sub: [T0 - 9 * DAY, T0 - 8 * DAY],
      vote: [T0 - 8 * DAY, T0 - 7 * DAY],
      resultsPublished: published,
      categories: ['Best Group PvP', 'Funniest Moment'],
    });
    const a = await makeVideo(h.env, s.seasonId, s.categoryIds[0], '700000000000000001');
    const b = await makeVideo(h.env, s.seasonId, s.categoryIds[0], '700000000000000002');
    await castVote(h.env, s.seasonId, s.categoryIds[0], a, '610000000000000001');
    await castVote(h.env, s.seasonId, s.categoryIds[0], b, '610000000000000002');
    return { h, s };
  }

  it('shows tied winners, standings, and empty categories', async () => {
    const { h } = await finished();
    h.render('/results');
    expect(await screen.findByRole('heading', { name: 'Best Group PvP' })).toBeInTheDocument();
    expect(screen.getAllByText('Winner (tie)')).toHaveLength(2);
    expect(screen.getByText('No votes were cast in this category.')).toBeInTheDocument();
    expect(screen.getAllByText('2 votes').length).toBeGreaterThan(0);
  });

  it('switches between historical seasons and explains pending results', async () => {
    const { h } = await finished();
    await makeSeason(h.env, { name: 'Eden Season 4 Awards' });
    h.render('/results');
    const select = await screen.findByLabelText('Season');
    expect(select).toHaveDisplayValue('Eden Season 3 Awards');
    await user().selectOptions(select, 'Eden Season 4 Awards (results pending)');
    expect(await findText(/Voting is still open/)).toBeInTheDocument();
  });

  it('never shows unpublished results', async () => {
    const { h, s } = await finished(false);
    h.render(`/results/${s.seasonId}`);
    expect(await findText(/results aren't out yet/)).toBeInTheDocument();
    expect(screen.getByText(/Voting has closed/)).toBeInTheDocument();
    expect(h.calls.some((c) => c.path.startsWith('/api/results'))).toBe(false);
  });

  it('handles having no seasons', async () => {
    const h = harness();
    h.render('/results');
    expect(await findText('No seasons yet')).toBeInTheDocument();
  });
});

describe('Entry page', () => {
  it('shows an approved entry with a vote button and its source link', async () => {
    const h = harness();
    const s = await makeSeason(h.env);
    const vid = await makeVideo(h.env, s.seasonId, s.categoryIds[0], '700000000000000001');
    await h.login('444444444444444444');
    h.render(`/videos/${vid}`);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/^Video vid/);
    expect(screen.getByRole('link', { name: 'Open on YouTube' })).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    await user().click(await screen.findByRole('button', { name: /^Vote for/ }));
    expect(await findText('Your vote')).toBeInTheDocument();
  });

  it('shows the author their pending entry and hides it from others', async () => {
    const h = harness();
    const s = await makeSeason(h.env);
    const vid = await makeVideo(h.env, s.seasonId, s.categoryIds[0], '444444444444444444', 'pending');
    h.render(`/videos/${vid}`);
    expect(await findText('Video not found')).toBeInTheDocument();
  });

  it('lets the author see their pending entry with a notice', async () => {
    const h = harness();
    const s = await makeSeason(h.env);
    const vid = await makeVideo(h.env, s.seasonId, s.categoryIds[0], '444444444444444444', 'pending');
    await h.login('444444444444444444');
    h.render(`/videos/${vid}`);
    expect(await findText(/Only you and the moderators can see this entry/)).toBeInTheDocument();
  });

  it('loads the player only when asked (no autoplay)', async () => {
    const h = harness();
    const s = await makeSeason(h.env);
    const vid = await makeVideo(h.env, s.seasonId, s.categoryIds[0], '700000000000000001');
    h.render(`/videos/${vid}`);
    const play = await screen.findByRole('button', { name: /^Play/ });
    expect(document.querySelector('iframe')).toBeNull();
    await user().click(play);
    const frame = document.querySelector('iframe')!;
    expect(frame.src).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/vid\d+\?/);
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
  });
});

describe('Layout and login', () => {
  it('shows the user menu, admin link for admins, and logs out', async () => {
    const h = harness({ ADMIN_DISCORD_IDS: '900000000000000001' });
    await makeSeason(h.env);
    await h.login('900000000000000001', 'Boss');
    h.render('/');
    expect(await screen.findAllByText('Boss')).not.toHaveLength(0);
    expect(screen.getAllByRole('link', { name: 'Admin' }).length).toBeGreaterThan(0);
    await user().click(screen.getAllByRole('button', { name: 'Log out' })[0]);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument());
    expect(h.jar.has('eden_session')).toBe(false);
  });

  it('opens the mobile menu', async () => {
    const h = harness();
    await makeSeason(h.env);
    h.render('/');
    const btn = await screen.findByRole('button', { name: 'Menu' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    await user().click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('mobile-nav')).toBeInTheDocument();
  });

  it('uses the Discord button when Discord is configured', async () => {
    const h = harness({ DISCORD_CLIENT_ID: 'c', DISCORD_CLIENT_SECRET: 's', DEV_LOGIN: 'false' });
    await makeSeason(h.env);
    h.render('/login?returnTo=/vote');
    const link = await within(screen.getByRole('main')).findByRole('link', { name: 'Log in with Discord' });
    expect(link).toHaveAttribute('href', '/api/auth/discord?returnTo=%2Fvote');
    expect(screen.queryByRole('form', { name: 'Development login' })).not.toBeInTheDocument();
  });

  it('signs in on the login page and shows dev-login errors', async () => {
    const h = harness();
    h.render('/login?returnTo=/results');
    const u = user();
    const id = await screen.findByLabelText('Discord ID');
    await u.clear(id);
    await u.type(id, 'abc');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await findText('discordId must be a numeric Discord ID.')).toBeInTheDocument();
    await u.clear(id);
    await u.type(id, '123456789');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await findText('No seasons yet')).toBeInTheDocument();
  });

  it('says when login is not configured at all, and shows a 404 page', async () => {
    const h = harness({ DEV_LOGIN: 'false' });
    h.render('/login');
    expect(await findText('Login is not configured')).toBeInTheDocument();
    const h2 = harness();
    h2.render('/nowhere');
    expect(await findText('Page not found')).toBeInTheDocument();
  });

  it('shows the logged-in state on the login page', async () => {
    const h = harness();
    await h.login('123456789', 'Someone');
    h.render('/login');
    expect(await findText("You're logged in as Someone")).toBeInTheDocument();
  });
});
