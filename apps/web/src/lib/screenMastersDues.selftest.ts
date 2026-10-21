/**
 * Dues and paid months from the screen's Masters book (data-layer 2.1i
 * review, 21 Oct 2026).
 *
 * Screens converted in 2.1 hand `computeStudentDues` the server's book as
 * the masters view sends it (useScreenMasters). Until then they handed it
 * `loadMasters()`, which runs the book through ensureFeeSetup first
 * (ensureAprToMarInstallments fills a blank `dueOn` and mints missing
 * months, fee heads are normalised, …). Two questions, answered on the e2e
 * fixture school plus the 15 Oct transport paid-month case:
 *
 *   1. Do dues / paid transport months differ between the raw book and the
 *      normalised one? If they do, a converted screen must normalise first.
 *   2. With the teaching subset (no Masters grant — e.g. a transport
 *      in-charge) the fee lists are WITHHELD. planTransportAmendment must
 *      then refuse to place a stop/route change ("cannot check paid months
 *      for your role") instead of treating the withheld lists as "nothing is
 *      settled" and letting the change land on a month already paid.
 *
 * Needs Supabase env (a real tenant: ensureFeeSetup's tenant rules); the npm
 * script supplies placeholders.
 * Run: npm run test:screen-masters-dues
 */
import assert from "node:assert/strict";

import { AY_CURRENT, buildFixture } from "../../e2e/fixture";
import {
  computeStudentDues,
  emptyFeesState,
  type CollectionVoucher,
  type FeeDueLine,
  type FeesState,
} from "./fees";
import { buildSessionInstallments, loadMasters, type MastersState } from "./masters";
import { teachingMastersSubset } from "./mastersTeachingSubset";
import { buildComplianceFactsFromMasters } from "./schoolDocumentAi";
import { setMirrorSlice } from "./schoolDataMirror";
import { isSupabaseConfigured } from "./supabase/client";
import { defaultFeePolicy, writeTransportLocalRaw, type TransportState } from "./transport";
import {
  PAID_MONTHS_UNKNOWN_FOR_ROLE,
  paidTransportMonths,
  planTransportAmendment,
} from "./transportAmend";

if (!isSupabaseConfigured()) {
  console.error("screenMastersDues.selftest: needs Supabase env — run `npm run test:screen-masters-dues`.");
  process.exit(1);
}

console.log("screenMastersDues.selftest.ts");
const failures: string[] = [];
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push(`  FAIL ${name}: ${(err as Error).message.split("\n")[0]}`);
    console.log(failures[failures.length - 1]);
  }
}

const fx = buildFixture();

// ── The transport paid-month case (e2e/transportPaidCase.ts), in memory ──
const used = new Set<string>([
  ...fx.growing.receipts.flatMap((v) => v.lines.map((l) => l.studentId)),
  ...fx.growing.chargeVouchers.map((c) => c.studentId),
]);
const CHILD = fx.sis.students.find(
  (s) => s.academicYearCode === AY_CURRENT && s.status === "active" && !used.has(s.id) && s.householdId,
)!;
const OLD = "ta_sel_old";
const NEW = "ta_sel_new";
const ROUTE = "tr_sel";
const APR_SEP = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

const transport = {
  version: 2,
  routes: [
    {
      id: ROUTE,
      code: "SEL-1",
      name: "Selftest",
      busNo: "SEL-1",
      vehicleReg: "",
      vehicleId: "",
      monthlyFeePaise: 0,
      isActive: true,
      stops: [{ id: "st_sel", name: "Stop", sequence: 1, distanceKm: 3, distanceSource: "manual", monthlyFeePaise: 50000 }],
      shifts: [],
    },
  ],
  assignments: [
    {
      id: OLD,
      studentId: CHILD.id,
      householdId: CHILD.householdId,
      routeId: ROUTE,
      stopId: "st_sel",
      academicYearCode: AY_CURRENT,
      effectiveFrom: "2026-04-01",
      effectiveTo: "2026-08-31",
      monthlyFeePaise: 50000,
      feeOverrideReason: "",
      serviceMode: "both",
      pickupShiftId: "",
      dropShiftId: "",
      boardingSuspended: false,
      createdAt: "2026-04-01T00:00:00.000Z",
    },
    {
      id: NEW,
      studentId: CHILD.id,
      householdId: CHILD.householdId,
      routeId: ROUTE,
      stopId: "st_sel",
      academicYearCode: AY_CURRENT,
      effectiveFrom: "2026-09-01",
      effectiveTo: null,
      monthlyFeePaise: 50000,
      feeOverrideReason: "",
      serviceMode: "both",
      pickupShiftId: "",
      dropShiftId: "",
      boardingSuspended: false,
      createdAt: "2026-09-01T00:00:00.000Z",
    },
  ],
  vehicles: [],
  feePolicy: defaultFeePolicy(AY_CURRENT),
} as unknown as TransportState;
writeTransportLocalRaw(transport);

