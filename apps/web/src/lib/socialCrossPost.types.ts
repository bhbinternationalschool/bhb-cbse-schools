export type SocialPlatform = "facebook" | "instagram" | "telegram";

export type SocialCrossPostKind = "notice" | "news" | "gallery" | "marketing";

export type SocialCrossPostPayload = {
  kind: SocialCrossPostKind;
  contentId: string;
  title: string;
  body: string;
  summary?: string;
  imageUrl?: string;
  imageUrls?: string[];
  linkUrl?: string;
  platforms?: SocialPlatform[];
  /** Re-post even if already posted to a platform */
  force?: boolean;
};

export type SocialPlatformResult = {
  platform: SocialPlatform;
  ok: boolean;
  skipped?: boolean;
  externalPostId?: string;
  postUrl?: string;
  error?: string;
};

export type SocialCrossPostResult = {
  ok: boolean;
  results: SocialPlatformResult[];
  error?: string;
};

export type SocialCrossPostLogEntry = {
  id: string;
  kind: SocialCrossPostKind;
  contentId: string;
  platform: SocialPlatform;
  status: "posted" | "failed" | "skipped";
  externalPostId: string;
  postUrl: string;
  error: string;
  postedAt: string;
  title: string;
};

export type SocialCrossPostConfig = {
  enabled: boolean;
  facebook: boolean;
  instagram: boolean;
  telegram: boolean;
  facebookPageId: string | null;
  instagramBusinessId: string | null;
  telegramChannelId: string | null;
  telegramChannelUsername: string | null;
  defaultImageUrl: string | null;
  notes: string[];
};
