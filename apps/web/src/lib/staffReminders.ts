/**
 * Personal work reminders for staff (director, 29 Oct 2026): every member of
 * staff is reminded, in the staff app, of THEIR OWN pending work.
 *
 *   punch      08:15  staff who should punch and have not: not exempt (the
 *                     office's list, owner / admin), not on approved leave,
 *                     not on outdoor duty, not on a staff holiday, not
 *                     visiting staff (they come on their own days)
 *   register   09:30  the class teacher(s) of a section whose register for
 *                     today is not taken — "taken" exactly as the 6 PM brief
 *                     counts it (a register with at least one P or A mark).
 *                     When the class teachers are all away, the section's
 *                     co-ordinator and today's substitutes are reminded
 *                     instead (lib/attendanceCover); a register a co-ordinator
 *                     or cover teacher took counts as taken
 *   homework   15:00  a teacher who had a period in a section today by the
 *                     PUBLISHED timetable and posted no homework for that
 *                     section and subject today (the brief's posted test)
 *   marks      16:00  subject teachers with marks still to enter for an exam
 *                     whose "marks due by" date (Exams → policy, per exam) is
 *                     within 3 days or today; a section with no teacher for
 *                     the subject falls to its class teacher
 *   approvals  17:30  whoever must act on what waits — staff leave (the
 *                     leave approvers + the named approver rules), parents'
 *                     leave (class teacher; leadership for long / medical),
 *                     documents to verify, complaints and staff requests
 *                     assigned to them (or, unassigned, the people the
 *                     original notification went to)
 *
 * Pure: the server (staffReminders.server.ts) reads the inputs from the
 * database; the self-test drives every rule with plain objects.
 *
 * A rule whose inputs could not be read is "unknown", never "nothing
 * pending": unknown sends nothing and is logged (R6).
 */
import type { StaffRecord } from "@/lib/foundationMasters";
import type { AudienceRule } from "@/lib/notify/audience";
import type { NotifyKind } from "@/lib/notify/kinds";
import type { NotifyEvent, Text } from "@/lib/notify/notify";

export const REMINDER_RULES = ["punch", "register", "homework", "marks", "approvals"] as const;
export type ReminderRule = (typeof REMINDER_RULES)[number];

export function isReminderRule(v: unknown): v is ReminderRule {
  return typeof v === "string" && (REMINDER_RULES as readonly string[]).includes(v);
}

export const REMINDER_RULE_LABELS: Record<ReminderRule, string> = {
  punch: "Punch-in",
  register: "Class register",
  homework: "Homework",
  marks: "Exam marks",
  approvals: "Approvals waiting",
};

/* ── Settings ───────────────────────────────────────────────────────────── */

export const REMINDER_SETTINGS_KEY = "staff_reminder_settings";

export type ReminderRuleSetting = { enabled: boolean; /** "HH:MM", India time */ at: string };

export type ReminderSettings = {
  version: 1;
  /** Master switch. */
  enabled: boolean;
  rules: Record<ReminderRule, ReminderRuleSetting>;
  /** Marks: remind from this many days before the deadline, then on the day. */
  marksLeadDays: number;
  /**
   * A tick later than `at + windowMinutes` does not send that rule: a 15-minute
   * tick honours the configured time, and a job that ran late in the
   * afternoon never sends the morning's punch reminder.
   */
  windowMinutes: number;
  /** WhatsApp (approved template only) for staff the app cannot reach. */
  whatsappFallback: boolean;
  /** "No app activity" = no device seen for this many days. */
  appInactiveDays: number;
  updatedAt: string;
  updatedBy: string;
};

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  version: 1,
  enabled: true,
  rules: {
    punch: { enabled: true, at: "08:15" },
    register: { enabled: true, at: "09:30" },
    homework: { enabled: true, at: "15:00" },
    marks: { enabled: true, at: "16:00" },
    approvals: { enabled: true, at: "17:30" },
  },
  marksLeadDays: 3,
  windowMinutes: 90,
  whatsappFallback: true,
  appInactiveDays: 3,
  updatedAt: "",
  updatedBy: "",
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function intIn(v: unknown, lo: number, hi: number, d: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
}

