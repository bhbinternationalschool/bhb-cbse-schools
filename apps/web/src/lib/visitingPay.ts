/**
 * Visiting staff paid by the period, the hour or the day — the pure half
 * (director, 11 Oct 2026: "We pay some people hourly or daily; they are not on
 * payroll — AI teacher, Music, Dance, Survey members").
 *
 * Who: a staff record with category "visiting". They are never on payroll
 * (no salary structure, no PF/ESIC, no payslip, no bank file), never counted
 * absent on a day they were not expected, never proposed as a substitute.
 *
 * What they earn, one month at a time, from the source their basis names:
 *   per_period  timetable periods assigned to them on school working days,
 *               counted on days they punched in; a day with periods and no
 *               punch is "not confirmed" (qty 0) until the office confirms it
 *               with a reason; a period handed to a substitute is not counted
 *   per_hour    punch in → punch out each day, rounded to 0.25 h; an IN with
 *               no OUT is flagged, not counted, until the register is fixed
 *   per_day     a day with a present punch, or a survey day that was ended
 *
 * Unknown is never zero: the server refuses to build a sheet when the
 * register, the timetable or the calendar could not be read (the caller says
 * so), and this file never fills a missing source with an empty one.
 *
 * TDS under 194J (a tick per person): 10% once the person's fees in the
 * financial year (April–March) pass ₹30,000 — on crossing, the TDS that was
 * not taken on the year's earlier payments is caught up on this one.
 */

import { L_CASH, L_PAYOUTS_WALLET, L_TDS_PAYABLE, L_VISITING_FEES } from "@/lib/ledger/coa";
import type { LedgerLineInput } from "@/lib/ledger/types";

/* ── who ──────────────────────────────────────────────────────────────── */

export type VisitingPayBasis = "per_period" | "per_hour" | "per_day";

export const VISITING_PAY_BASES: { value: VisitingPayBasis; label: string; unit: VisitingUnit }[] = [
  { value: "per_period", label: "Per period taught (timetable)", unit: "period" },
  { value: "per_hour", label: "Per hour (punch in → out)", unit: "hour" },
  { value: "per_day", label: "Per day present (punch or survey day)", unit: "day" },
];

/** Stored on the staff record (sis_staff.profile.visitingPay). */
export type VisitingPayProfile = {
  basis: VisitingPayBasis | "";
  /** Whole rupees as typed (₹ per period / hour / day). */
  rateRupees: string;
  /** Deduct TDS under section 194J. */
  tds194j: boolean;
};

export function emptyVisitingPay(): VisitingPayProfile {
  return { basis: "", rateRupees: "", tds194j: false };
}

export function normalizeVisitingPay(raw: unknown): VisitingPayProfile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<VisitingPayProfile>;
  const basis = r.basis === "per_period" || r.basis === "per_hour" || r.basis === "per_day" ? r.basis : "";
  const rate = String(r.rateRupees ?? "").trim();
  return { basis, rateRupees: rate, tds194j: r.tds194j === true };
}

export function isVisitingStaff(s: { category?: string | null } | null | undefined): boolean {
  return !!s && s.category === "visiting";
}

/** ₹ per unit in paise, or null when the rate is missing or not a number. */
export function visitingRatePaise(p: VisitingPayProfile): number | null {
  const n = Number(String(p.rateRupees).replace(/[,₹\s]/g, ""));
  if (!p.rateRupees || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** What stops a sheet (errors) and what the office should know (warnings). */
export function visitingSetupProblems(s: { visitingPay?: unknown; panNo?: string }): { errors: string[]; warnings: string[] } {
  const p = normalizeVisitingPay(s.visitingPay);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!p.basis) errors.push("Choose how this person is paid (per period, per hour or per day) on their staff profile");
  if (visitingRatePaise(p) === null) errors.push("Enter the rate (₹) on their staff profile");
  if (p.tds194j && !PAN_RE.test(String(s.panNo || "").trim().toUpperCase())) {
    warnings.push("TDS is ticked but there is no valid PAN on the profile — without a PAN the law asks for 20% (s.206AA), and the TDS cannot be credited to them");
  }
  return { errors, warnings };
}

export function unitForBasis(b: VisitingPayBasis): VisitingUnit {
  return b === "per_period" ? "period" : b === "per_hour" ? "hour" : "day";
}

/* ── dates (IST, plain YYYY-MM-DD strings — no clock arithmetic) ──────── */

export function isMonthKey(m: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
}

export function monthDates(month: string): string[] {
  if (!isMonthKey(month)) return [];
  const [y, m] = month.split("-").map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** 0 = Sunday … 6 = Saturday, for a calendar date (no timezone involved). */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Today's date in India. */
export function istToday(nowMs = Date.now()): string {
  return new Date(nowMs + 330 * 60 * 1000).toISOString().slice(0, 10);
}

/** Financial year (April–March) a month falls in: "2026-10" → "2026-27". */
export function fyOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** The school's academic year runs April–March too; same code. */
export const ayOfMonth = fyOfMonth;

export function fyMonths(fy: string): string[] {
  const start = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((i + 3) % 12) + 1;
    const y = m >= 4 ? start : start + 1;
    return `${y}-${String(m).padStart(2, "0")}`;
  });
}

