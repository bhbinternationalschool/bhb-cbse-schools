/**
 * Where the tutor's topic videos come from, as pure rules the server and
 * its self-test share.
 *
 * DIKSHA — the Government of India's school platform, run by NCERT — comes
 * first: its videos are filed against the CBSE/NCERT books class by class,
 * in Hindi and English medium, and most carry a Creative Commons licence. A
 * YouTube search only tops the list up when DIKSHA has too little.
 *
 * DIKSHA's search matches words in a video's name, so a whole question
 * ("What is photosynthesis?") finds nothing while "photosynthesis" finds a
 * dozen. The question is first turned into short lesson names — by the
 * model when it is reachable, by dropping question words when it is not.
 */

export type TutorVideoFormat = "youtube" | "mp4";

export type TutorVideo = {
  /** YouTube id; empty for a file DIKSHA hosts itself. */
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  /** A page a person can open: the YouTube watch page or DIKSHA's player. */
  url: string;
  kind: TutorVideoFormat;
  /** The file to play when kind is "mp4"; empty otherwise. */
  mediaUrl: string;
  source: "diksha" | "youtube";
  /** The licence DIKSHA lists, verbatim; empty for a YouTube search hit. */
  license: string;
};

export const TUTOR_VIDEO_MAX = 5;
/** Fewer DIKSHA videos than this and a YouTube search tops the list up. */
export const DIKSHA_ENOUGH = 3;
export const DIKSHA_SEARCH_URL = "https://diksha.gov.in/api/content/v1/search";

/**
 * What the app can play. Builds before DIKSHA files existed send nothing
 * and can only play a YouTube id — a file handed to them would open a
 * broken YouTube player — so the absence of the field means YouTube only.
 */
export function parseVideoFormats(v: unknown): TutorVideoFormat[] {
  return Array.isArray(v) && v.includes("mp4") ? ["youtube", "mp4"] : ["youtube"];
}

/**
 * DIKSHA's grade names for a class label from Masters ("VI A", "LKG B"):
 * the class itself, and the classes either side for when the class alone
 * has nothing. Nursery–UKG are DIKSHA's Preschool 1–3 (the NCF's Balvatika).
 * Null when the label names no class the school teaches.
 */
export function dikshaGradesFor(classLabel: string): { exact: string; nearby: string[] } | null {
  const n = ` ${(classLabel || "").toLowerCase()} `;
  let level = 0; // Preschool 1–3 → -2..0, Class 1–12 → 1..12
  if (/\b(nursery|nur|play ?group)\b/.test(n)) level = -2;
  else if (/\blkg\b/.test(n)) level = -1;
  else if (/\b(ukg|kg)\b/.test(n)) level = 0;
  else {
    const roman: Record<string, number> = {
      i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12,
    };
    const m = n.match(/\b(xii|xi|x|ix|viii|vii|vi|iv|v|iii|ii|i|1[0-2]|[1-9])\b/);
    if (!m) return null;
    level = roman[m[1]!] ?? Number(m[1]);
  }
  const name = (l: number) => (l <= 0 ? `Preschool ${l + 3}` : `Class ${l}`);
  return {
    exact: name(level),
    nearby: [level - 1, level + 1].filter((l) => l >= -2 && l <= 12).map(name),
  };
}

export function mediumFor(lang: "hi" | "en"): "Hindi" | "English" {
  return lang === "hi" ? "Hindi" : "English";
}

export const VIDEO_TERMS_PROMPT_VERSION = "v1";

export function buildVideoTermsSystemPrompt(): string {
  return [
    "You turn a school question from an Indian parent or child into short search phrases for DIKSHA, the government video library of NCERT/CBSE lessons.",
    "The library matches words in video names, and videos are named after NCERT chapters and topics. So each phrase must be a chapter or topic name as the NCERT textbook for that class words it — never a question, never a sentence.",
    'Reply with JSON only: {"en": [...], "hi": [...]}.',
    "en: up to 3 phrases in English, as in the English-medium NCERT books. hi: up to 3 phrases in Devanagari, as in the Hindi-medium NCERT books (for example प्रकाश संश्लेषण, पादपों में पोषण, भिन्न).",
    "Order each list from most specific (the topic itself) to broader (its chapter). Each phrase is 1–4 words. No question words, no class numbers, no board names.",
    "The question may be in English, Hindi or Hinglish; answer both lists whatever its language.",
    'If it is not about a school topic, reply {"en": [], "hi": []}.',
  ].join("\n");
}

export function buildVideoTermsUserPrompt(opts: { topic: string; grade: string }): string {
  return `Class: ${opts.grade}\nQuestion: ${opts.topic.replace(/\s+/g, " ").trim().slice(0, 300)}`;
}

