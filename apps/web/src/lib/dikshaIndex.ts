/**
 * The NCERT chapter index: which DIKSHA textbooks count, and how one book's
 * hierarchy becomes chapter and resource rows. Pure, so the sync and its
 * self-test share every rule. Tables: migration 20260916140100.
 *
 * DIKSHA carries two generations of NCERT books. Its CBSE channel holds the
 * pre-2023 editions (Marigold, Math-Magic, Honeysuckle) relabelled "(NEW)";
 * NCERT's own channel holds the NCF 2023 books the school teaches from
 * 2026-27 (Mridang, Santoor, Maths Mela, Ganita Prakash, Curiosity, Poorvi,
 * Malhar…). Indexing the wrong one would ground the tutor in chapters the
 * child never opens, so the choice is made here, by rule, not by name.
 */

export const DIKSHA_SEARCH_URL = "https://diksha.gov.in/api/content/v1/search";
export const DIKSHA_HIERARCHY_URL = "https://diksha.gov.in/api/course/v1/hierarchy/";
/** NCERT's own DIKSHA channel (the CBSE channel is 01241974041332940818). */
export const NCERT_CHANNEL = "0125196274181898243";
/** NCF 2023 editions began with Classes 1–2 in 2023. */
export const FIRST_CURRENT_EDITION_YEAR = 2023;
export const INDEX_GRADES = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const COLLECTION = "application/vnd.ekstep.content-collection";

export const TEXTBOOK_FIELDS = [
  "identifier",
  "name",
  "channel",
  "gradeLevel",
  "medium",
  "subject",
  "year",
  "copyrightYear",
  "lastPublishedOn",
] as const;

/** One page of NCERT's textbooks for Classes 1–8, in a stable order for paging. */
export function textbookSearchBody(offset: number, limit = 100) {
  return {
    request: {
      filters: {
        status: ["Live"],
        primaryCategory: ["Digital Textbook"],
        board: ["NCERT"],
        channel: [NCERT_CHANNEL],
        gradeLevel: INDEX_GRADES.map((g) => `Class ${g}`),
        medium: ["English", "Hindi", "Sanskrit"],
      },
      fields: [...TEXTBOOK_FIELDS],
      sort_by: { identifier: "asc" },
      limit,
      offset,
    },
  };
}

export type DikshaTextbookHit = {
  identifier?: string;
  name?: string;
  channel?: string;
  gradeLevel?: string[];
  medium?: string[] | string;
  subject?: string[] | string;
  year?: string | number;
  copyrightYear?: string | number;
  lastPublishedOn?: string;
};

export type IndexTextbook = {
  id: string;
  grade: number;
  medium: "English" | "Hindi" | "Sanskrit";
  subjects: string[];
  name: string;
  editionYear: number;
  /** ISO timestamp, or null when DIKSHA gives none. */
  publishedAt: string | null;
};

const list = (v: string[] | string | undefined): string[] =>
  (Array.isArray(v) ? v : v ? [v] : []).map((s) => String(s).trim()).filter(Boolean);

/**
 * DIKSHA writes "2026-09-08T10:12:33.123+0000"; Postgres and Date want the
 * offset as +00:00. Null for anything that is not a date.
 */
export function dikshaDate(s: string | undefined | null): string | null {
  const v = (s || "").trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * The books that belong in the index. Each rule is a way DIKSHA's catalogue
 * was seen to mislead:
 *  - another channel's upload of the same title;
 *  - an old edition still listed on NCERT's channel ("(NEW) Our Past II",
 *    copyright 2020, no edition year);
 *  - a book filed under several classes at once (workbooks, comics);
 *  - Sanskrit translations of the other subjects ("Curiosity (Sanskrit)") —
 *    only Sanskrit the subject (Deepakam) is taught in Sanskrit.
 */
