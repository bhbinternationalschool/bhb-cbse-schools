/**
 * Load the school's own textbooks (Propel) — book by book, chapter by
 * chapter — into school_textbooks / school_textbook_chapters. The AI tutor
 * and AI lesson plans read these for Classes 1–8 (tutorSyllabus.server.ts).
 *
 *   npx tsx scripts/import-school-textbooks.mts books.json            # dry run
 *   ALLOW_LOCAL_PROD_WRITES=1 npx tsx scripts/import-school-textbooks.mts books.json --apply
 *
 * SOURCE: each book's printed contents page, typed into a JSON file. The
 * e-book shelf is password-protected, so nothing is scraped; a person copies
 * the contents page and this script checks it before anything is written.
 *
 * books.json — an array, one entry per book:
 *   {
 *     "grade": 4,                          // 1..8 (Nursery -2, LKG -1, UKG 0)
 *     "subject": "maths",                  // maths science evs social english hindi sanskrit arts pe vocational
 *     "name": "Propel New Prime Mathematics 4",
 *     "series": "Propel New Prime",        // optional
 *     "publisher": "Propel",               // optional, default "Propel"
 *     "medium": "English",                 // optional; Hindi/Sanskrit books default to their own language
 *     "edition": "2025",                   // optional
 *     "chapters": [
 *       "Large Numbers",                   // position = order in the list
 *       { "name": "Fractions", "exams": ["HY"], "topics": ["Like fractions", "Equivalent fractions"] }
 *                                          // exams: which papers set it; topics: short
 *                                          // topic NAMES only, never the book's text
 *     ]
 *   }
 *
 * SAFE TO RE-RUN: a book's id is derived from grade + subject + name, and
 * each book is replaced in ONE database transaction (school_replace_textbook)
 * — its chapter list is swapped whole or not at all. A book left out of the
 * file is left alone; nothing here ever deletes a book.
 */

import { readFileSync } from "node:fs";

import { getServerTenantContext } from "../src/lib/serverTenant";

const APPLY = process.argv.includes("--apply");
const file = process.argv.slice(2).find((a) => !a.startsWith("--"));

const SUBJECTS = ["maths", "science", "evs", "social", "english", "hindi", "sanskrit", "arts", "pe", "vocational"];

type ChapterIn = string | { name: string; exams?: string[]; topics?: string[] };
type BookIn = {
  grade: number;
  subject: string;
  name: string;
  series?: string;
  publisher?: string;
  medium?: string;
  edition?: string;
  notes?: string;
  chapters: ChapterIn[];
};

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function check(books: unknown): { ok: BookIn[]; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(books)) return { ok: [], errors: ["the file must hold an array of books"] };
  const ids = new Set<string>();
  const ok: BookIn[] = [];
  books.forEach((b: BookIn, i) => {
    const where = `book ${i + 1}${b?.name ? ` (${b.name})` : ""}`;
    const before = errors.length;
    if (!Number.isInteger(b?.grade) || b.grade < -2 || b.grade > 12) errors.push(`${where}: grade must be a whole number, Nursery -2 … Class 12`);
    if (!SUBJECTS.includes(b?.subject)) errors.push(`${where}: subject "${b?.subject}" is not one of ${SUBJECTS.join(", ")}`);
    if (!b?.name?.trim()) errors.push(`${where}: name is required`);
    if (!Array.isArray(b?.chapters) || !b.chapters.length) errors.push(`${where}: no chapters — a book is never loaded empty`);
    (b?.chapters ?? []).forEach((c, j) => {
      const name = typeof c === "string" ? c : c?.name;
      if (!name?.trim()) errors.push(`${where}: chapter ${j + 1} has no name`);
    });
    if (errors.length > before) return;
    const id = `sb-g${b.grade}-${b.subject}-${slug(b.name)}`;
    if (ids.has(id)) {
      errors.push(`${where}: listed twice in the file`);
      return;
    }
    ids.add(id);
    ok.push(b);
  });
  return { ok, errors };
}

if (!file) {
  console.error("usage: npx tsx scripts/import-school-textbooks.mts books.json [--apply]");
  process.exit(2);
}

const { ok: books, errors } = check(JSON.parse(readFileSync(file, "utf8")));
if (errors.length) {
  console.error(`Not loaded — fix these first:\n  ${errors.join("\n  ")}`);
  process.exit(1);
}

const tenant = APPLY ? await getServerTenantContext() : null;
if (APPLY && !tenant) {
  console.error("No database connection (Supabase env missing).");
  process.exit(1);
}

let total = 0;
for (const b of books) {
  const id = `sb-g${b.grade}-${b.subject}-${slug(b.name)}`;
  const medium = b.medium ?? (b.subject === "hindi" ? "Hindi" : b.subject === "sanskrit" ? "Sanskrit" : "English");
  const chapters = b.chapters.map((c, i) => ({
    position: i + 1,
    name: (typeof c === "string" ? c : c.name).replace(/\s+/g, " ").trim(),
    exam_term_codes: typeof c === "string" ? [] : (c.exams ?? []).map((e) => e.trim().toUpperCase()).filter(Boolean),
    topics: typeof c === "string" ? [] : (c.topics ?? []).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean),
  }));
  const examined = chapters.filter((c) => c.exam_term_codes.length).length;
  const topics = chapters.reduce((n, c) => n + c.topics.length, 0);
  console.log(
    `Class ${b.grade} ${b.subject.padEnd(10)} ${b.name} — ${chapters.length} chapters${topics ? `, ${topics} topics` : ""}${examined ? `, ${examined} marked for exams` : ""}`,
  );

  if (!APPLY || !tenant) continue;
  const { data, error } = await tenant.sb.rpc("school_replace_textbook", {
    p_tenant_id: tenant.tenantId,
    p_book: {
      id,
      grade: b.grade,
      subject_key: b.subject,
      name: b.name.trim(),
      publisher: b.publisher ?? "Propel",
      series: b.series ?? "",
      medium,
      edition: b.edition ?? "",
      notes: b.notes ?? "",
    },
    p_chapters: chapters,
  });
  if (error) {
    console.error(`  FAILED: ${error.message} — this book is unchanged`);
    process.exitCode = 1;
    continue;
  }
  total += Number(data ?? 0);
}

console.log(
  APPLY
    ? `\nLoaded ${total} chapters. The tutor picks them up within 10 minutes (a class that had no books) or on the next deploy.`
    : `\nDry run — ${books.length} books checked, nothing written. Add --apply to load them.`,
);
