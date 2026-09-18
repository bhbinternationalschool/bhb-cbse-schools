import "server-only";

/**
 * Short homework → the message parents read. The side that loads things.
 *
 * The pure half (homeworkExpand.ts) decides everything that can be decided
 * without I/O. This file does three things around it: fetch the class's own
 * books, ask the model to write the message from the resolved facts, and
 * fall back to the plain rendering when there is no model, no budget, or a
 * draft that named a chapter nobody gave it.
 *
 * It saves nothing and sends nothing. What comes back is a draft for the
 * teacher to confirm — a homework message goes to every parent in the
 * section, and no model gets to do that unseen.
 */

import { TENANT } from "@/lib/types";
import { cleanChapterName, subjectDisplayName, subjectKeyFor } from "@/lib/tutorSyllabus";
import { schoolBooksForClass } from "@/lib/tutorSyllabus.server";
import {
  formatDueLabel,
  homeworkExpandFacts,
  parseHomeworkReference,
  renderHomeworkExpansion,
  resolutionNoteForTeacher,
  resolveHomeworkChapter,
  type BookFact,
  type HomeworkExpandFacts,
  type HomeworkExpansion,
  type HomeworkResolution,
} from "@/lib/homeworkExpand";

export type HomeworkExpandResult = {
  title: string;
  bodyEn: string;
  bodyHi: string;
  /** What the resolver decided, for the teacher's preview and the caller's log. */
  resolution: HomeworkResolution;
  /** One line to show the teacher when the reference did not resolve; "" when it did. */
  note: string;
  /** "Ch 6 — Multiples and Factors", for the post's aiTutorHint so the tutor opens on the right chapter. */
  chapterHint: string;
  facts: HomeworkExpandFacts;
  /** False when the plain rendering was used — no model, no budget, or a refused draft. */
  usedAi: boolean;
};

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * The books for one class and subject, as the resolver wants them.
 *
 * Filtered by subject before the resolver sees them, because "ch 5" means
 * chapter 5 OF THIS SUBJECT'S book; handing it every book of the class
 * would make every reference ambiguous. A subject label the mapping does
 * not recognise yields no books, and the message then names none.
 */
async function booksFor(className: string, subjectLabel: string): Promise<BookFact[]> {
  const key = subjectKeyFor(subjectLabel);
  if (!key) return [];
  const wanted = subjectDisplayName(key);
  const { books, chapters } = await schoolBooksForClass(className);
  return books
    .filter((b) => b.subjects.includes(wanted))
    .map((b) => ({
      name: b.name,
      chapters: chapters
        .filter((c) => c.textbookId === b.id)
        .map((c) => ({ position: c.position, name: cleanChapterName(c.name), topics: c.topics ?? [] }))
        .sort((x, y) => x.position - y.position),
    }));
}

export async function expandHomeworkForParents(input: {
  classLabel: string;
  /** The class as the books are indexed by — "Class 5", "5A" both work. */
  className: string;
  subjectLabel: string;
  /** What the teacher typed, without the class/subject prefix. */
  teacherText: string;
  dueAt?: string;
}): Promise<HomeworkExpandResult> {
  const reference = parseHomeworkReference(input.teacherText);

  let books: BookFact[] = [];
  try {
    books = await booksFor(input.className, input.subjectLabel);
  } catch (e) {
    console.warn("[homework-expand] books unavailable", e instanceof Error ? e.message : e);
  }
  const resolution = resolveHomeworkChapter({ books, reference });

  const facts = homeworkExpandFacts({
    classLabel: input.classLabel,
    subjectLabel: input.subjectLabel,
    teacherText: input.teacherText,
    dueLabel: formatDueLabel(input.dueAt || "", todayIso()),
    reference,
    resolution,
  });

  const plain = renderHomeworkExpansion(facts);
  let written: HomeworkExpansion = plain;
  let usedAi = false;
  try {
    const { expandHomeworkJson } = await import("@/lib/aiLlm.server");
    const r = await expandHomeworkJson({ facts, schoolName: TENANT.nameDisplay });
    if (r.ok) {
      written = r.draft;
      usedAi = true;
    } else {
      // Not an error worth failing the post for: the plain rendering already
      // says the book, the chapter and the work.
      console.warn("[homework-expand] written by hand instead:", r.error);
    }
  } catch (e) {
    console.warn("[homework-expand] AI unavailable", e instanceof Error ? e.message : e);
  }

  return {
    title: written.title || plain.title,
    bodyEn: written.bodyEn,
    bodyHi: written.bodyHi,
    resolution,
    note: resolutionNoteForTeacher(resolution, reference),
    chapterHint:
      resolution.kind === "chapter" ? `Ch ${resolution.chapter.position} — ${resolution.chapter.name}` : "",
    facts,
    usedAi,
  };
}
