/**
 * Client helpers — cross-post prefs + API calls.
 */

import type {
  SocialCrossPostConfig,
  SocialCrossPostKind,
  SocialCrossPostPayload,
  SocialCrossPostResult,
  SocialPlatform,
} from "@/lib/socialCrossPost.types";

export type {
  SocialCrossPostConfig,
  SocialCrossPostKind,
  SocialCrossPostLogEntry,
  SocialCrossPostPayload,
  SocialCrossPostResult,
  SocialPlatform,
} from "@/lib/socialCrossPost.types";

const PREFS_KEY = "bhb_social_cross_post_prefs_v1";

export type SocialCrossPostPrefs = {
  enabled: boolean;
  platforms: SocialPlatform[];
};

const DEFAULT_PREFS: SocialCrossPostPrefs = {
  enabled: true,
  platforms: ["facebook", "instagram", "telegram"],
};

export function loadSocialCrossPostPrefs(): SocialCrossPostPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<SocialCrossPostPrefs>;
    const platforms = Array.isArray(parsed.platforms)
      ? parsed.platforms.filter((p): p is SocialPlatform =>
          p === "facebook" || p === "instagram" || p === "telegram",
        )
      : DEFAULT_PREFS.platforms;
    return {
      enabled: parsed.enabled !== false,
      platforms: platforms.length ? platforms : DEFAULT_PREFS.platforms,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveSocialCrossPostPrefs(prefs: SocialCrossPostPrefs): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  window.dispatchEvent(new CustomEvent("bhb-social-cross-post-prefs"));
}

export async function fetchSocialCrossPostConfig(): Promise<SocialCrossPostConfig | null> {
  try {
    const res = await fetch("/api/integrations/social/config");
    if (!res.ok) return null;
    return (await res.json()) as SocialCrossPostConfig;
  } catch {
    return null;
  }
}

export async function requestSocialCrossPost(
  payload: SocialCrossPostPayload,
): Promise<SocialCrossPostResult> {
  const res = await fetch("/api/integrations/social/cross-post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => ({}))) as SocialCrossPostResult & {
    error?: string;
  };
  if (!res.ok) {
    return {
      ok: false,
      results: json.results ?? [],
      error: json.error || `HTTP ${res.status}`,
    };
  }
  return json;
}

export function summarizeCrossPostResult(result: SocialCrossPostResult): string {
  if (!result.results.length) {
    return result.error || "No platforms selected";
  }
  const parts = result.results.map((r) => {
    if (r.skipped && r.ok) return `${r.platform}: already posted`;
    if (r.ok) return `${r.platform}: posted`;
    return `${r.platform}: ${r.error || "failed"}`;
  });
  return parts.join(" · ");
}

export function buildCrossPostPayload(input: {
  kind: SocialCrossPostKind;
  contentId: string;
  title: string;
  body: string;
  summary?: string;
  imageUrl?: string;
  imageUrls?: string[];
  linkUrl?: string;
  force?: boolean;
  platforms?: SocialPlatform[];
}): SocialCrossPostPayload {
  const prefs = loadSocialCrossPostPrefs();
  return {
    ...input,
    platforms: input.platforms ?? (prefs.enabled ? prefs.platforms : []),
  };
}
