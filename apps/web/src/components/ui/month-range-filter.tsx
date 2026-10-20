"use client";

/**
 * Month ↔ date-range filter — the one hook and one control for every screen
 * that offers a month next to a From / To range. The rule itself (IST month
 * bounds, "Custom", session bounds, restore) is lib/monthRange.ts with a
 * self-test; this file only holds it in React state and draws it.
 *
 *   const period = useMonthRange({ session: ay, storageKey: "fees.receipts" });
 *   <MonthRangeFilter period={period} />
 *   rows.filter((r) => inRange(r.date, period.range))   // list, totals, export
 *
 * - Picking a month sets From/To to its first..last day.
 * - Editing From or To keeps the range; the month box then shows the month
 *   when the range is exactly one whole month, else "Custom".
 * - The session (academic year) bounds both; changing it keeps the period
 *   only when it still fits.
 * - `storageKey` remembers the period per browser (localStorage, guarded);
 *   `urlKeys` mirrors it into the URL search params. Both restore through
 *   restoreRange, so a stale or contradictory pair never comes back.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DraftDateInput } from "@/components/ui/draft-inputs";
import {
  defaultMonth,
  editRange,
  exactMonth,
  isAllDates,
  istThisMonth,
  monthBounds,
  monthBoxValue,
  monthName,
  monthOf,
  onSessionChange,
  persistShape,
  pickMonth,
  rangeLabel,
  reportPeriodMode,
  restoreRange,
  singleDay,
  snapForMode,
  sessionBounds,
  sessionMonths,
  type DateRange,
  type ReportPeriodMode,
  type SessionBounds,
} from "@/lib/monthRange";
import { cn } from "@/lib/utils";

const STORAGE_PREFIX = "erp.monthRange.";
const CUSTOM = "__custom";
const ALL = "__all";

export type MonthRangeOptions = {
  /** Academic session code ("2026-27") or explicit bounds. */
  session?: string | SessionBounds | null;
  /** Starting period: the session's default month (default), "all", a month "YYYY-MM", or a range. */
  initial?: "month" | "all" | string | DateRange;
  /** Allow "All dates" and open ends. */
  allowOpen?: boolean;
  /** Remember the period in this browser under this key. */
  storageKey?: string;
  /** Mirror the period into these URL search params. */
  urlKeys?: { from: string; to: string; month?: string };
};

export type MonthRangeState = {
  range: DateRange;
  from: string;
  to: string;
  /** The exact month ("YYYY-MM") the range is, or "" (custom / all dates). */
  month: string;
  /** "October 2026", "Custom" or "All dates". */
  label: string;
  session: SessionBounds;
  /** Months the month box offers. */
  months: string[];
  allowOpen: boolean;
  setMonth: (ym: string) => void;
  setFrom: (iso: string) => void;
  setTo: (iso: string) => void;
  setRange: (range: DateRange) => void;
  setAllDates: () => void;
  /** For a month-only report: the exact month, else the month the range starts in. */
  singleMonth: string;
};

function resolveSession(s: MonthRangeOptions["session"]): SessionBounds {
  if (!s) return null;
  if (typeof s === "string") return sessionBounds(s);
  return s;
}

function initialRange(opts: MonthRangeOptions, session: SessionBounds): DateRange {
  const init = opts.initial ?? "month";
  if (init === "all") return { from: "", to: "" };
  if (typeof init === "object") return editRange(init, init, session, { allowOpen: opts.allowOpen });
  if (init !== "month") {
    const r = pickMonth(init, session);
    if (r) return r;
  }
  return pickMonth(defaultMonth(session), session) ?? { from: "", to: "" };
}

function readStored(key: string | undefined): unknown {
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string | undefined, range: DateRange) {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(persistShape(range)));
  } catch {
    /* private window / blocked storage: the period simply is not remembered */
  }
}

function readUrl(keys: MonthRangeOptions["urlKeys"]) {
  if (!keys || typeof window === "undefined") return null;
  try {
    const p = new URLSearchParams(window.location.search);
    const from = p.get(keys.from);
    const to = p.get(keys.to);
    const month = keys.month ? p.get(keys.month) : null;
    if (from == null && to == null && month == null) return null;
    return { from: from ?? undefined, to: to ?? undefined, month: month ?? undefined };
  } catch {
    return null;
  }
}

function writeUrl(keys: MonthRangeOptions["urlKeys"], range: DateRange) {
  if (!keys || typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    const shape = persistShape(range);
    const set = (k: string, v: string) => (v ? url.searchParams.set(k, v) : url.searchParams.delete(k));
    set(keys.from, shape.from);
    set(keys.to, shape.to);
    if (keys.month) set(keys.month, shape.month);
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url.href);
  } catch {
    /* ignore */
  }
}

