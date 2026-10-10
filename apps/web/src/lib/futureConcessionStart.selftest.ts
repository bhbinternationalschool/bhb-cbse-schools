import assert from "node:assert/strict";
import {
  laterSameHeadDueKeys,
  listFutureConcessionCandidates,
} from "./counterConcession";
import {
  academicYearEndOn,
  emptyMastersShell,
  type MastersState,
} from "./masters";
import type { SisStudent } from "./sis";
import type { FeeDueLine } from "./fees";
import type { CounterDiscountSlice } from "./feeAdjustments";

console.log("futureConcessionStart.selftest.ts");

/**
 * A standing discount granted from the counter must never begin in a month
 * the same receipt is already discounting.
 *
 * Reported from the counter: April and May taken together, discount applied
 * to April with "apply to future months" ticked. The grant began in MAY —
 * the month sitting in the same basket. May still showed full on screen, so
 * it was discounted by hand too, and at the next billing May carried both
 * the counter waiver and the standing grant: double the discount anyone
 * intended, with nothing downstream to catch it (`applyPostedWaiver`
 * subtracts on top of whatever the grant already took off).
 */

const AY = "2026-27";
const HEAD = "fh_tuition";
const GROUP = "fg1";

const masters: MastersState = {
  ...emptyMastersShell(),
  feeHeads: [
    { id: HEAD, code: "TUIT", nameEn: "Tuition Fee", frequency: "monthly" },
  ] as unknown as MastersState["feeHeads"],
  installments: [
    { id: "i_apr", dueOn: "2026-04-10", isActive: true, academicYearCode: AY },
    { id: "i_may", dueOn: "2026-05-10", isActive: true, academicYearCode: AY },
    { id: "i_jun", dueOn: "2026-06-10", isActive: true, academicYearCode: AY },
    { id: "i_jul", dueOn: "2026-07-10", isActive: true, academicYearCode: AY },
  ] as unknown as MastersState["installments"],
  feeStructureLines: [
    { feeGroupId: GROUP, feeHeadId: HEAD, installmentId: "i_apr", amountPaise: 800000 },
    { feeGroupId: GROUP, feeHeadId: HEAD, installmentId: "i_may", amountPaise: 800000 },
    { feeGroupId: GROUP, feeHeadId: HEAD, installmentId: "i_jun", amountPaise: 800000 },
    { feeGroupId: GROUP, feeHeadId: HEAD, installmentId: "i_jul", amountPaise: 800000 },
  ] as unknown as MastersState["feeStructureLines"],
};

const student = {
  id: "st1", fullName: "SATVIK YADAV", feeGroupId: GROUP, status: "active",
  academicYearCode: AY,
} as unknown as SisStudent;

const due = (dueOn: string, key: string): FeeDueLine =>
  ({
    dueKey: key, studentId: "st1", feeHeadId: HEAD, feeHeadName: "Tuition Fee",
    label: `Tuition Fee · ${dueOn}`, kind: "academic", dueOn,
    billedPaise: 800000, balancePaise: 800000, paidPaise: 0, concessionPaise: 0,
  }) as unknown as FeeDueLine;

const slice = (dueKey: string): CounterDiscountSlice =>
  ({ dueKey, studentId: "st1", label: "Tuition Fee", amountPaise: 150000 }) as CounterDiscountSlice;

// ── One month in the basket: the grant starts the month after it ─────────
{
  const dues = [due("2026-04-10", "apr")];
  const [c] = listFutureConcessionCandidates([slice("apr")], dues, masters, [student], AY);
  assert.ok(c, "April alone should offer a future concession");
  assert.equal(
    c.futureEffectiveFrom,
    "2026-05-10",
    "discounting April alone, the standing rate starts in May",
  );
}

// ── April AND May in the basket: the grant must skip May ────────────────
{
  // The reported case. Both months are being collected; April is discounted
  // and "apply to future" ticked.
  const dues = [due("2026-04-10", "apr"), due("2026-05-10", "may")];
  const [c] = listFutureConcessionCandidates([slice("apr")], dues, masters, [student], AY);
  assert.equal(
    c.futureEffectiveFrom,
    "2026-06-10",
    "May is on this receipt, so the standing rate must start in June — " +
      "starting in May is what double-discounted it",
  );
}

// ── Both months discounted by hand: still June, never May ──────────────
{
  const dues = [due("2026-04-10", "apr"), due("2026-05-10", "may")];
  const cands = listFutureConcessionCandidates(
    [slice("apr"), slice("may")], dues, masters, [student], AY,
  );
  for (const c of cands) {
    assert.equal(
      c.futureEffectiveFrom,
      "2026-06-10",
      "whichever line the clerk ticked, the grant starts past the basket",
    );
  }
}

// ── Three months in the basket pushes it to the fourth ─────────────────
{
  const dues = [due("2026-04-10", "apr"), due("2026-05-10", "may"), due("2026-06-10", "jun")];
  const [c] = listFutureConcessionCandidates([slice("apr")], dues, masters, [student], AY);
  assert.equal(c.futureEffectiveFrom, "2026-07-10");
}

// ── Another child's months must not push this child's start date ───────
{
  const other = { ...student, id: "st2", fullName: "SIBLING" } as SisStudent;
  const dueFor = (sid: string, dueOn: string, key: string) =>
    ({ ...due(dueOn, key), studentId: sid }) as FeeDueLine;
  const dues = [
    dueFor("st1", "2026-04-10", "apr1"),
    dueFor("st2", "2026-07-10", "jul2"),
  ];
  const [c] = listFutureConcessionCandidates(
    [{ ...slice("apr1") }], dues, masters, [student, other], AY,
  );
  assert.equal(
    c.futureEffectiveFrom,
    "2026-05-10",
    "a sibling's July line must not delay THIS child's standing discount",
  );
}