function receipt(i: number, ym: string, assignmentId: string): CollectionVoucher {
  const date = `${ym}-10`;
  return {
    id: `sel_rcv_${i}`,
    receiptNo: `SEL-${i}`,
    householdId: CHILD.householdId,
    academicYearCode: AY_CURRENT,
    collectionDate: date,
    transactionDate: date,
    collectedAt: `${date}T05:30:00.000Z`,
    lines: [
      {
        dueKey: `transport:${CHILD.id}:${assignmentId}:${ym}`,
        studentId: CHILD.id,
        studentName: CHILD.fullName,
        label: `Transport ${ym}`,
        kind: "transport",
        amountPaise: 50000,
        billedPaise: 50000,
        concessionPaise: 0,
        concessionDetails: [],
      },
    ],
    tenders: [{ mode: "cash", amountPaise: 50000, ref: "", realisation: "cleared" }],
    totalPaise: 50000,
    voidedAt: null,
  } as unknown as CollectionVoucher;
}

const fees: FeesState = {
  ...emptyFeesState(),
  vouchers: [
    ...fx.growing.receipts,
    ...APR_SEP.map((ym, i) => receipt(i + 1, ym, ym === "2026-09" ? NEW : OLD)),
  ],
};

// ── The raw book (what views/masters sends) and the normalised one ──────
const raw: MastersState = {
  ...fx.masters,
  staff: fx.staff.staff,
  departments: fx.staff.departments,
  designations: fx.staff.designations,
};
setMirrorSlice("masters", raw);
const normalised = loadMasters(); // server path: ensureFeeSetup(mirror)

const children = fx.sis.students.filter((s) => s.academicYearCode === AY_CURRENT && s.status === "active");

