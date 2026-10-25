# Deployment guide

Eden Awards can run in two ways from the same code. Pick one.

| | **A. Node.js (Bluehost) behind Cloudflare** | **B. Cloudflare Workers + D1** |
|---|---|---|
| Runtime | Node ≥ 22.13 process | Cloudflare Workers |
| Database | SQLite file on the server | Cloudflare D1 |
| Cost | Your hosting plan | Free tier is enough for a community event |
| Backups | `npm run db:backup` / file copy | D1 Time Travel + `wrangler d1 export` |

> **Before touching production:** check whether `eden-awards.com` already serves a site, and
> note its current DNS records. Don't change production DNS or overwrite an existing site until
> you've tested on a preview host first.

---

## 1. Discord application (both options)

1. Go to <https://discord.com/developers/applications>, click **New Application**, and name it "Eden Awards".
2. Under **OAuth2**:
   - copy the **Client ID** and reset/copy the **Client Secret**;
   - add redirects for every host you'll use:
     - `https://eden-awards.com/api/auth/callback`
     - your preview host, e.g. `https://preview.eden-awards.com/api/auth/callback`
     - optionally `http://localhost:5173/api/auth/callback` for local testing with real Discord
3. No bot is needed. The app requests only the `identify` scope.
4. Find your own Discord user ID: Discord → Settings → Advanced → enable **Developer Mode**, then right-click your name → **Copy User ID**. Put it, and your co-organizers' IDs, in `ADMIN_DISCORD_IDS`.

To test real Discord login locally, put the ID and secret in `.env`, set `DEV_LOGIN=false`, and restart `npm run dev`.

## 2. Optional video verification keys

- **YouTube:** Google Cloud Console → enable **YouTube Data API v3** → create an API key. Restrict it to that API.
- **Twitch:** <https://dev.twitch.tv/console/apps> → register an app (category: Website Integration) → Client ID and Secret.

Without these, every submission waits for a moderator.

---

## Option A: Bluehost (Node.js) behind Cloudflare

### Requirements
- A Bluehost plan that can run a long-lived **Node.js ≥ 22.13** process:
  - VPS or Dedicated (root/SSH access) is recommended;
  - shared plans that offer cPanel **"Setup Node.js App"** can work if they provide Node 22.13+.
- Plain shared hosting that only runs PHP **can't** run this app. Use Option B instead, or ask for a PHP port.

### Build
On your machine or in CI (the `CI` workflow uploads a `node-bundle` artifact):

```bash
npm ci
npm run build                       # → dist/client (site) + dist/server/node.js (server)
```

### Install on the server
Copy `dist/`, `migrations/`, `package.json` and `package-lock.json` to the server (e.g. `/home/<user>/eden-awards`), then:

```bash
npm ci --omit=dev                   # runtime deps only (hono, @hono/node-server)
cat > .env <<'ENV'
APP_ORIGIN=https://eden-awards.com
ADMIN_DISCORD_IDS=<your id>,<co-organizer id>
DISCORD_CLIENT_ID=<client id>
DISCORD_CLIENT_SECRET=<client secret>
YOUTUBE_API_KEY=
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
DEV_LOGIN=false
DATABASE_PATH=/home/<user>/eden-awards-data/eden-awards.sqlite
PORT=8787
HOST=127.0.0.1
TRUST_PROXY=true
ENV
chmod 600 .env
NODE_ENV=production npm start       # applies migrations automatically on start
```

- Keep `DATABASE_PATH` **outside** the web root.
- Only set `TRUST_PROXY=true` if the origin can be reached **only** through Cloudflare or your reverse proxy. Otherwise clients could fake their IP for rate limiting.

**Keep it running:**
- **VPS:** use `pm2 start dist/server/node.js --name eden-awards --node-args="--disable-warning=ExperimentalWarning"`, then `pm2 save` and `pm2 startup`.
- Put **nginx/Apache** in front, proxying `https://eden-awards.com` → `http://127.0.0.1:8787`, and pass the `Host` and `X-Forwarded-For` headers.
- **cPanel Node.js App:** set the application root to the uploaded folder and the startup file to `dist/server/node.js`. Add the variables above in the UI, without `PORT` (cPanel provides it).

