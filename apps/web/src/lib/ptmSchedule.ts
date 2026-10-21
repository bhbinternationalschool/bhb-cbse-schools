/**
 * Scheduling a PTM from the staff app (director-approved request
 * mr_mv9yydt031or, 20 Oct 2026): a date and one or more classes.
 *
 * The PTM model is the web desk's (lib/ptm.ts): ONE event covers several
 * classes (`classIds`), and every teacher of those classes then adds their
 * own slots to it. The app creates exactly that — one event per scheduling,
 * covering every class picked.
 *
 * Who may pick what:
 *   - the office / leadership (unrestricted scope): any active class;
 *   - a teacher: only classes they teach a section of — the same rule
 *     `ptmEventReachesScope` uses for adding slots, so a teacher can always
 *     add slots to a PTM they scheduled. The model has no section field
 *     (ptm_desk_events.class_ids_json), so a PTM is for a whole class.
 * A teacher may not schedule an "every class" PTM (empty list): that stays
 * an office decision.
 *
 * Pure — the route (app/api/v1/staff/ptm/events) does auth and the write.
 */

import type { PtmEvent, PtmMode } from "@/lib/ptm";

export type PtmScheduleScope = {
  unrestricted: boolean;
  /** The teacher's sections (empty when unrestricted). */
  teaching: { classId: string; className: string; sectionId: string; sectionName: string }[];
};

export type PtmScheduleClass = {
  id: string;
  name: string;
  /** The teacher's own sections of this class ("A, B"); "" = every section (office). */
  sections: string;
};

type ClassLike = { id: string; name: string; sortOrder?: number; isActive?: boolean };

/** The classes this person may put in a PTM, class-ordered. */
export function ptmScheduleClasses(scope: PtmScheduleScope, classes: ClassLike[]): PtmScheduleClass[] {
  const order = new Map(classes.map((c, i) => [c.id, c.sortOrder ?? i]));
  if (scope.unrestricted) {
    return classes
      .filter((c) => c.isActive !== false)
      .slice()
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .map((c) => ({ id: c.id, name: c.name, sections: "" }));
  }
  const byClass = new Map<string, PtmScheduleClass>();
  for (const t of scope.teaching) {
    const name = classes.find((c) => c.id === t.classId)?.name || t.className || t.classId;
    const cur = byClass.get(t.classId);
    if (!cur) byClass.set(t.classId, { id: t.classId, name, sections: t.sectionName });
    else if (t.sectionName && !cur.sections.split(", ").includes(t.sectionName)) {
      cur.sections = cur.sections ? `${cur.sections}, ${t.sectionName}` : t.sectionName;
    }
  }
  return [...byClass.values()].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export type PtmScheduleInput = {
  name?: string;
  date?: string;
  endDate?: string;
  classIds?: string[];
  mode?: string;
  note?: string;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MODES: PtmMode[] = ["in_person", "video", "phone"];

/**
 * The event to write, or why not. Every refusal names the problem; nothing
 * is written for a class this person may not schedule.
 */
export function planPtmEvent(input: {
  body: PtmScheduleInput;
  scope: PtmScheduleScope;
  classes: ClassLike[];
  academicYearCode: string;
  today: string;
  id: string;
  now: string;
}): { ok: true; event: PtmEvent } | { ok: false; error: string; status: 400 | 403 } {
  const b = input.body;
  const name = (b.name || "").trim().slice(0, 120);
  if (!name) return { ok: false, error: "Give the PTM a name", status: 400 };
  const date = (b.date || "").trim();
  if (!YMD.test(date) || Number.isNaN(Date.parse(date))) {
    return { ok: false, error: "Pick the PTM date", status: 400 };
  }
  if (date < input.today) return { ok: false, error: "The PTM date has already passed", status: 400 };
  const endDate = (b.endDate || "").trim() || date;
  if (!YMD.test(endDate) || endDate < date) {
    return { ok: false, error: "The last day cannot be before the first", status: 400 };
  }
  const mode = (MODES as string[]).includes(b.mode || "") ? (b.mode as PtmMode) : "in_person";
  const classIds = Array.from(
    new Set((Array.isArray(b.classIds) ? b.classIds : []).map((c) => String(c).trim()).filter(Boolean)),
  );
  if (!classIds.length) return { ok: false, error: "Select at least one class", status: 400 };
  const allowed = new Map(ptmScheduleClasses(input.scope, input.classes).map((c) => [c.id, c]));
  const outside = classIds.filter((id) => !allowed.has(id));
  if (outside.length) {
    const known = new Set(input.classes.map((c) => c.id));
    const names = outside.map((id) => input.classes.find((c) => c.id === id)?.name || id);
    if (outside.some((id) => !known.has(id))) {
      return { ok: false, error: `Unknown class: ${names.join(", ")}`, status: 400 };
    }
    return {
      ok: false,
      error: `You do not teach ${names.join(", ")} — a PTM for it is for its own teachers or the office`,
      status: 403,
    };
  }
  // Class order, as the desk lists them.
  const ordered = [...allowed.keys()].filter((id) => classIds.includes(id));
  return {
    ok: true,
    event: {
      id: input.id,
      academicYearCode: input.academicYearCode,
      name,
      date,
      endDate,
      classIds: ordered,
      mode,
      note: (b.note || "").trim().slice(0, 500),
      isActive: true,
      createdAt: input.now,
    },
  };
}