/**
 * Minutes after midnight from a register time. Punches write "13:24"; marks
 * carried over from the old ERP read "07:22 AM" / "1:05 pm" — both count.
 */
export function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i.exec(String(hhmm || "").trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    const pm = m[3].toLowerCase().startsWith("p");
    h = (h % 12) + (pm ? 12 : 0);
  } else if (h > 23) return null;
  return h * 60 + min;
}

/** Hours rounded to the nearest quarter hour. */
export function roundQuarterHours(minutes: number): number {
  return Math.round((minutes / 60) * 4) / 4;
}

/* ── lines ────────────────────────────────────────────────────────────── */

export type VisitingUnit = "period" | "hour" | "day";
export type WorkLineSource = "timetable" | "punch" | "survey" | "office";
/**
 * counted      in the total
 * unconfirmed  work the sources suggest but cannot prove (periods, no punch) — qty 0
 * flagged      a source is broken (IN without OUT) — qty 0 until fixed
 * removed      taken off by the office with a reason — kept for the audit
 */
export type WorkLineStatus = "counted" | "unconfirmed" | "flagged" | "removed";

export type ComputedLine = {
  /** Stable per source fact, so a rebuild finds the same line again. */
  key: string;
  date: string;
  unit: VisitingUnit;
  qty: number;
  ratePaise: number;
  amountPaise: number;
  source: WorkLineSource;
  status: WorkLineStatus;
  note: string;
};

export type DayPunch = { status: string; inTime: string; outTime: string };

const PRESENT = new Set(["P", "L", "HD"]);
export function punchIsPresent(p: DayPunch | undefined): boolean {
  return !!p && PRESENT.has(String(p.status || "").toUpperCase());
}

export type TimetableSource = {
  grids: {
    classId: string;
    sectionId: string;
    slots: { weekday: number; periodNo: number; subjectId: string; teacherId: string }[];
  }[];
  substitutions: { date: string; classId: string; sectionId: string; periodNo: number; absentTeacherId: string }[];
};

export type ClassDay = "working" | "holiday" | "half_holiday";

export type BuildInput = {
  staffId: string;
  basis: VisitingPayBasis;
  ratePaise: number;
  month: string;
  /** Days after this are not looked at (the month is not over yet). */
  todayIso: string;
  /** Register marks by date — only days with a mark for this person. */
  punches: Record<string, DayPunch>;
  /** Survey days for this person (per_day). */
  surveyDays?: { day: string; status: string }[];
  /** per_period only; null means it could not be read. */
  timetable?: TimetableSource | null;
  /** per_period only: is this class at school on this date (published calendar). */
  classDay?: (date: string, classId: string) => ClassDay;
  periodLabel?: (classId: string, sectionId: string, subjectId: string, periodNo: number) => string;
};

export type BuildResult =
  | { ok: true; lines: ComputedLine[]; warnings: string[] }
  | { ok: false; error: string };

function line(
  key: string,
  date: string,
  unit: VisitingUnit,
  qty: number,
  ratePaise: number,
  source: WorkLineSource,
  status: WorkLineStatus,
  note: string,
): ComputedLine {
  const counted = status === "counted";
  const q = counted ? qty : 0;
  return { key, date, unit, qty: q, ratePaise, amountPaise: Math.round(q * ratePaise), source, status, note };
}

