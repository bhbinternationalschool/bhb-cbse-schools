/**
 * Run: npx tsx src/lib/punchSchedule.selftest.ts
 *
 * Pins the gate punch hours and the printed backup QR (director, 5 Oct 2026):
 * - the window is read in IST, inclusive of its last minute, on the chosen
 *   weekdays only; anything unreadable falls back to 06:45–18:00 Mon–Sat,
 *   never to "always open";
 * - a printed token matches only its own version, so "New printed QR" kills
 *   every older print.
 */
import assert from "node:assert/strict";

import {
  defaultPunchOptions,
  normalizePunchOptions,
  printedQrLink,
  printedQrToken,
  punchWindowMessage,
  punchWindowState,
  verifyPrintedQrToken,
} from "./punchSchedule";

console.log("punchSchedule.selftest.ts");

/** An IST wall-clock instant: 2026-10-05 is a Monday. */
const ist = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00+05:30`);

{
  const o = defaultPunchOptions();
  assert.equal(punchWindowState(o, ist("2026-10-05", "06:44")).open, false, "before 06:45 is closed");
  assert.equal(punchWindowState(o, ist("2026-10-05", "06:45")).open, true, "06:45 opens");
  assert.equal(punchWindowState(o, ist("2026-10-05", "18:00")).open, true, "the last minute is still open");
  assert.equal(punchWindowState(o, ist("2026-10-05", "18:01")).open, false, "18:01 is closed");
  const before = punchWindowState(o, ist("2026-10-05", "06:00"));
  assert.ok(!before.open && before.opensToday && before.reason === "before");
  const sunday = punchWindowState(o, ist("2026-10-04", "09:00"));
  assert.ok(!sunday.open && sunday.reason === "day_off", "Sunday is off by default");
  assert.match(punchWindowMessage(o, before), /opens at 06:45/);
  // UTC midnight is 05:30 IST — a server clock in UTC must not shift the day.
  assert.equal(punchWindowState(o, Date.parse("2026-10-05T01:30:00Z")).open, true, "07:00 IST Monday from a UTC clock");
}

{
  // Unreadable or inverted settings never open punching all day.
  assert.deepEqual(normalizePunchOptions(null), defaultPunchOptions());
  const inverted = normalizePunchOptions({ windowStart: "18:00", windowEnd: "06:45" });
  assert.equal(inverted.windowStart, "06:45");
  assert.equal(inverted.windowEnd, "18:00");
  const junk = normalizePunchOptions({ windowStart: "7am", days: [0, 9, "x"], printedQrEnabled: "yes", printedQrVersion: -3 });
  assert.equal(junk.windowStart, "06:45");
  assert.deepEqual(junk.days, [1, 2, 3, 4, 5, 6], "no valid day → the default week");
  assert.equal(junk.printedQrEnabled, false, "only a real true switches the printed QR on");
  assert.equal(junk.printedQrVersion, 1);
  const custom = normalizePunchOptions({ windowStart: "07:00", windowEnd: "13:30", days: [6, 1, 1] });
  assert.deepEqual([custom.windowStart, custom.windowEnd, custom.days], ["07:00", "13:30", [1, 6]]);
}

{
  const secret = "test-secret";
  const v1 = printedQrToken(secret, 1);
  const v2 = printedQrToken(secret, 2);
  assert.notEqual(v1, v2, "each print version has its own token");
  assert.equal(verifyPrintedQrToken(secret, 1, v1), true);
  assert.equal(verifyPrintedQrToken(secret, 2, v1), false, "a new print kills the old one");
  assert.equal(verifyPrintedQrToken("other", 1, v1), false, "another server's token is refused");
  assert.equal(verifyPrintedQrToken(secret, 1, `${v1}x`), false);
  assert.equal(verifyPrintedQrToken(secret, 1, undefined), false);
  assert.match(printedQrLink("https://bhbinternational.school/", v1), /^https:\/\/bhbinternational\.school\/punch\?p=[A-Za-z0-9_-]+$/);
}

console.log("  ok");
