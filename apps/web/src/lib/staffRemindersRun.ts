/**
 * The staff reminders, end to end, with every dependency injected (the real
 * ones are in staffReminders.server.ts; the self-test passes fakes):
 *
 *   computePendingWork   what each person has pending per rule — the tick,
 *                        the staff app's "My pending work" card and the 6 PM
 *                        brief all use this one computation
 *   runReminderTick      for the rules whose time has come: notify() each
 *                        person once a day (dedupe key per rule and day, the
 *                        bell + their phones, mute and quiet hours honoured
 *                        by lib/notify); WhatsApp — an APPROVED template only
 *                        — for staff the app cannot reach
 *   readUnanswered       for the brief: who was reminded today and still has
 *                        it pending
 *
 * Every input is a Read: a failed read makes the rules that need it
 * "unknown", and an unknown rule sends nothing and is logged.
 */
import type { StaffRecord } from "@/lib/foundationMasters";
import { classifyClassHolidayDay, classifyStaffHolidayDay } from "@/lib/holidayPolicy";
import type { LeaveRequest, StaffRequestTicket } from "@/lib/staffHr";
import { currentAcademicYearCode, type MastersState } from "@/lib/masters";
import { resolveAudience, type AudienceContext, type AudienceRule } from "@/lib/notify/audience";
import { DEFAULT_PREFS, type NotifyPrefs } from "@/lib/notify/kinds";
import type { NotifyEvent, NotifyResult } from "@/lib/notify/notify";
import { inQuietHours } from "@/lib/notify/policy";
import { NOTIFY_KINDS } from "@/lib/notify/kinds";
import { isReviewDemoStudent } from "@/lib/reviewDemoRecords";
import type { SisState, SisStudent } from "@/lib/sis";
import type { StudentLeaveRequest } from "@/lib/studentLeave";
import type { ComplaintTicket } from "@/lib/complaints";
import type { ExamsState, MarkSheet } from "@/lib/exams";
import type { TimetableState } from "@/lib/timetable";
import { coordinatorBySection, type ClassCoordinatorsState } from "@/lib/attendanceCover";
import { resolveApprovers, type ApproverRule } from "@/lib/staffLeaveRules";
import {
  approvalsPending,
  dueRules,
  homeworkPending,
  marksPending,
  marksToRemind,
  needsWhatsAppFallback,
  punchPending,
  registerPending,
  reminderEvent,
  reminderKey,
  rulePassed,
  unansweredReminders,
  weekdayOf,
  whatsappLine,
  type BriefReminders,
  type PendingItem,
  type PunchMark,
  type ReminderRule,
  type ReminderSection,
  type ReminderSettings,
  type RuleResult,
  type WaitingThing,
  REMINDER_KIND,
  REMINDER_RULES,
} from "@/lib/staffReminders";
import { computeMarksGaps, termsInMarksWindow } from "@/lib/staffRemindersMarks";

export type Read<T> = { ok: true; value: T } | { ok: false; error: string };

