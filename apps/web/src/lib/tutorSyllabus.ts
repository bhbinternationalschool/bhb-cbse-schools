/**
 * The child's textbooks, as a short table of contents for the tutor's and the
 * lesson planner's prompts. Pure: the server loads books and chapters and
 * this file decides which of them the prompt carries and how they read.
 *
 * Whose books (director's decision, 16 Sep 2026): Classes 1–8 follow the
 * SCHOOL's own books (Propel at this school; tables school_textbooks /
 * school_textbook_chapters). Before that the list came from the DIKSHA index
 * of NCERT books, and answers said "Ganita Prakash, Chapter 7" to families
 * whose child has never seen that book. Nursery–UKG keep NCERT's learning
 * outcomes as a minimum (DIKSHA index), because that is a floor, not a book.
 *
 * When the index has nothing for the class (not synced yet, Nursery–UKG,
 * a class label that names no class) the block is empty and the prompt is
 * exactly what it was before — an absent list is never described as one.
 */

export type SyllabusBook = { id: string; medium: string; subjects: string[]; name: string };
export type SyllabusChapter = { textbookId: string; position: number; name: string };

export type SubjectKey = "maths" | "science" | "evs" | "social" | "english" | "hindi" | "sanskrit" | "arts" | "pe" | "vocational";

/** What a free question is most likely about. Arts, PE and vocational books are listed only when asked by subject. */
export const CORE_SUBJECTS: readonly SubjectKey[] = ["maths", "science", "evs", "social", "english", "hindi", "sanskrit"];

const SUBJECT_NAME: Record<SubjectKey, string> = {
  maths: "Mathematics",
  science: "Science",
  evs: "The World Around Us (EVS)",
  social: "Social Science",
  english: "English",
  hindi: "Hindi",
  sanskrit: "Sanskrit",
  arts: "Arts",
  pe: "Physical Education",
  vocational: "Vocational Education",
};

/** "maths" → "Mathematics": how a school book's subject key is shown and read back by subjectKeyFor. */
export function subjectDisplayName(key: string): string {
  return (SUBJECT_NAME as Record<string, string>)[key] ?? key;
}

/** The index covers Classes 1–8; anything else (Nursery–UKG, an unknown label) is null. */
export function tutorGrade(className: string | undefined): number | null {
  const n = ` ${(className || "").toLowerCase()} `;
  if (/[^a-z](nursery|nur|play ?group|pre-?primary|lkg|ukg|kg)[^a-z]/.test(n)) return null;
  const roman: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 };
  const m = n.match(/[^a-z0-9](viii|vii|vi|iv|v|iii|ii|i|[1-8])[^a-z0-9]/);
  if (!m) return null;
  return roman[m[1]!] ?? Number(m[1]);
}

/** Nursery, LKG, UKG as the index stores them (-2, -1, 0); null for anything else. */
export function preschoolGrade(className: string | undefined): number | null {
  const n = ` ${(className || "").toLowerCase()} `;
  if (/[^a-z](nursery|nur|play ?group|pre-?nursery)[^a-z]/.test(n)) return -2;
  if (/[^a-z]lkg[^a-z]/.test(n)) return -1;
  if (/[^a-z](ukg|kg)[^a-z]/.test(n)) return 0;
  return null;
}

/** The index grade for a class label: Nursery–UKG as -2..0, Classes 1–8 as 1..8, else null. */
export function indexGrade(className: string | undefined): number | null {
  return preschoolGrade(className) ?? tutorGrade(className);
}

/**
 * A subject name — from Masters ("Hindi — Written", "Environmental Studies /
 * World Around Us"), from DIKSHA ("Physical Education And Well Being"), or
 * typed — to one key. Order matters: "Social Science" is not Science, and
 * "Health & Physical Education" is not health science.
 */
export function subjectKeyFor(label: string | undefined): SubjectKey | null {
  const s = (label || "").toLowerCase();
  if (!s.trim()) return null;
  if (/social|history|geograph|politic|civics|\bsst\b|समाज|इतिहास|भूगोल/.test(s)) return "social";
  if (/environment|world around|\bevs\b|पर्यावरण|आस-पास|अद्भुत संसार/.test(s)) return "evs";
  if (/physical|sport|yoga|खेल|शारीरिक/.test(s)) return "pe";
  if (/vocation|skill|work education|kaushal|कौशल/.test(s)) return "vocational";
  if (/\bart\b|arts|music|dance|theatre|kriti|bansuri|कला|कृति|बांसुरी/.test(s)) return "arts";
  if (/sanskrit|संस्कृत/.test(s)) return "sanskrit";
  if (/hindi|हिंदी|हिन्दी/.test(s)) return "hindi";
  if (/english|अंग्रेज़ी|अंग्रेजी/.test(s)) return "english";
  if (/math|numeracy|गणित/.test(s)) return "maths";
  if (/science|physics|chemistry|biology|विज्ञान/.test(s)) return "science";
  return null;
}