export function buildVisitingLines(input: BuildInput): BuildResult {
  if (!isMonthKey(input.month)) return { ok: false, error: "Pick a month" };
  if (!(input.ratePaise > 0)) return { ok: false, error: "No rate on the staff profile" };
  const dates = monthDates(input.month).filter((d) => d <= input.todayIso);
  const lines: ComputedLine[] = [];
  const warnings: string[] = [];
  const rate = input.ratePaise;

  if (input.basis === "per_period") {
    if (!input.timetable) return { ok: false, error: "The timetable could not be read — periods cannot be counted" };
    if (!input.classDay) return { ok: false, error: "The school calendar could not be read — holidays cannot be told apart" };
    const mine = input.timetable.grids.flatMap((g) =>
      g.slots
        .filter((s) => s.teacherId === input.staffId)
        .map((s) => ({ classId: g.classId, sectionId: g.sectionId, ...s })),
    );
    if (mine.length === 0) warnings.push("No periods are assigned to this person in the timetable");
    const handedOver = new Set(
      input.timetable.substitutions
        .filter((s) => s.absentTeacherId === input.staffId)
        .map((s) => `${s.date}|${s.classId}|${s.sectionId}|${s.periodNo}`),
    );
    for (const date of dates) {
      const wd = weekdayOf(date);
      const today = mine
        .filter((s) => s.weekday === wd)
        .sort((a, b) => a.periodNo - b.periodNo || a.classId.localeCompare(b.classId));
      const present = punchIsPresent(input.punches[date]);
      let any = false;
      for (const s of today) {
        const day = input.classDay(date, s.classId);
        if (day === "holiday") continue;
        const factKey = `${date}|${s.classId}|${s.sectionId}|${s.periodNo}`;
        if (handedOver.has(factKey)) continue;
        any = true;
        const label = input.periodLabel?.(s.classId, s.sectionId, s.subjectId, s.periodNo) || `Period ${s.periodNo}`;
        const half = day === "half_holiday" ? " · half holiday — check it was held" : "";
        lines.push(
          present
            ? line(`p|${factKey}`, date, "period", 1, rate, "timetable", "counted", `${label}${half}`)
            : line(`p|${factKey}`, date, "period", 1, rate, "timetable", "unconfirmed", `${label} · no punch this day — confirm with a reason to pay${half}`),
        );
      }
      if (present && !any) warnings.push(`${date}: punched in, but no periods were due that day`);
    }
    return { ok: true, lines, warnings };
  }

  if (input.basis === "per_hour") {
    for (const date of dates) {
      const p = input.punches[date];
      if (!p) continue;
      const inM = minutesOf(p.inTime);
      const outM = minutesOf(p.outTime);
      if (inM === null && outM === null) {
        if (punchIsPresent(p)) lines.push(line(`h|${date}`, date, "hour", 0, rate, "punch", "flagged", "Marked present with no punch times — enter IN and OUT on the register, then refresh"));
        continue;
      }
      if (inM === null) {
        lines.push(line(`h|${date}`, date, "hour", 0, rate, "punch", "flagged", `OUT ${p.outTime} with no IN — fix the register, then refresh`));
        continue;
      }
      if (outM === null) {
        const why = date === input.todayIso ? "still at school (no OUT yet)" : "no OUT punch";
        lines.push(line(`h|${date}`, date, "hour", 0, rate, "punch", "flagged", `IN ${p.inTime}, ${why} — not counted until the OUT is on the register`));
        continue;
      }
      if (outM <= inM) {
        lines.push(line(`h|${date}`, date, "hour", 0, rate, "punch", "flagged", `OUT ${p.outTime} is not after IN ${p.inTime} — fix the register`));
        continue;
      }
      const hours = roundQuarterHours(outM - inM);
      if (hours <= 0) continue;
      lines.push(line(`h|${date}`, date, "hour", hours, rate, "punch", "counted", `${p.inTime} → ${p.outTime}`));
    }
    return { ok: true, lines, warnings };
  }

  // per_day
  const survey = new Map<string, string>();
  for (const s of input.surveyDays ?? []) survey.set(s.day, String(s.status || ""));
  for (const date of dates) {
    const present = punchIsPresent(input.punches[date]);
    const sv = survey.get(date);
    if (present) {
      lines.push(line(`d|${date}`, date, "day", 1, rate, "punch", "counted", sv === "ended" ? "Present (punch) · survey day too" : "Present (punch)"));
    } else if (sv === "ended") {
      lines.push(line(`d|${date}`, date, "day", 1, rate, "survey", "counted", "Survey day (ended)"));
    } else if (sv) {
      lines.push(line(`d|${date}`, date, "day", 0, rate, "survey", "flagged", "Survey day started but never ended — end it, then refresh"));
    }
  }
  return { ok: true, lines, warnings };
}

