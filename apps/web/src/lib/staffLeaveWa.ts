/**
 * Staff leave over WhatsApp — pure.
 *
 * A staff member asks for CL or ML (the leave master's ML, "Medical leave")
 * for a day that has not ended yet (up to 11:59 PM IST of the leave day).
 * The leave master's own rules decide it — the balance, CL's one day a
 * month, CL's one day per application — through the same functions the HR
 * desk uses (staffHr.ts). When CL for that month is already used, or the
 * balance is gone, the leave can still go as Leave Without Pay, once the
 * staff member accepts that. It then goes to the principal and the admins;
 * the first of them to approve decides it, it is posted to the ERP, and the
 * day is marked as leave. A second approver is told it is already done.
 *
 * Director's brief, 29 Sep 2026.
 */

import {
  computeLeaveDays,
  remainingBalance,
  validateLeaveAdjustmentRules,
  type LeaveRequest,
  type StaffHrState,
} from "@/lib/staffHr";

export type WaLeaveType = "CL" | "ML" | "LWP";

/* ── Reading the ask ─────────────────────────────────────────────────── */

const CL_WORDS = /(?<![\p{L}\p{M}\p{N}])(cl|casual(\s+leave)?|casual\s*chutti)(?![\p{L}\p{M}\p{N}])/iu;
const ML_WORDS =
  /(?<![\p{L}\p{M}\p{N}])(ml|sl|medical(\s+leave)?|sick(\s+leave)?|bimar|beemar|bimari|tabiyat|tabiyat\s+kharab|fever|bukhar|बीमार|मेडिकल)(?![\p{L}\p{M}\p{N}])/iu;
