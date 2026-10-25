import type { Category, PublicUser, Season, Video, ModerationStatus } from '../../shared/types';
import type { Platform } from '../../shared/video';
import { resultsVisible, seasonPhase, submissionState, votingState, type SeasonTimes } from '../../shared/season';
import { iso } from './http';

export interface UserRow {
  discord_id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  is_banned: number;
  created_at: number;
  updated_at: number;
}

export interface SeasonRow {
  id: number;
  name: string;
  description: string;
  submission_starts_at: number;
  submission_ends_at: number;
  voting_starts_at: number;
  voting_ends_at: number;
  results_publish_at: number;
  is_published: number;
  results_published: number;
  allow_self_vote: number;
  created_at: number;
  updated_at: number;
}

export interface CategoryRow {
  id: number;
  season_id: number;
  name: string;
  description: string;
  enabled: number;
  display_order: number;
  created_at: number;
}

/** A video joined with its category name and author. */
export interface VideoRow {
  id: number;
  season_id: number;
  category_id: number;
  category_name: string;
  author_discord_id: string;
  author_username: string;
  author_global_name: string | null;
  author_avatar: string | null;
  title: string;
  platform: Platform;
  platform_video_id: string;
  canonical_url: string;
  thumbnail_url: string | null;
  moderation_status: ModerationStatus;
  moderation_reason: string | null;
  created_at: number;
}

export const VIDEO_SELECT = `
  SELECT v.id, v.season_id, v.category_id, c.name AS category_name,
         v.author_discord_id, u.username AS author_username, u.global_name AS author_global_name,
         u.avatar AS author_avatar, v.title, v.platform, v.platform_video_id, v.canonical_url,
         v.thumbnail_url, v.moderation_status, v.moderation_reason, v.created_at
  FROM videos v
  JOIN categories c ON c.id = v.category_id
  JOIN users u ON u.discord_id = v.author_discord_id`;

export function avatarUrl(discordId: string, avatar: string | null): string | null {
  if (avatar && /^(a_)?[a-f0-9]{32}$/.test(avatar)) {
    return `https://cdn.discordapp.com/avatars/${encodeURIComponent(discordId)}/${avatar}.png?size=128`;
  }
  if (/^\d{5,25}$/.test(discordId)) {
    const index = Number((BigInt(discordId) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  }
  return null;
}

export function toPublicUser(id: string, username: string, globalName: string | null, avatar: string | null): PublicUser {
  return { discordId: id, username, displayName: globalName || username, avatarUrl: avatarUrl(id, avatar) };
}

export function seasonTimes(r: SeasonRow): SeasonTimes {
  return {
    submissionStartsAt: r.submission_starts_at,
    submissionEndsAt: r.submission_ends_at,
    votingStartsAt: r.voting_starts_at,
    votingEndsAt: r.voting_ends_at,
    resultsPublishAt: r.results_publish_at,
    resultsPublished: r.results_published === 1,
  };
}

export function toSeason(r: SeasonRow, now: number): Season {
  const t = seasonTimes(r);
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    submissionStartsAt: iso(r.submission_starts_at)!,
    submissionEndsAt: iso(r.submission_ends_at)!,
    votingStartsAt: iso(r.voting_starts_at)!,
    votingEndsAt: iso(r.voting_ends_at)!,
    resultsPublishAt: iso(r.results_publish_at)!,
    isPublished: r.is_published === 1,
    resultsPublished: r.results_published === 1,
    allowSelfVote: r.allow_self_vote === 1,
    phase: seasonPhase(t, now),
    submissionState: submissionState(t, now),
    votingState: votingState(t, now),
    resultsVisible: resultsVisible(t, now),
  };
}

export function toCategory(r: CategoryRow): Category {
  return {
    id: r.id,
    seasonId: r.season_id,
    name: r.name,
    description: r.description,
    enabled: r.enabled === 1,
    displayOrder: r.display_order,
  };
}

export function toVideo(r: VideoRow, includeModeration: boolean): Video {
  const v: Video = {
    id: r.id,
    seasonId: r.season_id,
    categoryId: r.category_id,
    categoryName: r.category_name,
    title: r.title,
    platform: r.platform,
    platformVideoId: r.platform_video_id,
    canonicalUrl: r.canonical_url,
    thumbnailUrl: r.thumbnail_url,
    author: toPublicUser(r.author_discord_id, r.author_username, r.author_global_name, r.author_avatar),
    createdAt: iso(r.created_at)!,
  };
  if (includeModeration) {
    v.moderationStatus = r.moderation_status;
    v.moderationReason = r.moderation_reason;
  }
  return v;
}
