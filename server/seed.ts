/**
 * Sample data for local development and tests.
 *
 *  - "Eden Season 3 Awards": finished, results published (includes a tie for first).
 *  - "Eden Season 4 Awards": the live season — submissions AND voting are open, so every
 *    flow can be tried locally right away.
 *  - "Eden Season 5 Awards": an unpublished draft for the admin screens.
 *
 * Video IDs are syntactically valid placeholders, not real uploads.
 */
import type { Statement, SqlValue } from './db';

export const SEED_ADMIN_ID = '100000000000000001';

export const SEED_USERS: Array<{ id: string; username: string; globalName: string }> = [
  { id: SEED_ADMIN_ID, username: 'eden_admin', globalName: 'Eden Admin' },
  { id: '100000000000000002', username: 'thane_of_hib', globalName: 'Thane of Hibernia' },
  { id: '100000000000000003', username: 'albion_knight', globalName: 'Albion Knight' },
  { id: '100000000000000004', username: 'midgard_skald', globalName: 'Midgard Skald' },
  { id: '100000000000000005', username: 'stealthy_infil', globalName: 'Stealthy Infiltrator' },
  { id: '100000000000000006', username: 'bard_of_avalon', globalName: 'Bard of Avalon' },
  { id: '100000000000000007', username: 'zerg_herder', globalName: 'Zerg Herder' },
  { id: '100000000000000008', username: 'emain_regular', globalName: 'Emain Regular' },
];

export const CATEGORY_TEMPLATES: Array<[string, string]> = [
  ['Best Solo PvP', 'One player against the frontier. Duels, ganks and impossible escapes.'],
  ['Best Group PvP', 'Eight-man coordination at its finest.'],
  ['Best Realm vs Realm Battle', 'Keep sieges, relic raids and massive frontier clashes.'],
  ['Funniest Moment', 'Bugs, blunders and pure comedy from the realms.'],
  ['Best Comeback', 'Down to the last heal and still came out on top.'],
  ['Best Gameplay Highlight', 'Mechanics, timing and skill that made jaws drop.'],
  ['Best Community Moment', 'The people that make Eden special.'],
];

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Deterministic, valid 11-character YouTube-style placeholder ID. */
export function fakeYoutubeId(n: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let s = '';
  let x = (n + 1) * 2654435761;
  for (let i = 0; i < 11; i++) {
    s += alphabet[Math.abs(x) % 64];
    x = Math.floor(x / 64) + (i + 7) * 97 * (n + 3);
  }
  return s;
}

const VIDEO_TITLES = [
  'Shadowblade 1v3 in Emain Macha',
  'Thane vs Thane — the longest duel',
  'Keep Bolton defense, 40 vs 120',
  'When the bridge collapses on the zerg',
  'Last-second rez turns the fight',
  'Perfect stun chain on a full group',
  'Eden community bonfire night',
  'Relic raid on Midgard',
  'Ranger snipes from the walls',
  'Accidental naked raid',
  'Mincer solo run',
  'Druid comeback at Dun Crauchon',
  'The great Agramon brawl',
  'Bard speed chase of the year',
];

