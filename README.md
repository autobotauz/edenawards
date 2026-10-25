# Eden Awards

Seasonal community video awards for the **Eden** Dark Age of Camelot server.
Players log in with Discord, submit YouTube/Twitch clips into award categories, vote once per
category, and organizers reveal the winners live in a full-screen ceremony presentation.

Production domain: `https://eden-awards.com`

---

## Quick start (local)

Requirements: **Node.js 22.13 or newer** (uses the built-in `node:sqlite`; no database server needed).

```bash
npm install
npm run setup     # creates .env and a sample database
npm run dev       # API on :8787 + web on :5173
```

On Windows you can instead double-click **`start-local.bat`**: it installs, seeds, builds and serves the app at **http://localhost:8787** (no hot reload).

Open **http://localhost:5173**. Discord isn't configured yet, so the site shows a **Development
login**: pick a sample player, or **Eden Admin** for the admin area (`/admin`).

The sample data contains:

| Season | State |
|---|---|
| Eden Season 3 Awards | Finished, results published (includes a tie for first) |
| Eden Season 4 Awards | **Live**: submissions *and* voting open, so every flow works immediately |
| Eden Season 5 Awards | Unpublished draft |

Sample videos use placeholder IDs, so their players show "video unavailable". Submit a real
YouTube or Twitch link to see a working embed.

Useful commands:

| Command | What it does |
|---|---|
| `npm run dev` | Run API + web with hot reload |
| `npm test` | All unit and integration tests with coverage (fails under 80%) |
| `npm run test:e2e` | Browser end-to-end smoke test of a full season (needs Playwright, see below) |
| `npm run typecheck` | TypeScript checks for client and server |
| `npm run build` | Production build into `dist/` |
| `npm start` | Run the production build (serves site + API on one port) |
| `npm run db:reset` | Wipe the local database and reseed sample data |
| `npm run db:backup` | Consistent snapshot of the database into `backups/` |
| `npm run cf:dev` | Run the Cloudflare Workers build locally with a local D1 database |

End-to-end test setup (one-off): `npm i -D playwright && npx playwright install chromium`.

---

## Architecture

