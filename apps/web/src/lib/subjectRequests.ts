/**
 * Teachers ask, the office approves (director, 10 Oct 2026): a teacher
 * cannot change what a class studies — one subject list feeds the
 * timetable, homework, marks, report cards, exam papers and UDISE — but they
 * know first when it is wrong. From the staff app they ask to add a subject
 * to a class, remove one, or have a new one created; nothing changes until
 * the principal or office approves it in Masters → Subjects. Pure.
 */

import { newFoundationId, type ClassSubjectLink, type Subject } from "@/lib/foundationMasters";
import { classGroupCodeForName, type SchoolClass } from "@/lib/masters";
import { CLASS_GROUP_TO_NEP, classLinkIdsToRemove, emptySubjectDraft, subjectDraftError, subjectFromDraft, type SubjectsSlice } from "@/lib/subjectMasters";
import { suggestedPeriodsPerWeek } from "@/lib/nepSubjectSuggestions";

export type SubjectRequestAction = "add" | "remove" | "new";
export type SubjectRequestStatus = "pending" | "approved" | "rejected" | "withdrawn";

export type SubjectRequest = {
  id: string;
  staffId: string;
  staffName: string;
  classId: string;
  className: string;
  action: SubjectRequestAction;
  /** add / remove: the school subject. "" for new. */
  subjectId: string;
  /** What the teacher saw or typed (kept even if the subject is renamed later). */
  subjectName: string;
  reason: string;
  status: SubjectRequestStatus;
  decidedBy: string;
  decidedAt: string;
  decisionNote: string;
  createdAt: string;
};

export type NewSubjectRequestInput = {
  classId: string;
  action: SubjectRequestAction;
  subjectId?: string;
  subjectName?: string;
  reason?: string;
};

const clean = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Why a teacher's request cannot be filed, or null. Checked against Masters as they stand. */
export function subjectRequestError(
  slice: SubjectsSlice,
  input: NewSubjectRequestInput,
  opts: { allowedClassIds: Set<string> | "all"; pending: SubjectRequest[] },
): string | null {
  const cls = slice.classes.find((c) => c.id === input.classId);
  if (!cls) return "That class no longer exists.";
  if (opts.allowedClassIds !== "all" && !opts.allowedClassIds.has(cls.id)) {
    return "You can only ask for changes to classes you teach.";
  }
  const linked = new Set(slice.classSubjects.filter((l) => l.isActive && l.classId === cls.id).map((l) => l.subjectId));
  if (input.action === "new") {
    const name = clean(input.subjectName, 80);
    if (name.length < 2) return "Write the name of the subject.";
    const same = slice.subjects.find((s) => s.nameEn.trim().toLowerCase() === name.toLowerCase());
    if (same) return linked.has(same.id) ? `${cls.name} already studies ${same.nameEn}.` : `${same.nameEn} is already a school subject — choose it from the list instead.`;
  } else {
    const sub = slice.subjects.find((s) => s.id === input.subjectId);
    if (!sub) return "That subject no longer exists.";
    if (input.action === "add") {
      if (!sub.isActive) return `${sub.nameEn} is switched off for the school — ask the office.`;
      if (linked.has(sub.id)) return `${cls.name} already studies ${sub.nameEn}.`;
    } else if (!linked.has(sub.id)) {
      return `${cls.name} does not study ${sub.nameEn}.`;
    }
  }
  const dup = opts.pending.find(
    (r) =>
      r.status === "pending" &&
      r.classId === cls.id &&
      r.action === input.action &&
      (input.action === "new"
        ? r.subjectName.toLowerCase() === clean(input.subjectName, 80).toLowerCase()
        : r.subjectId === input.subjectId),
  );
  if (dup) return `This is already waiting for the office (asked by ${dup.staffName}).`;
  return null;
}

function stageOf(c: SchoolClass) {
  return CLASS_GROUP_TO_NEP[c.groupCode ?? classGroupCodeForName(c.name)];
}

export type ApplyResult =
  | { ok: true; subjects: Subject[]; classSubjects: ClassSubjectLink[]; summary: string }
  | { ok: false; error: string };

/**
 * What approving does to Masters. "new" needs the code the office chose
 * (codes are unique school-wide; marks and report cards find a subject by
 * it). Re-checked here: Masters may have changed since the request.
 */
export function applySubjectRequest(slice: SubjectsSlice, req: SubjectRequest, opts: { newCode?: string } = {}): ApplyResult {
  const cls = slice.classes.find((c) => c.id === req.classId);
  if (!cls) return { ok: false, error: "That class no longer exists." };
  const active = (id: string) => slice.classSubjects.some((l) => l.isActive && l.classId === cls.id && l.subjectId === id);
  const link = (s: Subject): ClassSubjectLink => ({
    id: newFoundationId("csub"),
    classId: cls.id,
    subjectId: s.id,
    periodsPerWeek: suggestedPeriodsPerWeek(stageOf(cls), s.code, s.category),
    isActive: true,
    isOptional: !!s.isElective,
  });

  if (req.action === "remove") {
    const sub = slice.subjects.find((s) => s.id === req.subjectId);
    if (!sub) return { ok: false, error: "That subject no longer exists." };
    const ids = new Set(classLinkIdsToRemove(slice, cls.id, sub.id));
    if (!ids.size) return { ok: false, error: `${cls.name} no longer studies ${sub.nameEn}.` };
    return {
      ok: true,
      subjects: slice.subjects,
      classSubjects: slice.classSubjects.filter((l) => !ids.has(l.id)),
      summary: `Removed ${sub.nameEn} from ${cls.name}`,
    };
  }
  if (req.action === "add") {
    const sub = slice.subjects.find((s) => s.id === req.subjectId);
    if (!sub) return { ok: false, error: "That subject no longer exists." };
    if (active(sub.id)) return { ok: false, error: `${cls.name} already studies ${sub.nameEn}.` };
    // A component brings its subject: "English — Oral" without English is
    // a marks sheet with no parent column.
    const parent = sub.parentId ? slice.subjects.find((s) => s.id === sub.parentId) : null;
    const added = [...(parent && !active(parent.id) ? [link(parent)] : []), link(sub)];
    return {
      ok: true,
      subjects: slice.subjects,
      classSubjects: [...slice.classSubjects, ...added],
      summary: `Added ${sub.nameEn} to ${cls.name}`,
    };
  }
  const draft = { ...emptySubjectDraft(), code: opts.newCode ?? "", nameEn: req.subjectName };
  const err = subjectDraftError(slice.subjects, draft);
  if (err) return { ok: false, error: err };
  const sub = subjectFromDraft(slice.subjects, draft);
  return {
    ok: true,
    subjects: [...slice.subjects, sub],
    classSubjects: [...slice.classSubjects, link(sub)],
    summary: `Created ${sub.nameEn} (${sub.code}) and added it to ${cls.name}`,
  };
}

/** A starting code for a new subject: "Computer Science" → "COMPUTER-SCIENCE", made unique. */
export function suggestSubjectCode(subjects: Subject[], name: string): string {
  const base =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9 ]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .join("-")
      .slice(0, 24) || "SUBJECT";
  const taken = new Set(subjects.map((s) => s.code.toUpperCase()));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now() % 1000}`;
}
