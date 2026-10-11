/**
 * Self-test: visiting staff month work sheets and 194J TDS — the pure half.
 * Run: npx tsx src/lib/visitingPay.selftest.ts
 *
 * The mistakes guarded: a holiday or a substituted period paid; a day with
 * periods and no punch paid without anyone confirming it; an IN with no OUT
 * paid as a day's hours; a missing source read as "no work"; month and IST
 * date edges; a rebuild that throws away the office's corrections; TDS that
 * forgets the year's earlier payments when the threshold is crossed; a
 * payment voucher that does not balance.
 */
import assert from "node:assert/strict";

import { L_CASH, L_PAYOUTS_WALLET, L_TDS_PAYABLE, L_VISITING_FEES } from "@/lib/ledger/coa";
import {
  buildVisitingLines,
  checkAdjustment,
  computeTds194J,
  fyMonths,
  fyOfMonth,
  isVisitingStaff,
  istToday,
  makerCheckerProblem,
  monthDates,
  normalizeVisitingPay,
  planRebuild,
  readSheetStatus,
  roundQuarterHours,
  sheetGrossPaise,
  staffPayInstrument,
  visitingPaymentLines,
  visitingRatePaise,
  visitingSetupProblems,
  weekdayOf,
  type ComputedLine,
  type StoredLine,
  type TimetableSource,
} from "@/lib/visitingPay";

console.log("visitingPay.selftest.ts");

/* ── who, setup ──────────────────────────────────────────────────────── */
{
  assert.equal(isVisitingStaff({ category: "visiting" }), true);
  assert.equal(isVisitingStaff({ category: "part_time" }), false);
  assert.equal(isVisitingStaff(null), false);
  const p = normalizeVisitingPay({ basis: "per_hour", rateRupees: "₹ 1,250", tds194j: true });
  assert.equal(visitingRatePaise(p), 1_250_00);
  assert.equal(normalizeVisitingPay({ basis: "weekly" }).basis, "", "an unknown basis is no basis");
  assert.equal(visitingRatePaise(normalizeVisitingPay({ rateRupees: "abc" })), null);
  const noPan = visitingSetupProblems({ visitingPay: { basis: "per_day", rateRupees: "500", tds194j: true }, panNo: "" });
  assert.equal(noPan.errors.length, 0);
  assert.match(noPan.warnings[0]!, /PAN/, "TDS ticked without PAN warns");
  assert.equal(visitingSetupProblems({ visitingPay: { basis: "per_day", rateRupees: "500", tds194j: true }, panNo: "abcde1234f" }).warnings.length, 0);
  assert.equal(visitingSetupProblems({ visitingPay: {} }).errors.length, 2, "basis and rate both missing");
}

/* ── dates ───────────────────────────────────────────────────────────── */
{
  assert.equal(monthDates("2026-02").length, 28);
  assert.equal(monthDates("2028-02").length, 29, "leap year");
  assert.equal(monthDates("2026-10").at(-1), "2026-10-31");
  assert.deepEqual(monthDates("2026-13"), []);
  assert.equal(weekdayOf("2026-10-11"), 0, "11 Oct 2026 is a Sunday");
  assert.equal(weekdayOf("2026-10-12"), 1);
  // 31 Oct 19:00 UTC is 1 Nov 00:30 in India.
  assert.equal(istToday(Date.UTC(2026, 9, 31, 19, 0)), "2026-11-01");
  assert.equal(istToday(Date.UTC(2026, 9, 31, 18, 0)), "2026-10-31");
  assert.equal(fyOfMonth("2026-04"), "2026-27");
  assert.equal(fyOfMonth("2027-03"), "2026-27");
  assert.equal(fyOfMonth("2026-03"), "2025-26");
  assert.deepEqual([fyMonths("2026-27")[0], fyMonths("2026-27")[11]], ["2026-04", "2027-03"]);
  assert.equal(roundQuarterHours(97), 1.5, "1h37m → 1.5");
  assert.equal(roundQuarterHours(98), 1.75, "1h38m → 1.75 (nearest quarter)");
  assert.equal(roundQuarterHours(7), 0, "7 minutes rounds to nothing");
}

