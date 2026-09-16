/**
 * Topic videos for the tutor. DIKSHA first — the government's NCERT/CBSE
 * lesson videos for the child's class, in the family's language — and a
 * YouTube Data API search (strict safe search, embeddable only) only when
 * DIKSHA has too little. Rules live in tutorVideoSources.ts.
 *
 * The finished list is cached by (topic, class, language, what the app can
 * play): the same lesson comes up across the school, DIKSHA publishes no
 * rate limit, and YouTube's free quota is only about a hundred searches a
 * day. Without a YouTube key the parent still gets a YouTube search link.
 */
import "server-only";
import { aiCacheGet, aiCacheKey, aiCachePut } from "@/lib/aiCache.server";
import { generateTutorVideoTermsJson, startLlmPrecheck } from "@/lib/aiLlm.server";
import { trackServerWork } from "@/lib/serverWork";
import { prefersHindi, videoSearchQuery, type TutorLanguage } from "@/lib/tutorPlans";
import {
  DIKSHA_ENOUGH,
  DIKSHA_SEARCH_URL,
  dikshaCandidate,
  dikshaGradesFor,
  dikshaSearchBody,
  fallbackSearchPhrases,
  mediumFor,
  mergeVideos,
  normaliseTopic,
  TUTOR_VIDEO_MAX,
  type DikshaContent,
  type TutorVideo,
  type TutorVideoFormat,
} from "@/lib/tutorVideoSources";

export type { TutorVideo } from "@/lib/tutorVideoSources";

export type TutorVideosResult = {
  query: string;
  searchUrl: string;
  items: TutorVideo[];
  source: "diksha" | "mixed" | "youtube" | "cache" | "search";
};

