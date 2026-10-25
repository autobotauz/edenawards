/** API data shapes shared by the server and the React client. Timestamps are ISO-8601 UTC strings. */
import type { Platform } from './video';
import type { SeasonPhase, WindowState } from './season';

export type ModerationStatus = 'pending' | 'approved' | 'rejected' | 'hidden';

export interface PublicUser {
  discordId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface Me extends PublicUser {
  isAdmin: boolean;
  isBanned: boolean;
  csrfToken: string;
}

export interface AuthConfig {
  discordEnabled: boolean;
  devLoginEnabled: boolean;
}

export interface Season {
  id: number;
  name: string;
  description: string;
  submissionStartsAt: string;
  submissionEndsAt: string;
  votingStartsAt: string;
  votingEndsAt: string;
  resultsPublishAt: string;
  isPublished: boolean;
  resultsPublished: boolean;
  allowSelfVote: boolean;
  phase: SeasonPhase;
  submissionState: WindowState;
  votingState: WindowState;
  resultsVisible: boolean;
}

export interface Category {
  id: number;
  seasonId: number;
  name: string;
  description: string;
  enabled: boolean;
  displayOrder: number;
}

export interface Video {
  id: number;
  seasonId: number;
  categoryId: number;
  categoryName: string;
  title: string;
  platform: Platform;
  platformVideoId: string;
  canonicalUrl: string;
  thumbnailUrl: string | null;
  author: PublicUser;
  createdAt: string;
  /** Only present for the author or an administrator. */
  moderationStatus?: ModerationStatus;
  moderationReason?: string | null;
}

export interface MyVote {
  seasonId: number;
  categoryId: number;
  videoId: number;
  /** False when the voted video was later disqualified; the voter may vote again. */
  videoEligible: boolean;
  updatedAt: string;
}

export interface RankedEntry {
  rank: number;
  tied: boolean;
  votes: number;
  video: Video;
}

export interface CategoryResult {
  category: Category;
  totalVotes: number;
  entries: RankedEntry[];
  winners: RankedEntry[];
}

export interface SeasonResults {
  season: Season;
  categories: CategoryResult[];
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