export type ReminderDeps = {
  settings: () => Promise<Read<ReminderSettings>>;
  /** Masters with the roster, roles and the super-admin emails — what notify() addresses by. */
  school: () => Promise<Read<AudienceContext>>;
  /** Today's staff register marks by staff id (none yet = an empty map). */
  staffMarks: (date: string) => Promise<Read<Map<string, PunchMark>>>;
  /** Who keeps no attendance (the office's list + owner / admin main role). */
  exempt: () => Promise<Read<Set<string>>>;
  staffLeave: () => Promise<Read<LeaveRequest[]>>;
  /** Staff on outdoor duty today (a session active now or started today). */
  outdoorDuty: (date: string) => Promise<Read<Set<string>>>;
  students: () => Promise<Read<SisStudent[]>>;
  /** "classId:sectionId" whose register today has at least one P or A mark. */
  registersMarked: (date: string) => Promise<Read<Set<string>>>;
  timetable: () => Promise<Read<TimetableState>>;
  coordinators: () => Promise<Read<ClassCoordinatorsState>>;
  /** Today's homework posts that count (not withdrawn). */
  homeworkPosts: (date: string) => Promise<Read<{ classId: string; sectionId: string; subjectId: string }[]>>;
  examSetup: () => Promise<Read<Omit<ExamsState, "sheets" | "version">>>;
  examSheets: (ay: string, termId: string) => Promise<Read<MarkSheet[]>>;
  approverRules: () => Promise<Read<ApproverRule[]>>;
  studentLeave: () => Promise<Read<StudentLeaveRequest[]>>;
  complaints: () => Promise<Read<ComplaintTicket[]>>;
  staffRequests: () => Promise<Read<StaffRequestTicket[]>>;
  /** Staff ids holding today's reminder for a rule (erp_notification_keys). */
  reminded: (rule: ReminderRule, date: string) => Promise<Read<Set<string>>>;
  /** Each person's push devices' last_seen_at, by staff id. */
  devices: (staff: readonly Pick<StaffRecord, "id" | "email">[]) => Promise<Read<Map<string, string[]>>>;
  prefs: (staffIds: readonly string[]) => Promise<Map<string, NotifyPrefs> | null>;
  notify: (ev: NotifyEvent) => Promise<NotifyResult>;
  /** Business-initiated WhatsApp: an approved template or nothing. */
  whatsapp: (p: { staffId: string; name: string; mobile: string; line: { en: string; hi: string }; rule: ReminderRule; date: string }) => Promise<{ ok: boolean; error?: string }>;
  now: () => number;
  log: (msg: string) => void;
};

/* ── Shared reads, once per run ─────────────────────────────────────────── */

type Memo = Map<string, Promise<unknown>>;

function once<T>(memo: Memo, key: string, f: () => Promise<T>): Promise<T> {
  let p = memo.get(key) as Promise<T> | undefined;
  if (!p) {
    p = f().catch((e: unknown) => ({ ok: false, error: (e as Error)?.message ?? String(e) }) as T);
    memo.set(key, p);
  }
  return p;
}

class Unknown extends Error {}

async function need<T>(r: Promise<Read<T>>, what: string): Promise<T> {
  const v = await r;
  if (!v.ok) throw new Unknown(`${what}: ${v.error}`);
  return v.value;
}

type Day = {
  date: string;
  ay: string;
  ctx: AudienceContext;
  masters: MastersState;
  weekday: number;
};

function staffOff(masters: MastersState, date: string, ay: string, weekday: number) {
  return (s: Pick<StaffRecord, "stream">): string => {
    const c = classifyStaffHolidayDay(masters, date, ay, s.stream || "any");
    if (c.status === "holiday") return c.label || "Holiday";
    if (weekday === 0 && !c.holiday?.workingOverride) return "Sunday";
    return "";
  };
}

function classOff(masters: MastersState, date: string, ay: string, weekday: number) {
  const memo = new Map<string, string>();
  return (classId: string): string => {
    const hit = memo.get(classId);
    if (hit !== undefined) return hit;
    const c = classifyClassHolidayDay(masters, date, ay, classId);
    const v = c.status === "holiday" ? c.label || "Holiday" : weekday === 0 && !c.holiday?.workingOverride ? "Sunday" : "";
    memo.set(classId, v);
    return v;
  };
}

function activeStudents(all: SisStudent[], ay: string): SisStudent[] {
  return all.filter((s) => s.status === "active" && (!ay || s.academicYearCode === ay) && !isReviewDemoStudent(s));
}

function sectionsOf(masters: MastersState, students: SisStudent[]): ReminderSection[] {
  const strength = new Map<string, number>();
  for (const s of students) strength.set(`${s.classId}:${s.sectionId}`, (strength.get(`${s.classId}:${s.sectionId}`) ?? 0) + 1);
  const classById = new Map((masters.classes ?? []).map((c) => [c.id, c]));
  const out: ReminderSection[] = [];
  for (const sec of masters.sections ?? []) {
    if (sec.isActive === false) continue;
    const cls = classById.get(sec.classId);
    if (!cls || cls.isActive === false) continue;
    out.push({
      classId: sec.classId,
      sectionId: sec.id,
      label: `Class ${cls.name}${sec.name ? ` · ${sec.name}` : ""}`,
      strength: strength.get(`${sec.classId}:${sec.id}`) ?? 0,
    });
  }
  const order = new Map((masters.classes ?? []).map((c) => [c.id, c.sortOrder ?? 0]));
  return out.sort((a, b) => (order.get(a.classId) ?? 999) - (order.get(b.classId) ?? 999) || a.label.localeCompare(b.label));
}

