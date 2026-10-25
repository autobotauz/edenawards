import type { Db } from '../db';
import type { CategoryResult, SeasonResults } from '../../shared/types';
import { rankEntries, winnersOf } from '../../shared/ranking';
import { toCategory, toSeason, toVideo, VIDEO_SELECT, type CategoryRow, type SeasonRow, type VideoRow } from './mappers';

/**
 * Calculates final standings for a season.
 *
 * Counting policy (documented in docs/POLICIES.md):
 *  - Only approved videos in enabled categories are ranked.
 *  - Votes for videos that were rejected/hidden after voting are not counted.
 *  - Votes cast by banned accounts are not counted.
 */
export async function computeResults(db: Db, season: SeasonRow, now: number): Promise<SeasonResults> {
  const [categories, videos, counts] = await Promise.all([
    db.all<CategoryRow>(
      'SELECT * FROM categories WHERE season_id = ? AND enabled = 1 ORDER BY display_order, id',
      [season.id],
    ),
    db.all<VideoRow>(`${VIDEO_SELECT} WHERE v.season_id = ? AND v.moderation_status = 'approved'`, [season.id]),
    db.all<{ video_id: number; n: number }>(
      `SELECT vo.video_id, COUNT(*) AS n
       FROM votes vo JOIN users u ON u.discord_id = vo.voter_discord_id
       WHERE vo.season_id = ? AND u.is_banned = 0
       GROUP BY vo.video_id`,
      [season.id],
    ),
  ]);

  const voteCount = new Map(counts.map((r) => [r.video_id, Number(r.n)]));

  const results: CategoryResult[] = categories.map((cat) => {
    const inCategory = videos
      .filter((v) => v.category_id === cat.id)
      .map((v) => ({ id: v.id, createdAt: v.created_at, votes: voteCount.get(v.id) ?? 0, row: v }));
    const entries = rankEntries(inCategory).map((r) => ({
      rank: r.rank,
      tied: r.tied,
      votes: r.item.votes,
      video: toVideo(r.item.row, false),
    }));
    return {
      category: toCategory(cat),
      totalVotes: entries.reduce((sum, e) => sum + e.votes, 0),
      entries,
      winners: winnersOf(entries),
    };
  });

  return { season: toSeason(season, now), categories: results };
}