// ── Transport can now stand too, and by the month ──────────────────────
{
  /**
   * A route is billed every month it runs, so a discount on it is exactly
   * the kind that should be able to stand. It was refused outright: the
   * candidate list only accepted `academic`, and transport has no fee
   * structure lines to count installments from, so even the recurrence test
   * would have said no.
   */
  const TRANSPORT_HEAD = "fh_transport";
  const tDue = (dueOn: string, key: string): FeeDueLine =>
    ({
      dueKey: key, studentId: "st1", feeHeadId: TRANSPORT_HEAD,
      feeHeadName: "Transport", label: `Transport · ${dueOn}`, kind: "transport",
      dueOn, billedPaise: 90000, balancePaise: 90000, paidPaise: 0,
      concessionPaise: 0, transport: { routeCode: "R1" },
    }) as unknown as FeeDueLine;

  const dues = [tDue("2026-04-10", "tapr"), tDue("2026-05-10", "tmay")];
  const cands = listFutureConcessionCandidates(
    [{ dueKey: "tapr", studentId: "st1", label: "Transport", amountPaise: 20000 } as CounterDiscountSlice],
    dues, masters, [student], AY,
  );
  assert.equal(cands.length, 1, "transport must be offered, not skipped");
  assert.equal(
    cands[0].futureEffectiveFrom,
    "2026-06-01",
    "May is on this receipt, so the standing transport rate starts in June",
  );
  assert.equal(cands[0].feeHeadName, "Transport");

  // A single transport month starts the month after it.
  const one = listFutureConcessionCandidates(
    [{ dueKey: "tapr", studentId: "st1", label: "Transport", amountPaise: 20000 } as CounterDiscountSlice],
    [tDue("2026-04-10", "tapr")], masters, [student], AY,
  );
  assert.equal(one[0].futureEffectiveFrom, "2026-05-01");

  // December must roll the YEAR, not produce month 13.
  const dec = listFutureConcessionCandidates(
    [{ dueKey: "tdec", studentId: "st1", label: "Transport", amountPaise: 20000 } as CounterDiscountSlice],
    [tDue("2026-12-10", "tdec")], masters, [student], AY,
  );
  assert.equal(dec[0].futureEffectiveFrom, "2027-01-01");
}

// ── The discount spreads across the basket, so it is never typed twice ──
{
  /**
   * The other half of the same fix. Making April's discount recurring used
   * to leave May on screen at full price, which is what prompted the clerk
   * to discount May by hand — the entry that then double-counted. Filling
   * those lines at the moment of the tick removes the reason to type it.
   */
  const dues = [
    due("2026-04-10", "apr"),
    due("2026-05-10", "may"),
    due("2026-06-10", "jun"),
  ];
  assert.deepEqual(
    laterSameHeadDueKeys(dues, "apr"),
    ["may", "jun"],
    "April spreads forward to May and June",
  );

  // Later ONLY. A discount made recurring from June says nothing about April.
  assert.deepEqual(laterSameHeadDueKeys(dues, "jun"), []);
  assert.deepEqual(laterSameHeadDueKeys(dues, "may"), ["jun"]);

  // A different head is a different discount.
  const mixed = [
    due("2026-04-10", "tuit_apr"),
    { ...due("2026-05-10", "comp_may"), feeHeadId: "fh_computer" } as FeeDueLine,
  ];
  assert.deepEqual(
    laterSameHeadDueKeys(mixed, "tuit_apr"),
    [],
    "tuition must not spread onto the computer fee",
  );

  // A sibling's months are their own.
  const sibs = [
    due("2026-04-10", "a_apr"),
    { ...due("2026-05-10", "b_may"), studentId: "st2" } as FeeDueLine,
  ];
  assert.deepEqual(laterSameHeadDueKeys(sibs, "a_apr"), []);

  // Transport spreads across transport, not across academic.
  const t = (dueOn: string, key: string) =>
    ({ ...due(dueOn, key), kind: "transport", feeHeadId: "fh_transport" }) as FeeDueLine;
  const withTransport = [t("2026-04-10", "t_apr"), t("2026-05-10", "t_may"), due("2026-05-10", "may")];
  assert.deepEqual(laterSameHeadDueKeys(withTransport, "t_apr"), ["t_may"]);

  // An unknown line spreads nowhere rather than throwing.
  assert.deepEqual(laterSameHeadDueKeys(dues, "nope"), []);
}

// ── A counter discount ends with the session ────────────────────────────
{
  /**
   * These grants were open-ended, and an open-ended grant never expires: a
   * hardship discount given in July 2026 kept coming off the bill in
   * 2027-28 and every year after. Production held 105 such grants, 69 of
   * them from the counter. They end on 31 March now, so the office
   * re-decides each year rather than the money leaving quietly.
   */
  assert.equal(academicYearEndOn("2026-27"), "2027-03-31");
  assert.equal(academicYearEndOn("2027-28"), "2028-03-31");
  assert.equal(academicYearEndOn("2026-2027"), "2027-03-31", "long form too");
  assert.equal(academicYearEndOn(" 2026-27 "), "2027-03-31", "trimmed");

  // Anything it cannot read with certainty returns null and the grant stays
  // as it was. A wrong end date cuts a family's discount off early.
  assert.equal(academicYearEndOn(""), null);
  assert.equal(academicYearEndOn("2026"), null);
  assert.equal(academicYearEndOn("not-a-year"), null);
  assert.equal(
    academicYearEndOn("2026-29"),
    null,
    "the closing year must be the one that follows, not any two digits",
  );
  assert.equal(academicYearEndOn("2026-26"), null);
}

console.log("futureConcessionStart.selftest: all assertions passed");
