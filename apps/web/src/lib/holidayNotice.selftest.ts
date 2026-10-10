/**
 * Self-test: holiday announcements built from the Masters record.
 * Run: npx tsx apps/web/src/lib/holidayNotice.selftest.ts
 */
import assert from "node:assert/strict";
import { buildHolidayNotice, defaultReopenDate, holidayDateLabel, isClosureKind } from "@/lib/holidayNotice";

const now = new Date("2026-09-05T10:00:00.000Z");
{
  assert.equal(holidayDateLabel("2026-09-08", "en", now), "Tue 8 Sep");
  assert.equal(holidayDateLabel("2026-09-08", "hi", now), "मंगल 8 सित");
  assert.equal(holidayDateLabel("2027-01-26", "en", now), "Tue 26 Jan 2027", "another year shows the year");
  assert.equal(defaultReopenDate("2026-09-05"), "2026-09-07", "Saturday's holiday reopens Monday, not Sunday");
  assert.equal(defaultReopenDate("2026-09-08"), "2026-09-09");
  assert.ok(isClosureKind("emergency") && isClosureKind("other") && !isClosureKind("gazetted") && !isClosureKind("school"));
}
{
  const n = buildHolidayNotice({ schoolName: "BHB", title: "Diwali break", startsOn: "2026-10-19", endsOn: "2026-10-24", kind: "school" }, now);
  assert.equal(n.family, "holiday_notice");
  assert.equal(n.variables.holidayTitle, "Diwali break");
  assert.equal(n.variables.reopenDate, "Mon 26 Oct", "24 Oct is Saturday → reopen Monday");
  assert.ok(n.variables.holidayNote.length > 0, "a note is always present so the template line is never blank");
  assert.ok(n.textHi.includes("अवकाश: *Diwali break*"));
}
{
  const c = buildHolidayNotice({ schoolName: "BHB", title: "Heat wave closure", startsOn: "2026-06-01", endsOn: "2026-06-03", kind: "emergency", reason: "heat_wave", orderedBy: "the District Magistrate, Varanasi" }, now);
  assert.equal(c.family, "holiday_emergency");
  assert.equal(c.variables.holidayReason, "the heat wave");
  assert.equal(c.variablesHi.holidayReason, "भीषण गर्मी (लू)");
  assert.equal(c.variables.orderedBy, "the District Magistrate, Varanasi");
  assert.equal(c.variablesHi.orderedBy, "the District Magistrate, Varanasi", "a typed authority is kept as typed in both languages");
  assert.ok(c.textEn.includes("Buses will not run") && c.textHi.includes("बसें नहीं चलेंगी"));
  assert.ok(c.variables.holidayNote.includes("AI tutor"), "the default closure note points families to the app");
  const d = buildHolidayNotice({ schoolName: "BHB", title: "x", startsOn: "2026-06-01", endsOn: "2026-06-01", kind: "other" }, now);
  assert.equal(d.variables.holidayReason, "unavoidable circumstances");
  assert.equal(d.variables.orderedBy, "the local administration");
  assert.equal(d.variablesHi.orderedBy, "स्थानीय प्रशासन");
}
console.log("holidayNotice.selftest: ok");