### Cloudflare in front of Bluehost
1. Add `eden-awards.com` to Cloudflare. At your registrar (Bluehost if the domain is registered there), switch the nameservers to Cloudflare's.
2. DNS: point `A @` (and `CNAME www` → `eden-awards.com`) at the Bluehost server IP, **proxied** (orange cloud).
3. SSL/TLS mode: **Full (strict)**. Install a Cloudflare Origin Certificate, or Bluehost's free SSL, on the origin.
4. Turn on **Always Use HTTPS**.
5. Optionally add a Cache Rule to bypass the cache for `/api/*`. The API already sends `Cache-Control: no-cache`/`no-store`, and hashed `/assets/*` are immutable.
6. Optionally, a firewall rule on the origin that accepts only [Cloudflare IP ranges](https://www.cloudflare.com/ips/), so `TRUST_PROXY=true` is safe.

### Backups and migrations (Node)
- **Backup:** `npm run db:backup` writes a consistent snapshot to `backups/` while the server runs. Schedule it daily with cron and copy the files off the server.
- **Restore:** stop the app, replace the database file with a backup, and start the app.
- **Migrations:** new files in `migrations/` are applied automatically on startup, each in a transaction. Take a backup first.

---

## Option B: Cloudflare Workers + D1

### One-time setup
```bash
npx wrangler login
npx wrangler d1 create eden-awards            # copy database_id into wrangler.jsonc (top level)
npx wrangler d1 create eden-awards-preview    # copy database_id into wrangler.jsonc (env.preview)
```
Edit `wrangler.jsonc`:
- replace both placeholder `database_id`s;
- set `ADMIN_DISCORD_IDS` and `DISCORD_CLIENT_ID` in `vars`, and the preview `APP_ORIGIN`.

Secrets (never in the file):
```bash
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put YOUTUBE_API_KEY          # optional
npx wrangler secret put TWITCH_CLIENT_ID         # optional
npx wrangler secret put TWITCH_CLIENT_SECRET     # optional
# and the same with --env preview
```

### Deploy the preview first
```bash
npm run cf:migrate:preview
npm run cf:deploy:preview
```
Open the `*.workers.dev` URL, log in with Discord, submit, approve and vote.

### Production
```bash
npm run cf:migrate:prod
npm run cf:deploy
```
Then attach the domain in the Cloudflare dashboard: **Workers & Pages → eden-awards → Settings → Domains & Routes → Add Custom Domain → `eden-awards.com`**. Cloudflare creates the DNS record and certificate. This replaces whatever `eden-awards.com` currently points to, so do it only once the preview is verified.

### GitHub Actions
- `.github/workflows/ci.yml` runs on every push and PR: typecheck, tests with an 80% coverage gate, build, and the browser E2E test. It uploads the Node bundle as an artifact.
- `.github/workflows/deploy-cloudflare.yml` is triggered manually (Actions → **Deploy to Cloudflare** → choose `preview` or `production`). It runs the tests, applies D1 migrations and deploys. It needs these repository secrets:
  - `CLOUDFLARE_API_TOKEN`: a custom token with **Account › Workers Scripts: Edit**, **Account › D1: Edit**, **Account › Account Settings: Read**, and **Zone › Workers Routes: Edit** (only for the custom domain);
  - `CLOUDFLARE_ACCOUNT_ID`.
- Create GitHub **Environments** named `preview` and `production`. Add a required reviewer on `production` for a manual approval gate.

### Backups (D1)
- D1 **Time Travel** can restore to any minute in the last 30 days: `npx wrangler d1 time-travel restore eden-awards --timestamp=<ISO time>`.
- Take a manual export before each ceremony: `npx wrangler d1 export eden-awards --remote --output=eden-awards-backup.sql`.

### Local Workers run
```bash
cp .dev.vars.example .dev.vars
npm run cf:migrate:local
npm run db:seed-sql && npx wrangler d1 execute eden-awards --local --file seed/seed.sql
npm run cf:dev                      # http://localhost:8788
```

---

## Ceremony-day checklist
1. Voting has closed. Check **Admin → Seasons → (season) → Standings (private)**.
2. Take a backup (`npm run db:backup` or `wrangler d1 export`).
3. Open **Open presentation**, then **Open audience screen**. Screen-share the audience window on Discord and press **F** for full screen.
4. Rehearse once with the presenter console. Nothing is public yet.
5. When the show ends, **Publish results**. They go live at the configured publish time, or immediately if that time has passed.

## Security checklist for production
- [ ] `DEV_LOGIN=false` (the admin overview shows a warning if it's on)
- [ ] `APP_ORIGIN` is the exact https origin
- [ ] Discord secret, API keys and the Cloudflare token are stored only as secrets / in `.env` with `chmod 600`
- [ ] Database file outside the web root (Node)
- [ ] Cloudflare SSL **Full (strict)** and Always Use HTTPS
- [ ] `TRUST_PROXY=true` only when the origin is locked to Cloudflare/your proxy
