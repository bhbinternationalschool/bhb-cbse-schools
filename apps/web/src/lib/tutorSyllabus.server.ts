/**
 * The textbook block for the tutor and for lesson plans.
 *
 * Classes 1–8 — the SCHOOL's own books (tables school_textbooks /
 * school_textbook_chapters; Propel at this school). Director's decision,
 * 16 Sep 2026: the tutor and lesson plans follow the books the children hold.
 * Until 16 Sep these came from the DIKSHA index of NCERT books, which named
 * "Ganita Prakash, Chapter 2" to families who own Propel Maths. When the
 * school's book for a class is not loaded yet, NO book and NO chapter is
 * named — never NCERT's in its place.
 *
 * Nursery–UKG — unchanged: NCERT's pre-primary learning outcomes from the
 * DIKSHA index, as a minimum (#240).
 *
 * Cached per class for a few hours; a class with nothing loaded is cached
 * briefly so a newly entered book is picked up within minutes. Any failure
 * gives an empty block — the tutor answers without a book rather than not
 * at all.
 */
import "server-only";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import {
  indexGrade,
  subjectDisplayName,
  outcomesListing,
  outcomesPromptBlock,
  textbooksListing,
  textbooksPromptBlock,
  type SyllabusBook,
  type SyllabusChapter,
} from "@/lib/tutorSyllabus";

const FILLED_TTL_MS = 6 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 10 * 60 * 1000;

type ClassTextbooks = { books: SyllabusBook[]; chapters: SyllabusChapter[] };
const cache = new Map<number, { at: number; value: ClassTextbooks }>();

export async function tutorTextbooksBlock(ctx: { className?: string; subjectLabel?: string }): Promise<string> {
  const grade = indexGrade(ctx.className);
  if (grade === null) return "";
  try {
    if (grade <= 0) {
      // Nursery–UKG: NCERT's learning outcomes as a minimum (#240).
      const value = await classTextbooks(grade);
      return outcomesPromptBlock({ grade, books: value.books, chapters: value.chapters, subjectLabel: ctx.subjectLabel });
    }
    // Classes 1–8: the school's own books, or nothing.
    const school = await schoolClassTextbooks(grade);
    return textbooksPromptBlock({
      grade,
      books: school.books,
      chapters: school.chapters,
      subjectLabel: ctx.subjectLabel,
      source: "school",
    });
  } catch (e) {
    console.warn("[tutor-textbooks] no textbook list for the prompt:", e instanceof Error ? e.message : e);
    return "";
  }
}

/**
 * The bare list for another AI feature (lesson plans): `kind` "chapters" for
 * Classes 1–8 — the SCHOOL's books, never NCERT's — "outcomes" for
 * Nursery–UKG (NCERT's minimum), "none" with empty text when nothing is
 * loaded for the class or the read fails. (The name predates the switch to
 * the school's books; kept so the lesson-plan route's contract is unchanged.)
 */
export async function ncertTextbooksListing(ctx: {
  className?: string;
  subjectLabel?: string;
  coreFallback?: boolean;
  medium?: "English" | "Hindi";
}): Promise<{ text: string; kind: "chapters" | "outcomes" | "none" }> {
  const grade = indexGrade(ctx.className);
  if (grade === null) return { text: "", kind: "none" };
  try {
    if (grade <= 0) {
      const value = await classTextbooks(grade);
      const text = outcomesListing({ grade, books: value.books, chapters: value.chapters, subjectLabel: ctx.subjectLabel, coreFallback: ctx.coreFallback });
      return { text, kind: text ? "outcomes" : "none" };
    }
    // Classes 1–8: the school's own books (Propel), never NCERT's.
    const school = await schoolClassTextbooks(grade);
    const text = textbooksListing({
      grade,
      books: school.books,
      chapters: school.chapters,
      subjectLabel: ctx.subjectLabel,
      coreFallback: ctx.coreFallback,
      medium: ctx.medium,
      source: "school",
    });
    return { text, kind: text ? "chapters" : "none" };
  } catch (e) {
    console.warn("[ncert-textbooks] no textbook list:", e instanceof Error ? e.message : e);
    return { text: "", kind: "none" };
  }
}

