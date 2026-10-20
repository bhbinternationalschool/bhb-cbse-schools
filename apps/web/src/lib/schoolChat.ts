/**
 * School chat — who may be in which conversation (pure; no I/O).
 *
 * Director's decisions, 15 Oct 2026:
 *  - Groups only, teachers present. A CLASS group per section: that section's
 *    children + its class teacher(s) + its co-ordinator. A SUBJECT group per
 *    section × subject: the children + the teachers of that subject there
 *    (Staff → Duties subject links and the PUBLISHED timetable). A group with
 *    no teacher in it is not offered at all.
 *  - Direct chats: staff ↔ staff, and staff ↔ a child's family. Never child ↔
 *    child, never family ↔ family: there is no conversation kind for it.
 *  - Children reach chat through the PARENT app (one family login). In a
 *    class or subject group the family's login speaks AS THE CHILD it picked
 *    ("Aarav Sharma (V-A)") — these are the child's class spaces. In a direct
 *    chat with a teacher the family speaks as itself ("Parent of Aarav Sharma
 *    (V-A)"). The server checks the child belongs to the family and to the
 *    group on every request; the client never says who is a member.
 *
 * Membership of a group is never stored: it is worked out here, on every
 * request, from the roster the server has just read — so a child who changes
 * section or a teacher who loses a subject is out of the old group at once.
 */

export type ChatKind = "class" | "subject" | "dm_staff" | "dm_parent";

export type ParsedConversation =
  | { kind: "class"; ay: string; classId: string; sectionId: string }
  | { kind: "subject"; ay: string; classId: string; sectionId: string; subjectId: string }
  | { kind: "dm_staff"; staffIds: [string, string] }
  | { kind: "dm_parent"; staffId: string; studentId: string };

const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const okId = (s: string) => ID_RE.test(s);

function need(...parts: string[]): void {
  for (const p of parts) if (!okId(p)) throw new Error(`school chat: unusable id "${p}"`);
}

export function classGroupId(ay: string, classId: string, sectionId: string): string {
  need(ay, classId, sectionId);
  return `cls:${ay}:${classId}:${sectionId}`;
}

export function subjectGroupId(ay: string, classId: string, sectionId: string, subjectId: string): string {
  need(ay, classId, sectionId, subjectId);
  return `sub:${ay}:${classId}:${sectionId}:${subjectId}`;
}

export function staffDmId(a: string, b: string): string {
  need(a, b);
  if (a === b) throw new Error("school chat: a direct chat needs two people");
  const [x, y] = [a, b].sort();
  return `dms:${x}:${y}`;
}

export function parentDmId(staffId: string, studentId: string): string {
  need(staffId, studentId);
  return `dmp:${staffId}:${studentId}`;
}

/** null = not a conversation id this server makes (refuse it). */
export function parseConversationId(id: string): ParsedConversation | null {
  const parts = String(id || "").split(":");
  if (!parts.slice(1).every(okId)) return null;
  const [tag, ...rest] = parts;
  if (tag === "cls" && rest.length === 3) return { kind: "class", ay: rest[0]!, classId: rest[1]!, sectionId: rest[2]! };
  if (tag === "sub" && rest.length === 4)
    return { kind: "subject", ay: rest[0]!, classId: rest[1]!, sectionId: rest[2]!, subjectId: rest[3]! };
  if (tag === "dms" && rest.length === 2 && rest[0]! < rest[1]!) return { kind: "dm_staff", staffIds: [rest[0]!, rest[1]!] };
  if (tag === "dmp" && rest.length === 2) return { kind: "dm_parent", staffId: rest[0]!, studentId: rest[1]! };
  return null;
}

// ── The roster the rules read ────────────────────────────────────────────

type YearLink = { classId: string; sectionId: string; academicYearCode?: string };

export type ChatStaff = {
  id: string;
  fullName: string;
  status?: string;
  classTeacherLinks?: YearLink[];
  subjectTeachingLinks?: { classId: string; sectionId?: string | null; academicYearCode?: string; subjectId: string }[];
};

export type ChatRoster = {
  ay: string;
  staff: ChatStaff[];
  classes: { id: string; name: string; sortOrder?: number }[];
  sections: { id: string; classId: string; name: string; isActive?: boolean }[];
  subjects: { id: string; nameEn?: string; name?: string; parentId?: string | null; isActive?: boolean }[];
  /** Published timetable grids only (lib/api/v1/timetableScope.server). */
  grids: { academicYearCode: string; classId: string; sectionId: string; slots: { teacherId: string; subjectId: string }[] }[];
  /** "classId|sectionId" → co-ordinator staff id. */
  coordinators: Map<string, string>;
};