/* ── per period ──────────────────────────────────────────────────────── */
const ME = "stf_music";
// Mondays: P2 in V-A (music), P5 in VI-A. Wednesdays: P3 in V-A.
const tt: TimetableSource = {
  grids: [
    {
      classId: "c5",
      sectionId: "s5a",
      slots: [
        { weekday: 1, periodNo: 2, subjectId: "mus", teacherId: ME },
        { weekday: 1, periodNo: 3, subjectId: "eng", teacherId: "stf_other" },
        { weekday: 3, periodNo: 3, subjectId: "mus", teacherId: ME },
      ],
    },
    { classId: "c6", sectionId: "s6a", slots: [{ weekday: 1, periodNo: 5, subjectId: "mus", teacherId: ME }] },
  ],
  substitutions: [
    // 19 Oct (Mon): V-A P2 handed to someone else.
    { date: "2026-10-19", classId: "c5", sectionId: "s5a", periodNo: 2, absentTeacherId: ME },
    // Someone else's substitution — nothing to do with this person.
    { date: "2026-10-05", classId: "c5", sectionId: "s5a", periodNo: 3, absentTeacherId: "stf_other" },
  ],
};
// 12 Oct: Class VI on a class holiday; 14 Oct (Wed) whole-school holiday.
const classDay = (date: string, classId: string) =>
  date === "2026-10-14" ? ("holiday" as const) : date === "2026-10-12" && classId === "c6" ? ("holiday" as const) : ("working" as const);
{
  const punches = {
    "2026-10-05": { status: "P", inTime: "08:00", outTime: "13:00" }, // Mon: 2 periods
    "2026-10-07": { status: "L", inTime: "09:10", outTime: "" }, // Wed late: 1 period (late counts)
    "2026-10-12": { status: "P", inTime: "08:00", outTime: "12:00" }, // Mon: VI on holiday → 1 period
    "2026-10-14": { status: "P", inTime: "08:00", outTime: "12:00" }, // holiday: 0, warned
    // 19 Oct Mon: no punch → P5 unconfirmed; P2 handed over (not even unconfirmed)
    "2026-10-21": { status: "A", inTime: "", outTime: "" }, // Wed absent → unconfirmed
  };
  const r = buildVisitingLines({
    staffId: ME,
    basis: "per_period",
    ratePaise: 300_00,
    month: "2026-10",
    todayIso: "2026-10-21",
    punches,
    timetable: tt,
    classDay,
    periodLabel: (c, s, sub, p) => `${c}/${s} P${p} ${sub}`,
  });
  assert.ok(r.ok);
  if (r.ok) {
    const counted = r.lines.filter((l) => l.status === "counted");
    const unconf = r.lines.filter((l) => l.status === "unconfirmed");
    assert.deepEqual(
      counted.map((l) => l.key),
      ["p|2026-10-05|c5|s5a|2", "p|2026-10-05|c6|s6a|5", "p|2026-10-07|c5|s5a|3", "p|2026-10-12|c5|s5a|2"],
      "periods counted only on punched working days, class holiday skipped",
    );
    assert.equal(sheetGrossPaise(r.lines), 4 * 300_00);
    assert.ok(!r.lines.some((l) => l.date === "2026-10-14"), "whole-school holiday pays nothing");
    assert.ok(r.warnings.some((w) => w.startsWith("2026-10-14")), "punched on a day with no periods is mentioned");
    assert.ok(!r.lines.some((l) => l.key === "p|2026-10-19|c5|s5a|2"), "a substituted period is not counted, not even as unconfirmed");
    assert.deepEqual(unconf.map((l) => l.key), ["p|2026-10-19|c6|s6a|5", "p|2026-10-21|c5|s5a|3"], "periods without a punch wait for the office");
    assert.ok(unconf.every((l) => l.qty === 0 && l.amountPaise === 0), "unconfirmed is not money");
    assert.ok(!r.lines.some((l) => l.date > "2026-10-21"), "days after today are not looked at");
    // Mondays 26 Oct are in the future → no line.
  }
  // Unknown is not zero.
  const noTt = buildVisitingLines({ staffId: ME, basis: "per_period", ratePaise: 300_00, month: "2026-10", todayIso: "2026-10-31", punches: {}, timetable: null, classDay });
  assert.equal(noTt.ok, false, "an unreadable timetable refuses, not zero");
  const noCal = buildVisitingLines({ staffId: ME, basis: "per_period", ratePaise: 300_00, month: "2026-10", todayIso: "2026-10-31", punches: {}, timetable: tt });
  assert.equal(noCal.ok, false, "an unreadable calendar refuses, not zero");
  const nobody = buildVisitingLines({ staffId: "stf_none", basis: "per_period", ratePaise: 300_00, month: "2026-10", todayIso: "2026-10-31", punches: {}, timetable: tt, classDay });
  assert.ok(nobody.ok && nobody.lines.length === 0 && nobody.warnings[0]!.includes("No periods"), "no periods is said, not hidden");
  // Half holiday: counted, flagged in the note.
  const half = buildVisitingLines({
    staffId: ME,
    basis: "per_period",
    ratePaise: 300_00,
    month: "2026-10",
    todayIso: "2026-10-31",
    punches: { "2026-10-07": { status: "P", inTime: "08:00", outTime: "10:00" } },
    timetable: tt,
    classDay: (d) => (d === "2026-10-07" ? "half_holiday" : "working"),
  });
  assert.ok(half.ok && half.lines.find((l) => l.date === "2026-10-07")!.note.includes("half holiday"));
}

