import "server-only";

/**
 * Which of the school's own books covers this class and subject, and what is
 * in it. See syllabusFromBooks.ts for why this bridge exists.
 *
 * It reads school_textbooks directly rather than through
 * `schoolBooksForClass`, which serves the AI tutor and deliberately stops at
 * Class 1: Nursery–UKG are taught from NCERT's competencies there, not from
 * a chapter list. The office's syllabus is the other way round — the school's
 * pre-primary books ARE loaded (grades -2, -1, 0 — twelve of them) and the
 * desk should show them.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import { cleanChapterName, indexGrade, subjectDisplayName, subjectKeyFor } from "@/lib/tutorSyllabus";
import { toImportChapters, type BookChapter } from "@/lib/syllabusFromBooks";
import type { SyllabusImportChapter } from "@/lib/teaching";

export type BooksForSubject = {
  /** The book as the shelf names it, so the screen can say where this came from. */
  book: string | null;
  chapters: SyllabusImportChapter[];
  /** Why there is nothing — in words the office can act on, never a blank. */
  reason?: string;
};

export async function syllabusChaptersFromBooks(opts: {
  className: string;
  subjectName: string;
}): Promise<BooksForSubject> {
  const grade = indexGrade(opts.className);
  if (grade === null) {
    return { book: null, chapters: [], reason: `No books are held for ${opts.className}` };
  }
  const key = subjectKeyFor(opts.subjectName);
  if (!key) {
    return { book: null, chapters: [], reason: `No book is mapped to "${opts.subjectName}"` };
  }

  const tenant = await getServerTenantContext();
  if (!tenant) return { book: null, chapters: [], reason: "The school server is not reachable" };
  const { sb, tenantId } = tenant;

  const { data, error } = await sb
    .from("school_textbooks")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("grade", grade)
    .eq("subject_key", key)
    .is("retired_at", null)
    .order("id", { ascending: true });
  if (error) {
    // Unreadable is not empty: say so rather than offer an empty syllabus.
    console.warn("[syllabus-from-books] books unreadable", error.message);
    return { book: null, chapters: [], reason: "Could not read the school's books just now" };
  }
  const book = (data ?? [])[0] as { id: string; name: string } | undefined;
  if (!book) {
    return {
      book: null,
      chapters: [],
      reason: `The shelf has no ${subjectDisplayName(key)} book for ${opts.className}`,
    };
  }

  // A book has tens of chapters, but the 1,000-row cap has bitten this
  // codebase before, so this pages like everything else.
  const read = await fetchAllPages<{ position: number; name: string; topics: string[] | null }>((from, to) =>
    sb
      .from("school_textbook_chapters")
      .select("position, name, topics")
      .eq("tenant_id", tenantId)
      .eq("textbook_id", book.id)
      .order("position", { ascending: true })
      .range(from, to),
  );
  if (read.error) {
    console.warn("[syllabus-from-books] chapters unreadable", read.error);
    return { book: book.name, chapters: [], reason: "Could not read that book's chapters just now" };
  }
  const own: BookChapter[] = read.rows.map((c) => ({
    position: Number(c.position),
    name: cleanChapterName(c.name),
    topics: Array.isArray(c.topics) ? c.topics : [],
  }));
  if (!own.length) {
    return { book: book.name, chapters: [], reason: `${book.name} has no chapters loaded yet` };
  }
  return { book: book.name, chapters: toImportChapters(own) };
}