function linkInYear(linkAy: string | undefined, ay: string) {
  return !linkAy || !ay || linkAy === ay;
}

function classTeachersFn(masters: MastersState, ay: string) {
  const by = new Map<string, string[]>();
  for (const s of masters.staff ?? []) {
    if (s.status !== "active") continue;
    for (const l of s.classTeacherLinks ?? []) {
      if (!linkInYear(l.academicYearCode, ay)) continue;
      const k = `${l.classId}:${l.sectionId}`;
      by.set(k, [...new Set([...(by.get(k) ?? []), s.id])]);
    }
  }
  return (classId: string, sectionId: string) => by.get(`${classId}:${sectionId}`) ?? [];
}

const covers = (l: Pick<LeaveRequest, "fromDate" | "toDate">, date: string) => (l.fromDate || "") <= date && date <= (l.toDate || "");

/* ── One rule ───────────────────────────────────────────────────────────── */

async function dayOf(deps: ReminderDeps, memo: Memo, date: string): Promise<Day> {
  const ctx = await need(once(memo, "school", deps.school), "the roster and roles");
  const ay = currentAcademicYearCode(ctx.masters);
  return { date, ay, ctx, masters: ctx.masters, weekday: weekdayOf(date) };
}

async function absentSets(deps: ReminderDeps, memo: Memo, date: string) {
  const [marks, leave] = await Promise.all([
    need(once(memo, `staffMarks:${date}`, () => deps.staffMarks(date)), "the staff register"),
    need(once(memo, "staffLeave", deps.staffLeave), "staff leave"),
  ]);
  const approved = new Set(leave.filter((l) => l.status === "approved" && covers(l, date)).map((l) => l.staffId));
  // The cover rule (attendanceCover.absentStaffIdsOn): A, leave or half day.
  const away = new Set(approved);
  // The brief's homework rule: absent or on leave (a half day still teaches).
  const absent = new Set(approved);
  for (const [id, m] of marks) {
    if (m.status === "A" || m.status === "LE" || m.status === "HD") away.add(id);
    if (m.status === "A" || m.status === "LE") absent.add(id);
  }
  return { marks, approved, away, absent };
}