```
Browser (React SPA)  ──fetch /api──▶  Hono API  ──SQL──▶  SQLite
                                         │                ├─ node:sqlite file (Node / Bluehost)
                                         │                └─ Cloudflare D1   (Workers)
                                         └─▶ Discord OAuth2 / YouTube Data API / Twitch Helix
```

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS 4, React Router. Fonts are self-hosted, with no third-party scripts.
- **Backend:** one [Hono](https://hono.dev) app (`server/app.ts`) with injected dependencies. The same code runs on:
  - **Node.js** (`server/node.ts`) for local development and Node hosting such as Bluehost VPS behind Cloudflare. It serves the built site and the API from one origin.
  - **Cloudflare Workers** (`server/worker.ts`) with D1 and Workers Static Assets.
- **Database:** SQLite everywhere. A single migration set (`migrations/`) is applied by Wrangler on D1, and by the built-in runner on Node, which uses the same `d1_migrations` tracking table.
- **Single origin:** the site and the API share a domain, so there's no CORS and cookies are first-party.

Key decisions are recorded in [PROGRESS.md](PROGRESS.md#architectural-decisions). Voting, moderation and publication rules are in [docs/POLICIES.md](docs/POLICIES.md).

### Repository layout

```
server/            API (Hono)
  app.ts           app factory, middleware, error handling
  routes/          auth, public, participate (submit/vote), admin
  lib/             sessions/CSRF, validation, rate limiting, results, mappers
  providers/       Discord OAuth, YouTube/Twitch verification
  db.ts            D1 + node:sqlite adapters (one interface)
  sqlite.ts        Node SQLite setup + migration runner
  node.ts          Node entry (local + Node hosting)
  worker.ts        Cloudflare Workers entry
  seed.ts          sample data
shared/            code used by both server and browser (URL parsing, season phases, ranking)
src/               React app
  pages/           Home, Submit, Browse & vote, Results, entry page, admin, presentation
  components/      layout, countdowns, video player, login
migrations/        versioned SQL migrations (D1 + Node)
tests/server/      API + database integration tests (real SQLite)
tests/web/         UI tests that run the real API in-process
e2e/               browser smoke test of a full season
docs/              deployment guide and policies
```

---

## Features

**Players**
- Log in with Discord (only the `identify` scope is requested).
- Submit a video in three steps: paste the link, add a title and category, submit. The link is recognised live as you type.
- Supported links: YouTube (watch, youtu.be, Shorts, embed) and Twitch (VODs, clips). Channels and livestreams are rejected.
- See your own submissions and their review status, including the reason when one is rejected.
- Browse entries by category without logging in. Players load only when clicked, so nothing autoplays.
- Vote once per category and change it until voting closes. A progress bar tracks your categories, your current vote is marked, and you can't vote for your own entry.
- Countdowns for submissions and voting run on the server's clock and show times in your local time zone.
- Results show tied winners, final standings and every past season.

**Organizers** (`/admin`, allow-listed Discord IDs)
- Overview: what to do next for each season, the moderation queue, participation numbers and system status.
- Seasons: create (optionally copying another season's categories), schedule, publish, then publish results.
- Categories: add, rename, reorder, enable/disable and delete, all with integrity guards.
- Moderation: approve, reject or hide entries with a reason, filter and search, see vote counts.
- Players: search, ban or unban (alt-account control).
- Activity log of every admin change.
- Private standings at any time, for review and rehearsal.

**Ceremony presentation** (`/present/:seasonId`)
- Presenter console with a live preview, Next/Previous, Replay step, Skip to next award, a jump list, and Play winning video on screen.
- Audience screen (`/present/:id/screen`) opens in its own window for Discord screen sharing, with no controls. It stays in sync with the console through `BroadcastChannel`, and F toggles full screen.
- Reveal sequence per award: title, then nominees (listed alphabetically so the order gives nothing away), then third, second and first place, then the winning video. Ties are revealed together.
- Rehearsal mode works before results are public. The audience screen is admin-only.

---

## Configuration

All settings are environment variables. Copy `.env.example` to `.env` for Node, or `.dev.vars.example` to `.dev.vars` for Wrangler. Never commit either file.

| Variable | Required | Purpose |
|---|---|---|
| `APP_ORIGIN` | yes | Public origin, e.g. `https://eden-awards.com`. Used for CSRF origin checks, cookie security and the OAuth callback. |
| `ADMIN_DISCORD_IDS` | yes | Comma-separated Discord user IDs with admin access |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | for login | Discord OAuth2 application |
| `DISCORD_REDIRECT_URI` | no | Defaults to `${APP_ORIGIN}/api/auth/callback` |
| `DEV_LOGIN` | no | `true` enables the development login. **Never enable in production.** |
| `YOUTUBE_API_KEY` | no | Automatic YouTube verification |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | no | Automatic Twitch verification |
| `ALLOWED_ORIGINS` | no | Extra origins allowed to make writes (preview domains) |
| `TRUST_PROXY` | no | Trust `CF-Connecting-IP`/`X-Forwarded-For` for rate limiting. Always on for Workers. |
| `DATABASE_PATH`, `PORT`, `HOST` | no | Node only. Defaults: `data/eden-awards.sqlite`, `8787`, `127.0.0.1` |
| `SESSION_TTL_DAYS` | no | Login session length (default 14) |
| `RELEVANCE_KEYWORDS` | no | Keywords for auto-approval (default: daoc, dark age of camelot, eden, …) |

Without YouTube/Twitch keys, every new submission waits for a moderator. That's the safe default.

## Deployment

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for:
- Bluehost (Node.js) behind Cloudflare
- Cloudflare Workers + D1 (with a GitHub Actions workflow)
- Discord application setup
- DNS, secrets, backups and migrations
