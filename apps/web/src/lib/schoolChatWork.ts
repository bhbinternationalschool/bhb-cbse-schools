/**
 * School chat work cards — the shapes and pure helpers (no I/O). The server
 * side is lib/schoolChatWork.server.ts.
 */

export type WorkKind = "homework" | "classwork";

/** What a chat card shows. Never the reference answer (teachers only). */
export type WorkCard = {
  kind: WorkKind;
  /** The homework post / diary entry id. */
  refId: string;
  subjectId: string;
  subject: string;
  title: string;
  body: string;
  bodyHi: string;
  /** Homework: due date ("" = none). */
  dueAt: string;
  /** The day it is for. */
  date: string;
  attachments: { id: string; label: string; kind: string; url: string }[];
  teacherStaffId: string;
  teacherName: string;
};

export type WorkItem = { card: WorkCard; classId: string; sectionId: string; createdAt: string };

/** The cards one group shows: a class group — all of its section's; a subject group — that subject's homework. */
export function workForGroup(items: WorkItem[], g: { kind: string; classId: string; sectionId: string; subjectId: string }): WorkItem[] {
  return items.filter(
    (i) =>
      i.classId === g.classId &&
      i.sectionId === g.sectionId &&
      (g.kind === "class" || (g.kind === "subject" && i.card.kind === "homework" && i.card.subjectId === g.subjectId)),
  );
}

/** The one-line text a card stands for (list preview; older apps show it as the message). */
export function cardText(c: WorkCard): string {
  const head = c.kind === "homework" ? `Homework${c.subject ? ` · ${c.subject}` : ""}` : "Classwork";
  const due = c.dueAt ? ` (due ${c.dueAt})` : "";
  const files = c.attachments.length ? ` · ${c.attachments.length} file${c.attachments.length === 1 ? "" : "s"}` : "";
  const body = c.body.trim() ? `\n${c.body.trim()}` : "";
  return `${head}: ${c.title}${due}${files}${body}`.slice(0, 2000);
}