/**
 * "Chapter-7: Fractions" → "Fractions". DIKSHA's names carry their own
 * numbering in a dozen spellings ("अध्याय-15:", "Unit 1 - Chapter 2", "12 - ",
 * "10. "), and the list numbers chapters itself. A leading number that is
 * part of a title ("3D Shapes") has no separator after it and stays.
 */
export function cleanChapterName(name: string): string {
  const plain = name.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  const stripped = plain
    .replace(/^unit\s*\d{1,2}\s*[-–—:.]+\s*/i, "")
    .replace(/^(?:chapter|ch\.|lesson|पाठ|अध्याय)?\s*[-–—:.]?\s*\d{1,2}(?:\s*[-–—:.)]+\s*|\s+)/i, "")
    .trim();
  return stripped || plain;
}

/**
 * The textbook list: a header and one line per book. With a subject (the
 * homework the parent opened the tutor from, the subject a lesson plan is
 * for), only that subject's books; without one — or with a subject the index
 * has no book for — the core subjects, unless `coreFallback` is false, in
 * which case nothing.
 *
 * For each subject one medium's edition is listed (English by default: the
 * model answers in Hindi from English chapter names without trouble) and
 * the other medium's edition is named, so a title quoted from either book is
 * understood. `medium: "Hindi"` lists the Hindi-medium edition instead, for
 * a teacher writing a plan in Hindi. Hindi and Sanskrit are always listed
 * from their own books.
 */
export function textbooksListing(opts: {
  grade: number;
  books: SyllabusBook[];
  chapters: SyllabusChapter[];
  subjectLabel?: string;
  coreFallback?: boolean;
  medium?: "English" | "Hindi";
  /**
   * Whose books these are. "school" (the default since 16 Sep 2026) are the
   * books the children actually hold — Propel for Classes 1–8 at this school;
   * "ncert" is the DIKSHA index. The director's decision: the tutor and
   * lesson plans follow the school's books, and never name an NCERT book to
   * a family that owns Propel.
   */
  source?: "school" | "ncert";
}): string {
  const byKey = new Map<SubjectKey, SyllabusBook[]>();
  for (const b of opts.books) {
    const key = b.subjects.map(subjectKeyFor).find((k): k is SubjectKey => !!k);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), b]);
  }
  const chaptersOf = new Map<string, SyllabusChapter[]>();
  for (const c of opts.chapters) chaptersOf.set(c.textbookId, [...(chaptersOf.get(c.textbookId) ?? []), c]);

  const asked = subjectKeyFor(opts.subjectLabel);
  const keys =
    asked && byKey.has(asked)
      ? [asked]
      : opts.coreFallback === false
        ? []
        : CORE_SUBJECTS.filter((k) => byKey.has(k));
  const byName = (a: SyllabusBook, b: SyllabusBook) => a.name.localeCompare(b.name);
  const preferred = opts.medium ?? "English";
  const other = preferred === "English" ? "Hindi" : "English";

  const lines: string[] = [];
  for (const key of keys) {
    const books = (byKey.get(key) ?? []).slice().sort(byName);
    const ownMedium = key === "hindi" ? "Hindi" : key === "sanskrit" ? "Sanskrit" : preferred;
    let listed = books.filter((b) => b.medium === ownMedium);
    if (!listed.length) listed = books.filter((b) => b.medium === (ownMedium === "Hindi" ? "English" : "Hindi"));
    const otherEditions = key === "hindi" || key === "sanskrit" ? [] : books.filter((b) => b.medium !== listed[0]?.medium && !listed.includes(b));
    const otherLabel = listed[0]?.medium === other ? preferred : other;

    for (const [i, book] of listed.entries()) {
      const chapters = (chaptersOf.get(book.id) ?? []).slice().sort((a, b) => a.position - b.position);
      if (!chapters.length) continue;
      const note = i === listed.length - 1 && otherEditions.length ? ` (${otherLabel}-medium edition: ${otherEditions.map((b) => b.name).join(", ")})` : "";
      lines.push(`${SUBJECT_NAME[key]} — ${book.name}${note}: ${chapters.map((c) => `${c.position}. ${cleanChapterName(c.name)}`).join("; ")}`);
    }
  }
  if (!lines.length) return "";
  const header =
    (opts.source ?? "school") === "ncert"
      ? `Textbooks: the current NCERT books for Class ${opts.grade}, as listed on DIKSHA, the government's school platform.`
      : `Textbooks: the books this school's Class ${opts.grade} children use, chapter by chapter — these are the books in the child's school bag.`;
  return [header, ...lines].join("\n");
}

