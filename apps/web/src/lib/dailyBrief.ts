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
};

export type BriefStudentAttendance = {
  classes: BriefClassAttendance[];
  present: number;
  absent: number;
  strength: number;
  classesMarked: number;
  classesUnmarked: number;
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
  /**
   * The Staff HR desk could not be read, so `pending` is empty because
   * nobody could look — not because nothing is waiting.
   */
  leaveUnreadable?: boolean;
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

export type DailyBrief = {
  /** IST calendar date this brief is about. */
  date: string;
  schoolName: string;
  collection: BriefCollection;
  expenses: BriefExpenses;
  students: BriefStudentAttendance;
  staff: BriefStaffAttendance;
  defaulters: BriefDefaulters;
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
    studentsNotInUse(b)
      ? `🎒 Student attendance isn't being taken in the ERP — ${lastRegisterPhrase(b.students.lastMarkedOn)}`
      : pct === null
      ? "🎒 No class register was marked today"
      : `🎒 Students ${pct}% present — ${b.students.present} in, ${b.students.absent} absent${
          b.students.classesUnmarked
            ? `, ${b.students.classesUnmarked} class${b.students.classesUnmarked === 1 ? "" : "es"} not marked`
            : ""
        }`,
  );

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
  } else if (b.staff.leaveUnreadable) {
    lines.push("📝 Leave requests could not be read tonight — reply *LEAVE* to check");
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
      studentsNotInUse(b)
        ? `not being taken in the ERP — ${lastRegisterPhrase(b.students.lastMarkedOn)}`
        : pct === null
        ? "no register marked today"
        : `${pct}% of those marked — ${b.students.present} in, ${b.students.absent} absent${
            b.students.classesUnmarked
              ? `, ${b.students.classesUnmarked} section${
                  b.students.classesUnmarked === 1 ? "" : "s"
                } not marked`
              : ""
          }`,
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
        : b.staff.leaveUnreadable
          ? "could not be read — reply LEAVE to check"
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

  if (studentsNotInUse(b)) {
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
    const children = b.students.classes
      .filter((c) => !c.marked)
      .reduce((s, c) => s + c.strength, 0);
    out.push({
      rank: 2,
      text: `${b.students.classesUnmarked} section${
        b.students.classesUnmarked === 1 ? "" : "s"
      } never marked attendance today, covering ${children} children`,
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
