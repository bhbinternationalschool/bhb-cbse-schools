/**
 * Staff work reminders — who is reminded and who is not, at what time, once
 * a day, within quiet hours, never on a failed read; the WhatsApp fallback;
 * the 6 PM brief's "not acted on" section; the marks deadline field.
 *
 *   npx tsx src/lib/staffReminders.selftest.ts   (npm run test:staff-reminders)
 *
 * The dedupe and quiet-hours checks drive the REAL notify() logic
 * (lib/notify/notify.notifyWith + policy) with a fake store that keeps one
 * row per (recipient, dedupe key), the way erp_notify_deliver does.
 */
import assert from "node:assert/strict";
import { normalizeStaffRecord } from "@/lib/foundationMasters";
import { emptyMastersShell, type MastersState } from "@/lib/masters";
import { defaultRbacState, type RbacState } from "@/lib/rbac";
import { DEFAULT_PREFS, NOTIFY_KINDS, type NotifyPrefs } from "@/lib/notify/kinds";
import { notifyWith, type DeliverRow, type NotifyDeps, type NotifyEvent } from "@/lib/notify/notify";
import { composeBriefSummary, emptyBrief, pendingFacts } from "@/lib/dailyBrief";
import { normalizeExamPolicy } from "@/lib/exams";
import { normalizeClassCoordinators } from "@/lib/attendanceCover";
import { emptyTimetableState, type TimetableState } from "@/lib/timetable";
import type { LeaveRequest } from "@/lib/staffHr";
import type { SisStudent } from "@/lib/sis";
import {
  DEFAULT_REMINDER_SETTINGS,
  dueRules,
  istDateOf,
  marksPending,
  marksToRemind,
  marksWindow,
  needsWhatsAppFallback,
  normalizeReminderSettings,
  reminderEvent,
  unansweredLine,
  unansweredReminders,
  whatsappLine,
  type ReminderSettings,
} from "@/lib/staffReminders";
import { computePendingWork, readUnanswered, runReminderTick, type Read, type ReminderDeps } from "@/lib/staffRemindersRun";

console.log("staffReminders.selftest.ts");

const ok = <T,>(value: T): Read<T> => ({ ok: true, value });
const bad = (error: string): Read<never> => ({ ok: false, error });

// ── India time ─────────────────────────────────────────────────────────────

const DATE = "2026-10-29"; // a Thursday
/** India wall-clock time on DATE as epoch ms. */
const at = (hhmm: string, date = DATE) => {
  const [h, m] = hhmm.split(":").map(Number);
  const [y, mo, d] = date.split("-").map(Number);
  return Date.UTC(y!, mo! - 1, d!, h!, m!) - 330 * 60_000;
};
assert.equal(istDateOf(at("08:15")), DATE);
// 00:30 IST on the 30th is still the 29th in UTC — the date must be India's.
assert.equal(istDateOf(at("00:30", "2026-10-30")), "2026-10-30", "an India date, never the UTC one (#723)");
assert.equal(new Date(at("00:30", "2026-10-30")).toISOString().slice(0, 10), "2026-10-29", "(the UTC date differs here)");

// ── When each rule is due ──────────────────────────────────────────────────

{
  const s = DEFAULT_REMINDER_SETTINGS;
  assert.deepEqual(dueRules(s, at("08:14")), [], "nothing before 08:15");
  assert.deepEqual(dueRules(s, at("08:15")), ["punch"], "punch at 08:15");
  assert.deepEqual(dueRules(s, at("09:30")), ["punch", "register"], "register at 09:30 (punch window still open)");
  assert.deepEqual(dueRules(s, at("09:45")), ["register"], "punch window (90 min) closed at 09:45");
  assert.deepEqual(dueRules(s, at("15:00")), ["homework"]);
  assert.deepEqual(dueRules(s, at("16:00")), ["homework", "marks"]);
  assert.deepEqual(dueRules(s, at("17:29")), ["marks"], "marks window still open at 17:29");
  assert.deepEqual(dueRules(s, at("17:30")), ["approvals"]);
  assert.deepEqual(dueRules(s, at("21:00")), [], "no rule at night");
  const moved = normalizeReminderSettings({ rules: { punch: { enabled: true, at: "08:30" }, homework: { enabled: false, at: "15:00" } } });
  assert.deepEqual(dueRules(moved, at("08:15")), [], "times are configurable: punch moved to 08:30");
  assert.deepEqual(dueRules(moved, at("08:30")), ["punch"]);
  assert.deepEqual(dueRules(moved, at("15:05")), [], "a rule turned off never fires");
  assert.deepEqual(dueRules({ ...s, enabled: false }, at("08:15")), [], "master switch");
  assert.equal(normalizeReminderSettings({ rules: { punch: { at: "8:15" } } }).rules.punch.at, "08:15", "a bad time falls back to the default");
}