export const sectionKeyOf = (classId: string, sectionId: string) => `${classId}|${sectionId}`;

const normYear = (y: string) => {
  const t = (y || "").trim().replace(/\s+/g, "").replace(/–/g, "-");
  const m = t.match(/^(20\d{2})-(20\d{2})$/);
  return m ? `${m[1]}-${m[2]!.slice(2)}` : t;
};
const yearOk = (linkYear: string | undefined, ay: string) => !linkYear || normYear(linkYear) === normYear(ay);
const active = (s: ChatStaff) => s.status !== "inactive";

export type SectionStaff = {
  classTeachers: string[];
  coordinator: string | null;
  /** Head subject id → its teachers in this section (a component counts as its head). */
  subjectTeachers: Map<string, string[]>;
};

/** Who teaches in one section this year. */
export function sectionStaff(roster: ChatRoster, classId: string, sectionId: string): SectionStaff {
  const subjectById = new Map(roster.subjects.map((s) => [s.id, s]));
  const head = (id: string) => {
    const p = subjectById.get(id)?.parentId;
    return p && subjectById.has(p) ? p : id;
  };
  const activeIds = new Set(roster.staff.filter(active).map((s) => s.id));
  const classTeachers: string[] = [];
  const bySubject = new Map<string, Set<string>>();
  const add = (subjectId: string, staffId: string) => {
    if (!subjectId || !activeIds.has(staffId) || !subjectById.has(subjectId)) return;
    const h = head(subjectId);
    if (subjectById.get(h)?.isActive === false) return;
    let set = bySubject.get(h);
    if (!set) bySubject.set(h, (set = new Set()));
    set.add(staffId);
  };
  for (const s of roster.staff) {
    if (!active(s)) continue;
    if ((s.classTeacherLinks ?? []).some((l) => l.classId === classId && l.sectionId === sectionId && yearOk(l.academicYearCode, roster.ay)))
      classTeachers.push(s.id);
    for (const l of s.subjectTeachingLinks ?? []) {
      if (l.classId !== classId || !yearOk(l.academicYearCode, roster.ay)) continue;
      if (l.sectionId && l.sectionId !== sectionId) continue;
      add(l.subjectId, s.id);
    }
  }
  for (const g of roster.grids) {
    if (g.classId !== classId || g.sectionId !== sectionId || !yearOk(g.academicYearCode, roster.ay)) continue;
    for (const slot of g.slots) add(slot.subjectId, slot.teacherId);
  }
  const coord = roster.coordinators.get(sectionKeyOf(classId, sectionId)) ?? null;
  return {
    classTeachers,
    coordinator: coord && activeIds.has(coord) ? coord : null,
    subjectTeachers: new Map([...bySubject].map(([k, v]) => [k, [...v].sort()])),
  };
}

export type GroupRef = {
  id: string;
  kind: "class" | "subject";
  classId: string;
  sectionId: string;
  subjectId: string;
  title: string;
  /** Staff in the group (push + the "teachers present" rule). */
  staffIds: string[];
};

export function sectionLabel(roster: Pick<ChatRoster, "classes" | "sections">, classId: string, sectionId: string): string {
  const cls = roster.classes.find((c) => c.id === classId)?.name || "Class";
  const sec = roster.sections.find((s) => s.id === sectionId)?.name || "";
  return sec ? `${cls}-${sec}` : cls;
}

function subjectName(roster: ChatRoster, id: string): string {
  const s = roster.subjects.find((x) => x.id === id);
  return s?.nameEn || s?.name || "Subject";
}

/** The class group and every subject group of one section that has a teacher. */
export function sectionGroups(roster: ChatRoster, classId: string, sectionId: string): GroupRef[] {
  const sec = roster.sections.find((s) => s.id === sectionId && s.classId === classId);
  if (!sec || sec.isActive === false) return [];
  const st = sectionStaff(roster, classId, sectionId);
  const label = sectionLabel(roster, classId, sectionId);
  const out: GroupRef[] = [];
  const classStaff = [...new Set([...st.classTeachers, ...(st.coordinator ? [st.coordinator] : [])])].sort();
  if (classStaff.length)
    out.push({ id: classGroupId(roster.ay, classId, sectionId), kind: "class", classId, sectionId, subjectId: "", title: `${label} · Class group`, staffIds: classStaff });
  const subjects = [...st.subjectTeachers.entries()].sort((a, b) => subjectName(roster, a[0]).localeCompare(subjectName(roster, b[0])));
  for (const [subjectId, staffIds] of subjects) {
    if (!staffIds.length) continue;
    out.push({
      id: subjectGroupId(roster.ay, classId, sectionId, subjectId),
      kind: "subject",
      classId,
      sectionId,
      subjectId,
      title: `${label} · ${subjectName(roster, subjectId)}`,
      staffIds,
    });
  }
  return out;
}

