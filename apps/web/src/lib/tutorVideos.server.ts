/**
 * Topic videos for the tutor: a YouTube Data API search, strict safe
 * search, embeddable videos only, in the family's language — cached by
 * (query, language) because the same lesson comes up across the school
 * and the API's free quota is only about a hundred searches a day.
 * Without a key the parent still gets a YouTube search link.
 */
import "server-only";
import { aiCacheGet, aiCacheKey, aiCachePut } from "@/lib/aiCache.server";
import { prefersHindi, videoSearchQuery, type TutorLanguage } from "@/lib/tutorPlans";

export type TutorVideo = {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  url: string;
};

export type TutorVideosResult = {
  query: string;
  searchUrl: string;
  items: TutorVideo[];
  source: "api" | "cache" | "search";
};

function searchUrlFor(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export async function searchTutorVideos(opts: {
  topic: string;
  classLabel: string;
  language: TutorLanguage;
}): Promise<TutorVideosResult> {
  const lang: "hi" | "en" = prefersHindi(opts.language) ? "hi" : "en";
  const query = videoSearchQuery(opts.topic, opts.classLabel, lang);
  const searchUrl = searchUrlFor(query);
  const key = (process.env.YOUTUBE_API_KEY || "").trim();
  if (!key) return { query, searchUrl, items: [], source: "search" };

  const cacheKey = aiCacheKey({ route: "tutor-videos", promptVersion: "v1", tier: lang, system: "", userMessage: query });
  const hit = await aiCacheGet(cacheKey);
  if (hit) {
    try {
      const items = JSON.parse(hit.response) as TutorVideo[];
      if (Array.isArray(items)) return { query, searchUrl, items, source: "cache" };
    } catch {
      /* fall through to a fresh search */
    }
  }

  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    maxResults: "5",
    safeSearch: "strict",
    videoEmbeddable: "true",
    relevanceLanguage: lang,
    regionCode: "IN",
    q: query,
    key,
  });
  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    const json = (await res.json().catch(() => ({}))) as {
      items?: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; thumbnails?: { medium?: { url?: string }; default?: { url?: string } } } }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      console.warn("[tutor-videos] search failed:", json.error?.message || res.status);
      return { query, searchUrl, items: [], source: "search" };
    }
    const items: TutorVideo[] = [];
    for (const it of json.items ?? []) {
      const id = it.id?.videoId;
      if (!id) continue;
      items.push({
        videoId: id,
        title: decodeEntities(it.snippet?.title || ""),
        channel: decodeEntities(it.snippet?.channelTitle || ""),
        thumbnail: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || "",
        url: `https://www.youtube.com/watch?v=${id}`,
      });
    }
    if (items.length) {
      void aiCachePut({ key: cacheKey, route: "tutor-videos", engine: "youtube", model: "search.list", response: JSON.stringify(items), generationId: "" });
    }
    return { query, searchUrl, items, source: "api" };
  } catch (e) {
    console.warn("[tutor-videos] search errored:", e instanceof Error ? e.message : e);
    return { query, searchUrl, items: [], source: "search" };
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
