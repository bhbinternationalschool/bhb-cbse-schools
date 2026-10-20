/**
 * Month ↔ date-range filter rule — ONE rule for every screen that offers a
 * month picker next to a From / To range (director, 15 Oct 2026: "check
 * wherever the month and date-range filters are available — they are not
 * respecting each other").
 *
 * Before this module each screen kept the month and the range as two
 * unrelated values. Depending on the screen the list then filtered by the
 * range and ignored the month (attendance reports: From/To always set, so
 * "Month = October" changed nothing), or by BOTH at once (student reports:
 * Month = October AND From/To in September returned no rows and said
 * nothing). Either way the screen could show one period and filter another.
 *
 * The rule, everywhere:
 *
 *   1. There is one period: a date range { from, to } (IST calendar days,
 *      "YYYY-MM-DD", both ends inclusive). "" on both ends = all dates,
 *      only where a screen allows it.
 *   2. Picking a month sets the range to that month's first..last day.
 *   3. Editing From or To keeps the range; the month box then reads that
 *      month when the range is exactly one whole month, else "Custom".
 *      A From after To moves the other end so the range is never inverted.
 *   4. The list, its totals and its export all filter by the range only.
 *   5. The academic session bounds both: the range is clipped into the
 *      session, the month list is the session's twelve months, and a session
 *      change carries the period over only if it still fits (else the
 *      session's own default month).
 *   6. URL search params and remembered filters store the range (plus the
 *      month as a label); on restore they go through the same rule, so a
 *      stale or contradictory pair can never come back.
 *
 * Pure — no React, no clock unless passed. Self-test: monthRange.selftest.ts.
 */

import { MONTH_NAMES } from "./monthGroups";

export type DateRange = {
  /** "YYYY-MM-DD", or "" for open. */
  from: string;
  /** "YYYY-MM-DD", or "" for open. */
  to: string;
};

/** Inclusive session bounds, or null when the screen has no session. */
export type SessionBounds = { from: string; to: string } | null;

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const YM = /^(\d{4})-(\d{2})$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function plausibleYear(y: number) {
  return y >= 1900 && y <= 2200;
}