export function seedStatements(now: number): Statement[] {
  const out: Statement[] = [];
  const add = (sql: string, ...params: SqlValue[]) => out.push({ sql, params });

  for (const u of SEED_USERS) {
    add(
      'INSERT INTO users (discord_id, username, global_name, avatar, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)',
      u.id,
      u.username,
      u.globalName,
      now - 120 * DAY,
      now - 120 * DAY,
    );
  }

  const seasons = [
    {
      id: 1,
      name: 'Eden Season 3 Awards',
      description: 'The best moments from Season 3 on Eden, voted by the community.',
      sub: [now - 90 * DAY, now - 70 * DAY],
      vote: [now - 69 * DAY, now - 60 * DAY],
      publish: now - 59 * DAY,
      published: 1,
      results: 1,
    },
    {
      id: 2,
      name: 'Eden Season 4 Awards',
      description:
        'Submit your best clips from Season 4 and vote for your favorites in every category. Winners are revealed live at the awards ceremony on Discord.',
      sub: [now - 5 * DAY, now + 4 * DAY + 6 * HOUR],
      vote: [now - 2 * DAY, now + 9 * DAY + 3 * HOUR],
      publish: now + 10 * DAY,
      published: 1,
      results: 0,
    },
    {
      id: 3,
      name: 'Eden Season 5 Awards',
      description: 'Draft — not yet announced.',
      sub: [now + 60 * DAY, now + 80 * DAY],
      vote: [now + 81 * DAY, now + 90 * DAY],
      publish: now + 91 * DAY,
      published: 0,
      results: 0,
    },
  ];

  for (const s of seasons) {
    add(
      `INSERT INTO seasons (id, name, description, submission_starts_at, submission_ends_at, voting_starts_at,
        voting_ends_at, results_publish_at, is_published, results_published, allow_self_vote, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      s.id, s.name, s.description, s.sub[0], s.sub[1], s.vote[0], s.vote[1], s.publish, s.published, s.results,
      s.sub[0] - DAY, s.sub[0] - DAY,
    );
  }

  // Categories: season 3 gets 4, season 4 gets all 7, season 5 gets all 7.
  let catId = 0;
  const catsBySeason = new Map<number, number[]>();
  for (const [seasonId, count] of [[1, 4], [2, 7], [3, 7]] as const) {
    const ids: number[] = [];
    CATEGORY_TEMPLATES.slice(0, count).forEach(([name, desc], i) => {
      catId++;
      ids.push(catId);
      add(
        'INSERT INTO categories (id, season_id, name, description, enabled, display_order, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
        catId, seasonId, name, desc, i + 1, now - 100 * DAY,
      );
    });
    catsBySeason.set(seasonId, ids);
  }

  // Videos.
  let videoId = 0;
  let titleIdx = 0;
  const players = SEED_USERS.slice(1).map((u) => u.id);
  const videosByCat = new Map<number, number[]>();
  const addVideo = (seasonId: number, categoryId: number, author: string, status: string, createdAt: number, reason: string) => {
    videoId++;
    const yt = fakeYoutubeId(videoId);
    const title = VIDEO_TITLES[titleIdx++ % VIDEO_TITLES.length];
    add(
      `INSERT INTO videos (id, season_id, category_id, author_discord_id, title, platform, platform_video_id, canonical_url,
        thumbnail_url, moderation_status, moderation_reason, created_at)
       VALUES (?, ?, ?, ?, ?, 'youtube', ?, ?, NULL, ?, ?, ?)`,
      videoId, seasonId, categoryId, author, title, yt, `https://www.youtube.com/watch?v=${yt}`, status, reason, createdAt,
    );
    if (status === 'approved') videosByCat.set(categoryId, [...(videosByCat.get(categoryId) ?? []), videoId]);
    return videoId;
  };

  // Season 3: three approved entries per category.
  for (const cat of catsBySeason.get(1)!) {
    for (let i = 0; i < 3; i++) addVideo(1, cat, players[(cat + i) % players.length], 'approved', now - 80 * DAY + i * HOUR, 'Sample data');
  }
  // Season 4: 2–4 approved entries in the first five categories, plus a pending and a rejected one.
  const s4 = catsBySeason.get(2)!;
  s4.slice(0, 5).forEach((cat, ci) => {
    for (let i = 0; i < 2 + (ci % 3); i++) addVideo(2, cat, players[(ci + i) % players.length], 'approved', now - 4 * DAY + i * HOUR, 'Sample data');
  });
  addVideo(2, s4[0], players[4], 'pending', now - 3 * HOUR, 'YouTube verification is not configured; awaiting moderator review.');
  addVideo(2, s4[3], players[5], 'pending', now - 2 * HOUR, 'Video exists, but its title, description and tags do not mention DAoC or Eden. Needs a moderator.');
  addVideo(2, s4[1], players[6], 'rejected', now - 1 * DAY, 'Not DAoC footage.');

  // Season 3 votes. Category 1 has a deliberate tie for first place.
  let voteId = 0;
  const vote = (seasonId: number, categoryId: number, vid: number, voter: string, at: number) => {
    voteId++;
    add(
      'INSERT INTO votes (id, season_id, category_id, video_id, voter_discord_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      voteId, seasonId, categoryId, vid, voter, at, at,
    );
  };
  const voters = SEED_USERS.map((u) => u.id);
  catsBySeason.get(1)!.forEach((cat, ci) => {
    const vids = videosByCat.get(cat)!;
    // Pattern of which entry each voter picks; the first category ends 3–3–1 (a tie).
    const patterns = [
      [0, 0, 0, 1, 1, 1, 2],
      [0, 0, 0, 0, 1, 1, 2],
      [1, 1, 1, 2, 2, 0, 0],
      [2, 2, 1, 1, 1, 0, 2],
    ];
    patterns[ci].forEach((pick, vi) => {
      const voter = voters[vi + 1];
      // Nobody votes for their own entry.
      const authorIdx = (cat + pick) % players.length;
      const target = players[authorIdx] === voter ? (pick + 1) % 3 : pick;
      vote(1, cat, vids[target], voter, now - 65 * DAY + vi * HOUR);
    });
  });

  // Season 4: a few votes so far (the admin hasn't voted, so the demo admin can try it).
  const authorOf = new Map<number, string>();
  for (const s of out) {
    if (s.sql.startsWith('INSERT INTO videos')) authorOf.set(s.params![0] as number, s.params![3] as string);
  }
  [4, 5, 6].forEach((vi, n) => {
    const cat = s4[0];
    const vids = videosByCat.get(cat)!.filter((v) => authorOf.get(v) !== voters[vi]);
    vote(2, cat, vids[n % vids.length], voters[vi], now - DAY + n * HOUR);
  });

  return out;
}

/** Renders statements as a plain SQL script (for `wrangler d1 execute --file`). */
export function toSqlScript(statements: Statement[]): string {
  const lit = (v: SqlValue) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  return statements
    .map((s) => {
      let i = 0;
      return s.sql.replace(/\?/g, () => lit((s.params ?? [])[i++])).replace(/\s+/g, ' ').trim() + ';';
    })
    .join('\n');
}