export function useMonthRange(opts: MonthRangeOptions = {}): MonthRangeState {
  const sessionKey =
    typeof opts.session === "string" ? opts.session : opts.session ? `${opts.session.from}..${opts.session.to}` : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const session = useMemo(() => resolveSession(opts.session), [sessionKey]);
  const allowOpen = !!opts.allowOpen;
  const [range, setRangeState] = useState<DateRange>(() => initialRange(opts, session));

  // Restore once, after mount (URL first, then this browser's memory).
  const restored = useRef(false);
  const { storageKey, urlKeys } = opts;
  const urlFrom = urlKeys?.from;
  const urlTo = urlKeys?.to;
  const urlMonth = urlKeys?.month;
  useEffect(() => {
    const keys = urlFrom && urlTo ? { from: urlFrom, to: urlTo, month: urlMonth } : undefined;
    const fromUrl = restoreRange(readUrl(keys) as never, session, { allowOpen });
    const fromStore = fromUrl ? null : restoreRange(readStored(storageKey) as never, session, { allowOpen });
    const r = fromUrl ?? fromStore;
    if (r) setRangeState(r);
    restored.current = true;
    // Restore runs once per mount; later session changes go through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The session moved: keep the period only when it still fits.
  const lastSession = useRef(sessionKey);
  useEffect(() => {
    if (lastSession.current === sessionKey) return;
    lastSession.current = sessionKey;
    setRangeState((r) => onSessionChange(r, session));
  }, [sessionKey, session]);

  // Remember / mirror after restore.
  useEffect(() => {
    if (!restored.current) return;
    writeStored(storageKey, range);
    if (urlFrom && urlTo) writeUrl({ from: urlFrom, to: urlTo, month: urlMonth }, range);
  }, [range, storageKey, urlFrom, urlTo, urlMonth]);

  const setMonth = useCallback(
    (ym: string) => {
      const r = pickMonth(ym, session);
      if (r) setRangeState(r);
    },
    [session],
  );
  const setFrom = useCallback(
    (iso: string) => setRangeState((r) => editRange(r, { from: iso }, session, { allowOpen })),
    [session, allowOpen],
  );
  const setTo = useCallback(
    (iso: string) => setRangeState((r) => editRange(r, { to: iso }, session, { allowOpen })),
    [session, allowOpen],
  );
  const setRange = useCallback(
    (next: DateRange) => setRangeState(editRange(next, next, session, { allowOpen })),
    [session, allowOpen],
  );
  const setAllDates = useCallback(() => {
    if (allowOpen) setRangeState({ from: "", to: "" });
  }, [allowOpen]);

  const months = useMemo(() => {
    let list = sessionMonths(session);
    if (!list.length) {
      // No session: the last two years up to this month.
      const now = istThisMonth();
      const out: string[] = [];
      let y = Number(now.slice(0, 4));
      let m = Number(now.slice(5, 7));
      for (let i = 0; i < 24; i++) {
        out.unshift(`${y}-${String(m).padStart(2, "0")}`);
        m -= 1;
        if (m < 1) {
          m = 12;
          y -= 1;
        }
      }
      list = out;
    }
    const ym = exactMonth(range);
    return ym && !list.includes(ym) ? [...list, ym].sort() : list;
  }, [session, range]);

  return {
    range,
    from: range.from,
    to: range.to,
    month: monthBoxValue(range),
    label: rangeLabel(range),
    session,
    months,
    allowOpen,
    setMonth,
    setFrom,
    setTo,
    setRange,
    setAllDates,
    singleMonth: monthOf(range, session),
  };
}

/**
 * For a report catalogue: open each report on a period it can read (a
 * month-only report snaps to one whole month), so the boxes never show one
 * period while the report reads another. Returns the report's mode.
 */
export function useReportPeriod(period: MonthRangeState, filters: readonly string[]): ReportPeriodMode {
  const mode = reportPeriodMode(filters);
  const { range, session, setRange } = period;
  useEffect(() => {
    const next = snapForMode(mode, range, session);
    if (next) setRange(next);
  }, [mode, range, session, setRange]);
  return mode;
}

export type MonthRangeFilterProps = {
  period: MonthRangeState;
  showMonth?: boolean;
  showRange?: boolean;
  /** A single "Date" box for a one-day-or-one-month report: a day sets From = To. */
  showDay?: boolean;
  dayLabel?: string;
  /** "month": From / To pick whole months (first day … last day). */
  granularity?: "day" | "month";
  monthLabel?: string;
  fromLabel?: string;
  toLabel?: string;
  /** Class for each select / input. */
  fieldClassName?: string;
  /** Class for each caption span. */
  captionClassName?: string;
  /** Class for each <label>. */
  labelClassName?: string;
  /** Wrap the controls in this element class (default: no wrapper, a fragment). */
  className?: string;
  /** Prefix for data-testid on the three controls. */
  testId?: string;
};

/**
 * The month box and the From / To boxes, wired to one useMonthRange state.
 * The month box is a list of the session's months; it reads "Custom" when
 * the range is not exactly one month, and "All dates" when the screen allows
 * an open range and none is set.
 */
export function MonthRangeFilter({
  period,
  showMonth = true,
  showRange = true,
  showDay = false,
  dayLabel = "Date",
  granularity = "day",
  monthLabel = "Month",
  fromLabel = "From",
  toLabel = "To",
  fieldClassName = "field !py-1.5",
  captionClassName = "mb-1 block text-[11px] text-[var(--muted)]",
  labelClassName = "text-sm",
  className,
  testId = "month-range",
}: MonthRangeFilterProps) {
  const all = isAllDates(period.range);
  const monthValue = all ? ALL : period.month || CUSTOM;
  const min = period.session?.from;
  const max = period.session?.to;
  const controls = (
    <>
      {showDay ? (
        <label className={labelClassName}>
          <span className={captionClassName}>{dayLabel}</span>
          <DraftDateInput
            className={fieldClassName}
            value={singleDay(period.range) ?? ""}
            min={min}
            max={max}
            data-testid={`${testId}-day`}
            aria-label={dayLabel}
            onCommit={(d) => (d ? period.setRange({ from: d, to: d }) : period.setMonth(period.singleMonth))}
          />
        </label>
      ) : null}
      {showMonth ? (
        <label className={labelClassName}>
          <span className={captionClassName}>{monthLabel}</span>
          <select
            className={fieldClassName}
            value={monthValue}
            data-testid={`${testId}-month`}
            aria-label={monthLabel}
            onChange={(e) => {
              const v = e.target.value;
              if (v === ALL) period.setAllDates();
              else if (v !== CUSTOM) period.setMonth(v);
            }}
          >
            {period.allowOpen ? <option value={ALL}>All dates</option> : null}
            {monthValue === CUSTOM ? (
              <option value={CUSTOM} disabled>
                Custom
              </option>
            ) : null}
            {[...period.months].reverse().map((ym) => (
              <option key={ym} value={ym}>
                {monthName(ym)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {showRange && granularity === "month" ? (
        <>
          <label className={labelClassName}>
            <span className={captionClassName}>{fromLabel}</span>
            <select
              className={fieldClassName}
              value={period.from.slice(0, 7)}
              data-testid={`${testId}-from`}
              aria-label={fromLabel}
              onChange={(e) => {
                // Whole months: a From after To moves To to that month's end.
                const ym = e.target.value;
                const from = ym ? `${ym}-01` : "";
                const end = ym ? (monthBounds(ym)?.to ?? "") : "";
                period.setRange({ from, to: period.to && from && period.to < from ? end : period.to });
              }}
            >
              {period.allowOpen ? <option value="">Any</option> : null}
              {period.months.map((ym) => (
                <option key={ym} value={ym}>
                  {monthName(ym)}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClassName}>
            <span className={captionClassName}>{toLabel}</span>
            <select
              className={fieldClassName}
              value={period.to.slice(0, 7)}
              data-testid={`${testId}-to`}
              aria-label={toLabel}
              onChange={(e) => {
                // Whole months: a To before From moves From to that month's start.
                const ym = e.target.value;
                const to = ym ? (monthBounds(ym)?.to ?? "") : "";
                period.setRange({ from: period.from && to && period.from > to ? `${ym}-01` : period.from, to });
              }}
            >
              {period.allowOpen ? <option value="">Any</option> : null}
              {period.months.map((ym) => (
                <option key={ym} value={ym}>
                  {monthName(ym)}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : showRange ? (
        <>
          <label className={labelClassName}>
            <span className={captionClassName}>{fromLabel}</span>
            <DraftDateInput
              className={fieldClassName}
              value={period.from}
              min={min}
              max={period.to || max}
              allowEmpty={period.allowOpen}
              data-testid={`${testId}-from`}
              aria-label={fromLabel}
              onCommit={period.setFrom}
            />
          </label>
          <label className={labelClassName}>
            <span className={captionClassName}>{toLabel}</span>
            <DraftDateInput
              className={fieldClassName}
              value={period.to}
              min={period.from || min}
              max={max}
              allowEmpty={period.allowOpen}
              data-testid={`${testId}-to`}
              aria-label={toLabel}
              onCommit={period.setTo}
            />
          </label>
        </>
      ) : null}
    </>
  );
  return className ? <div className={cn(className)}>{controls}</div> : controls;
}