export function selectCurrentTextbooks(hits: DikshaTextbookHit[]): IndexTextbook[] {
  const out: IndexTextbook[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const id = (h.identifier || "").trim();
    const name = (h.name || "").replace(/\s+/g, " ").trim();
    if (!id || !name || seen.has(id) || h.channel !== NCERT_CHANNEL) continue;
    const grades = list(h.gradeLevel);
    const g = grades.length === 1 ? grades[0]!.match(/^Class ([1-8])$/i) : null;
    if (!g) continue;
    const year = Number(h.year) || 0;
    if (year < FIRST_CURRENT_EDITION_YEAR) continue;
    const mediums = list(h.medium);
    const subjects = list(h.subject);
    if (mediums.length !== 1) continue;
    const medium = mediums[0]!;
    const isSanskritSubject = subjects.some((s) => /^sanskrit$/i.test(s));
    if (!(medium === "English" || medium === "Hindi" || (medium === "Sanskrit" && isSanskritSubject))) continue;
    seen.add(id);
    out.push({
      id,
      grade: Number(g[1]),
      medium: medium as IndexTextbook["medium"],
      subjects,
      name,
      editionYear: year,
      publishedAt: dikshaDate(h.lastPublishedOn),
    });
  }
  return out.sort((a, b) => a.grade - b.grade || a.medium.localeCompare(b.medium) || a.name.localeCompare(b.name));
}

export type HierarchyNode = {
  identifier?: string;
  name?: string;
  mimeType?: string;
  primaryCategory?: string;
  index?: number;
  dialcodes?: string[];
  description?: string;
  keywords?: string[];
  license?: string;
  copyright?: string;
  organisation?: string[];
  artifactUrl?: string;
  size?: number | string;
  children?: HierarchyNode[];
};

export type ChapterRow = {
  id: string;
  position: number;
  name: string;
  chapter_code: string;
  description: string;
  keywords: string[];
  textbook_pdf_url: string;
  textbook_pdf_license: string;
  video_count: number;
  audio_count: number;
  practice_count: number;
};

export type ResourceRow = {
  chapter_id: string;
  id: string;
  position: number;
  folder: string;
  name: string;
  category: string;
  mime_type: string;
  license: string;
  copyright: string;
  url: string;
  size_bytes: number | null;
};

export type TextbookPayload = {
  textbook: {
    id: string;
    grade: number;
    medium: string;
    subjects: string[];
    name: string;
    edition_year: number;
    license: string;
    copyright: string;
    published_at: string | null;
  };
  chapters: ChapterRow[];
  resources: ResourceRow[];
};

const clean = (s: string | undefined) => (s || "").replace(/\s+/g, " ").trim();

/** DIKSHA's form placeholder is not a description. */
function realDescription(s: string | undefined): string {
  const d = clean(s);
  return /^enter description\b/i.test(d) ? "" : d.slice(0, 1000);
}

/** Keywords once each, whatever their case, in the spelling first seen. */
function uniqueKeywords(keywords: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of (keywords ?? []).map(clean)) {
    if (!k || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
  }
  return out.slice(0, 30);
}

