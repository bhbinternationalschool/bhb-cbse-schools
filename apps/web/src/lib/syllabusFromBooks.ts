/**
 * The school's own books, turned into a syllabus the desk can show.
 *
 * WHY (19 Sep 2026, the director): "why in our ERP subject's syllabus,
 * chapters and topics are not seen". They were not seen because they were
 * never in the store that screen reads. The books loaded over 17–18 Sep —
 * 68 of them, 1,538 chapters, 5,558 topics — sit in school_textbooks, which
 * only the AI reads: the tutor, lesson plans, homework and the exam drill.
 * The Syllabus tab reads teaching_state.units, which a teacher fills by
 * photographing the printed syllabus, and which was completely empty.
 *
 * So the tutor could quote a child chapter 6 of their own EVS book at ten at
 * night while the desk showed the office nothing. This is the bridge: the
 * chapters are already shaped the way syllabus units want them — a number, a
 * name, and the topics inside.
 *
 * It only ever PROPOSES. The import on the other side skips what is already
 * in the plan, so nothing a teacher typed is overwritten by a book.
 */

import type { SyllabusImportChapter } from "@/lib/teaching";

export type BookChapter = {
  /** The chapter's number in its own book. */
  position: number;
  name: string;
  topics: string[];
};

/**
 * Book chapters → the import shape, in the book's own order.
 *
 * `plannedPeriods` is deliberately NOT set. How many periods a chapter takes
 * is the teacher's judgement about their own class; a number invented here
 * would be read as the school's plan and quietly become one.
 */
export function toImportChapters(chapters: BookChapter[]): SyllabusImportChapter[] {
  const seen = new Set<string>();
  return [...chapters]
    .sort((a, b) => a.position - b.position)
    .flatMap((c) => {
      const title = (c.name || "").replace(/\s+/g, " ").trim();
      if (!title) return [];
      const key = title.toLowerCase();
      // The same chapter twice in one book is a loading mistake, not two
      // chapters; importing both would put two identical rows on the screen.
      if (seen.has(key)) return [];
      seen.add(key);
      const topics = dedupeTopics(c.topics);
      return [
        {
          code: c.position > 0 ? String(c.position) : undefined,
          title,
          ...(topics.length ? { topics: topics.map((t) => ({ title: t })) } : {}),
        },
      ];
    });
}

function dedupeTopics(topics: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of topics ?? []) {
    const t = String(raw || "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
