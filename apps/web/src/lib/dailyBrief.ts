/**
 * The 6 PM brief for the people who run the school.
 *
 * One message a day to the owner, the principal and the office head, with
 * the day's money, attendance and staff in it, a PDF carrying the detail,
 * and — the part that makes it more than a report — the pending leave
 * requests, decidable by replying to it.
 *
 * This file is the arithmetic and the wording, with no database and no
 * WhatsApp in it, so the numbers can be proved in a selftest. Two rules run
 * through all of it:
 *
 *  1. NOTHING RECORDED is not ZERO. This school has no expense voucher and
 *     no leave request on file at all; a brief that printed "Expenses:
 *     ₹0.00" would read as "we spent nothing today" when the truth is "the
 *     accounts desk has not been used". Every section can say which it is,
 *     and the composer prints a different sentence for each.
 *  2. A percentage needs its denominator. "Attendance 84%" hides whether
 *     three classes were never marked. Marked and unmarked classes are
 *     counted separately and both are shown.
 */

export type BriefMoneyLine = { key: string; label: string; paise: number; count: number };

export type BriefCollection = {
  /** false = the fee desk recorded nothing today (not "collected ₹0"). */
  recorded: boolean;
  totalPaise: number;
  receipts: number;
  /** Cash, UPI, card… in descending amount. Only modes actually used. */
  byMode: BriefMoneyLine[];
};

export type BriefExpenses = {
  recorded: boolean;
  totalPaise: number;
  vouchers: number;
  /** By expense head, descending. */
  byHead: BriefMoneyLine[];
};

export type BriefClassAttendance = {
  classId: string;
  sectionId: string;
  label: string;
  present: number;
  absent: number;
  /** On the roster but with no mark either way. */
  unmarked: number;
  strength: number;
  /** false = nobody opened the register for this class today. */
  marked: boolean;
  /**
   * The holiday that gives this class the day off ("Pre-Primary Saturday
   * off"), by the same holiday rules the attendance desk uses. An unmarked
   * class on holiday is not a register somebody forgot.
   */
  holiday?: string;
  /** Whose register it is. Empty = no class teacher recorded for this section. */
  classTeacherName?: string;
};

export type BriefStudentAttendance = {
  classes: BriefClassAttendance[];
  present: number;
  absent: number;
  strength: number;
  classesMarked: number;
  /** Working classes with no marks — classes on holiday are not counted here. */
  classesUnmarked: number;
  /** Classes the holiday calendar gave the day off. */
  classesOff?: number;
  /**
   * The latest date BEFORE this brief's day with any class register on
   * file. null = none ever; undefined = not looked up (or the read failed),
   * which falls back to the plain "not marked today" wording.
   */
  lastMarkedOn?: string | null;
};

export type BriefStaffRow = {
  staffId: string;
  name: string;
  empCode: string;
  /**
   * Why this staff member is not at school, as far as the records show:
   *   on_leave        — an approved leave covers today
   *   leave_pending   — they applied and nobody has decided yet
   *   unexplained     — marked absent with no leave of any kind on file
   */
  reason: "on_leave" | "leave_pending" | "unexplained";
  leaveTypeLabel: string;
  /** The pending request's id, so a reply can decide it. */
  requestId: string;
  fromDate: string;
  toDate: string;
  days: number;
};

export type BriefStaffAttendance = {
  marked: boolean;
  present: number;
  absent: number;
  strength: number;
  /** Absent today, split by why. */
  absentRows: BriefStaffRow[];
  /** Requests awaiting a decision — today's absences and future dates alike. */
  pending: BriefStaffRow[];
  /** As BriefStudentAttendance.lastMarkedOn, for the staff register. */
  lastMarkedOn?: string | null;
};

export type BriefDefaulter = {
  studentId: string;
  name: string;
  fatherName: string;
  classLabel: string;
  duePaise: number;
  /** 10 digits, for the person doing the calling. */
  mobile: string;
  guardianName: string;
};

export type BriefDefaulters = {
  /** Every family with dues, for the PDF's calling list. */
  rows: BriefDefaulter[];
  totalPaise: number;
  /** Families with dues but no number anyone can ring. */
  noMobile: number;
};

/** One subject a teacher was expected to set homework for and did not. */
export type BriefHomeworkGap = {
  classLabel: string;
  subjectName: string;
};

