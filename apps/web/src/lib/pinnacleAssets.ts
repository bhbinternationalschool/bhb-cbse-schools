/**
 * Pinnacle Smart Teach's teaching assets, indexed against the ERP's books
 * (director, 12 Oct 2026). Each chapter of the school's Pearson / LEAD add-on
 * books has publisher assets on Smart Teach — animations, games, interactive
 * exercises, worksheets, mind maps, videos, picture studies, timelines. The
 * Office Robot reads their titles and types from the Assets tab the teacher
 * is signed in to; the ERP keeps only that index and links teachers to the
 * book's Assets page. The files themselves stay on Smart Teach (licensed to
 * the school, opened with the teacher's own login) — never copied here.
 *
 * Pure: no I/O.
 */

import { pinnacleChapterName, pinnacleClassName, pinnacleSeriesSubject } from "@/lib/pinnacleBooks";

export type PinnacleAsset = { type: string; title: string };

export type PinnacleAssetChapter = {
  /** Chapter name without its "Ch7:" numbering. */
  name: string;
  /** The publisher's chapter number, or null when it has none. */
  number: number | null;
  assets: PinnacleAsset[];
};

export type PinnacleAssetBook = {
  bookId: number;
  title: string;
  /** ERP grade (Nursery −2, LKG −1, UKG 0, Class N = N). */
  grade: number;
  /** ERP subject_key ("" for a series with no ERP subject). */
  subjectKey: string;
  chapters: PinnacleAssetChapter[];
};

const SUBJECT_KEY: Record<string, string> = {
  Computer: "computer",
  "General Knowledge": "gk",
  "Social Studies": "social",
};

/** Smart Teach's Assets page for a book — teachers open it with their own login. */
export function pinnacleAssetsUrl(bookId: number): string {
  return `https://teacher.pinnaclelearning.in/book?bookId=${bookId}&userRole=teacher&activeTab=assets`;
}

/** Asset types in the order a teacher reaches for them in class. */
const TYPE_ORDER = [
  "Animation",
  "Video",
  "Mind Map",
  "Game",
  "Additional Interactivity",
  "Chapter Opening",
  "Activity Based Worksheet",
  "Image Based Worksheet",
  "Worksheet",
  "Computer Lab Activity",
  "Picture Study",
  "Timeline",
];

/** True for an asset a child does at a desk or at home: printable worksheets and lab activities. */
export function isWorksheetAsset(a: PinnacleAsset): boolean {
  return /worksheet|lab activity/i.test(a.type);
}

/** True for an asset suited to quick revision before an exam. */
export function isRevisionAsset(a: PinnacleAsset): boolean {
  return /mind map|timeline|animation|video/i.test(a.type);
}

const gradeOf = (className: string) =>
  className === "Nursery" ? -2 : className === "LKG" ? -1 : className === "UKG" ? 0 : Number(className.replace(/\D/g, "")) || NaN;

/**
 * The robot's scan, cleaned: books the ERP can place (known series and class),
 * chapters with their assets, answer keys and "Unknown" entries dropped,
 * duplicates removed. A chapter with no assets is left out.
 */
export function normalizePinnacleAssets(raw: unknown): PinnacleAssetBook[] {
  if (!Array.isArray(raw)) return [];
  const out: PinnacleAssetBook[] = [];
  const seenBook = new Set<number>();
  for (const r of raw.slice(0, 100) as { bookId?: unknown; title?: unknown; path?: unknown; chapters?: unknown }[]) {
    const bookId = Number(r?.bookId);
    const title = String(r?.title || "").trim().slice(0, 160);
    const path = String(r?.path || "").trim().slice(0, 200);
    if (!Number.isInteger(bookId) || bookId <= 0 || seenBook.has(bookId)) continue;
    const subject = pinnacleSeriesSubject(title, path);
    const grade = gradeOf(pinnacleClassName(title, path));
    if (!subject || !Number.isFinite(grade)) continue;
    const chapters: PinnacleAssetChapter[] = [];
    for (const c of (Array.isArray(r.chapters) ? r.chapters : []).slice(0, 200) as { name?: unknown; assets?: unknown }[]) {
      const rawName = String(c?.name || "").replace(/\s+/g, " ").trim();
      const name = pinnacleChapterName(rawName);
      if (!name) continue;
      const m = rawName.match(/^ch(?:apter)?\s*[:.]?\s*(\d+)/i);
      const seen = new Set<string>();
      const assets: PinnacleAsset[] = [];
      for (const a of (Array.isArray(c.assets) ? c.assets : []).slice(0, 60) as { type?: unknown; title?: unknown }[]) {
        let type = String(a?.type || "").replace(/\s+/g, " ").trim().slice(0, 60);
        const t = String(a?.title || "").replace(/\s+/g, " ").trim().normalize("NFKC").slice(0, 200);
        // Smart Teach labels some real items "Unknown" ("Unknown: NEP
        // Worksheet"); one with a title is kept under a plain type, one
        // without is an empty card.
        if (!type || /^unknown$/i.test(type)) {
          if (!t) continue;
          type = /worksheet/i.test(t) ? "Worksheet" : "Resource";
        }
        if (/answer key/i.test(type)) continue;
        const key = `${type}|${t}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        assets.push({ type, title: t || type });
      }
      if (!assets.length) continue;
      assets.sort((a, b) => rank(a.type) - rank(b.type));
      chapters.push({ name, number: m ? Number(m[1]) : null, assets });
    }
    if (!chapters.length) continue;
    seenBook.add(bookId);
    out.push({ bookId, title, grade, subjectKey: SUBJECT_KEY[subject] ?? "", chapters });
  }
  return out;
}

const rank = (type: string) => {
  const i = TYPE_ORDER.findIndex((t) => t.toLowerCase() === type.toLowerCase());
  return i < 0 ? TYPE_ORDER.length : i;
};

const nameKey = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export type ChapterAssets = { bookId: number; bookTitle: string; url: string; chapter: string; assets: PinnacleAsset[] };

/**
 * The assets for one ERP chapter: the book for that grade and subject, then
 * the chapter by name, else by the publisher's number matching the ERP
 * position — but only when that numbered chapter's name does not belong to a
 * different ERP chapter. Null when Smart Teach has nothing for it.
 */
export function assetsForChapter(
  index: PinnacleAssetBook[],
  grade: number,
  subjectKey: string,
  chapterName: string,
  position: number | null,
): ChapterAssets | null {
  if (!subjectKey) return null;
  const book = index.find((b) => b.grade === grade && b.subjectKey === subjectKey);
  if (!book) return null;
  const want = nameKey(chapterName);
  let hit = want ? book.chapters.find((c) => nameKey(c.name) === want) : undefined;
  if (!hit && want) hit = book.chapters.find((c) => nameKey(c.name).startsWith(want) || want.startsWith(nameKey(c.name)));
  if (!hit && position !== null) hit = book.chapters.find((c) => c.number === position);
  if (!hit) return null;
  return { bookId: book.bookId, bookTitle: book.title, url: pinnacleAssetsUrl(book.bookId), chapter: hit.name, assets: hit.assets };
}

/** One line a teacher reads at a glance: "Animation: Early Calculating Devices · Mind Map · Game". */
export function assetsLine(assets: PinnacleAsset[], max = 4): string {
  const parts = assets.slice(0, max).map((a) => (a.title && a.title !== a.type ? `${a.type}: ${a.title}` : a.type));
  return parts.join(" · ") + (assets.length > max ? ` · +${assets.length - max} more` : "");
}