/** A stored / posted settings object; unknown fields dropped, bad ones defaulted. */
export function normalizeReminderSettings(raw: unknown): ReminderSettings {
  const d = DEFAULT_REMINDER_SETTINGS;
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const r = (o.rules && typeof o.rules === "object" ? o.rules : {}) as Record<string, unknown>;
  const rules = {} as Record<ReminderRule, ReminderRuleSetting>;
  for (const rule of REMINDER_RULES) {
    const x = (r[rule] && typeof r[rule] === "object" ? r[rule] : {}) as Record<string, unknown>;
    rules[rule] = {
      enabled: typeof x.enabled === "boolean" ? x.enabled : d.rules[rule].enabled,
      at: typeof x.at === "string" && HHMM.test(x.at) ? x.at : d.rules[rule].at,
    };
  }
  return {
    version: 1,
    enabled: typeof o.enabled === "boolean" ? o.enabled : d.enabled,
    rules,
    marksLeadDays: intIn(o.marksLeadDays, 0, 14, d.marksLeadDays),
    windowMinutes: intIn(o.windowMinutes, 15, 240, d.windowMinutes),
    whatsappFallback: typeof o.whatsappFallback === "boolean" ? o.whatsappFallback : d.whatsappFallback,
    appInactiveDays: intIn(o.appInactiveDays, 1, 30, d.appInactiveDays),
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : "",
    updatedBy: typeof o.updatedBy === "string" ? o.updatedBy : "",
  };
}

/* ── India time ─────────────────────────────────────────────────────────── */

const IST_MS = 330 * 60_000;

/** "YYYY-MM-DD" in India (the same arithmetic as monthRange.istTodayIso). */
export function istDateOf(nowMs: number): string {
  return new Date(nowMs + IST_MS).toISOString().slice(0, 10);
}

/** Minutes since midnight in India. */
export function istMinutesOf(nowMs: number): number {
  const m = Math.floor((nowMs + IST_MS) / 60_000);
  return ((m % 1440) + 1440) % 1440;
}