export type BriefHomeworkTeacher = {
  staffId: string;
  name: string;
  gaps: BriefHomeworkGap[];
};

export type BriefHomework = {
  /**
   * false = the homework desk could not be read, so nobody knows who posted:
   * the brief says so rather than naming every teacher.
   */
  checked: boolean;
  /** Class-subjects expected today (after holidays and absent teachers). */
  expected: number;
  /** Of those, how many have a homework post today. */
  posted: number;
  /** Teachers with at least one class-subject not posted, most gaps first. */
  missing: BriefHomeworkTeacher[];
  /** Sections judged by today's timetable periods. */
  timetableSections: number;
  /**
   * Sections with no published timetable, judged by the subjects assigned in
   * Staff → Duties — every assigned subject on every school day.
   */
  assignmentSections: number;
  /** Teachers left out because they are marked absent today. */
  absentTeachersSkipped: number;
};

export type DailyBrief = {
  /** IST calendar date this brief is about. */
  date: string;
  schoolName: string;
  collection: BriefCollection;
  expenses: BriefExpenses;
  students: BriefStudentAttendance;
  staff: BriefStaffAttendance;
  defaulters: BriefDefaulters;
  /** Homework posted against what was expected. Absent = not computed. */
  homework?: BriefHomework;
  /** The AI paragraph on what is still open. Empty when it could not run. */
  aiNote: string;
};

