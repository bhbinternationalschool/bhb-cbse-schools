/**
 * The tutor's textbook block, loaded from the DIKSHA chapter index
 * (migration 20260916140000; filled weekly by /api/curriculum/diksha-index/tick).
 * Rules for what the block says: tutorSyllabus.ts.
 *
 * Cached per class for a few hours: the index changes weekly and a parent's
 * conversation asks many times. A class the index has nothing for is cached
 * briefly, so the first sync after a deploy is picked up within minutes.
 * Any failure gives an empty block — the tutor answers as it did before the
 * index existed rather than not at all.
 */
import "server-only";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import {
  textbooksPromptBlock,
  tutorGrade,
  type SyllabusBook,
  type SyllabusChapter,
} from "@/lib/tutorSyllabus";

const FILLED_TTL_MS = 6 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 10 * 60 * 1000;

type ClassTextbooks = { books: SyllabusBook[]; chapters: SyllabusChapter[] };
const cache = new Map<number, { at: number; value: ClassTextbooks }>();

export async function tutorTextbooksBlock(ctx: { className?: string; subjectLabel?: string }): Promise<string> {
  const grade = tutorGrade(ctx.className);
  if (!grade) return "";
  try {
    const value = await classTextbooks(grade);
    return textbooksPromptBlock({ grade, books: value.books, chapters: value.chapters, subjectLabel: ctx.subjectLabel });
  } catch (e) {
    console.warn("[tutor-textbooks] no textbook list for the prompt:", e instanceof Error ? e.message : e);
    return "";
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
