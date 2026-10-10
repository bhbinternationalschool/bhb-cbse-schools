/**
 * Self-test: the days a repeating expense lands on.
 *
 * A daily rate times the days chosen — the office knows what a day of milk
 * costs, and multiplying cannot drift the way dividing a total does.
 * Holidays are MARKED, not forbidden: the school opens the odd Sunday, and
 * locking the day would mean editing the school calendar to book milk.
 */

import assert from "node:assert/strict";

import {
  enumerateExpenseDays,
  expenseTotalPaise,
  weekdayOf,
  MAX_SPREAD_DAYS,
} from "./expenseSpread";

console.log("expenseSpread.selftest.ts");

const none = () => null;
const sundays = (d: string) => (weekdayOf(d) === 0 ? "Sunday Holiday" : null);

const ok = (r: ReturnType<typeof enumerateExpenseDays>) => {
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r as Extract<typeof r, { ok: true }>;
};

/* Every day in the range is offered, in order, once. */
{
  const r = ok(enumerateExpenseDays({ from: "2026-08-30", to: "2026-09-05", holidayReason: none }));
  assert.deepEqual(
    r.days.map((d) => d.date),
    ["2026-08-30","2026-08-31","2026-09-01","2026-09-02","2026-09-03","2026-09-04","2026-09-05"],
    "the month boundary is walked exactly once",
  );
  assert.equal(r.workingCount, 7);
  assert.equal(r.holidayCount, 0);
}

/* A holiday is marked and unticked — but still present, so it can be ticked. */
{
  const r = ok(enumerateExpenseDays({ from: "2026-08-30", to: "2026-09-05", holidayReason: sundays }));
  const sun = r.days.find((d) => d.date === "2026-08-30")!;
  assert.equal(sun.holidayReason, "Sunday Holiday", "named, so the office sees why");
  assert.equal(sun.selectedByDefault, false, "not billed unless someone says so");
  assert.ok(
    r.days.some((d) => d.date === "2026-08-30"),
    "the day is STILL OFFERED — the school opens the odd Sunday and must be able to bill it",
  );
  assert.equal(r.workingCount, 6);
  assert.equal(r.holidayCount, 1);
}

/* Weekday is carried so a calendar can lay the month out. */
{
  const r = ok(enumerateExpenseDays({ from: "2026-08-30", to: "2026-08-31", holidayReason: none }));
  assert.equal(r.days[0]!.weekday, 0, "30 Aug 2026 is a Sunday");
  assert.equal(r.days[1]!.weekday, 1, "31 Aug 2026 is a Monday");
}

/* Rate times days — no division, so nothing to round. */
{
  assert.equal(expenseTotalPaise(200_00, ["a", "b", "c"]), 600_00, "rate times three days");
  assert.equal(expenseTotalPaise(16667, ["a", "b", "c"]), 50001, "an odd rate stays exact");
  assert.equal(expenseTotalPaise(200_00, []), 0, "no days chosen is no money");
  assert.equal(expenseTotalPaise(0, ["a"]), 0, "no rate is no money");
  assert.equal(expenseTotalPaise(-5, ["a"]), 0, "a negative rate books nothing");
}

/* Refusals say what to fix rather than guessing. */
{
  const bad = (r: ReturnType<typeof enumerateExpenseDays>) => {
    assert.equal(r.ok, false);
    return (r as Extract<typeof r, { ok: false }>).error;
  };
  assert.match(bad(enumerateExpenseDays({ from: "2026-09-11", to: "2026-09-07", holidayReason: none })), /end date is before/);
  assert.match(bad(enumerateExpenseDays({ from: "", to: "2026-09-07", holidayReason: none })), /Pick both dates/);
  assert.match(
    bad(enumerateExpenseDays({ from: "2026-04-01", to: "2027-03-31", holidayReason: none })),
    new RegExp(`longer than ${MAX_SPREAD_DAYS} days`),
  );
}

/* A single day is a valid range. */
{
  const r = ok(enumerateExpenseDays({ from: "2026-09-07", to: "2026-09-07", holidayReason: none }));
  assert.equal(r.days.length, 1);
}

/* Every day a holiday is allowed — the office may still tick one. */
{
  const r = ok(enumerateExpenseDays({ from: "2026-08-30", to: "2026-08-30", holidayReason: sundays }));
  assert.equal(r.workingCount, 0, "nothing is ticked for them");
  assert.equal(r.days.length, 1, "but the day is offered rather than the range refused");
}

console.log("  ok — every day offered, holidays marked not locked, rate times days");