export function rupees(paise: number): string {
  const n = Math.round(paise) / 100;
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** Precise rupees, for the PDF where a rounded total invites a query. */
export function rupeesExact(paise: number): string {
  return `₹${(Math.round(paise) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export const TENDER_MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  cheque: "Cheque",
  rtgs: "RTGS",
  neft: "NEFT",
  imps: "IMPS",
  bank: "Bank transfer",
};

export function tenderModeLabel(mode: string): string {
  return TENDER_MODE_LABELS[mode] || mode.toUpperCase();
}

/** Percentage of MARKED students present, or null when nothing was marked. */
export function attendancePercent(a: BriefStudentAttendance): number | null {
  const seen = a.present + a.absent;
  if (seen === 0) return null;
  return Math.round((a.present / seen) * 1000) / 10;
}

export function staffPercent(s: BriefStaffAttendance): number | null {
  const seen = s.present + s.absent;
  if (seen === 0) return null;
  return Math.round((s.present / seen) * 1000) / 10;
}

/**
 * "Not marked today" and "not taken in the ERP at all" are different facts.
 *
 * On 29 Sep 2026 the brief had said "no class register was marked today"
 * every evening for a month. The school was taking attendance, just not in
 * the ERP: its registers were an import of the old system's export that
 * ended on 31 Aug. Read night after night, the daily wording suggests
 * sections lapsing. The true sentence is that the desk is not in use, and it
 * names the last date anything was recorded.
 *
 * A week with no register at all is past any weekend or short holiday.
 */
export const ATTENDANCE_IDLE_DAYS = 7;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "31 Aug" — the year is the brief's own, so it is left off. */
export function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Calendar days from one ISO date to a later one. */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * True when nothing was marked today AND the register has been empty long
 * enough that "not marked today" would mislead. An unknown last date
 * (undefined) is never read as idle: we only say the desk is unused when
 * we looked and found that it is.
 */
export function attendanceNotInUse(
  markedToday: boolean,
  lastMarkedOn: string | null | undefined,
  today: string,
): boolean {
  if (markedToday || lastMarkedOn === undefined) return false;
  if (lastMarkedOn === null) return true;
  return daysBetween(lastMarkedOn, today) > ATTENDANCE_IDLE_DAYS;
}

/** "last register 31 Aug" / "no register on file". */
function lastRegisterPhrase(lastMarkedOn: string | null | undefined): string {
  return lastMarkedOn ? `last register ${shortDate(lastMarkedOn)}` : "no register on file";
}

/** "since 31 Aug (29 days)" / "ever" — for the still-open facts. */
function idleSincePhrase(lastMarkedOn: string | null | undefined, today: string): string {
  return lastMarkedOn
    ? `since ${shortDate(lastMarkedOn)} (${daysBetween(lastMarkedOn, today)} days)`
    : "at all — no register is on file";
}

export function studentsNotInUse(b: DailyBrief): boolean {
  return attendanceNotInUse(attendancePercent(b.students) !== null, b.students.lastMarkedOn, b.date);
}

export function staffNotInUse(b: DailyBrief): boolean {
  return attendanceNotInUse(staffPercent(b.staff) !== null, b.staff.lastMarkedOn, b.date);
}

/** The PDF's note when nothing was marked — the same distinction, in full. */
export function attendanceIdleNote(b: DailyBrief, who: "students" | "staff"): string {
  const last = who === "students" ? b.students.lastMarkedOn : b.staff.lastMarkedOn;
  const idle = who === "students" ? studentsNotInUse(b) : staffNotInUse(b);
  const what = who === "students" ? "Student" : "Staff";
  if (idle) {
    return `${what} attendance is not being taken in the ERP — ${lastRegisterPhrase(last)}. This is not a lapse today; the register has not been used ${idleSincePhrase(last, b.date)}.`;
  }
  const base = who === "students" ? "No class register was marked today." : "Staff attendance was not marked today.";
  return last ? `${base} The last register on file is ${shortDate(last)}.` : base;
}

/**
 * The absences that need somebody to do something.
 *
 * An approved leave is not a problem; an absence with nothing on file is
 * the one a principal wants to see before the day is out, and a pending
 * request is one they can settle from the message.
 */
export function absencesNeedingAttention(s: BriefStaffAttendance): BriefStaffRow[] {
  return s.absentRows.filter((r) => r.reason !== "on_leave");
}

/** Working classes nobody marked — the registers somebody owes. */
export function unmarkedWorkingClasses(a: BriefStudentAttendance): BriefClassAttendance[] {
  return a.classes.filter((c) => !c.marked && !c.holiday);
}

/**
 * "Class 3 · A (Ramesh Yadav)" for each unmarked working class, the first
 * `max` of them, then "+N more". A section with no class teacher on file
 * says so — a guessed name would send the principal after the wrong person.
 */
export function unmarkedClassesWithTeachers(
  a: BriefStudentAttendance,
  max = 4,
): string {
  const rows = unmarkedWorkingClasses(a);
  const shown = rows
    .slice(0, max)
    .map((c) => `${c.label} (${c.classTeacherName || "no class teacher on file"})`);
  const more = rows.length - shown.length;
  return `${shown.join(", ")}${more > 0 ? `, +${more} more` : ""}`;
}

/** Every class had the day off — nothing to mark, nothing missed. */
export function allClassesOff(a: BriefStudentAttendance): boolean {
  return a.classes.length > 0 && a.classes.every((c) => c.holiday && !c.marked);
}

/** "Holiday: Pre-Primary Saturday off" — one line naming who had the day off. */
export function classesOffLine(a: BriefStudentAttendance): string {
  const off = a.classes.filter((c) => c.holiday);
  if (!off.length) return "";
  const reasons = [...new Set(off.map((c) => c.holiday!))];
  return `${off.length} section${off.length === 1 ? "" : "s"} off today (${reasons.join(", ")})`;
}

/**
 * Is the school shut today? Only when EVERY class the school runs is on a
 * full holiday AND staff are too.
 *
 * Not the calendar's "school" audience: that one counts a class-group
 * holiday ("Pre-Primary Saturday off") as the whole school's, which would
 * skip every Saturday brief for the classes that DID come in. A half day
 * is a working day — the registers and the money still happen.
 */
export function briefHolidaySkip(opts: {
  classDays: { status: "working" | "holiday" | "half_holiday"; label: string }[];
  staffDay: { status: "working" | "holiday" | "half_holiday"; label: string };
}): string | null {
  if (opts.classDays.length === 0) return null;
  if (!opts.classDays.every((d) => d.status === "holiday")) return null;
  if (opts.staffDay.status !== "holiday") return null;
  return opts.staffDay.label || opts.classDays[0]!.label || "School holiday";
}

/**
 * Who owes homework today, from what was expected and what was posted.
 *
 * Pure so the matching rules can be proved: a subject counts as done when
 * ANY post exists for that class, section and subject today — a substitute
 * who set it covered it — and a teacher is listed once with every
 * class-subject they still owe.
 */
export function computeHomeworkGaps(opts: {
  expected: {
    sectionKey: string;
    classLabel: string;
    subjectKey: string;
    subjectName: string;
    teacherStaffId: string;
    teacherName: string;
  }[];
  /** `${sectionKey}|${subjectKey}` of every post today. */
  postedKeys: Set<string>;
}): Pick<BriefHomework, "expected" | "posted" | "missing"> {
  const slots = new Map<
    string,
    { classLabel: string; subjectName: string; teachers: Map<string, string> }
  >();
  for (const e of opts.expected) {
    const key = `${e.sectionKey}|${e.subjectKey}`;
    let slot = slots.get(key);
    if (!slot) {
      slot = { classLabel: e.classLabel, subjectName: e.subjectName, teachers: new Map() };
      slots.set(key, slot);
    }
    if (e.teacherStaffId) slot.teachers.set(e.teacherStaffId, e.teacherName || e.teacherStaffId);
  }

  let posted = 0;
  const byTeacher = new Map<string, BriefHomeworkTeacher>();
  for (const [key, slot] of slots) {
    if (opts.postedKeys.has(key)) {
      posted++;
      continue;
    }
    for (const [staffId, name] of slot.teachers) {
      let t = byTeacher.get(staffId);
      if (!t) {
        t = { staffId, name, gaps: [] };
        byTeacher.set(staffId, t);
      }
      t.gaps.push({ classLabel: slot.classLabel, subjectName: slot.subjectName });
    }
  }
  const missing = [...byTeacher.values()]
    .map((t) => ({
      ...t,
      gaps: t.gaps.sort(
        (a, b) => a.classLabel.localeCompare(b.classLabel) || a.subjectName.localeCompare(b.subjectName),
      ),
    }))
    .sort((a, b) => b.gaps.length - a.gaps.length || a.name.localeCompare(b.name));
  return { expected: slots.size, posted, missing };
}

/** One line on homework, or "" when there was nothing to expect. */
export function homeworkLine(h: BriefHomework | undefined): string {
  if (!h) return "";
  if (!h.checked) return "homework could not be read today";
  if (h.expected === 0) return "";
  if (h.missing.length === 0) return `homework posted for all ${h.expected} class-subjects`;
  const names = h.missing.slice(0, 4).map((t) => t.name);
  const more = h.missing.length - names.length;
  return `homework posted for ${h.posted} of ${h.expected} class-subjects — not yet from ${names.join(", ")}${
    more > 0 ? ` +${more} more` : ""
  }`;
}

/**
 * The WhatsApp body: the headline numbers and nothing else.
 *
 * Meta caps a template body at 1024 characters and this has to fit inside
 * that with a margin, in two languages, with the school's name in it — so
 * the detail lives in the attached PDF and this is the part someone reads
 * on a phone at a traffic light. Every line is a number they would
 * otherwise ring the office for.
 */
export function composeBriefSummary(b: DailyBrief): string {
  const lines: string[] = [];

  lines.push(
    b.collection.recorded
      ? `💰 Collected ${rupees(b.collection.totalPaise)} in ${b.collection.receipts} receipt${b.collection.receipts === 1 ? "" : "s"}${
          b.collection.byMode.length
            ? ` (${b.collection.byMode
                .map((m) => `${tenderModeLabel(m.key)} ${rupees(m.paise)}`)
                .join(", ")})`
            : ""
        }`
      : "💰 No fee collection recorded today",
  );

  lines.push(
    b.expenses.recorded
      ? `🧾 Spent ${rupees(b.expenses.totalPaise)} across ${b.expenses.vouchers} voucher${b.expenses.vouchers === 1 ? "" : "s"}`
      : "🧾 No expense voucher entered today",
  );

  const pct = attendancePercent(b.students);
  lines.push(
    allClassesOff(b.students)
      ? "🎒 No classes today — holiday for every class"
      : studentsNotInUse(b)
      ? `🎒 Student attendance isn't being taken in the ERP — ${lastRegisterPhrase(b.students.lastMarkedOn)}`
      : pct === null
      ? "🎒 No class register was marked today"
      : `🎒 Students ${pct}% present — ${b.students.present} in, ${b.students.absent} absent${
          b.students.classesUnmarked
            ? `, ${b.students.classesUnmarked} class${b.students.classesUnmarked === 1 ? "" : "es"} not marked`
            : ""
        }`,
  );
  // Naming class teachers for a register the ERP has not been used for in
  // weeks would repeat the same list every night; the line above says why.
  if (b.students.classesUnmarked && !studentsNotInUse(b)) {
    lines.push(`   Not marked: ${unmarkedClassesWithTeachers(b.students)}`);
  }
  const off = classesOffLine(b.students);
  if (off && !allClassesOff(b.students)) lines.push(`🏖️ ${off}`);

  const hw = homeworkLine(b.homework);
  if (hw) lines.push(`📚 ${hw.charAt(0).toUpperCase()}${hw.slice(1)}`);

  const spct = staffPercent(b.staff);
  const attention = absencesNeedingAttention(b.staff);
  lines.push(
    staffNotInUse(b)
      ? `👩‍🏫 Staff attendance isn't being taken in the ERP — ${lastRegisterPhrase(b.staff.lastMarkedOn)}`
      : spct === null
      ? "👩‍🏫 Staff attendance not marked today"
      : `👩‍🏫 Staff ${spct}% present — ${b.staff.present} in, ${b.staff.absent} absent${
          attention.length ? `, ${attention.length} without approved leave` : ""
        }`,
  );

  if (b.staff.pending.length) {
    lines.push(
      `📝 ${b.staff.pending.length} leave request${b.staff.pending.length === 1 ? "" : "s"} waiting for you — reply *LEAVE* to see them`,
    );
  }

  if (b.defaulters.rows.length) {
    lines.push(
      `📞 ${b.defaulters.rows.length} families owe ${rupees(b.defaulters.totalPaise)} — calling list is in the PDF`,
    );
  }

  if (b.aiNote.trim()) lines.push(`\n${b.aiNote.trim()}`);

  return lines.join("\n");
}