function searchUrlFor(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export async function searchTutorVideos(opts: {
  topic: string;
  classLabel: string;
  language: TutorLanguage;
  formats: TutorVideoFormat[];
  /** Who the model call is billed to in ai_generations (hh:<householdId>). */
  requester: string;
}): Promise<TutorVideosResult> {
  const lang: "hi" | "en" = prefersHindi(opts.language) ? "hi" : "en";
  const query = videoSearchQuery(opts.topic, opts.classLabel, lang);
  const searchUrl = searchUrlFor(query);
  const grades = dikshaGradesFor(opts.classLabel);

  const cacheKey = aiCacheKey({
    route: "tutor-videos",
    promptVersion: "v2",
    tier: `${lang}:${opts.formats.join("+")}`,
    system: grades?.exact ?? "",
    userMessage: normaliseTopic(opts.topic),
  });
  const hit = await aiCacheGet(cacheKey);
  if (hit) {
    try {
      const items = JSON.parse(hit.response) as TutorVideo[];
      if (Array.isArray(items) && items.length) return { query, searchUrl, items, source: "cache" };
    } catch {
      /* fall through to a fresh search */
    }
  }

  // Set when an answer came back short for a passing reason (DIKSHA or
  // YouTube's oEmbed unreachable, the model over budget), so a thin list is
  // not remembered for a month as if it were all there is.
  const degraded = { value: false };
  const diksha = grades
    ? await searchDiksha({ topic: opts.topic, grades, lang, formats: opts.formats, requester: opts.requester, degraded })
    : [];
  const youtube = diksha.length < DIKSHA_ENOUGH ? await searchYoutube(query, lang) : [];
  const items = mergeVideos([diksha, youtube], TUTOR_VIDEO_MAX);

  if (items.length && !degraded.value) {
    void trackServerWork(
      aiCachePut({
        key: cacheKey,
        route: "tutor-videos",
        engine: diksha.length ? "diksha" : "youtube",
        model: "search",
        response: JSON.stringify(items),
        generationId: "",
      }),
    );
  }
  const source = !items.length ? "search" : !youtube.length ? "diksha" : diksha.length ? "mixed" : "youtube";
  return { query, searchUrl, items, source };
}

async function searchDiksha(opts: {
  topic: string;
  grades: { exact: string; nearby: string[] };
  lang: "hi" | "en";
  formats: TutorVideoFormat[];
  requester: string;
  degraded: { value: boolean };
}): Promise<TutorVideo[]> {
  const terms = await generateTutorVideoTermsJson({
    topic: opts.topic,
    grade: opts.grades.exact,
    precheck: startLlmPrecheck({ requester: opts.requester }),
  });
  const phrases = terms.ok ? terms.terms[opts.lang] : [];
  if (!terms.ok) {
    opts.degraded.value = true;
    console.warn("[tutor-videos] search terms fell back:", terms.error);
  }
  const search = phrases.length ? phrases : fallbackSearchPhrases(opts.topic, opts.lang);
  if (!search.length) return [];

  const medium = mediumFor(opts.lang);
  const run = (phrase: string, grades: string[]) =>
    dikshaSearch(dikshaSearchBody({ phrase, grades, medium, formats: opts.formats, limit: 8 }), opts.formats, opts.degraded);

  const exact = await Promise.all(search.map((p) => run(p, [opts.grades.exact])));
  let lists = exact;
  // A class with nothing on the topic borrows the classes either side
  // before the parent is sent to YouTube.
  if (mergeVideos(exact, TUTOR_VIDEO_MAX).length < DIKSHA_ENOUGH && opts.grades.nearby.length) {
    lists = [...exact, await run(search[0]!, opts.grades.nearby)];
  }
  return keepPlayable(mergeVideos(lists, TUTOR_VIDEO_MAX + 3), TUTOR_VIDEO_MAX, opts.degraded);
}

async function dikshaSearch(
  body: object,
  formats: TutorVideoFormat[],
  degraded: { value: boolean },
): Promise<TutorVideo[]> {
  try {
    const res = await fetch(DIKSHA_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    });
    const json = (await res.json().catch(() => ({}))) as { result?: { content?: DikshaContent[] } };
    if (!res.ok) {
      degraded.value = true;
      console.warn("[tutor-videos] DIKSHA search failed:", res.status);
      return [];
    }
    return (json.result?.content ?? []).map((c) => dikshaCandidate(c, formats)).filter((v): v is TutorVideo => !!v);
  } catch (e) {
    degraded.value = true;
    console.warn("[tutor-videos] DIKSHA search errored:", e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * DIKSHA lists YouTube links teachers filed years ago; some are now
 * private or deleted, and its name for an entry is often the book section
 * rather than what the video is. YouTube's oEmbed answers both — whether
 * the video can still be embedded, and its real title and channel —
 * without a key or quota. A file DIKSHA hosts itself needs no check.
 */
async function keepPlayable(videos: TutorVideo[], max: number, degraded: { value: boolean }): Promise<TutorVideo[]> {
  const checked = await Promise.all(
    videos.map(async (v) => {
      if (v.kind !== "youtube") return v;
      try {
        const res = await fetch(
          `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(v.url)}`,
          { signal: AbortSignal.timeout(4000) },
        );
        // 401/403: embedding turned off or private; 404: deleted.
        if (!res.ok) {
          if (res.status >= 500 || res.status === 429) degraded.value = true;
          return null;
        }
        const o = (await res.json().catch(() => ({}))) as { title?: string; author_name?: string; thumbnail_url?: string };
        return {
          ...v,
          title: o.title?.trim() || v.title,
          channel: o.author_name?.trim() || v.channel,
          thumbnail: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
        };
      } catch {
        degraded.value = true;
        return null;
      }
    }),
  );
  return checked.filter((v): v is TutorVideo => !!v).slice(0, max);
}

async function searchYoutube(query: string, lang: "hi" | "en"): Promise<TutorVideo[]> {
  const key = (process.env.YOUTUBE_API_KEY || "").trim();
  if (!key) return [];

  const cacheKey = aiCacheKey({ route: "tutor-videos", promptVersion: "v1", tier: lang, system: "", userMessage: query });
  const hit = await aiCacheGet(cacheKey);
  if (hit) {
    try {
      const items = JSON.parse(hit.response) as Partial<TutorVideo>[];
      // v1 entries predate kind/source; every one of them is a YouTube id.
      if (Array.isArray(items)) return items.filter((v) => v.videoId).map((v) => youtubeVideo(v as TutorVideo));
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
      return [];
    }
    const items: TutorVideo[] = [];
    for (const it of json.items ?? []) {
      const id = it.id?.videoId;
      if (!id) continue;
      items.push(
        youtubeVideo({
          videoId: id,
          title: decodeEntities(it.snippet?.title || ""),
          channel: decodeEntities(it.snippet?.channelTitle || ""),
          thumbnail: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || "",
          url: `https://www.youtube.com/watch?v=${id}`,
        }),
      );
    }
    if (items.length) {
      void trackServerWork(aiCachePut({ key: cacheKey, route: "tutor-videos", engine: "youtube", model: "search.list", response: JSON.stringify(items), generationId: "" }));
    }
    return items;
  } catch (e) {
    console.warn("[tutor-videos] search errored:", e instanceof Error ? e.message : e);
    return [];
  }
}

function youtubeVideo(v: Pick<TutorVideo, "videoId" | "title" | "channel" | "thumbnail" | "url">): TutorVideo {
  return { ...v, kind: "youtube", mediaUrl: "", source: "youtube", license: "" };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