/* ── rebuilding a draft without losing the office's work ──────────────── */

export type StoredLine = ComputedLine & {
  id: string;
  /** Set when the office changed this line (or added it): a rebuild keeps it. */
  adjustedAt: string | null;
};

export type RebuildPlan = {
  insert: ComputedLine[];
  update: { id: string; line: ComputedLine }[];
  /** Explicit ids — computed lines whose source fact is gone and nobody touched. */
  remove: string[];
};

function sameLine(a: ComputedLine, b: ComputedLine): boolean {
  return (
    a.date === b.date &&
    a.unit === b.unit &&
    a.qty === b.qty &&
    a.ratePaise === b.ratePaise &&
    a.amountPaise === b.amountPaise &&
    a.source === b.source &&
    a.status === b.status &&
    a.note === b.note
  );
}

export function planRebuild(stored: StoredLine[], computed: ComputedLine[]): RebuildPlan {
  const byKey = new Map<string, StoredLine>();
  for (const s of stored) if (s.key) byKey.set(s.key, s);
  const fresh = new Set(computed.map((c) => c.key));
  const plan: RebuildPlan = { insert: [], update: [], remove: [] };
  for (const c of computed) {
    const s = byKey.get(c.key);
    if (!s) plan.insert.push(c);
    else if (s.adjustedAt) continue; // the office's word stands
    else if (!sameLine(s, c)) plan.update.push({ id: s.id, line: c });
  }
  for (const s of stored) {
    if (s.source === "office" || s.adjustedAt || !s.key) continue;
    if (!fresh.has(s.key)) plan.remove.push(s.id);
  }
  return plan;
}

export function sheetGrossPaise(lines: { status: WorkLineStatus; amountPaise: number }[]): number {
  return lines.filter((l) => l.status === "counted").reduce((n, l) => n + Math.round(l.amountPaise), 0);
}

export function sheetQty(lines: { status: WorkLineStatus; qty: number }[]): number {
  return lines.filter((l) => l.status === "counted").reduce((n, l) => n + l.qty, 0);
}

/** An office change: qty must be a real number of the unit, the reason real words. */
export function checkAdjustment(input: { qty: number; unit: VisitingUnit; reason: string }): string {
  if (String(input.reason || "").trim().length < 4) return "Give a reason (it is kept with the sheet)";
  if (!Number.isFinite(input.qty) || input.qty < 0) return "Enter a quantity of 0 or more";
  if (input.unit === "hour") {
    if (input.qty > 24) return "More than 24 hours in a day?";
    if (Math.round(input.qty * 4) !== input.qty * 4) return "Hours go in quarters (0.25, 0.5, 0.75)";
  } else {
    if (!Number.isInteger(input.qty)) return input.unit === "day" ? "Days are whole days" : "Periods are whole periods";
    if (input.unit === "day" && input.qty > 1) return "One line is one day";
    if (input.unit === "period" && input.qty > 12) return "More than 12 periods on one line?";
  }
  return "";
}

/* ── sheet status ─────────────────────────────────────────────────────── */

export type SheetStatus = "draft" | "approved" | "paid";

export function readSheetStatus(raw: unknown): SheetStatus {
  // Unknown is locked, never editable and never payable again.
  return raw === "draft" ? "draft" : raw === "approved" ? "approved" : "paid";
}

/**
 * Who did it, for maker ≠ checker: the staff record, else the login email —
 * never the display name, which two people can share and anyone can edit.
 */
export function actorKey(s: { staffId?: string | null; email?: string | null; fullName?: string | null }): string {
  if (s.staffId) return `staff:${s.staffId}`;
  if (s.email) return `email:${s.email.trim().toLowerCase()}`;
  return "";
}