async function computeRule(deps: ReminderDeps, memo: Memo, rule: ReminderRule, date: string, settings: ReminderSettings): Promise<RuleResult> {
  try {
    const day = await dayOf(deps, memo, date);
    const { masters, ay, weekday } = day;
    const activeIds = new Set((masters.staff ?? []).filter((s) => s.status === "active").map((s) => s.id));

    if (rule === "punch") {
      const [exempt, outdoor, sets] = await Promise.all([
        need(once(memo, "exempt", deps.exempt), "the attendance-exempt list"),
        need(once(memo, `outdoor:${date}`, () => deps.outdoorDuty(date)), "outdoor duty"),
        absentSets(deps, memo, date),
      ]);
      const off = staffOff(masters, date, ay, weekday);
      if ((masters.staff ?? []).every((s) => s.status !== "active" || off(s))) {
        return { rule, state: "off", reason: `staff day off — ${off({ stream: "teaching" }) || off({ stream: "non_teaching" }) || "no active staff"}` };
      }
      return {
        rule,
        state: "ok",
        items: punchPending({
          staff: masters.staff ?? [],
          exempt,
          onApprovedLeave: sets.approved,
          onOutdoorDuty: outdoor,
          marks: sets.marks,
          dayOffFor: off,
        }),
      };
    }

    if (rule === "register" || rule === "homework") {
      const students = activeStudents(await need(once(memo, "students", deps.students), "the student register"), ay);
      const sections = sectionsOf(masters, students);
      const off = classOff(masters, date, ay, weekday);
      if (sections.filter((s) => s.strength > 0).every((s) => off(s.classId))) {
        return { rule, state: "off", reason: "no class is working today" };
      }
      const [sets, timetable] = await Promise.all([
        absentSets(deps, memo, date),
        need(once(memo, "timetable", deps.timetable), "the timetable"),
      ]);
      if (rule === "register") {
        const [marked, coord] = await Promise.all([
          need(once(memo, `registers:${date}`, () => deps.registersMarked(date)), "today's class registers"),
          need(once(memo, "coordinators", deps.coordinators), "the class co-ordinators"),
        ]);
        const subs = new Map<string, string[]>();
        for (const s of timetable.substitutions ?? []) {
          if (s.date !== date || !s.substituteTeacherId || !linkInYear(s.academicYearCode, ay)) continue;
          const k = `${s.classId}|${s.sectionId}`;
          subs.set(k, [...new Set([...(subs.get(k) ?? []), s.substituteTeacherId])]);
        }
        return {
          rule,
          state: "ok",
          items: registerPending({
            sections,
            marked,
            classOff: off,
            classTeachers: classTeachersFn(masters, ay),
            coordinatorOf: coordinatorBySection(coord),
            substitutesOf: subs,
            absent: sets.away,
          }),
        };
      }
      const posts = await need(once(memo, `homework:${date}`, () => deps.homeworkPosts(date)), "today's homework");
      const subjectById = new Map((masters.subjects ?? []).map((x) => [x.id, x]));
      const subjectKey = (id: string) => {
        const parent = subjectById.get(id)?.parentId;
        return parent && subjectById.has(parent) ? parent : id;
      };
      const grids = new Map(
        (timetable.publishedGrids ?? []).filter((g) => linkInYear(g.academicYearCode, ay)).map((g) => [`${g.classId}:${g.sectionId}`, g]),
      );
      if (grids.size === 0) return { rule, state: "off", reason: "no published timetable" };
      const working = sections
        .filter((s) => s.strength > 0 && !off(s.classId) && grids.has(`${s.classId}:${s.sectionId}`))
        .map((s) => ({ ...s, slots: grids.get(`${s.classId}:${s.sectionId}`)!.slots }));
      return {
        rule,
        state: "ok",
        items: homeworkPending({
          weekday,
          sections: working,
          subjectKey,
          subjectName: (id) => subjectById.get(id)?.nameEn || subjectById.get(id)?.code || id,
          activeStaff: activeIds,
          absent: sets.absent,
          posted: new Set(posts.map((p) => `${p.classId}:${p.sectionId}|${subjectKey(p.subjectId)}`)),
        }),
      };
    }

    if (rule === "marks") {
      const setup = await need(once(memo, "examSetup", deps.examSetup), "the exams setup");
      const exams = { version: 1 as const, ...setup, sheets: [] };
      const terms = termsInMarksWindow(exams, ay, date, settings.marksLeadDays);
      if (terms.length === 0) return { rule, state: "off", reason: "no exam has its marks due in the next days" };
      const [studentsAll, timetable, ...sheetLists] = await Promise.all([
        need(once(memo, "students", deps.students), "the student register"),
        need(once(memo, "timetable", deps.timetable), "the timetable"),
        ...terms.map((t) => need(deps.examSheets(ay, t.termId), `the ${t.label} mark sheets`)),
      ]);
      const sis: SisState = { version: 1, households: [], students: studentsAll, curriculumRequests: [], tags: [], classUpgrades: [] };
      const gaps = computeMarksGaps({
        ay,
        masters,
        sis,
        exams,
        terms,
        sheets: sheetLists.flat(),
        grids: (timetable.publishedGrids ?? []).filter((g) => linkInYear(g.academicYearCode, ay)),
      });
      return { rule, state: "ok", items: marksPending({ date, leadDays: settings.marksLeadDays, gaps }) };
    }

    // approvals
    const [leave, approverRules, studentLeave, complaints, requests, studentsAll] = await Promise.all([
      need(once(memo, "staffLeave", deps.staffLeave), "staff leave"),
      need(once(memo, "approverRules", deps.approverRules), "the leave approver rules"),
      need(once(memo, "studentLeave", deps.studentLeave), "parents' leave requests"),
      need(once(memo, "complaints", deps.complaints), "complaints"),
      need(once(memo, "staffRequests", deps.staffRequests), "staff requests"),
      need(once(memo, "students", deps.students), "the student register"),
    ]);
    const things = waitingThings({ masters, ay, leave, approverRules, studentLeave, complaints, requests, students: activeStudents(studentsAll, ay) });
    return {
      rule,
      state: "ok",
      items: approvalsPending({
        things,
        resolve: (rules, exclude) =>
          resolveAudience(rules, day.ctx, exclude.map((id) => ({ type: "staff" as const, id })))
            .filter((r) => r.type === "staff" && activeIds.has(r.id))
            .map((r) => r.id),
      }),
    };
  } catch (e) {
    if (e instanceof Unknown) return { rule, state: "unknown", reason: e.message };
    return { rule, state: "unknown", reason: (e as Error)?.message ?? String(e) };
  }
}