function shape(lines: FeeDueLine[]) {
  return lines
    .map((d) => ({
      key: d.dueKey,
      kind: d.kind,
      dueOn: d.dueOn,
      billed: d.billedPaise,
      concession: d.concessionPaise,
      paid: d.paidPaise,
      balance: d.balancePaise,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

const OPTS = { includeFuture: true, includePaid: true, asOf: "2026-10-21" } as const;

check("precondition: the case child has six paid transport months", () => {
  const dues = computeStudentDues(CHILD, raw, fees, OPTS);
  assert.deepEqual(paidTransportMonths(dues), APR_SEP);
});

check(`raw book vs ensureFeeSetup book: identical dues for all ${children.length} current-year children`, () => {
  assert.ok(children.length > 100, `fixture children: ${children.length}`);
  const differ: string[] = [];
  for (const s of children) {
    const a = JSON.stringify(shape(computeStudentDues(s, raw, fees, OPTS)));
    const b = JSON.stringify(shape(computeStudentDues(s, normalised, fees, OPTS)));
    if (a !== b) differ.push(s.id);
  }
  assert.deepEqual(differ, [], `children whose dues differ: ${differ.slice(0, 5).join(", ")}`);
});

check("raw book vs ensureFeeSetup book: identical paid transport months (the amend dialog's floor)", () => {
  const a = paidTransportMonths(computeStudentDues(CHILD, raw, fees, OPTS));
  const b = paidTransportMonths(computeStudentDues(CHILD, normalised, fees, OPTS));
  assert.deepEqual(a, b);
  const pa = planTransportAmendment({ dues: computeStudentDues(CHILD, raw, fees, OPTS), currentEffectiveFrom: "2026-09-01", currentMonth: "2026-10" });
  const pb = planTransportAmendment({ dues: computeStudentDues(CHILD, normalised, fees, OPTS), currentEffectiveFrom: "2026-09-01", currentMonth: "2026-10" });
  assert.deepEqual(pa, pb);
  assert.ok(pa.ok && pa.plan.fromMonth === "2026-10", `full scope lands in October: ${JSON.stringify(pa)}`);
});

// ── A production-shaped fee book ─────────────────────────────────────────
// The fixture carries no fee structure (one inactive group), so the check
// above compares transport and voucher lines only. Production (read-only
// count, 21 Oct 2026): masters_desk_installments holds all 12 months for
// 2025-26 and 2026-27, none with a null due_on. Same check on a book of that
// shape — 12 installments with their dates, TUITION + TRANSPORT heads, an
// active group per class with one tuition line per month.
check("production-shaped fee book: raw vs ensureFeeSetup dues identical for every current-year child", () => {
  const installments = buildSessionInstallments(AY_CURRENT, "monthly");
  const heads = [
    { id: "fh_sel_tui", code: "TUITION", nameEn: "Tuition", category: "academic", frequency: "monthly", isOptional: false, isRefundable: false, isActive: true, sortOrder: 1 },
    { id: "fh_sel_trn", code: "TRANSPORT", nameEn: "Transport", category: "transport", frequency: "monthly", isOptional: false, isRefundable: false, isActive: true, sortOrder: 2 },
  ] as unknown as MastersState["feeHeads"];
  const types = Array.from(new Set(children.map((c) => c.studentType)));
  const groups = fx.masters.classes.flatMap((c) =>
    types.map((t) => ({
      id: `fg_sel_${c.id}_${t}`,
      code: `SEL-${c.id}-${t}`,
      name: `Selftest ${c.id} ${t}`,
      academicYearCode: AY_CURRENT,
      studentType: t,
      classIds: [c.id],
      isActive: true,
      structurePublishedAt: "2026-04-01T00:00:00.000Z",
      structurePublishedBy: "selftest",
    })),
  ) as unknown as MastersState["feeGroups"];
  const lines = groups.flatMap((g) =>
    installments.map((i) => ({
      id: `fsl_${g.id}_${i.code}`,
      feeGroupId: g.id,
      feeHeadId: "fh_sel_tui",
      classId: null,
      amountPaise: 100000,
      installmentId: i.id,
    })),
  ) as unknown as MastersState["feeStructureLines"];
  const book: MastersState = { ...raw, installments, feeHeads: heads, feeGroups: groups, feeStructureLines: lines };
  setMirrorSlice("masters", book);
  const norm = loadMasters();
  const acadLines = computeStudentDues(children[0]!, book, fees, OPTS).filter((d) => d.kind !== "transport");
  assert.ok(acadLines.length >= 7, `precondition: the book bills tuition (${acadLines.length} lines)`);
  const differ: string[] = [];
  for (const s of children) {
    const a = JSON.stringify(shape(computeStudentDues(s, book, fees, OPTS)));
    const b = JSON.stringify(shape(computeStudentDues(s, norm, fees, OPTS)));
    if (a !== b) differ.push(s.id);
  }
  assert.deepEqual(differ, [], `children whose dues differ: ${differ.slice(0, 5).join(", ")}`);
  setMirrorSlice("masters", raw);
});

// ── Teaching scope: withheld is not "nothing paid" ─────────────────────
check("teaching scope: planTransportAmendment(dues: null) refuses with the role message", () => {
  const r = planTransportAmendment({ dues: null, currentEffectiveFrom: "2026-09-01", currentMonth: "2026-10" });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error, PAID_MONTHS_UNKNOWN_FOR_ROLE);
  const asked = planTransportAmendment({ dues: null, requestedMonth: "2026-09", currentEffectiveFrom: "2026-04-01", currentMonth: "2026-10" });
  assert.equal(asked.ok, false, "a backdated month into the past is refused too");
});

check("teaching subset of the same book: the dues engine has no fee lines to work with (why null, not [])", () => {
  const teaching = {
    ...(teachingMastersSubset(raw as unknown as Record<string, unknown>) as unknown as MastersState),
    staff: raw.staff,
    departments: raw.departments,
    designations: raw.designations,
  };
  assert.equal(teaching.feeGroups.length, 0, "fee groups withheld");
  assert.equal(teaching.feeHeads.length, 0, "fee heads withheld (TRANSPORT head → transport concessions unseen)");
});

// ── Documents → "Insert school facts": withheld fees are not "0 published" ──
check("documents school facts, teaching scope: no \"0 fee structures\" line, says not available", () => {
  const teaching = teachingMastersSubset(raw as unknown as Record<string, unknown>) as unknown as MastersState;
  const text = buildComplianceFactsFromMasters({
    academicYearCode: AY_CURRENT,
    masters: teaching,
    students: fx.sis.students,
    examTermCount: 0,
    feesWithheld: true,
  } as Parameters<typeof buildComplianceFactsFromMasters>[0]);
  assert.ok(!/\b0 fee structures?\b/.test(text), `wrote a zero fee count: ${text.split("\n").find((l) => l.startsWith("Fee:"))}`);
  assert.match(text, /^Fee: not available for your role/m);
  const full = buildComplianceFactsFromMasters({ academicYearCode: AY_CURRENT, masters: raw, students: fx.sis.students, examTermCount: 0 });
  assert.match(full, /^Fee: 0 fee structures published/m, "full scope keeps the real count");
});

if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("screenMastersDues.selftest: all ok");