/** Maker ≠ checker: the person who built or last changed the sheet does not approve it. Keys from actorKey. */
export function makerCheckerProblem(input: { approver: string; makers: string[]; approverIsOwner: boolean }): string {
  const who = input.approver.trim().toLowerCase();
  if (!who) return "Your login is not linked to a staff record or an email — it cannot approve";
  if (input.approverIsOwner) return "";
  if (input.makers.some((m) => m.trim().toLowerCase() === who)) {
    return "You built or changed this sheet — someone else with approve permission must approve it";
  }
  return "";
}

/* ── no double pay with payroll ───────────────────────────────────────── */

/**
 * A payroll line for this person and month means salary for those days —
 * someone switched to visiting mid-month, or drafted before the switch. A
 * sheet then would pay the same days twice, so it is refused until the
 * payroll line is taken out of that run. (Safer than an effective-from date:
 * the run's own day count is the only record of which days salary covered.)
 */
export function payrollOverlapProblem(runs: { runId: string; status: string; month: string }[], month: string): string {
  const hit = runs.find((r) => r.month === month);
  if (!hit) return "";
  return `This person is on the ${month} payroll run (${hit.status}) — a work sheet would pay the same days twice. Take them out of that payroll run first, or pay that month through payroll.`;
}

/**
 * Two approvals of the same person's sheets at once would each take the
 * year's catch-up TDS. An approval records the other sheets its TDS was
 * worked out against; if that set changed by the time it is saved, it is
 * undone and must be approved again.
 */
export function tdsBasisKey(earlier: { id: string; tdsPaise: number; grossPaise: number }[]): string {
  return earlier
    .map((e) => `${e.id}:${e.grossPaise}:${e.tdsPaise}`)
    .sort()
    .join("|");
}

/* ── TDS 194J ─────────────────────────────────────────────────────────── */

export const TDS_194J_THRESHOLD_PAISE = 30_000_00;
export const TDS_194J_RATE = 0.1;

/** Whole rupees (s.288B rounds TDS to the nearest rupee). */
function rupeeRound(paise: number): number {
  return Math.round(paise / 100) * 100;
}

export type TdsComputation = {
  applies: boolean;
  fy: string;
  thresholdPaise: number;
  ratePercent: number;
  /** This person's fees on the year's other approved/paid sheets. */
  earlierGrossPaise: number;
  earlierTdsPaise: number;
  thisGrossPaise: number;
  fyGrossPaise: number;
  /** True when this sheet takes the year over the threshold. */
  crossesNow: boolean;
  /** TDS for earlier payments that went untaxed, taken on this sheet. */
  catchUpPaise: number;
  /** 10% of this sheet. */
  currentPaise: number;
  /** What is deducted on this sheet (never more than its gross). */
  tdsPaise: number;
  /** TDS owed that this sheet could not carry (gross too small). */
  shortfallPaise: number;
  netPaise: number;
  explanation: string[];
};

