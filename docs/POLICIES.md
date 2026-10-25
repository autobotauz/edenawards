# Competition rules and policies

These rules are enforced by the server and the database, not just the UI.

## Identity
- A player is their **Discord user ID**. Usernames can change and are never used for authorization.
- Only the Discord `identify` scope is requested. We store the ID, username, display name and avatar hash. OAuth tokens are discarded immediately after login.
- **Known limitation:** Discord login stops casual anonymous voting, but it can't stop one person from using several Discord accounts. The mitigations are:
  - per-account rate limits;
  - an admin **ban**, which blocks submitting and voting, signs the account out, and excludes its votes from the results;
  - the Players page, which shows each account's join date and activity so new alt accounts are easier to spot.
  - A future option is to require membership of the Eden Discord server (needs the `guilds` scope).

## Seasons and deadlines
- Each season has five UTC timestamps: submissions open/close, voting open/close, results publish.
- Windows are **half-open**: open at exactly the start time, closed at exactly the end time.
- Every write checks the deadline against the **server clock** at request time. No scheduled job is involved, and the browser's countdown is only a display.
- Required order: submissions close after they open; voting opens no earlier than submissions open; voting closes after it opens; results publish no earlier than voting closes. Voting may overlap the submission window.
- **Locked history:** a timestamp that has already passed can't be changed, and a future timestamp can't be moved into the past (there is a one-minute grace period, so "close it now" works). Closed windows therefore can't be quietly reopened.
- The self-vote setting is locked once voting opens.
- A published season can only be unpublished before its submissions open.

## Submissions
- Logged-in, non-banned players, while submissions are open.
- Title: 3–100 characters, with no control or direction-override characters.
- The link must be an https YouTube (watch, youtu.be, Shorts, embed) or Twitch (VOD, clip) URL on an exact allow-listed host. No credentials, ports, channels or livestreams.
- The same platform video can be entered only once per season (database `UNIQUE` constraint), whatever URL form is used.
- The author is always the logged-in account.
- Verification:
  - With API keys, videos that exist and mention DAoC/Eden are **auto-approved**.
  - Missing, private or non-embeddable videos are **rejected** immediately.
  - Everything else goes to the **moderation queue**, including all submissions when no API keys are configured.
  - A missing keyword is never a reason to reject.

## Voting
- **One vote per player, per category, per season**, enforced by `UNIQUE(season_id, category_id, voter_discord_id)`.
- Changing your vote replaces it (a single atomic `INSERT … ON CONFLICT DO UPDATE`). Concurrent requests can't create a second vote.
- The vote's video must belong to that category and season. A composite foreign key enforces this in the database itself.
- Only **approved** videos in enabled categories of published seasons are eligible.
- Voting for your own entry is **not allowed** by default; it's a per-season setting.
- Once voting closes, votes are final.
- Live vote totals are **never shown publicly** during voting. Admins can see private standings.

## Moderation and disqualification
- Statuses: `pending` → `approved` / `rejected` / `hidden`. Moderators can change their decision while results are not yet public.
- **Disqualification policy:** if an approved entry with votes is later rejected or hidden:
  - its votes are kept in the database but **don't count**;
  - affected voters see a notice on the voting page and can vote again in that category while voting is open (the new vote replaces the old one);
  - if the entry is re-approved, its remaining votes count again.
- Once results are public, moderation is frozen. Unpublish the results first if a correction is needed. Every moderation action is recorded in the activity log.

## Categories
- Renaming is always allowed: entries and votes are attached by ID.
- Categories can be enabled or disabled only **before voting opens**. A disabled category is hidden from submission, voting and results.
- New categories can be added until submissions close.
- A category can be deleted only while it has no submissions.

## Results
- Only approved entries in enabled categories are ranked. Votes from banned accounts are excluded.
- **Competition ranking:** equal votes share a rank, and the next rank skips (1, 1, 3). Ties are never broken artificially, so tied first places are all winners. An entry with zero votes never wins.
- Results become public only when **all** of these hold:
  - an admin has published them;
  - the results-publish time has passed;
  - voting has closed.
- Admins can preview the private standings and rehearse the presentation at any time. The public results endpoint still refuses until publication.
- Results remain available permanently. Seasons are never deleted.