/**
 * What waits, each with the audience its own notification used
 * (lib/notify/events.ts): the people who must act.
 */
export function waitingThings(input: {
  masters: MastersState;
  ay: string;
  leave: LeaveRequest[];
  approverRules: ApproverRule[];
  studentLeave: StudentLeaveRequest[];
  complaints: ComplaintTicket[];
  requests: StaffRequestTicket[];
  students: SisStudent[];
}): WaitingThing[] {
  const { masters, ay } = input;
  const out: WaitingThing[] = [];
  const staffById = new Map((masters.staff ?? []).map((s) => [s.id, s]));
  const ctOf = classTeachersFn(masters, ay);
  const studentById = new Map(input.students.map((s) => [s.id, s]));

  for (const l of input.leave) {
    if (l.status !== "pending" && l.status !== "pending_l2") continue;
    const s = staffById.get(l.staffId);
    const chain = resolveApprovers(input.approverRules, { id: l.staffId, departmentId: s?.departmentId ?? null, status: s?.status });
    const named = l.status === "pending_l2" ? chain.level2 : chain.level1;
    out.push({ kind: "staff_leave", refId: l.id, audience: [{ staffLeaveApprovers: true }, { staff: named }], exclude: [l.staffId] });
  }

  for (const r of input.studentLeave) {
    if (r.status !== "pending" || (r.academicYearCode && ay && r.academicYearCode !== ay)) continue;
    const st = studentById.get(r.studentId);
    if (!st) continue;
    const teachers = ctOf(st.classId, st.sectionId);
    const days = Math.round((Date.parse(`${r.toDate || r.fromDate}T00:00:00Z`) - Date.parse(`${r.fromDate}T00:00:00Z`)) / 86_400_000) + 1;
    const leadership = days > 3 || r.leaveType === "ML" || r.leaveType === "LL" || teachers.length === 0;
    const audience: AudienceRule[] = leadership
      ? [{ staff: teachers }, { permission: "student_leave", action: "approve", schoolWide: true }]
      : [{ staff: teachers }];
    out.push({ kind: "student_leave", refId: r.id, audience });
  }

  for (const st of input.students) {
    const pending = Object.entries(st.docs || {}).filter(([, d]) => d?.status === "pending");
    if (!pending.length) continue;
    const teachers = ctOf(st.classId, st.sectionId);
    for (const [key] of pending) {
      out.push({
        kind: "document",
        refId: `${st.id}:${key}`,
        audience: [{ staff: teachers }, { permission: "students", action: "edit", schoolWide: true }],
      });
    }
  }

  const OPEN = new Set(["open", "assigned", "in_progress"]);
  for (const t of input.complaints) {
    if (!OPEN.has(t.status)) continue;
    if (t.assignedToStaffId) {
      out.push({ kind: "complaint", refId: t.id, audience: [{ staff: [t.assignedToStaffId] }] });
      continue;
    }
    const st = t.studentId ? studentById.get(t.studentId) : undefined;
    const teachers = st ? ctOf(st.classId, st.sectionId) : [];
    out.push({ kind: "complaint", refId: t.id, audience: [{ staff: teachers }, { permission: "complaints", action: "approve", schoolWide: true }] });
  }

  for (const q of input.requests) {
    if (q.status !== "open" && q.status !== "in_progress") continue;
    out.push(
      q.assignedToStaffId
        ? { kind: "staff_request", refId: q.id, audience: [{ staff: [q.assignedToStaffId] }], exclude: [q.staffId] }
        : { kind: "staff_request", refId: q.id, audience: [{ staffLeaveApprovers: true }], exclude: [q.staffId] },
    );
  }
  return out;
}

/* ── Public entry points ────────────────────────────────────────────────── */