/* ── per hour ────────────────────────────────────────────────────────── */
{
  const r = buildVisitingLines({
    staffId: ME,
    basis: "per_hour",
    ratePaise: 400_00,
    month: "2026-10",
    todayIso: "2026-10-20",
    punches: {
      "2026-10-01": { status: "P", inTime: "09:00", outTime: "11:37" }, // 2h37m → 2.5
      "2026-10-02": { status: "P", inTime: "09:00", outTime: "" }, // no OUT → flagged
      "2026-10-03": { status: "P", inTime: "", outTime: "" }, // manual P, no times → flagged
      "2026-10-05": { status: "P", inTime: "14:00", outTime: "13:00" }, // OUT before IN → flagged
      "2026-10-06": { status: "A", inTime: "", outTime: "" }, // absent → nothing
      "2026-10-20": { status: "P", inTime: "10:00", outTime: "" }, // today, still at school
      "2026-09-30": { status: "P", inTime: "09:00", outTime: "17:00" }, // other month: ignored
    },
  });
  assert.ok(r.ok);
  if (r.ok) {
    const by = new Map(r.lines.map((l) => [l.date, l]));
    assert.equal(by.get("2026-10-01")!.qty, 2.5);
    assert.equal(by.get("2026-10-01")!.amountPaise, 1_000_00);
    assert.equal(by.get("2026-10-02")!.status, "flagged");
    assert.equal(by.get("2026-10-02")!.qty, 0, "an IN with no OUT is not counted");
    assert.equal(by.get("2026-10-03")!.status, "flagged");
    assert.equal(by.get("2026-10-05")!.status, "flagged");
    assert.ok(!by.has("2026-10-06"));
    assert.match(by.get("2026-10-20")!.note, /still at school/);
    assert.ok(!by.has("2026-09-30"), "month boundary");
    assert.equal(sheetGrossPaise(r.lines), 1_000_00);
  }
}