const LEAVE_WORDS = /(?<![\p{L}\p{M}\p{N}])(leave|chutti|chhutti|avkash|अवकाश|छुट्टी)(?![\p{L}\p{M}\p{N}])/iu;
const APPLY_WORDS =
  /(?<![\p{L}\p{M}\p{N}])(apply|need|want|chahiye|chaiye|leni\s+hai|lena\s+hai|lunga|lungi|le\s+raha|le\s+rahi|request|application|mujhe|i\s+will\s+be|i'?m\s+taking|taking|take)(?![\p{L}\p{M}\p{N}])/iu;
/** A leave question about someone else, or the approvers' queue — not an application. */
const NOT_AN_APPLICATION =
  /(?<![\p{L}\p{M}\p{N}])(requests|pending|list|approve|approved|reject|ok|no|kaun|who|students?|class|balance|kitni|kitna|bachi|remaining)(?![\p{L}\p{M}\p{N}])/iu;

export function parseLeaveType(text: string): WaLeaveType | null {
  const t = text || "";
  if (CL_WORDS.test(t)) return "CL";
  if (ML_WORDS.test(t)) return "ML";
  if (/(?<![\p{L}\p{M}\p{N}])(lwp|without\s+pay|unpaid)(?![\p{L}\p{M}\p{N}])/iu.test(t)) return "LWP";
  return null;
}

/**
 * "Apply leave", "CL tomorrow", "ML 2 Oct to 4 Oct fever", "kal chutti
 * chahiye", "I need leave on Monday" — the start of an application, with
 * whatever it already says. Null for everything else, including the
 * approvers' own "LEAVE", "leave requests", and a student's leave.
 */
/**
 * Which half a half-day leave takes off, from a WhatsApp message — only when
 * it is said plainly. "Half day" alone could mean either, so it stays "" and
 * the register asks for the "other half" to be punched.
 */
export function parseHalfDaySession(text: string): "" | "morning" | "afternoon" {
  const t = (text || "").toLowerCase();
  if (/(first|1st|pehl[ae])\s*half|morning\s*(off|leave|chhutti)|सुबह\s*की\s*छुट्टी|पहला\s*हाफ/u.test(t)) return "morning";
  if (/(second|2nd|doosr[ae]|dusr[ae])\s*half|afternoon\s*(off|leave|chhutti)|दोपहर\s*की\s*छुट्टी|दूसरा\s*हाफ/u.test(t)) return "afternoon";
  return "";
}

export function parseLeaveApplyStart(
  text: string,
  todayIso: string,
): {
  typeCode: WaLeaveType | null;
  dates: { from: string; to: string } | null;
  halfDay: boolean;
  halfDaySession: "" | "morning" | "afternoon";
} | null {
  const t = (text || "").trim();
  if (!t || t.length > 200) return null;
  if (/^\s*leave\s*$/i.test(t)) return null;
  if (NOT_AN_APPLICATION.test(t)) return null;
  const typeCode = parseLeaveType(t);
  const explicitType = /^(cl|ml|sl)(\s|$)/i.test(t) || /(casual|medical|sick)\s+leave/i.test(t);
  const leaveWord = LEAVE_WORDS.test(t);
  if (!explicitType && !(leaveWord && (APPLY_WORDS.test(t) || parseLeaveDates(t, todayIso)))) return null;
  return {
    typeCode,
    dates: parseLeaveDates(t, todayIso),
    halfDay:
      /(?<![\p{L}\p{M}\p{N}])(half\s*day|aadha\s*din|आधा\s*दिन)(?![\p{L}\p{M}\p{N}])/iu.test(t) ||
      parseHalfDaySession(t) !== "",
    halfDaySession: parseHalfDaySession(t),
  };
}

/** "my leave", "leave balance", "kitni CL bachi hai" — the balances. */
export function isLeaveBalanceAsk(text: string): boolean {
  const t = (text || "").trim().toLowerCase();
  return (
    /^(my\s+leaves?|leave\s+balance|my\s+leave\s+balance|balance\s+leave|cl\s+balance|ml\s+balance|meri\s+leave|meri\s+chutti)[\s?!.]*$/i.test(t) ||
    (/(cl|ml|sl|leave|chutti)/i.test(t) && /(kitni|kitna|bachi|balance|remaining|left)/i.test(t) && t.length <= 60)
  );
}

/* ── Dates ───────────────────────────────────────────────────────────── */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11,
  november: 11, dec: 12, december: 12,
};
const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, ravivar: 0, monday: 1, mon: 1, somvar: 1, tuesday: 2, tue: 2, mangalvar: 2,
  wednesday: 3, wed: 3, budhvar: 3, thursday: 4, thu: 4, guruvar: 4, friday: 5, fri: 5, shukravar: 5,
  saturday: 6, sat: 6, shanivar: 6,
};

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function ymd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const back = new Date(`${iso}T00:00:00Z`);
  return back.getUTCMonth() + 1 === m && back.getUTCDate() === d ? iso : null;
}

/** One date from a fragment — never in the past by more than a few days' wrap. */
function oneDate(frag: string, todayIso: string): string | null {
  const f = frag.trim().toLowerCase();
  if (!f) return null;
  if (/^(today|aaj|आज)$/.test(f)) return todayIso;
  // For leave, "kal" is tomorrow: nobody applies for yesterday.
  if (/^(tomorrow|tmrw|tmr|kal|कल)$/.test(f)) return addDays(todayIso, 1);
  if (/^(day\s+after(\s+tomorrow)?|parso|परसों)$/.test(f)) return addDays(todayIso, 2);
  const iso = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(f);
  if (iso) return ymd(+iso[1]!, +iso[2]!, +iso[3]!);
  const year = +todayIso.slice(0, 4);
  const dm = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(f);
  if (dm) {
    const y = dm[3] ? (dm[3].length === 2 ? 2000 + +dm[3] : +dm[3]) : year;
    const got = ymd(y, +dm[2]!, +dm[1]!);
    // "2/1" typed in December means next January.
    if (got && !dm[3] && got < addDays(todayIso, -7)) return ymd(y + 1, +dm[2]!, +dm[1]!);
    return got;
  }
  const dmon = /^(\d{1,2})(?:st|nd|rd|th)?\s*([a-z]+)$/.exec(f) ?? /^([a-z]+)\s*(\d{1,2})(?:st|nd|rd|th)?$/.exec(f);
  if (dmon) {
    const [a, b] = [dmon[1]!, dmon[2]!];
    const day = /^\d/.test(a) ? +a : +b;
    const mon = MONTHS[/^\d/.test(a) ? b : a];
    if (!mon) return null;
    const got = ymd(year, mon, day);
    if (got && got < addDays(todayIso, -7)) return ymd(year + 1, mon, day);
    return got;
  }
  const wd = WEEKDAYS[f.replace(/^(next|coming|agle|agla)\s+/, "")];
  if (wd !== undefined) {
    const now = new Date(`${todayIso}T00:00:00Z`).getUTCDay();
    let ahead = (wd - now + 7) % 7;
    if (ahead === 0) ahead = 7;
    return addDays(todayIso, ahead);
  }
  return null;
}

