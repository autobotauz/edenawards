/**
 * End-to-end smoke test of a whole awards season in a real browser:
 * player submits → admin approves → another player votes → admin closes voting,
 * publishes results → presenter console works → the public results page shows the winner.
 *
 * Requires a production build (`npm run build`) and Playwright:
 *   npm i -D playwright && npx playwright install chromium
 *   npm run test:e2e
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const PORT = 8799;
const BASE = `http://localhost:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'eden-e2e-'));
const env = {
  ...process.env,
  DATABASE_PATH: join(dir, 'e2e.sqlite'),
  PORT: String(PORT),
  APP_ORIGIN: BASE,
  ADMIN_DISCORD_IDS: '100000000000000001',
  DEV_LOGIN: 'true',
  DISCORD_CLIENT_ID: '',
  YOUTUBE_API_KEY: '',
};

const run = (cmd, args) =>
  new Promise((res, rej) => {
    const p = spawn(cmd, args, { env, stdio: 'inherit', shell: process.platform === 'win32' });
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });

await run('npx', ['tsx', 'server/scripts/seed.ts', '--reset']);
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'dist/server/node.js'], { env, stdio: 'pipe' });
await new Promise((res) => server.stdout.on('data', (d) => String(d).includes('listening') && res()));

const step = (msg) => console.log(`  ✓ ${msg}`);
const browser = await chromium.launch();
let failed = false;
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const login = async (who) => {
    await page.goto(`${BASE}/login?returnTo=/`);
    await page.getByRole('button', { name: who }).click();
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(`${BASE}/`);
  };
  const logout = async () => {
    await page.getByRole('button', { name: 'Log out' }).first().click();
    await page.getByRole('link', { name: 'Log in' }).first().waitFor();
  };

  // 1. A player submits a video.
  await login('Midgard Skald');
  await page.goto(`${BASE}/submit`);
  await page.getByLabel('Video link').fill('https://www.twitch.tv/videos/987654321');
  await page.getByLabel('Title').fill('E2E keep defense');
  await page.getByLabel('Award category').selectOption({ label: 'Best Gameplay Highlight' });
  await page.getByRole('button', { name: 'Submit video' }).click();
  await page.getByText('Your video is entered').waitFor();
  step('player submitted a video (pending review)');
  await logout();

  // 2. The admin approves it.
  await login('Eden Admin');
  await page.goto(`${BASE}/admin/moderation`);
  const item = page.getByRole('listitem').filter({ hasText: 'E2E keep defense' });
  await item.getByRole('button', { name: 'Approve' }).click();
  await page.getByText('Approved “E2E keep defense”.').waitFor();
  step('admin approved it');
  await logout();

  // 3. Another player votes for it, and the vote survives a reload.
  await login('Albion Knight');
  await page.goto(`${BASE}/vote`);
  await page.getByRole('button', { name: 'Best Gameplay Highlight' }).click();
  await page.getByRole('button', { name: 'Vote for E2E keep defense' }).click();
  await page.getByText('Your vote').first().waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Best Gameplay Highlight' }).click();
  await page.getByText('Your vote').first().waitFor();
  step('another player voted, and the vote persists after reload');
  await logout();

  // 4. The admin closes voting a few seconds from now and publishes results.
  await login('Eden Admin');
  const soon = new Date(Date.now() + 5_000).toISOString();
  const status = await page.evaluate(async (t) => {
    const me = await (await fetch('/api/auth/me')).json();
    const res = await fetch('/api/admin/seasons/2', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.user.csrfToken },
      body: JSON.stringify({ submissionEndsAt: t, votingEndsAt: t, resultsPublishAt: t }),
    });
    return res.status;
  }, soon);
  if (status !== 200) throw new Error(`closing voting failed: ${status}`);
  await page.waitForTimeout(5_500);
  await page.goto(`${BASE}/admin/seasons/2`);
  await page.getByRole('button', { name: 'Publish results' }).click();
  await page.getByRole('group', { name: 'Confirm action' }).getByRole('button', { name: 'Publish results' }).click();
  await page.getByText('Public now.').waitFor();
  step('admin closed voting and published results');

  // 5. The presenter console loads and advances.
  await page.goto(`${BASE}/present/2`);
  await page.getByRole('button', { name: /^Next:/ }).click();
  await page.getByText(/Step 2 of/).waitFor();
  step('presentation console works');
  await logout();

  // 6. The public sees the winner.
  await page.goto(`${BASE}/results/2`);
  const section = page.getByRole('region', { name: 'Best Gameplay Highlight' });
  await section.getByText('E2E keep defense').first().waitFor();
  await section.getByText('Winner').first().waitFor();
  step('public results show the winner');

  // 7. Voting is closed for everyone.
  await login('Thane of Hibernia');
  await page.goto(`${BASE}/vote`);
  await page.getByText('Voting is closed').waitFor();
  step('voting is closed for everyone');
} catch (err) {
  failed = true;
  console.error('E2E FAILED:', err);
} finally {
  await browser.close();
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? 'E2E smoke test failed.' : 'E2E smoke test passed.');
process.exit(failed ? 1 : 0);