/* ── per day ─────────────────────────────────────────────────────────── */
{
  const r = buildVisitingLines({
    staffId: "stf_survey",
    basis: "per_day",
    ratePaise: 600_00,
    month: "2026-10",
    todayIso: "2026-10-31",
    punches: {
      "2026-10-01": { status: "P", inTime: "09:00", outTime: "" },
      "2026-10-02": { status: "HD", inTime: "09:00", outTime: "12:00" },
      "2026-10-03": { status: "A", inTime: "", outTime: "" },
      "2026-10-04": { status: "LE", inTime: "", outTime: "" },
    },
    surveyDays: [
      { day: "2026-10-01", status: "ended" }, // also punched: one day, not two
      { day: "2026-10-05", status: "ended" },
      { day: "2026-10-06", status: "active" }, // never ended → flagged
    ],
  });
  assert.ok(r.ok);
  if (r.ok) {
    const counted = r.lines.filter((l) => l.status === "counted").map((l) => [l.date, l.source]);
    assert.deepEqual(counted, [["2026-10-01", "punch"], ["2026-10-02", "punch"], ["2026-10-05", "survey"]]);
    assert.equal(r.lines.find((l) => l.date === "2026-10-06")!.status, "flagged");
    assert.equal(sheetGrossPaise(r.lines), 3 * 600_00);
  }
}

/* ── rebuild keeps the office's word ─────────────────────────────────── */
{
  const mk = (key: string, date: string, qty: number, status: ComputedLine["status"] = "counted"): ComputedLine => ({
    key, date, unit: "day", qty, ratePaise: 500_00, amountPaise: qty * 500_00, source: "punch", status, note: "Present (punch)",
  });
  const stored: StoredLine[] = [
    { ...mk("d|2026-10-01", "2026-10-01", 1), id: "a", adjustedAt: null },
    { ...mk("d|2026-10-02", "2026-10-02", 1), id: "b", adjustedAt: "2026-10-03T10:00:00Z" }, // office changed it
    { ...mk("d|2026-10-03", "2026-10-03", 1), id: "c", adjustedAt: null }, // punch since removed
    { ...mk("", "2026-10-04", 1), id: "d", source: "office", adjustedAt: "2026-10-05T10:00:00Z" }, // office added
    { ...mk("d|2026-10-06", "2026-10-06", 0, "flagged"), id: "e", adjustedAt: null }, // flagged, now fixed
  ];
  const computed = [mk("d|2026-10-01", "2026-10-01", 1), mk("d|2026-10-02", "2026-10-02", 1), mk("d|2026-10-06", "2026-10-06", 1), mk("d|2026-10-07", "2026-10-07", 1)];
  const plan = planRebuild(stored, computed);
  assert.deepEqual(plan.insert.map((l) => l.key), ["d|2026-10-07"]);
  assert.deepEqual(plan.update.map((u) => u.id), ["e"], "a fixed flag becomes counted");
  assert.deepEqual(plan.remove, ["c"], "only an untouched line whose source is gone is dropped — by id");
  assert.ok(!plan.remove.includes("b") && !plan.remove.includes("d"), "office lines survive");
}

/* ── adjustments, status, maker/checker ──────────────────────────────── */
{
  assert.match(checkAdjustment({ qty: 1, unit: "period", reason: "" }), /reason/);
  assert.match(checkAdjustment({ qty: 1.5, unit: "period", reason: "took class" }), /whole/);
  assert.match(checkAdjustment({ qty: 1.3, unit: "hour", reason: "forgot out punch" }), /quarters/);
  assert.equal(checkAdjustment({ qty: 1.75, unit: "hour", reason: "forgot out punch" }), "");
  assert.match(checkAdjustment({ qty: 2, unit: "day", reason: "two days" }), /One line/);
  assert.equal(checkAdjustment({ qty: 0, unit: "day", reason: "was not here" }), "");
  assert.equal(readSheetStatus("draft"), "draft");
  assert.equal(readSheetStatus("??"), "paid", "an unreadable status is locked and never payable again");
  assert.match(makerCheckerProblem({ approver: "Nihal Rajak", makers: ["nihal rajak"], approverIsOwner: false }), /someone else/);
  assert.equal(makerCheckerProblem({ approver: "Beena Singh", makers: ["Nihal Rajak"], approverIsOwner: false }), "");
  assert.equal(makerCheckerProblem({ approver: "Director", makers: ["Director"], approverIsOwner: true }), "", "the owner may approve their own");
}

