/**
 * Self-test: importing India's holidays for a school in Uttar Pradesh.
 *
 * The calendar this produces drives student attendance AND staff payroll, so
 * a wrong row marks children absent on a working day and pays staff for a
 * holiday they worked. Nothing here publishes itself; these are the rules
 * that decide what is even proposed.
 */

import assert from "node:assert/strict";

import {
  dropAlreadyPresent,
  mapGoogleHolidays,
  type GoogleHolidayEvent,
} from "./holidayImport";

console.log("holidayImport.selftest.ts");

const SESSION = { from: "2026-04-01", to: "2027-03-31" };
const ev = (p: Partial<GoogleHolidayEvent> & { summary: string }): GoogleHolidayEvent => ({
  start: { date: "2026-08-15" },
  end: { date: "2026-08-16" },
  description: "Public holiday",
  ...p,
});

/* Google's all-day end date is EXCLUSIVE — the commonest way to close the
   school for a day it actually works. */
{
  const { drafts } = mapGoogleHolidays(
    [ev({ summary: "Independence Day", start: { date: "2026-08-15" }, end: { date: "2026-08-16" } })],
    SESSION,
  );
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]!.startsOn, "2026-08-15");
  assert.equal(drafts[0]!.endsOn, "2026-08-15", "a one-day holiday must not become two");
}

/* A genuine multi-day break keeps its span, less the exclusive end. */
{
  const { drafts } = mapGoogleHolidays(
    [ev({ summary: "Diwali break", start: { date: "2026-11-08" }, end: { date: "2026-11-11" } })],
    SESSION,
  );
  assert.equal(drafts[0]!.startsOn, "2026-11-08");
  assert.equal(drafts[0]!.endsOn, "2026-11-10", "three days, not four");
}

/* Restricted holidays are proposed but marked as such — the office decides. */
{
  const { drafts } = mapGoogleHolidays(
    [ev({ summary: "Guru Nanak Jayanti", description: "Restricted holiday" })],
    SESSION,
  );
  assert.equal(drafts[0]!.kind, "restricted");
  assert.match(drafts[0]!.sourceNote, /Restricted/);
}

/* Observances are days of note, not closures. */
{
  const { drafts, skipped } = mapGoogleHolidays(
    [
      ev({ summary: "Teachers' Day", description: "Observance" }),
      ev({ summary: "Republic Day", description: "Public holiday", start: { date: "2027-01-26" }, end: { date: "2027-01-27" } }),
    ],
    SESSION,
  );
  assert.deepEqual(drafts.map((d) => d.title), ["Republic Day"]);
  assert.match(skipped[0]!.reason, /observance/);
}

/* Another state's holiday is not proposed for a school in UP. */
{
  const { drafts, skipped } = mapGoogleHolidays(
    [
      ev({ summary: "Maharashtra Day", description: "Public holiday", start: { date: "2026-05-01" }, end: { date: "2026-05-02" } }),
      ev({ summary: "Onam", description: "Public holiday in Kerala", start: { date: "2026-08-26" }, end: { date: "2026-08-27" } }),
      ev({ summary: "Holi", description: "Public holiday", start: { date: "2027-03-03" }, end: { date: "2027-03-04" } }),
    ],
    SESSION,
  );
  assert.deepEqual(drafts.map((d) => d.title), ["Holi"], "only what a UP school would close for");
  assert.equal(skipped.length, 2);
  assert.match(skipped.map((s) => s.reason).join(" "), /maharashtra|kerala/);
}

/* A holiday naming UP itself is kept, not caught by the state filter. */
{
  const { drafts } = mapGoogleHolidays(
    [ev({ summary: "Uttar Pradesh Day", start: { date: "2027-01-24" }, end: { date: "2027-01-25" } })],
    SESSION,
  );
  assert.deepEqual(drafts.map((d) => d.title), ["Uttar Pradesh Day"]);
}

/* Anything outside the session is left for that year's import. */
{
  const { drafts, skipped } = mapGoogleHolidays(
    [ev({ summary: "Old Republic Day", start: { date: "2026-01-26" }, end: { date: "2026-01-27" } })],
    SESSION,
  );
  assert.equal(drafts.length, 0);
  assert.match(skipped[0]!.reason, /outside the session/);
}

/* Re-importing adds only what is new — spelling drift and all. */
{
  const drafts = mapGoogleHolidays(
    [
      ev({ summary: "Dussehra", start: { date: "2026-10-20" }, end: { date: "2026-10-21" } }),
      ev({ summary: "Holi", start: { date: "2027-03-03" }, end: { date: "2027-03-04" } }),
    ],
    SESSION,
  ).drafts;
  const { fresh, alreadyThere } = dropAlreadyPresent(drafts, [
    { title: "  dussehra ", startsOn: "2026-10-20" },
  ]);
  assert.deepEqual(fresh.map((d) => d.title), ["Holi"]);
  assert.equal(alreadyThere, 1, "the one already on file is not proposed again");
}

/* An event with no date is reported, not guessed at. */
{
  const { drafts, skipped } = mapGoogleHolidays(
    [{ summary: "Mystery day", description: "Public holiday" }],
    SESSION,
  );
  assert.equal(drafts.length, 0);
  assert.match(skipped[0]!.reason, /no date/);
}

console.log("  ok — UP only, observances out, exclusive end dates handled, re-import safe");