/** The model's phrases, kept only when each is a short name in the right script. */
export function parseVideoTermsJson(text: string): { en: string[]; hi: string[] } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*([\s\S]*?)```$/i, "$1"));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const clean = (v: unknown, script: RegExp): string[] => {
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const item of v) {
      if (typeof item !== "string") continue;
      const s = item.replace(/[?!.,;:"“”]/g, " ").replace(/\s+/g, " ").trim();
      if (!s || s.length > 40 || s.split(" ").length > 4 || !script.test(s)) continue;
      if (!out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
      if (out.length === 3) break;
    }
    return out;
  };
  return { en: clean(r.en, /^[A-Za-z0-9 '&()-]+$/), hi: clean(r.hi, /[\u0900-\u097F]/) };
}

const STOPWORDS = new Set(
  (
    "what is are was were the a an of in on to for and or how why when where which who does do did can " +
    "explain tell me about please give with example examples meaning define definition difference between " +
    "chapter lesson class question answer my child homework help " +
    "kya hai hain hota hote hoti ka ki ke ko se me mein aur samjhao samjhaiye batao bataiye kaise kyon " +
    "क्या है हैं होता होते होती का की के को से में और समझाओ समझाइए समझाएं बताओ बताइए कैसे क्यों कौन किसे कहते उदाहरण अर्थ पाठ प्रश्न उत्तर"
  ).split(" "),
);

/**
 * Search phrases without the model: the question's own content words in
 * the medium's script. A Hindi-medium search needs Devanagari, so a
 * question typed in English or Hinglish gives none — YouTube covers it.
 */
export function fallbackSearchPhrases(topic: string, lang: "hi" | "en"): string[] {
  const script = lang === "hi" ? /^[\u0900-\u097F]+$/ : /^[a-z0-9]+$/;
  const words = topic
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w) && script.test(w) && !/^\d+$/.test(w));
  if (!words.length) return [];
  const all = words.slice(0, 4).join(" ");
  const longest = [...words].sort((a, b) => b.length - a.length)[0]!;
  return all === longest ? [all] : [all, longest];
}

export const DIKSHA_FIELDS = [
  "identifier",
  "name",
  "mimeType",
  "artifactUrl",
  "streamingUrl",
  "appIcon",
  "license",
  "creator",
  "author",
  "organisation",
] as const;

export function dikshaSearchBody(opts: {
  phrase: string;
  grades: string[];
  medium: "Hindi" | "English";
  formats: TutorVideoFormat[];
  limit: number;
}) {
  return {
    request: {
      filters: {
        status: ["Live"],
        // CBSE's own uploads and NCERT's; state boards teach the same topic
        // a class earlier or later, which the tutor already refuses to mix.
        board: ["CBSE", "NCERT"],
        gradeLevel: opts.grades,
        medium: [opts.medium],
        mimeType: opts.formats.map((f) => (f === "mp4" ? "video/mp4" : "video/x-youtube")),
      },
      query: opts.phrase,
      limit: opts.limit,
      fields: [...DIKSHA_FIELDS],
    },
  };
}

export type DikshaContent = {
  identifier?: string;
  name?: string;
  mimeType?: string;
  artifactUrl?: string;
  streamingUrl?: string;
  appIcon?: string;
  license?: string;
  creator?: string;
  author?: string;
  organisation?: string[];
};

/** YouTube's 11-character id from an embed, watch or youtu.be link. */
export function youtubeIdFrom(url: string | undefined): string {
  const m = (url || "").match(/(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?(?:.*&)?v=|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/);
  return m ? m[1]! : "";
}

/**
 * The Creative Commons licences DIKSHA uses. Every one of them allows the
 * video to be shown as published, with credit; a file with any other or no
 * licence is left out. A YouTube-hosted entry plays through YouTube's own
 * embedded player, which is how YouTube's licence lets it be shown.
 */
const CC_LICENCE = /^CC BY(?:-NC)?(?:-SA|-ND)? 4\.0$/i;

export function dikshaCandidate(c: DikshaContent, formats: TutorVideoFormat[]): TutorVideo | null {
  const id = (c.identifier || "").trim();
  const name = (c.name || "").replace(/_/g, " · ").replace(/\s+/g, " ").trim();
  if (!id || !name) return null;
  const license = (c.license || "").trim();
  const channel = (c.organisation?.[0] || c.creator || c.author || "DIKSHA").trim();
  const thumbnail = /^https:\/\//.test(c.appIcon || "") ? c.appIcon! : "";
  if (c.mimeType === "video/x-youtube") {
    const videoId = youtubeIdFrom(c.artifactUrl) || youtubeIdFrom(c.streamingUrl);
    if (!videoId) return null;
    return {
      videoId,
      title: name,
      channel,
      thumbnail,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      kind: "youtube",
      mediaUrl: "",
      source: "diksha",
      license,
    };
  }
  if (c.mimeType === "video/mp4" && formats.includes("mp4")) {
    const mediaUrl = (c.artifactUrl || "").trim();
    if (!/^https:\/\/\S+\.mp4$/i.test(mediaUrl) || !CC_LICENCE.test(license)) return null;
    return {
      videoId: "",
      title: name,
      channel,
      thumbnail,
      url: `https://diksha.gov.in/play/content/${encodeURIComponent(id)}`,
      kind: "mp4",
      mediaUrl,
      source: "diksha",
      license,
    };
  }
  return null;
}

function videoKey(v: TutorVideo): string {
  return v.videoId ? `yt:${v.videoId}` : `f:${v.mediaUrl}`;
}

/**
 * One list from several, earlier lists first (the most specific phrase's
 * results lead). DIKSHA often files the same video under several names or
 * uploads it more than once, so a repeated id, file or title is dropped.
 */
export function mergeVideos(lists: TutorVideo[][], max: number): TutorVideo[] {
  const out: TutorVideo[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const v of list) {
      const title = `t:${v.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")}`;
      if (seen.has(videoKey(v)) || seen.has(title)) continue;
      seen.add(videoKey(v));
      seen.add(title);
      out.push(v);
      if (out.length === max) return out;
    }
  }
  return out;
}

/** Cache key text for a topic: the same question typed twice shares one entry. */
export function normaliseTopic(topic: string): string {
  return topic.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 300);
}
