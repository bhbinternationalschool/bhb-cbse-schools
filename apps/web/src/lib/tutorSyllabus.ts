/**
 * The child's NCERT textbooks, as a short table of contents for the tutor's
 * prompt. Pure: the server loads books and chapters from the DIKSHA chapter
 * index (tables diksha_textbooks / diksha_chapters) and this file decides
 * which of them the prompt carries and how they read.
 *
 * Why: the tutor was told "follow NCERT" and had never seen a chapter list.
 * With it, an answer can say "Ganita Prakash, Chapter 7" and use the book's
 * own words, instead of a guess at which edition the child holds.
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

/** The index covers Classes 1–8; anything else (Nursery–UKG, an unknown label) is null. */
export function tutorGrade(className: string | undefined): number | null {
  const n = ` ${(className || "").toLowerCase()} `;
  if (/[^a-z](nursery|nur|play ?group|pre-?primary|lkg|ukg|kg)[^a-z]/.test(n)) return null;
  const roman: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 };
  const m = n.match(/[^a-z0-9](viii|vii|vi|iv|v|iii|ii|i|[1-8])[^a-z0-9]/);
  if (!m) return null;
  return roman[m[1]!] ?? Number(m[1]);
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
 * The prompt block. With a subject (the homework the parent opened the tutor
 * from), only that subject's books; without one, the core subjects. For each
 * subject the English-medium edition is listed — the model answers in Hindi
 * from English chapter names without trouble — and the Hindi edition is
 * named so a parent quoting its title is understood. Hindi and Sanskrit are
 * listed from their own books.
 */
export function textbooksPromptBlock(opts: {
  grade: number;
  books: SyllabusBook[];
  chapters: SyllabusChapter[];
  subjectLabel?: string;
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
  const keys = asked && byKey.has(asked) ? [asked] : CORE_SUBJECTS.filter((k) => byKey.has(k));
  const byName = (a: SyllabusBook, b: SyllabusBook) => a.name.localeCompare(b.name);

  const lines: string[] = [];
  for (const key of keys) {
    const books = (byKey.get(key) ?? []).slice().sort(byName);
    const ownMedium = key === "hindi" ? "Hindi" : key === "sanskrit" ? "Sanskrit" : "English";
    let listed = books.filter((b) => b.medium === ownMedium);
    if (!listed.length) listed = books.filter((b) => b.medium === "Hindi");
    const hindiEditions = key === "hindi" || key === "sanskrit" ? [] : books.filter((b) => b.medium === "Hindi" && !listed.includes(b));

    for (const [i, book] of listed.entries()) {
      const chapters = (chaptersOf.get(book.id) ?? []).slice().sort((a, b) => a.position - b.position);
      if (!chapters.length) continue;
      const hindiNote = i === listed.length - 1 && hindiEditions.length ? ` (Hindi-medium edition: ${hindiEditions.map((b) => b.name).join(", ")})` : "";
      lines.push(`${SUBJECT_NAME[key]} — ${book.name}${hindiNote}: ${chapters.map((c) => `${c.position}. ${cleanChapterName(c.name)}`).join("; ")}`);
    }
  }
  if (!lines.length) return "";

  return [
    `Textbooks: the current NCERT books for Class ${opts.grade}, as listed on DIKSHA, the government's school platform.`,
    ...lines,
    // The example names no real book: a Class III prompt must not mention a
    // Class VII title next to "never name a book that is not listed".
    "Using the textbooks: when a question belongs to one of these chapters, say which one as listed — book name, then \"Chapter\" and its number and name — and explain it the way that chapter does, in its words. Never name a book, chapter or chapter number that is not in this list. A question that fits no chapter here may still be this class's schoolwork — answer it by the level guide without naming a chapter.",
  ].join("\n");
}
