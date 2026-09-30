/**
 * punchAttempts — today's refused punches, earliest IN and latest OUT, in
 * IST. Run: npx tsx src/lib/punchAttempts.selftest.ts
 */
import { attemptsToRecord, istDateTime, mergePunchAttempt } from "./punchAttempts";

let failed = 0;
function expect(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed += 1;
    console.error(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// 30 Sep 2026, 08:50 IST = 03:20 UTC.
const at0850 = "2026-09-30T03:20:00.000Z";
const at0905 = "2026-09-30T03:35:00.000Z";
const at1700 = "2026-09-30T11:30:00.000Z";
const at1720 = "2026-09-30T11:50:00.000Z";
const yesterday = "2026-09-29T03:20:00.000Z";
const now = Date.parse("2026-09-30T12:00:00.000Z"); // 17:30 IST

expect("IST", istDateTime(Date.parse(at0850)), { date: "2026-09-30", time: "08:50" });
expect("IST past midnight", istDateTime(Date.parse("2026-09-30T19:00:00.000Z")), { date: "2026-10-01", time: "00:30" });

let a = mergePunchAttempt([], { kind: "in", at: at0905 }, now);
a = mergePunchAttempt(a, { kind: "in", at: at0850 }, now);
expect("earliest IN kept", a, [{ kind: "in", at: at0850 }]);
a = mergePunchAttempt(a, { kind: "out", at: at1700 }, now);
a = mergePunchAttempt(a, { kind: "out", at: at1720 }, now);
expect("latest OUT kept", a, [{ kind: "in", at: at0850 }, { kind: "out", at: at1720 }]);
expect("yesterday dropped", mergePunchAttempt([{ kind: "in", at: yesterday }], { kind: "out", at: at1700 }, now), [
  { kind: "out", at: at1700 },
]);
expect("garbage ignored", mergePunchAttempt([{ kind: "x", at: "no" }, null], { kind: "in", at: at0850 }, now), [
  { kind: "in", at: at0850 },
]);

expect("to record: IN then OUT", attemptsToRecord([{ kind: "out", at: at1720 }, { kind: "in", at: at0850 }], now), [
  { kind: "in", date: "2026-09-30", time: "08:50" },
  { kind: "out", date: "2026-09-30", time: "17:20" },
]);
expect("to record: yesterday skipped", attemptsToRecord([{ kind: "in", at: yesterday }], now), []);
expect("to record: none", attemptsToRecord(undefined, now), []);

if (failed) {
  console.error(`punchAttempts: ${failed} failure(s)`);
  process.exit(1);
}
console.log("punchAttempts: ok");