/** The tutor's block: the textbook list and how to use it in an answer. */
export function textbooksPromptBlock(opts: {
  grade: number;
  books: SyllabusBook[];
  chapters: SyllabusChapter[];
  subjectLabel?: string;
  source?: "school" | "ncert";
}): string {
  const listing = textbooksListing(opts);
  if (!listing) return "";
  return [
    listing,
    // The example names no real book: a Class III prompt must not mention a
    // Class VII title next to "never name a book that is not listed".
    "Using the textbooks: when a question belongs to one of these chapters, say which one as listed — book name, then \"Chapter\" and its number and name — and explain it the way that chapter does, in its words. Never name a book, chapter or chapter number that is not in this list — in particular never an NCERT book: the child does not have one. A question that fits no chapter here may still be this class's schoolwork — answer it by the level guide without naming a chapter.",
  ].join("\n");
}

// ── Pre-primary: NCERT's learning outcomes as a minimum ───────────────────

export const PRESCHOOL_GOAL_ORDER = ["Involved Learners", "Effective Communicators", "Health and Well-being"] as const;
const PRESCHOOL_YEAR = ["Nursery", "LKG", "UKG"] as const;

/**
 * Which NCF developmental goals a pre-primary subject belongs to. The
 * school's Masters names ("Early Numeracy", "Music, rhymes & movement",
 * "Socio-emotional & ethical development") do not line up one-to-one with
 * the goals, so a subject can touch two: rhymes are communication, movement
 * is well-being.
 */
export function preschoolGoalsFor(label: string | undefined): string[] {
  const s = (label || "").toLowerCase();
  const goals = new Set<string>();
  if (/numer|math|number|count|world around|environment|\bevs\b|science|shape|pattern|गणित|गिनती/.test(s)) goals.add("Involved Learners");
  if (/english|hindi|language|literacy|read|writ|oral|rhyme|story|poem|phonic|letter|\bart\b|draw|हिंदी|कविता|कहानी/.test(s)) goals.add("Effective Communicators");
  if (/socio|emotion|habit|self-help|health|physical|hygiene|movement|music|dance|yoga|sport|motor|\bart\b|draw|खेल/.test(s)) goals.add("Health and Well-being");
  return PRESCHOOL_GOAL_ORDER.filter((g) => goals.has(g));
}

/** "IL 2.9 Counts and perceives objects up to five" → "Counts and perceives objects up to five". */
export function cleanOutcomeName(name: string): string {
  const plain = name.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  const stripped = plain.replace(/^(?:HW|ECL|IL)\s*\d*\s*[-–.]?\s*\d+\s*(?:\.\s*\d+)?\s*[a-z]?\b[\s.:\-–]*/i, "").trim();
  const text = stripped || plain;
  return text.length > 100 ? `${text.slice(0, 99).replace(/\s+\S*$/, "")}…` : text;
}

/**
 * NCERT's pre-primary outcomes for one year, grouped by goal. The header says
 * what they are — the minimum, with the school's own books above it — so a
 * reader never takes the list for the syllabus. With a subject, only its
 * goals; without one, all three unless `coreFallback` is false. Each book's
 * "Key Competencies" overview is not an outcome and is left out; an outcome
 * NCERT lists twice is listed once.
 */
export function outcomesListing(opts: {
  grade: number;
  books: SyllabusBook[];
  chapters: SyllabusChapter[];
  subjectLabel?: string;
  coreFallback?: boolean;
}): string {
  const year = PRESCHOOL_YEAR[opts.grade + 2];
  if (!year) return "";
  const asked = preschoolGoalsFor(opts.subjectLabel);
  const goals = asked.length ? asked : opts.coreFallback === false ? [] : [...PRESCHOOL_GOAL_ORDER];
  const lines: string[] = [];
  for (const goal of goals) {
    const books = opts.books.filter((b) => b.subjects[0] === goal);
    const seen = new Set<string>();
    const outcomes: string[] = [];
    for (const book of books) {
      for (const c of opts.chapters.filter((x) => x.textbookId === book.id).sort((a, b) => a.position - b.position)) {
        if (/^key competenc/i.test(c.name.trim())) continue;
        const text = cleanOutcomeName(c.name);
        if (seen.has(text.toLowerCase())) continue;
        seen.add(text.toLowerCase());
        outcomes.push(text);
      }
    }
    if (outcomes.length) lines.push(`${goal}: ${outcomes.join("; ")}`);
  }
  if (!lines.length) return "";
  return [
    `NCERT's minimum for ${year} (DIKSHA Preschool ${opts.grade + 3}), from NCERT's pre-primary competency books. The school teaches pre-primary from its own publisher books, which go further than this.`,
    ...lines,
  ].join("\n");
}

/** The tutor's pre-primary block: the outcomes and how to use them in an answer. */
export function outcomesPromptBlock(opts: { grade: number; books: SyllabusBook[]; chapters: SyllabusChapter[]; subjectLabel?: string }): string {
  const listing = outcomesListing(opts);
  if (!listing) return "";
  return [
    listing,
    "Using NCERT's minimum: it is what NCERT expects by the end of the year, not a ceiling — the child's own book may ask for more, and that is fine. When a question touches one of these, say in plain words what the child is working towards and suggest short play-based practice at home (everyday objects, songs, drawing, games). Never quote outcome codes, and never name an NCERT book or chapter: pre-primary has none.",
  ].join("\n");
}