// ── A small school ─────────────────────────────────────────────────────────

const DES = [
  { id: "d_prin", code: "PRIN", name: "Principal", departmentId: null, isActive: true },
  { id: "d_prt", code: "PRT", name: "PRT Teacher", departmentId: null, isActive: true },
  { id: "d_op", code: "OP", name: "Computer Operator", departmentId: null, isActive: true },
];
const AY = "2026-27";
const C5 = "cls_5";
const S5A = "sec_5a";
const S5B = "sec_5b";
const C6 = "cls_6";
const S6A = "sec_6a";
const MATH = "sub_math";
const HIN = "sub_hin";
const HIN_ORAL = "sub_hin_oral";

function staff(id: string, designationId: string, extra: Record<string, unknown> = {}) {
  return normalizeStaffRecord({
    id,
    empCode: id.toUpperCase(),
    fullName: `Person ${id}`,
    mobile: "9000000001",
    status: "active",
    stream: designationId === "d_prt" ? "teaching" : "non_teaching",
    designationId,
    departmentId: null,
    campusId: null,
    ...extra,
  });
}
const ct = (classId: string, sectionId: string) => ({ classTeacherLinks: [{ classId, sectionId, academicYearCode: AY, isPrimary: true }] });

const PRIN = "s_prin";
const ASHA = "s_asha"; // class teacher 5-A
const BINA = "s_bina"; // maths 5-A by the published timetable
const CHETAN = "s_chetan"; // co-ordinator of 5-A, class teacher of 6-A
const DEEP = "s_deep"; // exempt from attendance
const ESHA = "s_esha"; // on approved leave today; class teacher of 5-B
const FARAH = "s_farah"; // on outdoor duty
const GOPAL = "s_gopal"; // visiting
const HARI = "s_hari"; // punched in
const INDU = "s_indu"; // marked absent by the office
const JAYA = "s_jaya"; // nothing done — the plain case; substitute in 5-B today

const masters = {
  ...emptyMastersShell(),
  academicYears: [{ id: "ay1", code: AY, label: AY, startsOn: "2026-04-01", endsOn: "2027-03-31", status: "current", isActive: true }],
  designations: DES,
  departments: [],
  classes: [
    { id: C5, name: "5", sortOrder: 5, isActive: true },
    { id: C6, name: "6", sortOrder: 6, isActive: true },
  ],
  sections: [
    { id: S5A, classId: C5, name: "A", isActive: true },
    { id: S5B, classId: C5, name: "B", isActive: true },
    { id: S6A, classId: C6, name: "A", isActive: true },
  ],
  subjects: [
    { id: MATH, code: "MATH", nameEn: "Maths", isActive: true },
    { id: HIN, code: "HIN", nameEn: "Hindi", isActive: true },
    { id: HIN_ORAL, code: "HINO", nameEn: "Hindi — Oral", parentId: HIN, isActive: true },
  ],
  holidays: [],
  staff: [
    staff(PRIN, "d_prin"),
    staff(ASHA, "d_prt", ct(C5, S5A)),
    staff(BINA, "d_prt"),
    staff(CHETAN, "d_prt", ct(C6, S6A)),
    staff(DEEP, "d_op"),
    staff(ESHA, "d_prt", ct(C5, S5B)),
    staff(FARAH, "d_op"),
    staff(GOPAL, "d_prt", { category: "visiting" }),
    staff(HARI, "d_prt"),
    staff(INDU, "d_op"),
    staff(JAYA, "d_prt", { mobile: "9876543210" }),
  ],
} as unknown as MastersState;

const rbac: RbacState = defaultRbacState();

const student = (id: string, classId: string, sectionId: string, extra: Partial<SisStudent> = {}) =>
  ({ id, classId, sectionId, academicYearCode: AY, status: "active", admissionNo: id.toUpperCase(), fullName: id, docs: {}, ...extra }) as unknown as SisStudent;

const STUDENTS: SisStudent[] = [
  student("st1", C5, S5A),
  student("st2", C5, S5A),
  student("st3", C5, S5B),
  student("st4", C6, S6A, { docs: { birthCert: { status: "pending" } } as unknown as SisStudent["docs"] }),
  student("demo", C6, S6A, { admissionNo: "PLAYREVIEW-1" } as Partial<SisStudent>),
];

const LEAVE: LeaveRequest[] = [
  { id: "lv1", staffId: ESHA, status: "approved", fromDate: "2026-10-28", toDate: "2026-10-30", typeCode: "CL" } as LeaveRequest,
  { id: "lv2", staffId: HARI, status: "pending", fromDate: "2026-11-02", toDate: "2026-11-02", typeCode: "CL" } as LeaveRequest,
];