function ordered(nodes: HierarchyNode[] | undefined): HierarchyNode[] {
  // DIKSHA's children arrays are already in book order; `index` is used only
  // where present, and a stable sort keeps the array order for ties.
  return [...(nodes ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

/**
 * One book's hierarchy → rows. A chapter is a top-level unit; everything
 * beneath it, however deeply foldered, is a resource of that chapter, filed
 * under the first-level folder DIKSHA put it in ("Video Content", "Practice
 * Set"). Loose files at the top of a book belong to no chapter and are left
 * out. A resource listed twice in one chapter is kept once.
 */
export function parseTextbookHierarchy(book: IndexTextbook, content: HierarchyNode): TextbookPayload {
  const chapters: ChapterRow[] = [];
  const resources: ResourceRow[] = [];
  const units = ordered(content.children).filter((c) => c.mimeType === COLLECTION && c.identifier);

  units.forEach((unit, i) => {
    const chapterId = unit.identifier!;
    const mine: ResourceRow[] = [];
    const seen = new Set<string>();
    const walk = (nodes: HierarchyNode[] | undefined, folder: string) => {
      for (const n of ordered(nodes)) {
        if (n.mimeType === COLLECTION) {
          walk(n.children, folder || clean(n.name));
          continue;
        }
        const id = (n.identifier || "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const size = Number(n.size);
        mine.push({
          chapter_id: chapterId,
          id,
          position: mine.length + 1,
          folder,
          name: clean(n.name) || id,
          category: clean(n.primaryCategory),
          mime_type: clean(n.mimeType),
          license: clean(n.license),
          copyright: clean(n.copyright) || clean(n.organisation?.[0]),
          url: /^https:\/\//.test(n.artifactUrl || "") ? n.artifactUrl! : "",
          size_bytes: Number.isFinite(size) && size > 0 ? Math.round(size) : null,
        });
      }
    };
    walk(unit.children, "");

    // The chapter's own pages: a PDF DIKSHA calls eTextbook, or any PDF in the
    // chapter's "e-Textbook" folder — 25 of 1,011 chapters (September 2026)
    // label it "Learning Resource" or "Explanation Content" instead. Three PE
    // warm-up chapters have no PDF at all and keep an empty link.
    const isPdf = (r: ResourceRow) => r.mime_type === "application/pdf" && !!r.url;
    const pdf =
      mine.find((r) => isPdf(r) && r.category === "eTextbook") ??
      mine.find((r) => isPdf(r) && /^e-?\s*text\s*book$/i.test(r.folder));
    chapters.push({
      id: chapterId,
      position: i + 1,
      name: clean(unit.name) || `Chapter ${i + 1}`,
      chapter_code: clean(unit.dialcodes?.[0]),
      description: realDescription(unit.description),
      keywords: uniqueKeywords(unit.keywords),
      textbook_pdf_url: pdf?.url ?? "",
      textbook_pdf_license: pdf?.license ?? "",
      video_count: mine.filter((r) => r.mime_type.startsWith("video/")).length,
      audio_count: mine.filter((r) => r.mime_type.startsWith("audio/")).length,
      practice_count: mine.filter((r) => r.category === "Practice Question Set").length,
    });
    resources.push(...mine);
  });

  return {
    textbook: {
      id: book.id,
      grade: book.grade,
      medium: book.medium,
      subjects: book.subjects,
      name: book.name,
      edition_year: book.editionYear,
      license: clean(content.license),
      copyright: clean(content.copyright),
      published_at: book.publishedAt,
    },
    chapters,
    resources,
  };
}

export type StoredTextbook = {
  id: string;
  published_at: string | null;
  chapter_count: number;
  retired_at: string | null;
};

/**
 * Whether a book's hierarchy must be fetched again. A hierarchy can run to a
 * megabyte, and DIKSHA moves its publish date whenever NCERT changes a book,
 * so an unchanged date with chapters already stored is skipped.
 */
export function needsRefetch(stored: StoredTextbook | undefined, book: IndexTextbook, force = false): boolean {
  if (force || !stored || stored.retired_at || stored.chapter_count <= 0) return true;
  if (!stored.published_at || !book.publishedAt) return true;
  return Date.parse(stored.published_at) !== Date.parse(book.publishedAt);
}

/**
 * Books to mark retired: stored, still active, and no longer in DIKSHA's
 * list. Only from a catalogue read to the end — a page that failed must not
 * look like NCERT withdrawing books — and never more than half the index at
 * once, which would say DIKSHA's search broke, not that NCERT rewrote its
 * shelf in a week.
 */
export function textbooksToRetire(
  stored: StoredTextbook[],
  current: IndexTextbook[],
  catalogueComplete: boolean,
): { ids: string[]; refused: string | null } {
  if (!catalogueComplete) return { ids: [], refused: "DIKSHA's catalogue was not read to the end" };
  const active = stored.filter((s) => !s.retired_at);
  const live = new Set(current.map((b) => b.id));
  const ids = active.filter((s) => !live.has(s.id)).map((s) => s.id);
  if (ids.length && ids.length * 2 > active.length) {
    return { ids: [], refused: `${ids.length} of ${active.length} books would retire at once` };
  }
  return { ids, refused: null };
}