/* ── TDS 194J ────────────────────────────────────────────────────────── */
{
  const off = computeTds194J({ applies: false, month: "2026-10", grossPaise: 90_000_00, earlier: [] });
  assert.equal(off.tdsPaise, 0);
  assert.equal(off.netPaise, 90_000_00);

  const below = computeTds194J({ applies: true, month: "2026-05", grossPaise: 12_000_00, earlier: [{ month: "2026-04", grossPaise: 10_000_00, tdsPaise: 0 }] });
  assert.equal(below.tdsPaise, 0, "₹22,000 for the year: no TDS");

  const exactly = computeTds194J({ applies: true, month: "2026-05", grossPaise: 20_000_00, earlier: [{ month: "2026-04", grossPaise: 10_000_00, tdsPaise: 0 }] });
  assert.equal(exactly.tdsPaise, 0, "exactly ₹30,000 does not exceed the threshold");

  // Apr 12,000 + May 12,000 untaxed; June 12,000 crosses (36,000):
  // 10% of 36,000 = 3,600 — 1,200 for June + 2,400 catch-up.
  const cross = computeTds194J({
    applies: true,
    month: "2026-06",
    grossPaise: 12_000_00,
    earlier: [
      { month: "2026-04", grossPaise: 12_000_00, tdsPaise: 0 },
      { month: "2026-05", grossPaise: 12_000_00, tdsPaise: 0 },
      { month: "2025-12", grossPaise: 50_000_00, tdsPaise: 0 }, // last FY: not counted
    ],
  });
  assert.equal(cross.crossesNow, true);
  assert.equal(cross.currentPaise, 1_200_00);
  assert.equal(cross.catchUpPaise, 2_400_00);
  assert.equal(cross.tdsPaise, 3_600_00);
  assert.equal(cross.netPaise, 8_400_00);
  assert.ok(cross.explanation.some((e) => e.includes("Catch-up")), "the sheet shows the catch-up");

  // July after crossing: plain 10%.
  const after = computeTds194J({
    applies: true,
    month: "2026-07",
    grossPaise: 12_000_00,
    earlier: [
      { month: "2026-04", grossPaise: 12_000_00, tdsPaise: 0 },
      { month: "2026-05", grossPaise: 12_000_00, tdsPaise: 0 },
      { month: "2026-06", grossPaise: 12_000_00, tdsPaise: 3_600_00 },
    ],
  });
  assert.equal(after.crossesNow, false);
  assert.equal(after.tdsPaise, 1_200_00);
  assert.equal(after.catchUpPaise, 0);

  // A small crossing sheet cannot carry the whole catch-up: never more than its gross.
  const small = computeTds194J({ applies: true, month: "2026-09", grossPaise: 1_000_00, earlier: [{ month: "2026-04", grossPaise: 29_900_00, tdsPaise: 0 }] });
  assert.equal(small.tdsPaise, 1_000_00);
  assert.equal(small.netPaise, 0);
  assert.equal(small.shortfallPaise, 3_090_00 - 1_000_00);

  // Same month passed as "earlier" (a re-approval) is not counted twice.
  const self = computeTds194J({ applies: true, month: "2026-06", grossPaise: 40_000_00, earlier: [{ month: "2026-06", grossPaise: 40_000_00, tdsPaise: 4_000_00 }] });
  assert.equal(self.tdsPaise, 4_000_00);

  // Rounded to the rupee (s.288B).
  const odd = computeTds194J({ applies: true, month: "2026-06", grossPaise: 31_234_56, earlier: [] });
  assert.equal(odd.tdsPaise % 100, 0);
  assert.equal(odd.tdsPaise, 3_123_00);
}

