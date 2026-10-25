-- Eden Awards initial schema.
-- All timestamps are INTEGER milliseconds since the Unix epoch (UTC).
-- This file is the single source of truth for both Cloudflare D1 and local SQLite.
-- Foreign keys are always enforced by D1; the Node adapter enables them explicitly.


CREATE TABLE users (
  discord_id   TEXT PRIMARY KEY,
  username     TEXT NOT NULL,
  global_name  TEXT,
  avatar       TEXT,
  is_banned    INTEGER NOT NULL DEFAULT 0 CHECK (is_banned IN (0, 1)),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE seasons (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT NOT NULL UNIQUE,
  description           TEXT NOT NULL DEFAULT '',
  submission_starts_at  INTEGER NOT NULL,
  submission_ends_at    INTEGER NOT NULL,
  voting_starts_at      INTEGER NOT NULL,
  voting_ends_at        INTEGER NOT NULL,
  results_publish_at    INTEGER NOT NULL,
  is_published          INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1)),
  results_published     INTEGER NOT NULL DEFAULT 0 CHECK (results_published IN (0, 1)),
  allow_self_vote       INTEGER NOT NULL DEFAULT 0 CHECK (allow_self_vote IN (0, 1)),
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  CHECK (submission_starts_at < submission_ends_at),
  CHECK (voting_starts_at < voting_ends_at),
  CHECK (submission_starts_at <= voting_starts_at),
  CHECK (results_publish_at >= voting_ends_at)
);

CREATE TABLE categories (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id      INTEGER NOT NULL REFERENCES seasons(id),
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  enabled        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  display_order  INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  UNIQUE (season_id, name),
  UNIQUE (id, season_id)
);
CREATE INDEX idx_categories_season ON categories(season_id, display_order);

CREATE TABLE videos (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id          INTEGER NOT NULL,
  category_id        INTEGER NOT NULL,
  author_discord_id  TEXT NOT NULL REFERENCES users(discord_id),
  title              TEXT NOT NULL,
  platform           TEXT NOT NULL CHECK (platform IN ('youtube', 'twitch-video', 'twitch-clip')),
  platform_video_id  TEXT NOT NULL,
  canonical_url      TEXT NOT NULL,
  thumbnail_url      TEXT,
  moderation_status  TEXT NOT NULL DEFAULT 'pending'
                     CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'hidden')),
  moderation_reason  TEXT,
  moderated_by       TEXT,
  moderated_at       INTEGER,
  created_at         INTEGER NOT NULL,
  -- The category must belong to the same season as the video.
  FOREIGN KEY (category_id, season_id) REFERENCES categories(id, season_id),
  -- The same platform video can only be entered once per season.
  UNIQUE (season_id, platform, platform_video_id),
  UNIQUE (id, category_id, season_id)
);
CREATE INDEX idx_videos_season_category ON videos(season_id, category_id, moderation_status);
CREATE INDEX idx_videos_author ON videos(author_discord_id);
CREATE INDEX idx_videos_status ON videos(moderation_status);

CREATE TABLE votes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id         INTEGER NOT NULL,
  category_id       INTEGER NOT NULL,
  video_id          INTEGER NOT NULL,
  voter_discord_id  TEXT NOT NULL REFERENCES users(discord_id),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  -- The voted video must belong to the voted category and season.
  FOREIGN KEY (video_id, category_id, season_id) REFERENCES videos(id, category_id, season_id),
  -- CRITICAL: one vote per user per category per season.
  UNIQUE (season_id, category_id, voter_discord_id)
);
CREATE INDEX idx_votes_video ON votes(video_id);
CREATE INDEX idx_votes_voter ON votes(voter_discord_id, season_id);

CREATE TABLE sessions (
  id_hash     TEXT PRIMARY KEY,
  discord_id  TEXT NOT NULL REFERENCES users(discord_id),
  csrf_token  TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(discord_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE rate_limits (
  key           TEXT PRIMARY KEY,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    TEXT NOT NULL,
  action      TEXT NOT NULL,
  target      TEXT,
  details     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at);