const DATE_TOKEN =
  "(?:today|aaj|tomorrow|tmrw|tmr|kal|day\\s+after(?:\\s+tomorrow)?|parso|20\\d{2}-\\d{2}-\\d{2}|\\d{1,2}[/.-]\\d{1,2}(?:[/.-]\\d{2,4})?|\\d{1,2}(?:st|nd|rd|th)?\\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\s*\\d{1,2}(?:st|nd|rd|th)?|(?:next\\s+|coming\\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat))";

/**
 * The leave's dates: "tomorrow", "2 Oct", "02/10", "2 Oct to 4 Oct",
 * "02-10 se 04-10", "Monday". A range needs "to", "se", "till" or "-" between
 * two dates. Null when there is no date in it.
 */
export function parseLeaveDates(text: string, todayIso: string): { from: string; to: string } | null {
  const low = ` ${(text || "").toLowerCase()} `;
  const range = new RegExp(`(?<![a-z0-9])(${DATE_TOKEN})\\s*(?:to|se|till|until|tak|–|—|-)\\s*(${DATE_TOKEN})(?![a-z0-9])`, "i").exec(low);
  if (range) {
    const from = oneDate(range[1]!, todayIso);
    const to = oneDate(range[2]!, todayIso);
    if (from && to) return from <= to ? { from, to } : { from: to, to: from };
  }
  const single = new RegExp(`(?<![a-z0-9])(${DATE_TOKEN})(?![a-z0-9])`, "i").exec(low);
  if (single) {
    const d = oneDate(single[1]!, todayIso);
    if (d) return { from: d, to: d };
  }
  return null;
}

/**
 * Every date a message mentions, in order, as YYYY-MM-DD — "kal", "2 Oct",
 * "02/10", "Monday". Used beyond leave: a held notice expires once the day
 * it talks about has come.
 */