export async function computePendingWork(
  deps: ReminderDeps,
  opts: { date: string; rules?: readonly ReminderRule[]; settings?: ReminderSettings; memo?: Memo },
): Promise<{ settings: Read<ReminderSettings>; results: RuleResult[] }> {
  const memo = opts.memo ?? new Map();
  const settings: Read<ReminderSettings> = opts.settings ? { ok: true, value: opts.settings } : await deps.settings();
  const rules = opts.rules ?? REMINDER_RULES;
  if (!settings.ok) {
    return { settings, results: rules.map((rule) => ({ rule, state: "unknown" as const, reason: `reminder settings: ${settings.error}` })) };
  }
  const results: RuleResult[] = [];
  for (const rule of rules) {
    results.push(
      settings.value.rules[rule].enabled
        ? await computeRule(deps, memo, rule, opts.date, settings.value)
        : { rule, state: "off", reason: "turned off in the reminder settings" },
    );
  }
  return { settings, results };
}

/** One person's pending work — the staff app card. */
export async function pendingWorkFor(
  deps: ReminderDeps,
  staffId: string,
  date: string,
): Promise<{ items: PendingItem[]; unknown: ReminderRule[] }> {
  const { results } = await computePendingWork(deps, { date });
  const items: PendingItem[] = [];
  const unknown: ReminderRule[] = [];
  for (const r of results) {
    if (r.state === "unknown") unknown.push(r.rule);
    if (r.state !== "ok") continue;
    const mine = r.items.find((i) => i.staffId === staffId);
    if (mine) items.push(mine);
  }
  return { items, unknown };
}

export type TickRuleOutcome = {
  rule: ReminderRule;
  state: RuleResult["state"];
  reason?: string;
  pending: number;
  /** Stored in the bell for the first time today. */
  reminded: number;
  /** Already reminded today (a second tick). */
  duplicate: number;
  pushed: number;
  held: { muted: number; quiet: number };
  whatsapp: { sent: number; failed: number; skipped: number };
  errors: string[];
};

export async function runReminderTick(
  deps: ReminderDeps,
  opts: { nowMs?: number; rules?: readonly ReminderRule[]; dryRun?: boolean } = {},
): Promise<{ ok: boolean; date: string; rules: TickRuleOutcome[]; note?: string }> {
  const nowMs = opts.nowMs ?? deps.now();
  const date = istDate(nowMs);
  const s = await deps.settings();
  if (!s.ok) {
    deps.log(`[staff-reminders] settings unreadable — nothing sent: ${s.error}`);
    return { ok: false, date, rules: [], note: "settings unreadable" };
  }
  const settings = s.value;
  const rules = opts.rules ?? dueRules(settings, nowMs);
  if (rules.length === 0) return { ok: true, date, rules: [], note: settings.enabled ? "no rule is due now" : "reminders are off" };

  const memo: Memo = new Map();
  const { results } = await computePendingWork(deps, { date, rules, settings, memo });
  const outcomes: TickRuleOutcome[] = [];
  let anyFailure = false;

  for (const r of results) {
    const o: TickRuleOutcome = {
      rule: r.rule,
      state: r.state,
      pending: 0,
      reminded: 0,
      duplicate: 0,
      pushed: 0,
      held: { muted: 0, quiet: 0 },
      whatsapp: { sent: 0, failed: 0, skipped: 0 },
      errors: [],
    };
    outcomes.push(o);
    if (r.state !== "ok") {
      o.reason = r.reason;
      if (r.state === "unknown") {
        anyFailure = true;
        deps.log(`[staff-reminders] ${r.rule}: unknown — nothing sent (${r.reason})`);
      }
      continue;
    }
    const items = r.rule === "marks" ? marksToRemind(r.items, date) : r.items;
    o.pending = items.length;
    if (opts.dryRun || items.length === 0) continue;

    const fresh: PendingItem[] = [];
    for (const item of items) {
      const res = await deps.notify(reminderEvent(item, date));
      if (!res.ok) {
        anyFailure = true;
        o.errors.push(`${item.staffId}: ${res.error}`);
        continue;
      }
      o.reminded += res.inserted;
      o.duplicate += res.duplicate + res.grouped;
      o.pushed += res.pushed;
      o.held.muted += res.held.muted;
      o.held.quiet += res.held.quiet;
      if (res.inserted > 0) fresh.push(item);
    }
    if (settings.whatsappFallback && fresh.length) {
      const wa = await whatsappFallback(deps, memo, fresh, r.rule, date, nowMs, settings);
      o.whatsapp = wa;
      if (wa.failed) anyFailure = true;
    }
  }
  return { ok: !anyFailure, date, rules: outcomes };
}