const inrText = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function computeTds194J(input: {
  applies: boolean;
  month: string;
  grossPaise: number;
  /** Other sheets of the same person in the same FY that are approved or paid. */
  earlier: { month: string; grossPaise: number; tdsPaise: number }[];
  thresholdPaise?: number;
}): TdsComputation {
  const fy = fyOfMonth(input.month);
  const threshold = input.thresholdPaise ?? TDS_194J_THRESHOLD_PAISE;
  const earlier = input.earlier.filter((e) => fyOfMonth(e.month) === fy && e.month !== input.month);
  const earlierGross = earlier.reduce((n, e) => n + Math.max(0, Math.round(e.grossPaise)), 0);
  const earlierTds = earlier.reduce((n, e) => n + Math.max(0, Math.round(e.tdsPaise)), 0);
  const gross = Math.max(0, Math.round(input.grossPaise));
  const fyGross = earlierGross + gross;
  const base: TdsComputation = {
    applies: input.applies,
    fy,
    thresholdPaise: threshold,
    ratePercent: TDS_194J_RATE * 100,
    earlierGrossPaise: earlierGross,
    earlierTdsPaise: earlierTds,
    thisGrossPaise: gross,
    fyGrossPaise: fyGross,
    crossesNow: false,
    catchUpPaise: 0,
    currentPaise: 0,
    tdsPaise: 0,
    shortfallPaise: 0,
    netPaise: gross,
    explanation: [],
  };
  if (!input.applies) return { ...base, explanation: ["TDS is not ticked for this person"] };
  const fyLine = `FY ${fy} fees: earlier ${inrText(earlierGross)} + this sheet ${inrText(gross)} = ${inrText(fyGross)}`;
  if (fyGross <= threshold) {
    return { ...base, explanation: [fyLine, `Not above ${inrText(threshold)} — no TDS yet under 194J`] };
  }
  const owedOnYear = Math.max(0, rupeeRound(fyGross * TDS_194J_RATE) - earlierTds);
  const current = Math.min(owedOnYear, rupeeRound(gross * TDS_194J_RATE));
  const catchUp = owedOnYear - current;
  const tds = Math.min(owedOnYear, gross);
  const crossesNow = earlierGross <= threshold;
  const explanation = [
    fyLine,
    crossesNow ? `This sheet takes the year above ${inrText(threshold)}` : `The year was already above ${inrText(threshold)}`,
    `10% of this sheet: ${inrText(current)}`,
  ];
  if (catchUp > 0) explanation.push(`Catch-up on earlier untaxed fees this year: ${inrText(catchUp)} (10% of ${inrText(earlierGross)} less ${inrText(earlierTds)} already deducted)`);
  if (owedOnYear > tds) explanation.push(`${inrText(owedOnYear - tds)} could not be deducted (the sheet is smaller) — it carries to the next sheet`);
  return {
    ...base,
    crossesNow,
    catchUpPaise: catchUp,
    currentPaise: current,
    tdsPaise: tds,
    shortfallPaise: owedOnYear - tds,
    netPaise: gross - tds,
    explanation,
  };
}

/* ── paying ───────────────────────────────────────────────────────────── */

export type VisitingPayMode = "cashfree" | "cash" | "bank";

/** How Cashfree can pay this person: bank, else UPI ID, else a link to their phone. */
export function staffPayInstrument(
  s: { bankAccountNo?: string; bankIfsc?: string; upiId?: string; mobile?: string },
  phoneProblem: (raw: string) => string,
  wanted: "transfer" | "link" | "" = "",
):
  | { ok: true; channel: "transfer"; accountNumber: string; ifsc: string; vpa: string }
  | { ok: true; channel: "link" }
  | { ok: false; error: string } {
  const account = String(s.bankAccountNo || "").replace(/\s/g, "");
  const ifsc = String(s.bankIfsc || "").trim().toUpperCase();
  const vpa = String(s.upiId || "").trim().toLowerCase();
  const hasBank = /^\d{6,18}$/.test(account) && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc);
  const hasVpa = /^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9.-]{1,63}$/.test(vpa);
  const hasPhone = !phoneProblem(s.mobile || "");
  if (wanted !== "link" && hasBank) return { ok: true, channel: "transfer", accountNumber: account, ifsc, vpa: "" };
  if (wanted !== "link" && hasVpa) return { ok: true, channel: "transfer", accountNumber: "", ifsc: "", vpa };
  if (wanted === "transfer") return { ok: false, error: "No usable bank account + IFSC or UPI ID on the staff profile — add one on the Bank tab, or send a pay link" };
  if (hasPhone) return { ok: true, channel: "link" };
  return { ok: false, error: "Add a bank account + IFSC, a UPI ID, or a real mobile number on the staff profile first" };
}

/**
 * The payment voucher: Dr 5075 Visiting faculty fees (gross) / Cr 2310 TDS
 * Payable (TDS) / Cr the money that left (net) — the wallet (1110) for
 * Cashfree, the cash box (1000) for cash, the chosen bank otherwise.
 */
