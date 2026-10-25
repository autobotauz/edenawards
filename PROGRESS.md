# Eden Awards: progress

_Last updated: 2026-10-25_

## Status
**Feature-complete and verified locally.** The app runs end to end on Node + SQLite (`npm run dev` / `npm start`) and on Cloudflare Workers + local D1 (`npm run cf:dev`). Production deployment is waiting on external credentials (see Remaining).

## Completed features
- [x] Project: React + TypeScript + Vite + Tailwind 4 frontend; Hono API; one codebase for Node and Workers
- [x] Database: SQLite schema with constraints, versioned migrations, sample seed, backup script
- [x] Discord OAuth2 authorization-code flow:
  - state cookie (CSRF), session fixation protection, hashed session IDs
  - logout, expiry, open-redirect protection
- [x] Development login (behind `DEV_LOGIN`, warns in admin if enabled)
- [x] Seasons with derived phases (upcoming, submissions, intermission, voting, tallying, completed) and two server-authoritative countdowns
- [x] Configurable categories (create, rename, reorder, enable/disable, delete-when-empty, copy from a previous season)
- [x] Video submission: live URL recognition; YouTube/Twitch normalization; duplicate, deadline and category checks; optional YouTube/Twitch API verification; moderation queue
- [x] Browse & vote: category rail, click-to-load embeds, progress tracking, one vote per category, vote changes, self-vote policy, disqualification notice
- [x] Results: competition ranking, tied winners, publication gate, historical seasons
- [x] Admin:
  - overview with a next step for each season
  - season editor with locked history
  - publishing controls with two-step confirmations
  - moderation with reasons and filters
  - player bans
  - activity log
  - private standings
- [x] Ceremony presentation: presenter console plus synced audience screen; title → nominees → third → second → first → winning video; ties revealed together; replay/skip/jump; rehearsal mode
- [x] Security:
  - CSRF (origin check plus per-session token) and HttpOnly/SameSite/Secure cookies
  - CSP and security headers
  - rate limiting (login, submit, vote)
  - strict input validation
  - no secrets in the bundle
- [x] Tests: 195 automated tests (unit, API integration on real SQLite, UI integration with the real API in-process), plus a browser E2E test of a full season
- [x] CI (GitHub Actions) with an 80% coverage gate, an optional Cloudflare deploy workflow, and deployment documentation for Bluehost/Node and Cloudflare

## Current work
None. Ready for credentials and a preview deployment.

## Remaining (needs external access)
1. Create the Discord application and set `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` and the admin IDs. Then test a real Discord login on a preview host.
2. Choose hosting:
   - **Bluehost:** confirm the plan runs Node ≥ 22.13, then follow docs/DEPLOYMENT.md, Option A.
   - **Cloudflare Workers:** create the D1 databases and put their IDs in `wrangler.jsonc`.
3. Optionally add YouTube/Twitch API keys for auto-approval.
4. Check what `eden-awards.com` currently serves before changing DNS.

## Known issues / limitations
- Several Discord accounts can still vote separately (mitigated by bans and rate limits). See docs/POLICIES.md.
- `node:sqlite` is marked experimental in Node 22/24; it's stable in practice and the warning is suppressed. It needs Node ≥ 22.13.
- Presenter and audience sync uses `BroadcastChannel`, so both windows must be in the **same browser on the same computer**. That's the normal Discord screen-share setup.
- Sample seed videos use placeholder IDs, so they don't play. Real submissions do.
- Twitch embeds need the page's hostname as `parent`; this is automatic, but the site must be served over https in production.

## Architectural decisions
| Decision | Why |
|---|---|
| Hono API with injected `db`/`config`/`now`/`fetch` | Same code on Node (Bluehost) and Workers; deterministic tests with a controllable clock |
| SQLite everywhere (node:sqlite / D1) | One SQL dialect and one migration set; no database server to run; D1-native on Cloudflare |
| No native npm modules | `node:sqlite` is built in, so installs work on Windows and shared hosts without compilers |
| Integer UTC milliseconds for timestamps | Exact comparisons; displayed in the viewer's zone with the zone named |
| Deadlines checked on every write, no cron | The spec requires it, and nothing can be missed if a job fails |
| Vote = one atomic `INSERT … SELECT … ON CONFLICT DO UPDATE` | All rules re-checked inside the write; no race can create duplicates |
| Composite foreign keys (video ↔ category ↔ season) | The database itself rejects mismatched votes and entries |
| Session token in an HttpOnly cookie, SHA-256 hash in the database, CSRF token returned by `/api/auth/me` | A stolen database doesn't yield sessions; CSRF is stopped even if SameSite fails |
| Click-to-load video facade | Fast pages with dozens of entries; no autoplay; fewer third-party requests |
| Nominees shown alphabetically in the presentation | The slide order can't leak the result |
| Disqualified votes kept but not counted | No silent data loss; reversible; voters are told and can recast |
| Bans exclude votes from results | Practical response to alt accounts |

## Test coverage (latest `npm test`)
| Metric | Coverage | Gate |
|---|---|---|
| Lines | 98.1% | 80% |
| Statements | 96.8% | 80% |
| Functions | 95.1% | 80% |
| Branches | 89.7% | 80% |

Critical logic is at or near 100% lines: auth/sessions, voting, submissions, season rules, ranking, results and URL parsing.
`npm run test:e2e`: passes (submit → approve → vote → close → publish → present → public results → voting closed).

## Deployment status
- Local Node: ✅ verified (`npm run dev`, `npm start`)
- Local Workers + D1 (Wrangler): ✅ verified (login, CSRF, vote, submit, SPA fallback, headers)
- Preview / production: ⏳ not deployed (needs Discord credentials and a hosting decision)