/** "Daily brief · 10 Sep 2026" — the PDF's own title. */
export function briefTitle(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return `Daily brief · ${dateIso}`;
  return `Daily brief · ${shortDate(dateIso)} ${d.getUTCFullYear()}`;
}

export function briefFilename(dateIso: string): string {
  return `daily-brief-${dateIso}.pdf`;
}

export function emptyBrief(date: string, schoolName = ""): DailyBrief {
  return {
    date,
    schoolName,
    collection: { recorded: false, totalPaise: 0, receipts: 0, byMode: [] },
    expenses: { recorded: false, totalPaise: 0, vouchers: 0, byHead: [] },
    students: {
      classes: [],
      present: 0,
      absent: 0,
      strength: 0,
      classesMarked: 0,
      classesUnmarked: 0,
    },
    staff: {
      marked: false,
      present: 0,
      absent: 0,
      strength: 0,
      absentRows: [],
      pending: [],
    },
    defaulters: { rows: [], totalPaise: 0, noMobile: 0 },
    aiNote: "",
  };
}


/* ------------------------------------------------------------------ *
 * The template send
 *
 * composeBriefSummary above is one multi-line block, which is right for a
 * free-form reply inside the 24-hour window and WRONG for a template.
 * Meta refuses a template PARAMETER containing a newline, a tab, or more
 * than four consecutive spaces — so the 6 PM push cannot pass the whole
 * brief as one {{summary}}. The template body carries the skeleton and
 * each number goes in as its own single-line value.
 *
 * Every value below is therefore built to be one line, and
 * briefTemplateValueProblem() is the guard a selftest and the sender both
 * use: a value that would be refused is caught here rather than at Meta,
 * where the only symptom is a 6 PM message that never arrived.
 * ------------------------------------------------------------------ */