const TIMETABLE: TimetableState = {
  ...emptyTimetableState(),
  publishedGrids: [
    {
      id: "g5a",
      academicYearCode: AY,
      classId: C5,
      sectionId: S5A,
      updatedAt: "",
      slots: [
        { weekday: 4, periodNo: 1, subjectId: MATH, teacherId: BINA },
        { weekday: 4, periodNo: 2, subjectId: HIN_ORAL, teacherId: ASHA },
        { weekday: 3, periodNo: 1, subjectId: MATH, teacherId: JAYA }, // Wednesday: not today
      ],
    },
    {
      id: "g5b",
      academicYearCode: AY,
      classId: C5,
      sectionId: S5B,
      updatedAt: "",
      slots: [{ weekday: 4, periodNo: 1, subjectId: MATH, teacherId: ESHA }], // on leave: not expected
    },
  ] as unknown as TimetableState["publishedGrids"],
  substitutions: [
    { id: "sub1", academicYearCode: AY, date: DATE, weekday: 4, periodNo: 1, classId: C5, sectionId: S5B, subjectId: MATH, absentTeacherId: ESHA, substituteTeacherId: JAYA, source: "manual" },
  ] as unknown as TimetableState["substitutions"],
};

// ── Fake notify store: one row per (recipient, dedupe key) ─────────────────

type World = {
  keys: Set<string>;
  pushes: { to: string; kind: string }[];
  rows: DeliverRow[];
  prefs: Map<string, NotifyPrefs>;
  wa: { staffId: string; line: string }[];
  notifyCalls: number;
};

function world(): World {
  return { keys: new Set(), pushes: [], rows: [], prefs: new Map(), wa: [], notifyCalls: 0 };
}

function notifyDepsFor(w: World, nowMs: number): NotifyDeps {
  return {
    audienceContext: async () => ({ masters, rbac, superAdminEmails: [] }),
    deliver: async (rows) => ({
      ok: true,
      results: rows.map((r) => {
        const k = `${r.recipient_type}:${r.recipient_id}|${r.dedupe_key}`;
        const dup = w.keys.has(k);
        if (!dup) {
          w.keys.add(k);
          w.rows.push(r);
        }
        return { recipient_type: r.recipient_type, recipient_id: r.recipient_id, id: `n_${w.rows.length}`, outcome: dup ? ("duplicate" as const) : ("inserted" as const) };
      }),
    }),
    prefsFor: async () => w.prefs,
    push: async (to, msg) => {
      w.pushes.push({ to: to.id, kind: String(msg.data.kind) });
      return { sent: 1 };
    },
    now: () => nowMs,
    log: () => undefined,
  };
}

type Overrides = Partial<ReminderDeps> & { settingsValue?: ReminderSettings };

function deps(w: World, nowMs: number, o: Overrides = {}): ReminderDeps {
  const base: ReminderDeps = {
    settings: async () => ok(o.settingsValue ?? DEFAULT_REMINDER_SETTINGS),
    school: async () => ok({ masters, rbac, superAdminEmails: [] }),
    staffMarks: async () =>
      ok(
        new Map([
          [HARI, { status: "P", inTime: "08:01" }],
          [INDU, { status: "A", inTime: "" }],
          [ESHA, { status: "LE", inTime: "" }],
        ]),
      ),
    exempt: async () => ok(new Set([DEEP])),
    staffLeave: async () => ok(LEAVE),
    outdoorDuty: async () => ok(new Set([FARAH])),
    students: async () => ok(STUDENTS),
    registersMarked: async () => ok(new Set<string>()),
    timetable: async () => ok(TIMETABLE),
    coordinators: async () => ok(normalizeClassCoordinators({ byStaff: { [CHETAN]: [`${C5}|${S5A}`] } })),
    homeworkPosts: async () => ok([]),
    examSetup: async () => ok({ terms: [], subjects: [], dateSheet: [], policy: normalizeExamPolicy(null), promotions: [], rooms: [], seating: [] }),
    examSheets: async () => ok([]),
    approverRules: async () => ok([]),
    studentLeave: async () => ok([]),
    complaints: async () => ok([]),
    staffRequests: async () => ok([]),
    reminded: async (rule, date) => ok(new Set([...w.keys].filter((k) => k.endsWith(`|staff_reminder:${rule}:${date}`)).map((k) => k.split("|")[0]!.slice("staff:".length)))),
    devices: async () => ok(new Map([[ASHA, [new Date(nowMs - 3600_000).toISOString()]]])),
    prefs: async () => w.prefs,
    notify: (ev: NotifyEvent) => {
      w.notifyCalls += 1;
      return notifyWith(notifyDepsFor(w, nowMs), ev);
    },
    whatsapp: async (p) => {
      w.wa.push({ staffId: p.staffId, line: p.line.en });
      return { ok: true };
    },
    now: () => nowMs,
    log: () => undefined,
  };
  const rest: Partial<ReminderDeps> = { ...o };
  delete (rest as Overrides).settingsValue;
  return { ...base, ...rest };
}