async function whatsappFallback(
  deps: ReminderDeps,
  memo: Memo,
  items: PendingItem[],
  rule: ReminderRule,
  date: string,
  nowMs: number,
  settings: ReminderSettings,
): Promise<TickRuleOutcome["whatsapp"]> {
  const out = { sent: 0, failed: 0, skipped: 0 };
  const school = await once(memo, "school", deps.school);
  if (!school.ok) return { ...out, skipped: items.length };
  const staffById = new Map((school.value.masters.staff ?? []).map((s) => [s.id, s]));
  const people = items.map((i) => staffById.get(i.staffId)).filter((s): s is StaffRecord => !!s);
  const devices = await deps.devices(people);
  if (!devices.ok) {
    deps.log(`[staff-reminders] ${rule}: push devices unreadable — no WhatsApp fallback (${devices.error})`);
    return { ...out, skipped: items.length };
  }
  const prefs = await deps.prefs(items.map((i) => i.staffId));
  const topic = NOTIFY_KINDS[REMINDER_KIND[rule]].topic;
  for (const item of items) {
    const s = staffById.get(item.staffId);
    if (!s || !needsWhatsAppFallback(devices.value.get(item.staffId) ?? [], nowMs, settings.appInactiveDays)) continue;
    // The person's own settings bind WhatsApp too: a muted topic or quiet hours send nothing.
    // Settings that could not be read: no WhatsApp (the bell row is stored).
    const p = prefs ? prefs.get(`staff:${item.staffId}`) ?? DEFAULT_PREFS : null;
    if (!p || p.mutedTopics.includes(topic) || inQuietHours(p, nowMs)) {
      out.skipped += 1;
      continue;
    }
    const mobile = tenDigits(s.mobile) || tenDigits(s.altMobile);
    if (!mobile) {
      out.skipped += 1;
      continue;
    }
    const r = await deps.whatsapp({
      staffId: s.id,
      name: s.fullName || s.id,
      mobile,
      line: { en: whatsappLine(item, "en"), hi: whatsappLine(item, "hi") },
      rule,
      date,
    });
    if (r.ok) out.sent += 1;
    else {
      out.failed += 1;
      deps.log(`[staff-reminders] ${rule}: WhatsApp to ${s.id} not sent — ${r.error ?? "failed"}`);
    }
  }
  return out;
}

function tenDigits(raw: string | undefined): string {
  const d = (raw || "").replace(/\D/g, "");
  const t = d.length > 10 ? d.slice(-10) : d;
  return t.length === 10 && /^[6-9]/.test(t) ? t : "";
}

function istDate(nowMs: number): string {
  return new Date(nowMs + 330 * 60_000).toISOString().slice(0, 10);
}

/** For the 6 PM brief: who did not act on today's reminders. */
export async function readUnanswered(deps: ReminderDeps, opts: { date: string; nowMs?: number }): Promise<BriefReminders> {
  const nowMs = opts.nowMs ?? deps.now();
  const s = await deps.settings();
  const rules: ReminderRule[] = ["punch", "register", "homework", "marks"];
  if (!s.ok) return { unknown: rules, rows: [] };
  const passed = rules.filter((r) => rulePassed(s.value, r, nowMs));
  const memo: Memo = new Map();
  const { results } = await computePendingWork(deps, { date: opts.date, rules: passed, settings: s.value, memo });
  const reminded = new Map<ReminderRule, Set<string> | null>();
  for (const r of passed) {
    const got = await deps.reminded(r, opts.date);
    reminded.set(r, got.ok ? got.value : null);
  }
  const school = await once(memo, "school", deps.school);
  const nameOf = (id: string) => (school.ok ? school.value.masters.staff.find((x) => x.id === id)?.fullName || id : id);
  return unansweredReminders({ date: opts.date, results, reminded, nameOf });
}

export { reminderKey };