export function datesMentioned(text: string, todayIso: string): string[] {
  const low = ` ${(text || "").toLowerCase()} `;
  const re = new RegExp(`(?<![a-z0-9])(${DATE_TOKEN})(?![a-z0-9])`, "gi");
  const out: string[] = [];
  for (const m of low.matchAll(re)) {
    const d = oneDate(m[1]!, todayIso);
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

/* ── The rules ───────────────────────────────────────────────────────── */

export type LeaveVerdict =
  | { kind: "ok"; days: number }
  /** Not allowed as asked, but can go as Leave Without Pay. */
  | { kind: "lwp"; days: number; why: string }
  | { kind: "refuse"; why: string };

/**
 * What the leave master says about this application — with the staff
 * member's balances and their other CL/ML in that month already in `state`.
 * Only today and later: a day that has ended cannot be applied for here.
 */
export function leaveVerdict(input: {
  state: StaffHrState;
  staffId: string;
  academicYearCode: string;
  typeCode: WaLeaveType;
  from: string;
  to: string;
  halfDay: boolean;
  todayIso: string;
}): LeaveVerdict {
  const { state, typeCode } = input;
  if (input.from < input.todayIso) {
    return { kind: "refuse", why: "A day that has already ended cannot be applied for here — please speak to the office." };
  }
  const to = input.halfDay ? input.from : input.to;
  const days = computeLeaveDays(input.from, to, input.halfDay);
  if (days > 31) return { kind: "refuse", why: "That is more than a month — please apply at the office." };
  const type = state.leaveTypes.find((t) => t.code === typeCode);
  if (!type) return { kind: "refuse", why: `${typeCode} is not set up in the leave master. Please ask the office.` };
  if (typeCode === "LWP") return { kind: "ok", days };

  // One application's worth: CL is one day per application.
  if (type.maxDaysPerRequest > 0 && days > type.maxDaysPerRequest + 0.001) {
    return {
      kind: "refuse",
      why: `${type.name} allows at most ${type.maxDaysPerRequest} day${type.maxDaysPerRequest === 1 ? "" : "s"} per application. For more days, apply for ML, or for Leave Without Pay.`,
    };
  }

  // The month: CL already used (or asked for) this month.
  const rule = validateLeaveAdjustmentRules(state, {
    staffId: input.staffId,
    typeCode,
    fromDate: input.from,
    toDate: to,
    days,
    halfDay: input.halfDay,
  });
  if (rule) {
    return {
      kind: "lwp",
      days,
      why:
        typeCode === "CL"
          ? `You have already used this month's CL entitlement (${type.maxDaysPerMonth} day${type.maxDaysPerMonth === 1 ? "" : "s"})`
          : rule,
    };
  }

  // The year: what is left.
  const bal = state.leaveBalances.find(
    (b) => b.staffId === input.staffId && b.typeCode === typeCode && b.academicYearCode === input.academicYearCode,
  );
  const left = bal ? remainingBalance(bal) : type.defaultDaysPerYear;
  const shown = type.code;
  if (type.defaultDaysPerYear > 0 && days > left + 0.001) {
    return {
      kind: "lwp",
      days,
      why: left > 0 ? `You have only ${left} ${shown} day${left === 1 ? "" : "s"} left this year` : `You have no ${shown} left this year`,
    };
  }
  return { kind: "ok", days };
}

/** Is this request's day still open for a WhatsApp decision? Until 11:59 PM IST of its first day. */
export function leaveDecisionOpen(fromDate: string, todayIso: string): boolean {
  return fromDate >= todayIso;
}

/* ── Wording ─────────────────────────────────────────────────────────── */

export function leaveTypeLabel(code: string): string {
  return code === "CL" ? "CL (Casual leave)" : code === "ML" ? "ML (Medical leave)" : code === "LWP" ? "Leave without pay" : code;
}

export function formatLeaveDates(from: string, to: string, halfDay: boolean): string {
  const f = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
  };
  if (halfDay) return `${f(from)} (half day)`;
  return from === to ? f(from) : `${f(from)} to ${f(to)}`;
}

export function composeLeaveAskType(): string {
  return [
    "Which leave?",
    "",
    "*1* — CL (Casual leave) · 1 day a month",
    "*2* — ML (Medical / sick leave)",
    "",
    "Reply 1 or 2 · *CANCEL* to stop.",
  ].join("\n");
}

export function composeLeaveAskDates(typeCode: string): string {
  return [
    `${leaveTypeLabel(typeCode)} — for which date?`,
    "",
    "e.g. _today_, _tomorrow_, _2 Oct_, _02/10_ or _2 Oct to 4 Oct_",
    typeCode === "CL" ? "_Half day? add *half day*._" : "",
    "",
    "Leave can be applied until 11:59 PM of the same day.",
  ]
    .filter((l, i, a) => l || (i > 0 && a[i - 1]))
    .join("\n");
}

export function composeLeaveAskReason(): string {
  return "The reason, in a few words? (e.g. _fever_, _family function_, _doctor's appointment_)";
}

export function composeLeaveLwpOffer(opts: { why: string; asked: string; dates: string }): string {
  return [
    `⚠️ ${opts.why}.`,
    "",
    `So this ${opts.asked} on *${opts.dates}* will be *Leave Without Pay*.`,
    "",
    "Reply *YES* to apply for it as Leave Without Pay, or *NO* to cancel.",
  ].join("\n");
}

export function composeLeaveSummary(opts: { typeCode: string; dates: string; days: number; reason: string }): string {
  return [
    "*Your leave application*",
    `• ${leaveTypeLabel(opts.typeCode)}`,
    `• ${opts.dates} · ${opts.days} day${opts.days === 1 ? "" : "s"}`,
    `• Reason: ${opts.reason}`,
    "",
    "Send it to the Principal and Admin for approval? Reply *YES* or *NO*.",
  ].join("\n");
}

export function composeLeaveSent(code: string): string {
  return [
    `✅ Sent to the Principal and Admin for approval — request *#${code}*.`,
    "You'll get a message here as soon as one of them decides.",
  ].join("\n");
}

export function composeLeaveApproverRequest(opts: {
  code: string;
  staffName: string;
  empCode: string;
  designation: string;
  typeCode: string;
  dates: string;
  days: number;
  reason: string;
  lwpWhy?: string;
}): string {
  return [
    `🗓️ *Leave request #${opts.code}*`,
    `${opts.staffName}${opts.empCode ? ` (${opts.empCode})` : ""}${opts.designation ? ` · ${opts.designation}` : ""}`,
    `${leaveTypeLabel(opts.typeCode)} · ${opts.dates} · ${opts.days} day${opts.days === 1 ? "" : "s"}`,
    `Reason: ${opts.reason}`,
    opts.lwpWhy ? `_Leave Without Pay: ${opts.lwpWhy}._` : "",
    "",
    `Reply *LEAVE OK ${opts.code}* to approve, or *LEAVE NO ${opts.code}* to refuse.`,
    "The first reply decides; it is then posted to the ERP and the day is marked.",
  ]
    .filter((l, i, a) => l || (i > 0 && a[i - 1]))
    .join("\n");
}

/** "LEAVE OK 4821", "leave no #4821" — a code, never the queue's list number. */
export function parseLeaveCodeDecision(text: string): { approve: boolean; code: string } | null {
  const m = /^\s*(?:leave|lv)\s+(ok|yes|approve|approved|no|reject|rejected|refuse|deny)\s*#?\s*(\d{4})\s*$/i.exec(text || "");
  if (!m) return null;
  return { approve: /^(ok|yes|approve|approved)$/i.test(m[1]!), code: m[2]! };
}

export function composeLeaveBalances(opts: {
  types: { code: string; name: string; paid: boolean; defaultDaysPerYear: number; maxDaysPerMonth: number }[];
  left: Record<string, number>;
  usedThisMonth: Record<string, number>;
}): string {
  const lines = ["*Your leave this year*"];
  for (const t of opts.types) {
    if (t.code === "LWP" || t.defaultDaysPerYear <= 0) continue;
    const month = t.maxDaysPerMonth > 0 ? ` · this month ${opts.usedThisMonth[t.code] ?? 0}/${t.maxDaysPerMonth} used` : "";
    lines.push(`• ${t.code} (${t.name}) — ${opts.left[t.code] ?? t.defaultDaysPerYear} left${month}`);
  }
  lines.push("", "To apply: _CL tomorrow_ or _ML 2 Oct to 4 Oct fever_");
  return lines.join("\n");
}

/** Days of this staff member's pending/approved leave of one type in a month (YYYY-MM). */
export function leaveUsedInMonth(requests: LeaveRequest[], staffId: string, typeCode: string, ym: string): number {
  let total = 0;
  for (const r of requests) {
    if (r.staffId !== staffId || r.typeCode !== typeCode) continue;
    if (!["pending", "pending_l2", "approved"].includes(r.status)) continue;
    if (r.fromDate.slice(0, 7) === ym || r.toDate.slice(0, 7) === ym) total += r.days;
  }
  return total;
}