/** The variables bhb_daily_brief declares, in the order it reads. */
export const BRIEF_TEMPLATE_VARIABLES = [
  "schoolName",
  "briefDate",
  "collection",
  "expenses",
  "students",
  "staff",
  "leavePending",
  "defaulters",
  "stillOpen",
] as const;

export type BriefTemplateVariable = (typeof BRIEF_TEMPLATE_VARIABLES)[number];

/** Why Meta would refuse this parameter, or null when it is fine. */
export function briefTemplateValueProblem(value: string): string | null {
  if (value === "") return "empty";
  if (/[\n\r]/.test(value)) return "contains a newline";
  if (/\t/.test(value)) return "contains a tab";
  if (/ {5,}/.test(value)) return "more than four consecutive spaces";
  if (value.length > 1024) return "longer than 1024 characters";
  return null;
}

/** One line, whatever the input did. */
function oneLine(text: string): string {
  return text.replace(/[\n\r\t]+/g, " ").replace(/ {2,}/g, " ").trim();
}

export function composeBriefTemplateVariables(
  b: DailyBrief,
): Record<BriefTemplateVariable, string> {
  const pct = attendancePercent(b.students);
  const spct = staffPercent(b.staff);
  const attention = absencesNeedingAttention(b.staff);

  return {
    schoolName: oneLine(b.schoolName || "School"),
    briefDate: oneLine(briefTitle(b.date).replace("Daily brief · ", "")),
    collection: oneLine(
      b.collection.recorded
        ? `${rupees(b.collection.totalPaise)} in ${b.collection.receipts} receipt${
            b.collection.receipts === 1 ? "" : "s"
          }${
            b.collection.byMode.length
              ? ` — ${b.collection.byMode
                  .map((m) => `${tenderModeLabel(m.key)} ${rupees(m.paise)}`)
                  .join(", ")}`
              : ""
          }`
        : "nothing recorded at the desk today",
    ),
    expenses: oneLine(
      b.expenses.recorded
        ? `${rupees(b.expenses.totalPaise)} across ${b.expenses.vouchers} voucher${
            b.expenses.vouchers === 1 ? "" : "s"
          }`
        : "no voucher entered today",
    ),
    students: oneLine(
      allClassesOff(b.students)
        ? "no classes today — holiday for every class"
        : studentsNotInUse(b)
        ? `not being taken in the ERP — ${lastRegisterPhrase(b.students.lastMarkedOn)}`
        : pct === null
        ? `no register marked today${
            b.students.classesUnmarked ? `: ${unmarkedClassesWithTeachers(b.students, 3)}` : ""
          }`
        : `${pct}% of those marked — ${b.students.present} in, ${b.students.absent} absent${
            b.students.classesUnmarked
              ? `, ${b.students.classesUnmarked} section${
                  b.students.classesUnmarked === 1 ? "" : "s"
                } not marked: ${unmarkedClassesWithTeachers(b.students, 3)}`
              : ""
          }${classesOffLine(b.students) ? `; ${classesOffLine(b.students)}` : ""}`,
    ),
    staff: oneLine(
      staffNotInUse(b)
        ? `not being taken in the ERP — ${lastRegisterPhrase(b.staff.lastMarkedOn)}`
        : spct === null
        ? "not marked today"
        : `${b.staff.present} of ${b.staff.strength} present${
            attention.length
              ? `, ${attention.length} absent without approved leave`
              : ""
          }`,
    ),
    leavePending: oneLine(
      b.staff.pending.length
        ? `${b.staff.pending.length} waiting — reply LEAVE to decide`
        : "none waiting",
    ),
    defaulters: oneLine(
      b.defaulters.rows.length
        ? `${b.defaulters.rows.length} families owe ${rupees(b.defaulters.totalPaise)} — list attached`
        : "none overdue today",
    ),
    /*
      The AI paragraph, flattened to one line and trimmed.

      It goes in the MESSAGE and not only the PDF because it is the part
      that says what to do next, and a phone at 6 PM is where that lands.
      One line because Meta refuses a parameter with a newline; trimmed
      because the whole body shares a 1024-character cap and the numbers
      above it must not be pushed out by a long paragraph. The full text is
      in the PDF, uncut.

      Never empty: Meta refuses a blank parameter, so a clean day says so.
    */
    stillOpen: oneLine(
      truncate(b.aiNote.trim() || composePendingFallback(b), 320) ||
        "nothing outstanding",
    ),
  };
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  // Cut at a word, not mid-number: "146 famil…" reads as a broken figure.
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;.\s]+$/, "")}… (full list in the PDF)`;
}

/**
 * Every parameter Meta would refuse, keyed by variable.
 *
 * The sender checks this before posting and skips the send with a readable
 * reason rather than letting Meta reject it, because a rejected template
 * is indistinguishable from a quiet evening.
 */
export function briefTemplateProblems(
  values: Record<string, string>,
): { key: string; problem: string }[] {
  const out: { key: string; problem: string }[] = [];
  for (const key of BRIEF_TEMPLATE_VARIABLES) {
    const problem = briefTemplateValueProblem(values[key] ?? "");
    if (problem) out.push({ key, problem });
  }
  return out;
}


/* ------------------------------------------------------------------ *
 * What is still open
 *
 * The AI paragraph is the one part of this brief a model writes, so the
 * facts it writes from are computed HERE and passed in. The model
 * prioritises and phrases; it never counts. That is the same contract
 * generateLeadershipDigestJson already states, and the reason the brief
 * can carry a sentence about the day without risking a number nobody can
 * reconcile.
 *
 * Which also means: when the model is unavailable, the facts are still
 * true and the section still has something to say. A missing API key
 * costs the school a nicer paragraph, not the list.
 * ------------------------------------------------------------------ */

export type PendingFact = {
  /** Sorted on: 1 is most urgent. Ordering is ours, not the model's. */
  rank: number;
  text: string;
};

/**
 * The day's loose ends, in the order somebody should care about them.
 *
 * Ranked rather than listed: a child unaccounted for outranks an unentered
 * expense voucher, and handing the model an unordered pile invites it to
 * lead with whatever sounds most dramatic.
 */
export function pendingFacts(b: DailyBrief): PendingFact[] {
  const out: PendingFact[] = [];

  const unexplained = b.staff.absentRows.filter((r) => r.reason === "unexplained");
  if (unexplained.length) {
    out.push({
      rank: 1,
      text: `${unexplained.length} staff absent with no leave on file: ${unexplained
        .map((r) => r.name)
        .slice(0, 6)
        .join(", ")}`,
    });
  }

  if (studentsNotInUse(b) && !allClassesOff(b.students)) {
    // Same rank: a school with no attendance in the ERP still has children
    // nobody can account for from it. Only the sentence changes — "never
    // marked today" read as a lapse today, every day.
    out.push({
      rank: 2,
      text: `student attendance has not been taken in the ERP ${idleSincePhrase(
        b.students.lastMarkedOn,
        b.date,
      )}`,
    });
  } else if (b.students.classesUnmarked > 0) {
    const children = unmarkedWorkingClasses(b.students).reduce((s, c) => s + c.strength, 0);
    out.push({
      rank: 2,
      text: `${b.students.classesUnmarked} section${
        b.students.classesUnmarked === 1 ? "" : "s"
      } never marked attendance today, covering ${children} children: ${unmarkedClassesWithTeachers(
        b.students,
        6,
      )}`,
    });
  }

  if (b.staff.pending.length) {
    out.push({
      rank: 3,
      text: `${b.staff.pending.length} leave request${
        b.staff.pending.length === 1 ? "" : "s"
      } waiting for a decision, the earliest starting ${b.staff.pending[0]!.fromDate}`,
    });
  }

  // Below leave and above the staff register: a class-subject with no
  // homework is a teacher to ask tomorrow morning, not a child unaccounted for.
  if (b.homework && (!b.homework.checked || b.homework.missing.length)) {
    out.push({ rank: 3.5, text: homeworkLine(b.homework) });
  }

  if (staffNotInUse(b)) {
    out.push({
      rank: 4,
      text: `staff attendance has not been taken in the ERP ${idleSincePhrase(
        b.staff.lastMarkedOn,
        b.date,
      )}`,
    });
  } else if (!b.staff.marked) {
    out.push({ rank: 4, text: "staff attendance was never marked today" });
  }

  if (b.defaulters.rows.length) {
    out.push({
      rank: 5,
      text: `${b.defaulters.rows.length} families overdue on fees, ${rupees(
        b.defaulters.totalPaise,
      )} in total`,
    });
  }

  if (b.defaulters.noMobile > 0) {
    out.push({
      rank: 6,
      text: `${b.defaulters.noMobile} overdue famil${
        b.defaulters.noMobile === 1 ? "y has" : "ies have"
      } no usable phone number on file, so nobody can ring them`,
    });
  }

  if (!b.collection.recorded) {
    out.push({ rank: 7, text: "no fee receipt was raised at the desk today" });
  }

  if (!b.expenses.recorded) {
    out.push({ rank: 8, text: "no expense voucher was entered today" });
  }

  return out.sort((a, b2) => a.rank - b2.rank);
}

/** The facts as the model receives them — one per line, most urgent first. */
export function pendingFactsBlock(b: DailyBrief): string {
  return pendingFacts(b)
    .map((f) => `- ${f.text}`)
    .join("\n");
}

/**
 * The section when no model is available, or when one fails.
 *
 * Reads as a list because that is what it is; the AI version reads as a
 * sentence. Neither invents anything the other does not have.
 */
export function composePendingFallback(b: DailyBrief): string {
  const facts = pendingFacts(b);
  if (facts.length === 0) return "";
  const head = facts.length === 1 ? "One thing is still open: " : "Still open: ";
  return `${head}${facts.map((f) => f.text).join("; ")}.`;
}