/** The groups a staff member is IN (not oversight): class teacher / co-ordinator → class group; subject teacher → subject group. */
export function staffGroups(roster: ChatRoster, staffId: string): GroupRef[] {
  const out: GroupRef[] = [];
  for (const sec of roster.sections) {
    if (sec.isActive === false) continue;
    for (const g of sectionGroups(roster, sec.classId, sec.id)) if (g.staffIds.includes(staffId)) out.push(g);
  }
  const order = (classId: string) => roster.classes.find((c) => c.id === classId)?.sortOrder ?? 0;
  return out.sort((a, b) => order(a.classId) - order(b.classId) || a.title.localeCompare(b.title));
}

/** Every group of the school (moderators' oversight list). */
export function allGroups(roster: ChatRoster): GroupRef[] {
  const out: GroupRef[] = [];
  const order = (classId: string) => roster.classes.find((c) => c.id === classId)?.sortOrder ?? 0;
  const secs = [...roster.sections].sort((a, b) => order(a.classId) - order(b.classId) || a.name.localeCompare(b.name));
  for (const sec of secs) out.push(...sectionGroups(roster, sec.classId, sec.id));
  return out;
}

/** The group a conversation id names, if it exists for this roster now. */
export function groupFor(roster: ChatRoster, parsed: ParsedConversation): GroupRef | null {
  if (parsed.kind !== "class" && parsed.kind !== "subject") return null;
  if (normYear(parsed.ay) !== normYear(roster.ay)) return null;
  const groups = sectionGroups(roster, parsed.classId, parsed.sectionId);
  const want = parsed.kind === "class" ? classGroupId(roster.ay, parsed.classId, parsed.sectionId) : subjectGroupId(roster.ay, parsed.classId, parsed.sectionId, parsed.subjectId);
  return groups.find((g) => g.id === want) ?? null;
}

/** The staff a family may open a direct chat with about one child: the child's class teachers, co-ordinator and subject teachers. */
export function staffForChild(roster: ChatRoster, classId: string, sectionId: string): string[] {
  const st = sectionStaff(roster, classId, sectionId);
  const ids = new Set<string>([...st.classTeachers, ...(st.coordinator ? [st.coordinator] : [])]);
  for (const list of st.subjectTeachers.values()) for (const id of list) ids.add(id);
  return [...ids].sort();
}

// ── Labels ───────────────────────────────────────────────────────────────

export function studentLabel(fullName: string, section: string): string {
  return `${fullName.trim() || "Student"} (${section})`;
}

export function parentLabel(childName: string, section: string): string {
  return `Parent of ${studentLabel(childName, section)}`;
}

export function staffLabel(fullName: string): string {
  return `${fullName.trim() || "Staff"} (staff)`;
}

// ── Blocks ───────────────────────────────────────────────────────────────

export type ChatSubject = { kind: "staff" | "student" | "household"; id: string };

export type ChatBlock = {
  id: string;
  subjectKind: ChatSubject["kind"];
  subjectId: string;
  mode: "mute" | "block";
  /** "" = school-wide. */
  conversationId: string;
  reason: string;
  createdAt: string;
  createdByName: string;
};

/**
 * What the active blocks say for these subjects in this conversation (or
 * school-wide, conversationId ""): a block bites before a mute; a
 * school-wide one applies everywhere.
 */
export function blockVerdict(
  blocks: ChatBlock[],
  subjects: ChatSubject[],
  conversationId: string,
): { canRead: boolean; canSend: boolean; by: ChatBlock | null } {
  const mine = blocks.filter(
    (b) =>
      subjects.some((s) => s.kind === b.subjectKind && s.id === b.subjectId) &&
      (b.conversationId === "" || b.conversationId === conversationId),
  );
  const block = mine.find((b) => b.mode === "block");
  if (block) return { canRead: false, canSend: false, by: block };
  const mute = mine.find((b) => b.mode === "mute");
  if (mute) return { canRead: true, canSend: false, by: mute };
  return { canRead: true, canSend: true, by: null };
}

/** A sender who keeps being stopped: ≥ 3 removals/warnings, or ≥ 5 holds, in the window. */
export function isRepeatOffender(c: { held: number; removed: number; warned: number }): boolean {
  return c.removed + c.warned >= 3 || c.held >= 5;
}