async function pending(w: World, nowMs: number, rule: Parameters<typeof computePendingWork>[1]["rules"], o: Overrides = {}) {
  const r = await computePendingWork(deps(w, nowMs, o), { date: istDateOf(nowMs), rules: rule });
  return r.results;
}

const who = (res: Awaited<ReturnType<typeof pending>>[number]) => (res.state === "ok" ? res.items.map((i) => i.staffId).sort() : res.state);

async function main() {
  // ── 1. Punch-in ──────────────────────────────────────────────────────────
  {
    const [r] = await pending(world(), at("08:15"), ["punch"]);
    assert.equal(r!.state, "ok");
    const ids = who(r!) as string[];
    for (const id of [ASHA, BINA, CHETAN, JAYA, PRIN]) assert.ok(ids.includes(id), `${id} has not punched → reminded`);
    assert.ok(!ids.includes(DEEP), "exempt from attendance → not reminded");
    assert.ok(!ids.includes(ESHA), "on approved leave → not reminded");
    assert.ok(!ids.includes(FARAH), "on outdoor duty → not reminded");
    assert.ok(!ids.includes(GOPAL), "visiting staff come on their own days → not reminded");
    assert.ok(!ids.includes(HARI), "already punched → not reminded");
    assert.ok(!ids.includes(INDU), "marked absent by the office → not reminded");
  }
  {
    // A published school holiday for staff.
    const hol = {
      ...masters,
      holidays: [{ id: "h1", academicYearCode: AY, title: "Diwali", startsOn: DATE, endsOn: DATE, kind: "festival", scope: "school", groupCode: "", classIds: [], appliesTo: "everyone", mode: "one_off", weekday: null, dayType: "full", paidForStaff: true, exceptionDates: [], workingOverride: false, isPublished: true, publishedAt: null, publishedBy: "", note: "" }],
    } as unknown as MastersState;
    const [r] = await pending(world(), at("08:15"), ["punch"], { school: async () => ok({ masters: hol, rbac, superAdminEmails: [] }) });
    assert.equal(r!.state, "off", "a staff holiday → nobody is reminded to punch");
    const [g] = await pending(world(), at("09:30"), ["register"], { school: async () => ok({ masters: hol, rbac, superAdminEmails: [] }) });
    assert.equal(g!.state, "off", "a school holiday → no register reminder");
    const sunday = await pending(world(), at("08:15", "2026-11-01"), ["punch"]);
    assert.equal(sunday[0]!.state, "off", "Sunday is not a school day");
  }

  // ── 2. Class register ────────────────────────────────────────────────────
  {
    const [r] = await pending(world(), at("09:30"), ["register"]);
    assert.equal(r!.state, "ok");
    const items = r!.state === "ok" ? r!.items : [];
    const of = (id: string) => items.find((i) => i.staffId === id);
    assert.ok(of(ASHA)?.lines.some((l) => l.en === "Class 5 · A register"), "class teacher of 5-A reminded");
    assert.ok(!of(CHETAN)?.lines.some((l) => l.en.startsWith("Class 5 · A")), "5-A's teacher is in: the co-ordinator is not reminded for it");
    assert.ok(of(CHETAN)?.lines.some((l) => l.en === "Class 6 · A register"), "Chetan is reminded for his own 6-A");
    assert.ok(!of(ESHA), "5-B's class teacher is on leave → not reminded");
    assert.ok(of(JAYA)?.lines.some((l) => l.en === "Class 5 · B register"), "…today's substitute in 5-B is (cover counts)");
    assert.ok(!of(BINA), "a subject teacher is not reminded for the register");
  }
  {
    // Asha away: 5-A falls to its co-ordinator.
    const [r] = await pending(world(), at("09:30"), ["register"], {
      staffMarks: async () => ok(new Map([[ASHA, { status: "A", inTime: "" }]])),
    });
    const items = r!.state === "ok" ? r!.items : [];
    assert.ok(!items.find((i) => i.staffId === ASHA), "absent class teacher not reminded");
    assert.ok(items.find((i) => i.staffId === CHETAN)?.lines.some((l) => l.en === "Class 5 · A register"), "the co-ordinator covers 5-A");
  }
  {
    // A register the co-ordinator (or anyone) took counts: nobody is reminded for it.
    const [r] = await pending(world(), at("09:30"), ["register"], {
      registersMarked: async () => ok(new Set([`${C5}:${S5A}`, `${C5}:${S5B}`, `${C6}:${S6A}`])),
    });
    assert.deepEqual(who(r!), [], "every register taken → nobody reminded");
  }

  // ── 3. Homework ──────────────────────────────────────────────────────────
  {
    const [r] = await pending(world(), at("15:00"), ["homework"]);
    const items = r!.state === "ok" ? r!.items : [];
    assert.deepEqual(items.map((i) => i.staffId).sort(), [ASHA, BINA], "today's periods by the PUBLISHED timetable");
    assert.ok(items.find((i) => i.staffId === BINA)!.lines[0]!.en === "Class 5 · A · Maths");
    assert.ok(items.find((i) => i.staffId === ASHA)!.lines[0]!.en === "Class 5 · A · Hindi", "Hindi — Oral posts as Hindi");
    assert.ok(!items.find((i) => i.staffId === JAYA), "a Wednesday period is not today's");
    assert.ok(!items.find((i) => i.staffId === ESHA), "a teacher on leave owes no homework");

    const [done] = await pending(world(), at("15:00"), ["homework"], {
      homeworkPosts: async () => ok([
        { classId: C5, sectionId: S5A, subjectId: MATH },
        { classId: C5, sectionId: S5A, subjectId: HIN }, // posted on the parent: covers Hindi — Oral
      ]),
    });
    assert.deepEqual(who(done!), [], "posted for that section and subject → not reminded");

    const [none] = await pending(world(), at("15:00"), ["homework"], { timetable: async () => ok({ ...TIMETABLE, publishedGrids: [] }) });
    assert.equal(none!.state, "off", "no published timetable → no homework reminder (drafts never count)");
  }

  // ── 4. Exam marks ────────────────────────────────────────────────────────
  {
    assert.equal(marksWindow("2026-10-25", "2026-10-29", 3), "before", "D-4: not yet");
    assert.equal(marksWindow("2026-10-26", "2026-10-29", 3), "remind", "D-3: remind");
    assert.equal(marksWindow("2026-10-29", "2026-10-29", 3), "remind", "the day itself: remind");
    assert.equal(marksWindow("2026-10-30", "2026-10-29", 3), "overdue", "D+1: overdue");
    const gap = { termId: "t1", termLabel: "Half-yearly", classId: C5, sectionId: S5A, sectionLabel: "Class 5 · A", subjectName: "Maths", teacherIds: [BINA] };
    const due = marksPending({ date: DATE, leadDays: 3, gaps: [{ ...gap, dueOn: "2026-10-31" }] });
    assert.equal(due.length, 1);
    assert.equal(marksToRemind(due, DATE).length, 1, "inside the window → reminded");
    const late = marksPending({ date: DATE, leadDays: 3, gaps: [{ ...gap, dueOn: "2026-10-27" }] });
    assert.equal(late[0]!.overdue, true);
    assert.equal(marksToRemind(late, DATE).length, 0, "past the deadline the reminders stop (the brief escalates it)");
    assert.equal(marksPending({ date: DATE, leadDays: 3, gaps: [{ ...gap, dueOn: "2026-11-05" }] }).length, 0, "a week out: nothing");

    // The deadline is a policy field that survives a save.
    const pol = normalizeExamPolicy({ marksDueByTerm: { t1: "2026-10-31", t2: "31/10/2026", t3: 5 } } as never);
    assert.deepEqual(pol.marksDueByTerm, { t1: "2026-10-31" }, "marks due dates kept; bad ones dropped");
    const [noDeadline] = await pending(world(), at("16:00"), ["marks"]);
    assert.equal(noDeadline!.state, "off", "no exam carries a marks deadline → no marks reminder (nothing invented)");

    // End to end through the Exams readiness functions: Half-yearly due on
    // the 31st, Maths entered for one of 5-A's two children.
    const term = {
      id: "t1", code: "HY", label: "Half-yearly", academicYearCode: AY, maxMarks: 100, sortOrder: 1, isActive: true,
      startsOn: "", endsOn: "", note: "", countsTowardHy: true, countsTowardFinal: true, weightInHy: 20, weightInFinal: 20,
      requiredOnMarksheet: true, requiresSeparateMarksheet: true,
    };
    const setup = {
      terms: [term],
      subjects: [{ id: "es_math", code: "MATH", name: "Maths", classIds: [C5], maxMarks: 100, sortOrder: 1, isActive: true }],
      dateSheet: [],
      policy: normalizeExamPolicy({ marksDueByTerm: { t1: "2026-10-31" } }),
      promotions: [],
      rooms: [],
      seating: [],
    };
    const sheet = (marks: { studentId: string; marksObtained: number | null }[]) => ({
      id: "ms1", academicYearCode: AY, examTermId: "t1", classId: C5, sectionId: S5A,
      marks: marks.map((m) => ({ ...m, subjectId: "es_math", component: "", grade: "" })),
      absences: [], coScholastic: [], overallRemarks: [], itemScores: [], lockedAt: null, enteredBy: "", updatedAt: "",
    });
    const run = (sheets: unknown[], o: Overrides = {}) =>
      pending(world(), at("16:00"), ["marks"], { examSetup: async () => ok(setup as never), examSheets: async () => ok(sheets as never), ...o });
    const [half] = await run([sheet([{ studentId: "st1", marksObtained: 41 }])]);
    assert.equal(half!.state, "ok");
    const mine = half!.state === "ok" ? half!.items : [];
    const for5A = mine.filter((i) => i.lines.some((l) => l.en === "Half-yearly: Class 5 · A · Maths")).map((i) => i.staffId);
    assert.deepEqual(for5A, [BINA, JAYA], "5-A Maths falls to its Maths teachers (published timetable) — not the class teacher");
    assert.ok(!mine.some((i) => i.staffId === ASHA), "the class teacher is not reminded while subject teachers exist");
    assert.ok(mine.find((i) => i.staffId === ESHA)?.lines.some((l) => l.en === "Half-yearly: Class 5 · B · Maths"), "5-B has no sheet at all → pending");
    assert.equal(mine.find((i) => i.staffId === BINA)!.dueOn, "2026-10-31");
    const [full] = await run([sheet([{ studentId: "st1", marksObtained: 41 }, { studentId: "st2", marksObtained: 37 }])]);
    assert.ok(full!.state === "ok" && !full!.items.some((i) => i.lines.some((l) => l.en.includes("Class 5 · A"))), "every child marked → not pending");
    const [unread] = await run([], { examSheets: async () => bad("timeout") });
    assert.equal(unread!.state, "unknown", "mark sheets unreadable → unknown, never 'all pending'");
  }

  // ── 5. Approvals waiting ─────────────────────────────────────────────────
  {
    const [r] = await pending(world(), at("17:30"), ["approvals"], {
      complaints: async () => ok([
        { id: "c1", status: "assigned", assignedToStaffId: JAYA, studentId: "st1" } as never,
        { id: "c2", status: "resolved", assignedToStaffId: BINA, studentId: "st1" } as never,
      ]),
    });
    const items = r!.state === "ok" ? r!.items : [];
    const of = (id: string) => items.find((i) => i.staffId === id);
    assert.ok(of(PRIN)?.lines.some((l) => l.en === "1 staff leave request"), "the principal decides staff leave");
    assert.ok(!of(HARI)?.kinds?.staff_leave, "never the applicant");
    assert.ok(of(CHETAN)?.lines.some((l) => l.en === "1 document to verify"), "6-A's class teacher verifies 6-A's document");
    assert.deepEqual(of(JAYA)?.lines.map((l) => l.en), ["1 complaint"], "an assigned complaint → its assignee only");
    assert.ok(!of(BINA), "a resolved complaint waits for nobody");
    assert.ok(!of(ASHA), "nothing waits for Asha");
  }

  // ── 6. The tick: sends once a day, honours quiet hours ───────────────────
  {
    const w = world();
    const t1 = await runReminderTick(deps(w, at("08:15")), {});
    const punch = t1.rules.find((x) => x.rule === "punch")!;
    assert.equal(t1.ok, true);
    assert.ok(punch.reminded >= 5 && punch.pushed === punch.reminded, "first tick: stored and pushed");
    assert.ok(w.rows.every((r) => r.kind === "staff_reminder.punch" && r.dedupe_key === `staff_reminder:punch:${DATE}`), "kind and dedupe key");
    assert.equal(w.rows.find((r) => r.recipient_id === ASHA)?.link, "/my-attendance", "the app opens the attendance screen");
    const pushesAfterFirst = w.pushes.length;
    const waAfterFirst = w.wa.length;

    const t2 = await runReminderTick(deps(w, at("08:30")), {});
    const p2 = t2.rules.find((x) => x.rule === "punch")!;
    assert.equal(p2.reminded, 0, "second tick the same day: nothing new stored");
    assert.equal(p2.duplicate, punch.reminded, "…every one a duplicate");
    assert.equal(w.pushes.length, pushesAfterFirst, "…no push");
    assert.equal(w.wa.length, waAfterFirst, "…no WhatsApp");

    const t3 = await runReminderTick(deps(w, at("08:15", "2026-10-30")), {});
    assert.ok(t3.rules[0]!.reminded > 0, "the next school day reminds again");
  }
  {
    const w = world();
    // Asha's quiet hours cover the morning; nobody else's do.
    w.prefs.set(`staff:${ASHA}`, { ...DEFAULT_PREFS, quietEnabled: true, quietStart: "07:00", quietEnd: "09:00" });
    await runReminderTick(deps(w, at("08:15")), { rules: ["punch"] });
    assert.ok(w.rows.some((r) => r.recipient_id === ASHA), "quiet hours: still in the bell");
    assert.ok(!w.pushes.some((p) => p.to === ASHA), "…but her phone does not ring");
    assert.ok(w.pushes.some((p) => p.to === BINA), "…others' do");
    // A muted topic is honoured the same way.
    const w2 = world();
    w2.prefs.set(`staff:${BINA}`, { ...DEFAULT_PREFS, mutedTopics: ["attendance"] });
    await runReminderTick(deps(w2, at("08:15")), { rules: ["punch"] });
    assert.ok(!w2.pushes.some((p) => p.to === BINA) && !w2.wa.some((x) => x.staffId === BINA), "muted topic: no push, no WhatsApp");
  }

  // ── 7. A failed read sends nothing ───────────────────────────────────────
  for (const [what, o] of [
    ["the staff register", { staffMarks: async () => bad("timeout") }],
    ["the exempt list", { exempt: async () => bad("timeout") }],
    ["staff leave", { staffLeave: async () => bad("timeout") }],
    ["outdoor duty", { outdoorDuty: async () => bad("timeout") }],
    ["the roster", { school: async () => bad("roster unknown") }],
    ["the settings", { settings: async () => bad("timeout") }],
  ] as [string, Overrides][]) {
    const w = world();
    const t = await runReminderTick(deps(w, at("08:15"), o), { rules: ["punch"] });
    assert.equal(w.notifyCalls, 0, `${what} unreadable → nobody notified`);
    assert.equal(w.wa.length, 0, `${what} unreadable → no WhatsApp`);
    assert.equal(t.ok, false, `${what} unreadable → the tick reports failure`);
  }
  {
    const w = world();
    await runReminderTick(deps(w, at("09:30"), { registersMarked: async () => bad("timeout") }), { rules: ["register"] });
    assert.equal(w.notifyCalls, 0, "registers unreadable → no 'register not taken' sent to anyone");
    await runReminderTick(deps(w, at("15:00"), { homeworkPosts: async () => bad("timeout") }), { rules: ["homework"] });
    assert.equal(w.notifyCalls, 0, "homework unreadable → nobody told they did not post");
    await runReminderTick(deps(w, at("09:30"), { coordinators: async () => bad("timeout") }), { rules: ["register"] });
    assert.equal(w.notifyCalls, 0, "co-ordinators unreadable → register rule unknown");
    await runReminderTick(deps(w, at("17:30"), { complaints: async () => bad("timeout") }), { rules: ["approvals"] });
    assert.equal(w.notifyCalls, 0, "one approvals source unreadable → no partial 'waiting for you'");
  }

  // ── 8. WhatsApp fallback: only for staff the app cannot reach ────────────
  {
    const now = at("08:15");
    assert.equal(needsWhatsAppFallback([], now, 3), true, "no device → WhatsApp");
    assert.equal(needsWhatsAppFallback([new Date(now - 3600_000).toISOString()], now, 3), false, "seen an hour ago → app only");
    assert.equal(needsWhatsAppFallback([new Date(now - 4 * 86_400_000).toISOString()], now, 3), true, "not seen for 4 days → WhatsApp");
    assert.equal(needsWhatsAppFallback(undefined, now, 3), false, "devices unreadable → no WhatsApp (unknown)");

    const w = world();
    await runReminderTick(deps(w, now), { rules: ["punch"] });
    assert.ok(!w.wa.some((x) => x.staffId === ASHA), "Asha's phone was seen an hour ago → no WhatsApp");
    assert.ok(w.wa.some((x) => x.staffId === JAYA), "Jaya has no app device → WhatsApp");
    assert.ok(w.wa.every((x) => !/[\n\t]/.test(x.line)), "one line: Meta refuses a newline in a parameter");

    const w2 = world();
    await runReminderTick(deps(w2, now, { devices: async () => bad("timeout") }), { rules: ["punch"] });
    assert.equal(w2.wa.length, 0, "device list unreadable → no WhatsApp");
    assert.ok(w2.rows.length > 0, "…the bell and push still go");

    const w3 = world();
    await runReminderTick(deps(w3, now, { settingsValue: { ...DEFAULT_REMINDER_SETTINGS, whatsappFallback: false } }), { rules: ["punch"] });
    assert.equal(w3.wa.length, 0, "fallback switched off → none");

    const w4 = world();
    await runReminderTick(deps(w4, at("08:15"), { prefs: async () => null }), { rules: ["punch"] });
    assert.equal(w4.wa.length, 0, "settings unreadable → no WhatsApp (quiet hours unknown)");

    const line = whatsappLine(
      { rule: "register", staffId: ASHA, count: 2, lines: [{ en: "Class 5 · A register", hi: "x" }, { en: "Class 6 · A register", hi: "y" }] },
      "en",
    );
    assert.equal(line, "2 registers not taken today — Take attendance: Class 5 · A register · Class 6 · A register");
  }

  // ── 9. The 6 PM brief: who did not act ───────────────────────────────────
  {
    const w = world();
    await runReminderTick(deps(w, at("08:15")), { rules: ["punch"] });
    await runReminderTick(deps(w, at("09:30")), { rules: ["register"] });
    // By 6 PM Bina punched; Jaya took 5-B.
    const evening = deps(w, at("18:00"), {
      staffMarks: async () =>
        ok(
          new Map([
            [HARI, { status: "P", inTime: "08:01" }],
            [BINA, { status: "P", inTime: "09:10" }],
            [ESHA, { status: "LE", inTime: "" }],
            [INDU, { status: "A", inTime: "" }],
          ]),
        ),
      registersMarked: async () => ok(new Set([`${C5}:${S5B}`])),
    });
    const b = await readUnanswered(evening, { date: DATE });
    const row = (id: string) => b.rows.find((r) => r.staffId === id);
    assert.ok(row(ASHA)?.what.includes("not punched in"), "reminded and still not punched → listed");
    assert.ok(row(ASHA)?.what.some((x) => x.startsWith("register not taken (Class 5 · A")), "…and her register");
    assert.ok(!row(BINA), "punched after the reminder → not listed");
    assert.ok(!row(JAYA)?.what.some((x) => x.startsWith("register")), "took the register after the reminder → not listed for it");
    assert.ok(!b.rows.some((r) => r.what.some((x) => x.startsWith("homework"))), "homework: no reminder went yet at this test's ticks → nobody listed for it");
    assert.deepEqual(b.unknown, [], "everything could be read");

    // Someone pending who was never reminded is not "unanswered".
    const fresh = await readUnanswered(deps(world(), at("18:00")), { date: DATE });
    assert.equal(fresh.rows.length, 0, "no reminder went → nothing unanswered");

    // Unknown is said out loud.
    const broken = await readUnanswered(deps(world(), at("18:00"), { reminded: async () => bad("timeout") }), { date: DATE });
    assert.ok(broken.unknown.includes("punch"), "unreadable reminder log → 'could not be checked'");

    const brief = { ...emptyBrief(DATE, "BHB"), reminders: b };
    const summary = composeBriefSummary(brief);
    assert.match(summary, /did not act on today's reminders: Person s_asha \(not punched in/, "the brief names them");
    assert.ok(pendingFacts(brief).some((f) => /did not act on today's reminders/.test(f.text)), "…and the 'still open' facts carry it");
    assert.match(unansweredLine(broken), /could not be checked for punch-in/);

    // Marks past their deadline are escalated whether or not a reminder went today.
    const marks = unansweredReminders({
      date: DATE,
      results: [{ rule: "marks", state: "ok", items: [{ rule: "marks", staffId: BINA, count: 1, lines: [{ en: "x", hi: "x" }], dueOn: "2026-10-27", overdue: true }] }],
      reminded: new Map([["marks", new Set<string>()]]),
      nameOf: (id) => id,
    });
    assert.deepEqual(marks.rows[0]?.what, ["marks overdue (1)"]);
  }

  // ── 10. Kinds, links, text ───────────────────────────────────────────────
  {
    for (const rule of ["punch", "register", "homework", "marks", "approvals"] as const) {
      const ev = reminderEvent({ rule, staffId: ASHA, count: 1, lines: [{ en: "Class 5 · A", hi: "Class 5 · A" }], dueOn: DATE }, DATE);
      assert.ok(NOTIFY_KINDS[ev.kind], `${ev.kind} is a registered notification kind`);
      assert.equal(ev.key, `staff_reminder:${rule}:${DATE}`);
      assert.deepEqual(ev.audience, [{ staff: [ASHA] }], "only the person it is about");
      assert.ok(ev.title.en && ev.title.hi, "English and Hindi");
    }
    assert.equal(NOTIFY_KINDS["staff_reminder.approvals"].topic, "approval");
    assert.equal(NOTIFY_KINDS["staff_reminder.punch"].urgent, false, "never urgent: quiet hours apply");
  }

  console.log("ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