/* ── paying ──────────────────────────────────────────────────────────── */
{
  const phone = (raw: string) => (/^[6-9]\d{9}$/.test(raw) ? "" : "bad");
  const bank = staffPayInstrument({ bankAccountNo: "123456789012", bankIfsc: "sbin0001234", upiId: "x@okaxis", mobile: "9876501234" }, phone);
  assert.ok(bank.ok && bank.channel === "transfer" && bank.accountNumber && !bank.vpa, "bank first");
  const upi = staffPayInstrument({ upiId: "Music.Teacher@okaxis", mobile: "9876501234" }, phone);
  assert.ok(upi.ok && upi.channel === "transfer" && upi.vpa === "music.teacher@okaxis", "then UPI");
  const link = staffPayInstrument({ mobile: "9876501234" }, phone);
  assert.ok(link.ok && link.channel === "link", "then a link to their phone");
  assert.equal(staffPayInstrument({ mobile: "123" }, phone).ok, false);
  assert.equal(staffPayInstrument({ mobile: "9876501234" }, phone, "transfer").ok, false, "transfer asked, nothing to transfer to");
  assert.ok((() => { const r = staffPayInstrument({ bankAccountNo: "123456789012", bankIfsc: "SBIN0001234", mobile: "9876501234" }, phone, "link"); return r.ok && r.channel === "link"; })(), "the office may ask for a link");

  const sum = (ls: { debitPaise: number; creditPaise: number }[]) => ls.reduce((n, l) => n + l.debitPaise - l.creditPaise, 0);
  const staff = { id: "stf_music", name: "Music Teacher" };
  const cf = visitingPaymentLines({ grossPaise: 12_000_00, tdsPaise: 3_600_00, netPaise: 8_400_00, mode: "cashfree", staff, narration: "Visiting fees 2026-06" });
  assert.ok(cf.ok);
  if (cf.ok) {
    assert.equal(sum(cf.lines), 0, "balances");
    assert.deepEqual(cf.lines.map((l) => [l.accountCode, l.debitPaise, l.creditPaise]), [
      [L_VISITING_FEES, 12_000_00, 0],
      [L_TDS_PAYABLE, 0, 3_600_00],
      [L_PAYOUTS_WALLET, 0, 8_400_00],
    ]);
    assert.equal(cf.lines[0]!.party?.kind, "staff");
  }
  const cash = visitingPaymentLines({ grossPaise: 5_000_00, tdsPaise: 0, netPaise: 5_000_00, mode: "cash", staff, narration: "x" });
  assert.ok(cash.ok && cash.lines.length === 2 && cash.lines[1]!.accountCode === L_CASH, "cash is the cash box, no TDS line at 0");
  const bankPay = visitingPaymentLines({ grossPaise: 5_000_00, tdsPaise: 500_00, netPaise: 4_500_00, mode: "bank", bankLedgerCode: "1012", bankAccountId: "bnk_1", staff, narration: "x" });
  assert.ok(bankPay.ok && bankPay.lines[2]!.subledgerId === "bnk_1");
  assert.equal(visitingPaymentLines({ grossPaise: 5_000_00, tdsPaise: 0, netPaise: 5_000_00, mode: "bank", staff, narration: "x" }).ok, false, "bank needs the bank");
  assert.equal(visitingPaymentLines({ grossPaise: 5_000_00, tdsPaise: 100, netPaise: 5_000_00, mode: "cash", staff, narration: "x" }).ok, false, "gross = TDS + net");
  assert.equal(visitingPaymentLines({ grossPaise: 0, tdsPaise: 0, netPaise: 0, mode: "cash", staff, narration: "x" }).ok, false);
}

console.log("visitingPay: ok");