export function minutesOfHhMm(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Day of week (0 = Sunday) of an India calendar date. */
export function weekdayOf(dateIso: string): number {
  return new Date(`${dateIso}T12:00:00Z`).getUTCDay();
}

/** `dateIso` plus `days` (may be negative), as an India calendar date. */
export function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The rules whose time has come at `nowMs` and whose window has not passed. */
export function dueRules(settings: ReminderSettings, nowMs: number): ReminderRule[] {
  if (!settings.enabled) return [];
  const now = istMinutesOf(nowMs);
  return REMINDER_RULES.filter((rule) => {
    const s = settings.rules[rule];
    if (!s.enabled) return false;
    const at = minutesOfHhMm(s.at);
    return now >= at && now < at + settings.windowMinutes;
  });
}

/** True once the rule's time has come today (the brief: was anyone reminded yet?). */
export function rulePassed(settings: ReminderSettings, rule: ReminderRule, nowMs: number): boolean {
  return settings.enabled && settings.rules[rule].enabled && istMinutesOf(nowMs) >= minutesOfHhMm(settings.rules[rule].at);
}

/* ── Results ────────────────────────────────────────────────────────────── */

export type PendingLine = Text & { hi: string };

export type PendingItem = {
  rule: ReminderRule;
  staffId: string;
  /** How many things are pending (registers, class-subjects, sheets, approvals). */
  count: number;
  /** One per pending thing, e.g. "Class 5 · A". */
  lines: PendingLine[];
  /** Marks only: the earliest deadline among the lines, and whether it has passed. */
  dueOn?: string;
  overdue?: boolean;
  /** Approvals only: counts by kind, for the link. */
  kinds?: Partial<Record<ApprovalKind, number>>;
};

export type RuleResult =
  | { rule: ReminderRule; state: "ok"; items: PendingItem[] }
  /** Nothing to remind about by design: a holiday, Sunday, rule off, no deadline set. */
  | { rule: ReminderRule; state: "off"; reason: string }
  /** An input could not be read: send nothing, say so. */
  | { rule: ReminderRule; state: "unknown"; reason: string };

function byStaff(items: PendingItem[]): PendingItem[] {
  return items.sort((a, b) => a.staffId.localeCompare(b.staffId));
}

function pushLine(map: Map<string, PendingItem>, rule: ReminderRule, staffId: string, line: PendingLine, key?: string, seen?: Set<string>) {
  if (key && seen) {
    const k = `${staffId}|${key}`;
    if (seen.has(k)) return;
    seen.add(k);
  }
  const cur = map.get(staffId) ?? { rule, staffId, count: 0, lines: [] };
  cur.count += 1;
  cur.lines.push(line);
  map.set(staffId, cur);
}

/* ── 1. Punch-in ────────────────────────────────────────────────────────── */

export type PunchMark = { status: string; inTime: string };

/** Marks that mean the person is accounted for today. */
const AT_WORK = new Set(["P", "L", "HD"]);

export function punchPending(input: {
  staff: readonly Pick<StaffRecord, "id" | "status" | "category" | "stream">[];
  exempt: ReadonlySet<string>;
  onApprovedLeave: ReadonlySet<string>;
  onOutdoorDuty: ReadonlySet<string>;
  /** Today's staff register marks by staff id. */
  marks: ReadonlyMap<string, PunchMark>;
  /** The staff holiday that gives this person the day off, or "" on a working day. */
  dayOffFor: (s: Pick<StaffRecord, "stream">) => string;
}): PendingItem[] {
  const out = new Map<string, PendingItem>();
  for (const s of input.staff) {
    if (s.status !== "active" || !s.id) continue;
    if (s.category === "visiting") continue;
    if (input.exempt.has(s.id) || input.onApprovedLeave.has(s.id) || input.onOutdoorDuty.has(s.id)) continue;
    if (input.dayOffFor(s)) continue;
    const m = input.marks.get(s.id);
    if (m) {
      // Punched (or marked present / late / half day by the office), on
      // leave (LE), or marked absent (A): accounted for either way.
      if (AT_WORK.has(m.status) || (m.inTime || "").trim() || m.status === "LE" || m.status === "A") continue;
    }
    pushLine(out, "punch", s.id, { en: "Punch in for today", hi: "आज की हाज़िरी (पंच) लगाएँ" });
  }
  return byStaff([...out.values()]);
}

/* ── 2. Class register ──────────────────────────────────────────────────── */

export type ReminderSection = {
  classId: string;
  sectionId: string;
  /** "Class 5 · A" */
  label: string;
  /** Active students this year. A section with none has no register to take. */
  strength: number;
};

export const sectionKeyOf = (classId: string, sectionId: string) => `${classId}:${sectionId}`;

export function registerPending(input: {
  sections: readonly ReminderSection[];
  /** "classId:sectionId" whose register today has at least one P or A mark. */
  marked: ReadonlySet<string>;
  /** Full holiday label for this class today, or "". */
  classOff: (classId: string) => string;
  /** Active class teachers of a section this year. */
  classTeachers: (classId: string, sectionId: string) => string[];
  /** "classId|sectionId" → co-ordinator staff id. */
  coordinatorOf: ReadonlyMap<string, string>;
  /** "classId|sectionId" → today's substitutes. */
  substitutesOf: ReadonlyMap<string, readonly string[]>;
  /** Staff away today (A / LE / HD on the register, or approved leave). */
  absent: ReadonlySet<string>;
}): PendingItem[] {
  const out = new Map<string, PendingItem>();
  const seen = new Set<string>();
  for (const sec of input.sections) {
    if (sec.strength <= 0) continue;
    if (input.classOff(sec.classId)) continue;
    const key = sectionKeyOf(sec.classId, sec.sectionId);
    if (input.marked.has(key)) continue;
    const coverKey = `${sec.classId}|${sec.sectionId}`;
    const teachers = input.classTeachers(sec.classId, sec.sectionId);
    const present = teachers.filter((t) => !input.absent.has(t));
    let who = present;
    if (who.length === 0) {
      // Every class teacher away (or none appointed): the cover does it.
      const cover = [input.coordinatorOf.get(coverKey) ?? "", ...(input.substitutesOf.get(coverKey) ?? [])];
      who = [...new Set(cover.filter((id) => id && !input.absent.has(id)))];
    }
    const line = { en: `${sec.label} register`, hi: `${sec.label} का रजिस्टर` };
    for (const id of who) pushLine(out, "register", id, line, key, seen);
  }
  return byStaff([...out.values()]);
}

/* ── 3. Homework ────────────────────────────────────────────────────────── */

export type ReminderSlot = { weekday: number; subjectId: string; teacherId: string };

export function homeworkPending(input: {
  weekday: number;
  /** Working sections today (not on holiday, with children) and their PUBLISHED grid. */
  sections: readonly (ReminderSection & { slots: readonly ReminderSlot[] })[];
  /** "Hindi — Oral" posts as Hindi: the parent subject id. */
  subjectKey: (subjectId: string) => string;
  subjectName: (subjectId: string) => string;
  activeStaff: ReadonlySet<string>;
  absent: ReadonlySet<string>;
  /** "classId:sectionId|subjectKey" with a homework post today. */
  posted: ReadonlySet<string>;
}): PendingItem[] {
  const out = new Map<string, PendingItem>();
  const seen = new Set<string>();
  for (const sec of input.sections) {
    const secKey = sectionKeyOf(sec.classId, sec.sectionId);
    for (const slot of sec.slots) {
      if (slot.weekday !== input.weekday || !slot.subjectId || !slot.teacherId) continue;
      if (!input.activeStaff.has(slot.teacherId) || input.absent.has(slot.teacherId)) continue;
      const subj = input.subjectKey(slot.subjectId);
      const k = `${secKey}|${subj}`;
      if (input.posted.has(k)) continue;
      const name = input.subjectName(subj);
      pushLine(out, "homework", slot.teacherId, { en: `${sec.label} · ${name}`, hi: `${sec.label} · ${name}` }, k, seen);
    }
  }
  return byStaff([...out.values()]);
}

/* ── 4. Exam marks ──────────────────────────────────────────────────────── */

export type MarksGap = {
  termId: string;
  termLabel: string;
  dueOn: string;
  classId: string;
  sectionId: string;
  sectionLabel: string;
  subjectName: string;
  /** Who enters it: the subject teachers, else the class teachers. */
  teacherIds: readonly string[];
};

/** Is `date` inside [dueOn − leadDays, dueOn]? Past = overdue. */
export function marksWindow(date: string, dueOn: string, leadDays: number): "before" | "remind" | "overdue" {
  if (!dueOn) return "before";
  if (date > dueOn) return "overdue";
  return date >= addDaysIso(dueOn, -leadDays) ? "remind" : "before";
}

/** Gaps → one item per teacher. `overdue` gaps are kept (the brief escalates them). */
export function marksPending(input: { date: string; leadDays: number; gaps: readonly MarksGap[] }): PendingItem[] {
  const out = new Map<string, PendingItem>();
  const seen = new Set<string>();
  for (const g of input.gaps) {
    const w = marksWindow(input.date, g.dueOn, input.leadDays);
    if (w === "before") continue;
    const line = { en: `${g.termLabel}: ${g.sectionLabel} · ${g.subjectName}`, hi: `${g.termLabel}: ${g.sectionLabel} · ${g.subjectName}` };
    for (const id of g.teacherIds) {
      const before = out.get(id)?.count ?? 0;
      pushLine(out, "marks", id, line, `${g.termId}|${g.classId}:${g.sectionId}|${g.subjectName}`, seen);
      const cur = out.get(id);
      if (cur && cur.count > before) {
        if (!cur.dueOn || g.dueOn < cur.dueOn) cur.dueOn = g.dueOn;
        cur.overdue = (cur.dueOn ?? "") < input.date;
      }
    }
  }
  return byStaff([...out.values()]);
}

/** The items the tick sends today: inside the window, not merely overdue. */
export function marksToRemind(items: readonly PendingItem[], date: string): PendingItem[] {
  return items.filter((i) => !i.overdue && (i.dueOn ?? "") >= date);
}

/* ── 5. Approvals waiting ───────────────────────────────────────────────── */

export type ApprovalKind = "staff_leave" | "student_leave" | "document" | "complaint" | "staff_request";

export type WaitingThing = {
  kind: ApprovalKind;
  refId: string;
  /** Who must act — the same rules the original notification used. */
  audience: readonly AudienceRule[];
  /** Never the person it is about (a leave applicant, a request raiser). */
  exclude?: readonly string[];
};

const APPROVAL_LABELS: Record<ApprovalKind, { one: string; many: string; hi: string }> = {
  staff_leave: { one: "staff leave request", many: "staff leave requests", hi: "स्टाफ छुट्टी अनुरोध" },
  student_leave: { one: "leave request from a parent", many: "leave requests from parents", hi: "अभिभावकों के छुट्टी अनुरोध" },
  document: { one: "document to verify", many: "documents to verify", hi: "जाँचने हेतु दस्तावेज़" },
  complaint: { one: "complaint", many: "complaints", hi: "शिकायतें" },
  staff_request: { one: "staff request", many: "staff requests", hi: "स्टाफ अनुरोध" },
};

const APPROVAL_ORDER: ApprovalKind[] = ["staff_leave", "student_leave", "document", "complaint", "staff_request"];

/** `resolve` is lib/notify/audience.resolveAudience bound to the school's roster and roles. */
export function approvalsPending(input: {
  things: readonly WaitingThing[];
  resolve: (rules: readonly AudienceRule[], exclude: readonly string[]) => string[];
}): PendingItem[] {
  const counts = new Map<string, Partial<Record<ApprovalKind, number>>>();
  for (const t of input.things) {
    for (const id of input.resolve(t.audience, t.exclude ?? [])) {
      const c = counts.get(id) ?? {};
      c[t.kind] = (c[t.kind] ?? 0) + 1;
      counts.set(id, c);
    }
  }
  const out: PendingItem[] = [];
  for (const [staffId, kinds] of counts) {
    const lines: PendingLine[] = [];
    let total = 0;
    for (const k of APPROVAL_ORDER) {
      const n = kinds[k] ?? 0;
      if (!n) continue;
      total += n;
      const l = APPROVAL_LABELS[k];
      lines.push({ en: `${n} ${n === 1 ? l.one : l.many}`, hi: `${l.hi}: ${n}` });
    }
    out.push({ rule: "approvals", staffId, count: total, lines, kinds });
  }
  return byStaff(out);
}

/* ── The reminder itself ────────────────────────────────────────────────── */

export const REMINDER_KIND: Record<ReminderRule, NotifyKind> = {
  punch: "staff_reminder.punch",
  register: "staff_reminder.register",
  homework: "staff_reminder.homework",
  marks: "staff_reminder.marks",
  approvals: "staff_reminder.approvals",
};

/** Once per person per rule per India day (erp_notification_keys). */
export function reminderKey(rule: ReminderRule, date: string): string {
  return `staff_reminder:${rule}:${date}`;
}

const APPROVAL_LINKS: Record<ApprovalKind, { app: string; web: string }> = {
  staff_leave: { app: "/leave-approvals", web: "/staff?tab=leave" },
  student_leave: { app: "/student-leave", web: "/student-leave" },
  document: { app: "/documents", web: "/documents" },
  complaint: { app: "/complaints", web: "/complaints" },
  staff_request: { app: "/notifications", web: "/staff?tab=requests" },
};

export function reminderLinks(item: Pick<PendingItem, "rule" | "kinds">): { app: string; web: string } {
  switch (item.rule) {
    case "punch":
      return { app: "/my-attendance", web: "/staff?tab=my" };
    case "register":
      return { app: "/attendance", web: "/attendance" };
    case "homework":
      return { app: "/homework", web: "/homework" };
    case "marks":
      return { app: "/marks", web: "/exams" };
    case "approvals": {
      const kinds = APPROVAL_ORDER.filter((k) => (item.kinds?.[k] ?? 0) > 0);
      return kinds.length === 1 ? APPROVAL_LINKS[kinds[0]!] : { app: "/notifications", web: "/staff?tab=leave" };
    }
  }
}

function shortDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Title + one-line body, English and Hindi. */
export function reminderText(item: PendingItem): { title: Text & { hi: string }; body: Text & { hi: string } } {
  const n = item.count;
  const list = (lang: "en" | "hi", max = 4) => {
    const shown = item.lines.slice(0, max).map((l) => l[lang]);
    const more = item.lines.length - shown.length;
    return `${shown.join(" · ")}${more > 0 ? (lang === "hi" ? ` · और ${more}` : ` · +${more} more`) : ""}`;
  };
  switch (item.rule) {
    case "punch":
      return {
        title: { en: "You have not punched in today", hi: "आज आपकी हाज़िरी (पंच) नहीं लगी है" },
        body: { en: "Please punch in from the staff app.", hi: "कृपया स्टाफ ऐप से पंच करें।" },
      };
    case "register":
      return {
        title: {
          en: n === 1 ? "Today's register is not taken" : `${n} registers not taken today`,
          hi: n === 1 ? "आज का रजिस्टर नहीं भरा गया" : `आज ${n} रजिस्टर नहीं भरे गए`,
        },
        body: { en: `Take attendance: ${list("en")}`, hi: `हाज़िरी लें: ${list("hi")}` },
      };
    case "homework":
      return {
        title: {
          en: `Homework not posted · ${n} class${n === 1 ? "" : "es"}`,
          hi: `होमवर्क नहीं डाला गया · ${n} कक्षा`,
        },
        body: { en: list("en"), hi: list("hi") },
      };
    case "marks":
      return {
        title: {
          en: `Marks to enter · due ${shortDay(item.dueOn ?? "")}`,
          hi: `अंक दर्ज करें · अंतिम तिथि ${shortDay(item.dueOn ?? "")}`,
        },
        body: { en: list("en"), hi: list("hi") },
      };
    case "approvals":
      return {
        title: { en: `Waiting for you · ${n}`, hi: `आपकी प्रतीक्षा में · ${n}` },
        body: { en: list("en", 5), hi: list("hi", 5) },
      };
  }
}

/** The notify() event for one person's reminder. */
export function reminderEvent(item: PendingItem, date: string): NotifyEvent {
  const t = reminderText(item);
  const links = reminderLinks(item);
  return {
    kind: REMINDER_KIND[item.rule],
    key: reminderKey(item.rule, date),
    audience: [{ staff: [item.staffId] }],
    title: t.title,
    body: t.body,
    link: links.app,
    webLink: links.web,
    data: { rule: item.rule, date, count: String(item.count) },
  };
}

/** One line for the WhatsApp template's {{pendingWork}} — Meta refuses newlines and tabs. */
export function whatsappLine(item: PendingItem, lang: "en" | "hi"): string {
  const t = reminderText(item);
  const s = `${t.title[lang]} — ${t.body[lang]}`.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim();
  return s.length > 500 ? `${s.slice(0, 499)}…` : s;
}

/* ── WhatsApp fallback ──────────────────────────────────────────────────── */

/**
 * The app cannot reach this person: no device has registered for push, or
 * none has been seen for `inactiveDays`. `lastSeen` = their devices'
 * last_seen_at; undefined = the device list could not be read (no fallback).
 */
export function needsWhatsAppFallback(lastSeen: readonly string[] | undefined, nowMs: number, inactiveDays: number): boolean {
  if (lastSeen === undefined) return false;
  if (lastSeen.length === 0) return true;
  const newest = Math.max(...lastSeen.map((s) => Date.parse(s)).filter((n) => Number.isFinite(n)));
  if (!Number.isFinite(newest)) return true;
  return nowMs - newest > inactiveDays * 86_400_000;
}

/* ── The 6 PM brief: reminders nobody acted on ──────────────────────────── */

export type UnansweredRow = { staffId: string; name: string; what: string[] };

export type BriefReminders = {
  /** Rules whose state could not be read tonight (the brief says so). */
  unknown: ReminderRule[];
  rows: UnansweredRow[];
};

const UNANSWERED_LABEL: Record<Exclude<ReminderRule, "approvals">, (i: PendingItem) => string> = {
  punch: () => "not punched in",
  register: (i) => `register not taken (${i.lines.map((l) => l.en.replace(/ register$/, "")).join(", ")})`,
  homework: (i) => `homework missing for ${i.count} class${i.count === 1 ? "" : "es"}`,
  marks: (i) => `${i.overdue ? "marks overdue" : "marks due today"} (${i.count})`,
};

/**
 * Staff reminded today who still have the thing pending at the time of the
 * brief. Marks that are past their deadline are listed whether or not a
 * reminder went today (the reminders stop on the deadline day).
 */
export function unansweredReminders(input: {
  date: string;
  results: readonly RuleResult[];
  /** rule → staff ids reminded today (erp_notification_keys); null = not readable. */
  reminded: ReadonlyMap<ReminderRule, ReadonlySet<string> | null>;
  nameOf: (staffId: string) => string;
}): BriefReminders {
  const unknown: ReminderRule[] = [];
  const what = new Map<string, string[]>();
  for (const r of input.results) {
    if (r.rule === "approvals") continue;
    if (r.state === "unknown") {
      unknown.push(r.rule);
      continue;
    }
    if (r.state !== "ok") continue;
    const reminded = input.reminded.get(r.rule);
    if (reminded === null) {
      unknown.push(r.rule);
      continue;
    }
    for (const item of r.items) {
      const dueToday = r.rule === "marks" && item.dueOn === input.date;
      const keep = r.rule === "marks" ? item.overdue || (dueToday && !!reminded?.has(item.staffId)) : !!reminded?.has(item.staffId);
      if (!keep) continue;
      const list = what.get(item.staffId) ?? [];
      list.push(UNANSWERED_LABEL[r.rule](item));
      what.set(item.staffId, list);
    }
  }
  const rows = [...what].map(([staffId, w]) => ({ staffId, name: input.nameOf(staffId) || staffId, what: w }));
  rows.sort((a, b) => b.what.length - a.what.length || a.name.localeCompare(b.name));
  return { unknown, rows };
}

/** "Not acted on: Asha (not punched in; register not taken (Class 5 · A)) …" */
export function unansweredLine(b: BriefReminders | undefined, max = 6): string {
  if (!b) return "";
  const parts: string[] = [];
  if (b.rows.length) {
    const shown = b.rows.slice(0, max).map((r) => `${r.name} (${r.what.join("; ")})`);
    const more = b.rows.length - shown.length;
    parts.push(
      `${b.rows.length} staff did not act on today's reminders: ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`,
    );
  }
  if (b.unknown.length) {
    parts.push(`reminders could not be checked for ${b.unknown.map((r) => REMINDER_RULE_LABELS[r].toLowerCase()).join(", ")}`);
  }
  return parts.join("; ");
}