async function classTextbooks(grade: number): Promise<ClassTextbooks> {
  const hit = cache.get(grade);
  if (hit && Date.now() - hit.at < (hit.value.books.length ? FILLED_TTL_MS : EMPTY_TTL_MS)) return hit.value;

  const tenant = await getServerTenantContext();
  if (!tenant) throw new Error("no database");
  const { sb, tenantId } = tenant;

  const books = await fetchAllPages<{ id: string; medium: string; subjects: string[] | null; name: string }>((from, to) =>
    sb
      .from("diksha_textbooks")
      .select("id, medium, subjects, name")
      .eq("tenant_id", tenantId)
      .eq("grade", grade)
      .is("retired_at", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (books.error) throw new Error(`diksha_textbooks: ${books.error}`);

  let chapters: SyllabusChapter[] = [];
  if (books.rows.length) {
    const read = await fetchAllPages<{ id: string; textbook_id: string; position: number; name: string }>((from, to) =>
      sb
        .from("diksha_chapters")
        .select("id, textbook_id, position, name")
        .eq("tenant_id", tenantId)
        .in(
          "textbook_id",
          books.rows.map((b) => b.id),
        )
        .order("id", { ascending: true })
        .range(from, to),
    );
    if (read.error) throw new Error(`diksha_chapters: ${read.error}`);
    chapters = read.rows.map((c) => ({ textbookId: c.textbook_id, position: Number(c.position), name: c.name }));
  }

  const value: ClassTextbooks = {
    books: books.rows.map((b) => ({ id: b.id, medium: b.medium, subjects: b.subjects ?? [], name: b.name })),
    chapters,
  };
  cache.set(grade, { at: Date.now(), value });
  return value;
}

const schoolCache = new Map<number, { at: number; value: ClassTextbooks }>();

/**
 * The school's own books for one class, shaped like the DIKSHA read so the
 * same listing builds from either. A book's subject is carried as its
 * display name ("Mathematics"), which subjectKeyFor reads back.
 */
/**
 * The school's own books and chapters for a class, as rows rather than a
 * prompt block — for callers that need to look a chapter UP rather than
 * describe the list to a model (homeworkExpand.server.ts). Same cache, same
 * rule: Classes 1–8 only, and an empty result when nothing is loaded.
 */
export async function schoolBooksForClass(className: string | undefined): Promise<{ books: SyllabusBook[]; chapters: SyllabusChapter[] }> {
  const grade = indexGrade(className);
  if (grade === null || grade <= 0) return { books: [], chapters: [] };
  try {
    return await schoolClassTextbooks(grade);
  } catch (e) {
    console.warn("[tutor-textbooks] school books unavailable:", e instanceof Error ? e.message : e);
    return { books: [], chapters: [] };
  }
}

async function schoolClassTextbooks(grade: number): Promise<ClassTextbooks> {
  const hit = schoolCache.get(grade);
  if (hit && Date.now() - hit.at < (hit.value.books.length ? FILLED_TTL_MS : EMPTY_TTL_MS)) return hit.value;

  const tenant = await getServerTenantContext();
  if (!tenant) throw new Error("no database");
  const { sb, tenantId } = tenant;

  const { data: bookRows, error: bookError } = await sb
    .from("school_textbooks")
    .select("id, medium, subject_key, name")
    .eq("tenant_id", tenantId)
    .eq("grade", grade)
    .is("retired_at", null)
    .order("id", { ascending: true });
  if (bookError) throw new Error(`school_textbooks: ${bookError.message}`);
  const books = (bookRows ?? []) as { id: string; medium: string; subject_key: string; name: string }[];

  let chapters: SyllabusChapter[] = [];
  if (books.length) {
    // A class has a handful of books and at most a few hundred chapters —
    // paged anyway, because the 1,000-row cap has bitten this codebase before.
    const read = await fetchAllPages<{ textbook_id: string; position: number; name: string; topics: string[] | null }>((from, to) =>
      sb
        .from("school_textbook_chapters")
        .select("textbook_id, position, name, topics")
        .eq("tenant_id", tenantId)
        .in(
          "textbook_id",
          books.map((b) => b.id),
        )
        .order("textbook_id", { ascending: true })
        .order("position", { ascending: true })
        .range(from, to),
    );
    if (read.error) throw new Error(`school_textbook_chapters: ${read.error}`);
    chapters = read.rows.map((c) => ({
      textbookId: c.textbook_id,
      position: Number(c.position),
      name: c.name,
      topics: Array.isArray(c.topics) ? c.topics : [],
    }));
  }

  const value: ClassTextbooks = {
    books: books.map((b) => ({
      id: b.id,
      medium: b.medium,
      subjects: [subjectDisplayName(b.subject_key)],
      name: b.name,
    })),
    chapters,
  };
  schoolCache.set(grade, { at: Date.now(), value });
  return value;
}