function lastDay(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Today in India, "YYYY-MM-DD". */
export function istTodayIso(nowMs: number = Date.now()): string {
  const d = new Date(nowMs + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** This month in India, "YYYY-MM". */
export function istThisMonth(nowMs: number = Date.now()): string {
  return istTodayIso(nowMs).slice(0, 7);
}

/** True for a real calendar day "YYYY-MM-DD" (29 Feb only in leap years). */
export function isIsoDay(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = YMD.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return plausibleYear(y) && mo >= 1 && mo <= 12 && d >= 1 && d <= lastDay(y, mo);
}

/** True for a real month "YYYY-MM". */
export function isYm(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = YM.exec(s);
  if (!m) return false;
  return plausibleYear(Number(m[1])) && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

/** First and last day of a month, or null for anything that is not one. */
export function monthBounds(ym: string): DateRange | null {
  if (!isYm(ym)) return null;
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return { from: `${ym}-01`, to: `${ym}-${pad2(lastDay(y, m))}` };
}

/** "October 2026". */
export function monthName(ym: string): string {
  if (!isYm(ym)) return ym;
  return `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

/** Academic session "2026-27" → 1 Apr 2026 .. 31 Mar 2027; null if unreadable. */
export function sessionBounds(ay: string | null | undefined): SessionBounds {
  const m = /^(\d{4})-(\d{2}|\d{4})$/.exec(String(ay ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  if (!plausibleYear(y)) return null;
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
}

/** The months of a session, oldest first ("2026-04" … "2027-03"). */
export function sessionMonths(session: SessionBounds): string[] {
  if (!session) return [];
  const out: string[] = [];
  let y = Number(session.from.slice(0, 4));
  let m = Number(session.from.slice(5, 7));
  const end = session.to.slice(0, 7);
  for (let i = 0; i < 36; i++) {
    const ym = `${y}-${pad2(m)}`;
    out.push(ym);
    if (ym >= end) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** The month a range is exactly (1st..last day of one month), else null. */
export function exactMonth(range: DateRange): string | null {
  if (!isIsoDay(range.from) || !isIsoDay(range.to)) return null;
  const ym = range.from.slice(0, 7);
  const b = monthBounds(ym);
  return b && b.from === range.from && b.to === range.to ? ym : null;
}

/** Both ends open — the screen shows every date. */
export function isAllDates(range: DateRange): boolean {
  return !range.from && !range.to;
}

/**
 * Clip a range into the session. An end outside the session moves to the
 * session's edge; a range wholly outside it collapses onto that edge.
 * Open ends stay open (an open end already means "as far as the session").
 */
export function clampToSession(range: DateRange, session: SessionBounds): DateRange {
  if (!session) return range;
  const clip = (d: string) => (!d ? d : d < session.from ? session.from : d > session.to ? session.to : d);
  return { from: clip(range.from), to: clip(range.to) };
}

/** Never inverted: when From > To the end that was NOT just edited follows. */
function order(range: DateRange, edited: "from" | "to"): DateRange {
  if (range.from && range.to && range.from > range.to) {
    return edited === "from" ? { from: range.from, to: range.from } : { from: range.to, to: range.to };
  }
  return range;
}

/** Rule 2: a month becomes its first..last day, inside the session. */
export function pickMonth(ym: string, session: SessionBounds): DateRange | null {
  const b = monthBounds(ym);
  if (!b) return null;
  return clampToSession(b, session);
}

/** Rule 3: one end edited. Bad dates are ignored (the previous range stays). */
export function editRange(
  prev: DateRange,
  patch: Partial<DateRange>,
  session: SessionBounds,
  opts: { allowOpen?: boolean } = {},
): DateRange {
  let next = { ...prev };
  let edited: "from" | "to" = "from";
  for (const key of ["from", "to"] as const) {
    if (!(key in patch)) continue;
    const v = patch[key] ?? "";
    if (v === "" && !opts.allowOpen) continue;
    if (v !== "" && !isIsoDay(v)) continue;
    next[key] = v;
    edited = key;
  }
  next = clampToSession(next, session);
  return order(next, edited);
}

/** What the month box shows: the exact month, "" when the range is custom. */
export function monthBoxValue(range: DateRange): string {
  return exactMonth(range) ?? "";
}

/** "October 2026", "Custom", or "All dates". */
export function rangeLabel(range: DateRange): string {
  if (isAllDates(range)) return "All dates";
  const ym = exactMonth(range);
  return ym ? monthName(ym) : "Custom";
}

/** The default month of a session: this month when today is in it, else its last month (a past session) or first month (a future one). */
export function defaultMonth(session: SessionBounds, nowMs: number = Date.now()): string {
  const today = istTodayIso(nowMs);
  if (!session) return today.slice(0, 7);
  if (today < session.from) return session.from.slice(0, 7);
  if (today > session.to) return session.to.slice(0, 7);
  return today.slice(0, 7);
}

/** True when both set ends lie inside the session. */
export function fitsSession(range: DateRange, session: SessionBounds): boolean {
  if (!session) return true;
  const ok = (d: string) => !d || (d >= session.from && d <= session.to);
  return ok(range.from) && ok(range.to);
}

/**
 * Rule 5: the session changed. Keep the period when it still fits; else the
 * new session's default month. "All dates" stays all dates.
 */
export function onSessionChange(range: DateRange, session: SessionBounds, nowMs: number = Date.now()): DateRange {
  if (isAllDates(range) || fitsSession(range, session)) return range;
  return pickMonth(defaultMonth(session, nowMs), session) ?? range;
}

/**
 * The single month a month-only report should use: the exact month, else the
 * month the range ENDS in (a year-to-date range → this month), else the
 * session's default month.
 */
export function monthOf(range: DateRange, session: SessionBounds, nowMs: number = Date.now()): string {
  if (exactMonth(range)) return exactMonth(range)!;
  if (isIsoDay(range.to)) return range.to.slice(0, 7);
  if (isIsoDay(range.from)) return range.from.slice(0, 7);
  return defaultMonth(session, nowMs);
}

/** Rule 4 helper: is an IST calendar day ("YYYY-MM-DD…") inside the range? Open ends always pass. */
export function inRange(day: string | null | undefined, range: DateRange): boolean {
  if (isAllDates(range)) return true;
  const d = String(day ?? "").slice(0, 10);
  if (!isIsoDay(d)) return false;
  if (range.from && d < range.from) return false;
  if (range.to && d > range.to) return false;
  return true;
}

/**
 * Rule 6: restore. Accepts what a URL or localStorage held — a range, a
 * month, or both (even contradictory) — and returns one consistent range.
 * The range wins when it is valid (it is what the list filtered by); a month
 * alone becomes its bounds; anything unreadable returns null (use defaults).
 */
export function restoreRange(
  raw: { from?: unknown; to?: unknown; month?: unknown } | null | undefined,
  session: SessionBounds,
  opts: { allowOpen?: boolean } = {},
): DateRange | null {
  if (!raw || typeof raw !== "object") return null;
  const from = isIsoDay(raw.from) ? raw.from : "";
  const to = isIsoDay(raw.to) ? raw.to : "";
  if (from && to) {
    const r = order(clampToSession({ from, to }, session), "from");
    return fitsSession({ from, to }, session) ? r : null;
  }
  if ((from || to) && opts.allowOpen) {
    return fitsSession({ from, to }, session) ? { from, to } : null;
  }
  if (isYm(raw.month)) {
    const b = monthBounds(raw.month);
    return b && fitsSession(b, session) ? b : null;
  }
  if (opts.allowOpen && raw.from === "" && raw.to === "") return { from: "", to: "" };
  return null;
}

/** What is stored/put in the URL: the range, plus the month as a label. */
export function persistShape(range: DateRange): { from: string; to: string; month: string } {
  return { from: range.from, to: range.to, month: monthBoxValue(range) };
}

/* ─── Report catalogues: one period across every report ──────────────────
 *
 * The attendance and leave report screens list many reports; each asks for
 * some of Date / From-To / Month. They now share ONE period, and each
 * report reads it the way its filters allow:
 *
 *   range       — the report has From/To (with or without Month): it filters
 *                 by the range; Month is only the range's label.
 *   month       — Month only: the period snaps to one whole month.
 *   dayOrMonth  — Date + Month, no range: one day OR one month; the period
 *                 snaps to whichever it is closest to.
 *   none        — no period (a Date-only report keeps its own day).
 */

export type ReportPeriodMode = "range" | "month" | "dayOrMonth" | "none";

export function reportPeriodMode(filters: readonly string[]): ReportPeriodMode {
  const has = (k: string) => filters.includes(k);
  if (has("fromTo")) return "range";
  if (has("month") && has("date")) return "dayOrMonth";
  if (has("month")) return "month";
  return "none";
}

/** A single day: From = To. */
export function singleDay(range: DateRange): string | null {
  return isIsoDay(range.from) && range.from === range.to ? range.from : null;
}

/**
 * The range a report should switch to when it is opened, or null to keep
 * the current one — so what the boxes show is always what the report reads.
 */
export function snapForMode(
  mode: ReportPeriodMode,
  range: DateRange,
  session: SessionBounds,
  nowMs: number = Date.now(),
): DateRange | null {
  if (mode === "month" && !exactMonth(range)) return pickMonth(monthOf(range, session, nowMs), session);
  if (mode === "dayOrMonth" && !exactMonth(range) && !singleDay(range)) {
    return pickMonth(monthOf(range, session, nowMs), session);
  }
  return null;
}

/** The period filters a report receives — never two that disagree. */
export function reportPeriodPayload(
  mode: ReportPeriodMode,
  range: DateRange,
  session: SessionBounds,
  nowMs: number = Date.now(),
): { date?: string; fromDate?: string; toDate?: string; month?: string } {
  switch (mode) {
    case "range":
      return {
        fromDate: range.from || undefined,
        toDate: range.to || undefined,
        month: exactMonth(range) ?? undefined,
      };
    case "month":
      return { month: monthOf(range, session, nowMs) };
    case "dayOrMonth": {
      const day = singleDay(range);
      return day && !exactMonth(range) ? { date: day } : { month: monthOf(range, session, nowMs) };
    }
    default:
      return {};
  }
}
