/**
 * Self-test: spreading one expense across the working days in a range.
 *
 * The office books a week of milk in one go. The parts must add back to
 * exactly the amount entered — a books figure that does not tie to the bill
 * is worse than an uneven day — and holidays must come out.
 */

import assert from "node:assert/strict";

import { spreadExpenseOverWorkingDays, MAX_SPREAD_DAYS } from "./expenseSpread";

console.log("expenseSpread.selftest.ts");

const noHolidays = () => null;
/** Sunday, as the school's weekly rule has it. */
const sundays = (d: string) =>
  new Date(`${d}T12:00:00`).getDay() === 0 ? "Sunday Holiday" : null;

const ok = (r: ReturnType<typeof spreadExpenseOverWorkingDays>) => {
  assert.ok(r.ok, "ok" in r && !r.ok ? r.error : "expected ok");
  return r as Extract<typeof r, { ok: true }>;
};

/* An even split. */
{
  const r = ok(spreadExpenseOverWorkingDays({
    totalPaise: 700_00, from: "2026-09-07", to: "2026-09-11", holidayReason: noHolidays,
  }));
  assert.equal(r.days.length, 5, "Mon–Fri is five days");
  assert.ok(r.days.every((d) => d.amountPaise === 140_00), "140 each");
  assert.equal(r.totalPaise, 700_00, "and they add back to the total");
}

/* An amount that does not divide: the parts must STILL add to the total. */
{
  const r = ok(spreadExpenseOverWorkingDays({
    totalPaise: 1000_00, from: "2026-09-07", to: "2026-09-12", holidayReason: noHolidays,
  }));
  assert.equal(r.days.length, 6);
  assert.equal(
    r.days.reduce((n, d) => n + d.amountPaise, 0),
    1000_00,
    "1000 over 6 days ties exactly — no paise lost to rounding",
  );
  assert.equal(r.perDayPaise, 16666, "the even share is 166.66");
  assert.equal(r.days[0]!.amountPaise, 16667, "the earliest day carries the extra paisa");
  assert.equal(r.days[5]!.amountPaise, 16666, "the last day does not");
  const distinct = new Set(r.days.map((d) => d.amountPaise));
  assert.equal(distinct.size, 2, "at most a paisa apart, never a rupee");
}

/* Holidays come out, and are reported rather than silently dropped. */
{
  const r = ok(spreadExpenseOverWorkingDays({
    totalPaise: 600_00, from: "2026-09-06", to: "2026-09-12", // Sun..Sat
    holidayReason: sundays,
  }));
  assert.equal(r.days.length, 6, "the Sunday is not billed");
  assert.deepEqual(r.skipped.map((s) => s.date), ["2026-09-06"], "and is listed");
  assert.equal(r.skipped[0]!.reason, "Sunday Holiday", "with the reason to show the office");
  assert.ok(!r.days.some((d) => d.date === "2026-09-06"), "no voucher lands on it");
  assert.equal(r.totalPaise, 600_00, "the whole amount still lands, over fewer days");
}

/* A single day is a valid range. */
{
  const r = ok(spreadExpenseOverWorkingDays({
    totalPaise: 250_00, from: "2026-09-07", to: "2026-09-07", holidayReason: noHolidays,
  }));
  assert.deepEqual(r.days, [{ date: "2026-09-07", amountPaise: 250_00 }]);
}

/* Refusals — each says what to fix rather than booking something wrong. */
{
  const bad = (r: ReturnType<typeof spreadExpenseOverWorkingDays>) => {
    assert.equal(r.ok, false);
    return (r as Extract<typeof r, { ok: false }>).error;
  };
  assert.match(bad(spreadExpenseOverWorkingDays({
    totalPaise: 0, from: "2026-09-07", to: "2026-09-11", holidayReason: noHolidays,
  })), /greater than zero/);

  assert.match(bad(spreadExpenseOverWorkingDays({
    totalPaise: 100, from: "2026-09-11", to: "2026-09-07", holidayReason: noHolidays,
  })), /end date is before/);

  assert.match(bad(spreadExpenseOverWorkingDays({
    totalPaise: 100, from: "2026-09-06", to: "2026-09-06", holidayReason: sundays,
  })), /Every day in that range is a holiday/);

  assert.match(bad(spreadExpenseOverWorkingDays({
    totalPaise: 100, from: "2026-04-01", to: "2027-03-31", holidayReason: noHolidays,
  })), new RegExp(`longer than ${MAX_SPREAD_DAYS} days`));

  assert.match(bad(spreadExpenseOverWorkingDays({
    totalPaise: 100, from: "", to: "2026-09-11", holidayReason: noHolidays,
  })), /Pick both dates/);
}

/* Crossing a month and a DST-free boundary must not lose or repeat a day. */
{
  const r = ok(spreadExpenseOverWorkingDays({
    totalPaise: 3100_00, from: "2026-08-30", to: "2026-09-02", holidayReason: noHolidays,
  }));
  assert.deepEqual(
    r.days.map((d) => d.date),
    ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"],
    "the month boundary is walked exactly once",
  );
}

console.log("  ok — even where it can be, exact where it must be, holidays out");