export function visitingPaymentLines(input: {
  grossPaise: number;
  tdsPaise: number;
  netPaise: number;
  mode: VisitingPayMode;
  bankLedgerCode?: string;
  bankAccountId?: string;
  staff: { id: string; name: string };
  narration: string;
  instrument?: { mode?: string; ref?: string; date?: string };
}): { ok: true; lines: LedgerLineInput[] } | { ok: false; error: string } {
  const gross = Math.round(input.grossPaise);
  const tds = Math.round(input.tdsPaise);
  const net = Math.round(input.netPaise);
  if (!(gross > 0)) return { ok: false, error: "Nothing to pay on this sheet" };
  if (tds < 0 || net < 0 || tds + net !== gross) return { ok: false, error: "Gross must equal TDS + net" };
  let money: { code: string; sub?: { kind: "bank_account"; id: string } };
  if (input.mode === "cashfree") money = { code: L_PAYOUTS_WALLET };
  else if (input.mode === "cash") money = { code: L_CASH };
  else {
    const code = String(input.bankLedgerCode || "");
    if (!code || code === L_PAYOUTS_WALLET || code === L_CASH) return { ok: false, error: "Choose the school bank the money left" };
    money = { code, ...(input.bankAccountId ? { sub: { kind: "bank_account" as const, id: input.bankAccountId } } : {}) };
  }
  const party = { kind: "staff" as const, externalId: input.staff.id, name: input.staff.name };
  const lines: LedgerLineInput[] = [
    { accountCode: L_VISITING_FEES, debitPaise: gross, creditPaise: 0, narration: input.narration, party },
  ];
  if (tds > 0) lines.push({ accountCode: L_TDS_PAYABLE, debitPaise: 0, creditPaise: tds, narration: `TDS u/s 194J — ${input.narration}`, party });
  if (net > 0) {
    lines.push({
      accountCode: money.code,
      debitPaise: 0,
      creditPaise: net,
      narration: input.narration,
      ...(money.sub ? { subledgerKind: money.sub.kind, subledgerId: money.sub.id } : {}),
      ...(input.instrument ? { instrument: input.instrument } : {}),
    });
  }
  return { ok: true, lines };
}

/* ── who holds the sheet for payment (payment_key) ────────────────────── */

export function handKey(mode: "cash" | "bank", sheetId: string): string {
  return `${mode}:${sheetId}`;
}
export function cashfreeKey(sheetId: string): string {
  return `cashfree:${sheetId}`;
}

/**
 * Recording a hand payment: claim a free sheet; carry on when this same
 * method already holds it (an earlier try posted the voucher, then failed to
 * mark the sheet paid — the voucher is keyed and will not repeat); refuse
 * when anything else holds it.
 */
export function handPayDecision(s: { status: SheetStatus; paymentKey: string; mode: "cash" | "bank"; sheetId: string }):
  | { action: "claim" }
  | { action: "continue" }
  | { action: "refuse"; error: string } {
  if (s.status === "paid") return { action: "refuse", error: "This sheet is already paid" };
  if (s.status !== "approved") return { action: "refuse", error: "Approve the sheet before paying it" };
  if (!s.paymentKey) return { action: "claim" };
  if (s.paymentKey === handKey(s.mode, s.sheetId)) return { action: "continue" };
  return {
    action: "refuse",
    error: s.paymentKey.startsWith("cashfree:") ? "A Cashfree payment holds this sheet — cancel it before paying another way" : "This sheet is already being paid another way",
  };
}

/** Preparing a Cashfree payment: only a free, approved sheet. "" = go. */
export function cashfreePrepareDecision(s: { status: SheetStatus; paymentKey: string; sheetId: string }): string {
  if (s.status === "paid") return "This sheet is already paid";
  if (s.status !== "approved") return "Approve the sheet before paying it";
  if (s.paymentKey) return s.paymentKey === cashfreeKey(s.sheetId) ? "A Cashfree payment for this sheet is already waiting or on its way" : "This sheet is being paid another way";
  return "";
}

/** Cashfree says the money arrived: book it, or say it was paid twice. */
export function cashfreeApplyDecision(s: {
  status: SheetStatus;
  paymentKey: string;
  sheetId: string;
  payMode: string;
  payoutRequestId: string;
  requestId: string;
}): { action: "done" } | { action: "paid_twice"; how: string } | { action: "claim" } | { action: "book" } {
  if (s.status === "paid") {
    return s.payMode === "cashfree" && s.payoutRequestId === s.requestId ? { action: "done" } : { action: "paid_twice", how: `by ${s.payMode}`.trim() };
  }
  if (!s.paymentKey) return { action: "claim" };
  if (s.paymentKey === cashfreeKey(s.sheetId)) return { action: "book" };
  return { action: "paid_twice", how: `by hand (${s.paymentKey.split(":")[0]}) while this payment was on its way` };
}

export function sheetStatusSentence(s: SheetStatus): string {
  return s === "draft" ? "Draft — the office can still change it" : s === "approved" ? "Approved — locked, ready to pay" : "Paid";
}
