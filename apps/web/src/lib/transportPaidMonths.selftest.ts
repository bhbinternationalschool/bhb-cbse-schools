/**
 * Self-test: transport money follows the child and the month.
 * Run: npx tsx apps/web/src/lib/transportPaidMonths.selftest.ts
 *
 * Production, 15 Oct 2026 (Anvi Yadav, stu_9fkxdecg):
 *  1. Sept paid on 10 Sep under ta_3ey94ij7; on 14 Sep her stop changed and
 *     the new assignment was backdated to 1 Sep → September re-billed under
 *     the new id and shown OWING; the paid line matched nothing.
 *  2. Apr–Aug paid under ta_3ey94ij7, whose stop id no longer existed and
 *     which had no fee of its own → the engine billed it ₹0, skipped it, and
 *     the five PAID months vanished from her fee card.
 *
 * Every case below is the dues engine itself (computeStudentDues), run in
 * node the way the server runs it, plus the pure helpers.
 */

import assert from "node:assert/strict";

import {
  buildFleetRosters,
  type StudentTransportProfile,
} from "./transportPlanner";
import {
  computeTransportComplianceAlerts,
  defaultFeePolicy,
  mergeImportedStops,
  writeTransportLocalRaw,
  type TransportAssignment,
  type TransportState,
  type TransportStop,
} from "./transport";
import {
  COUNTER_DISCOUNT_CODE,
  computeStudentDues,
  emptyFeesState,
  paidByDueKey,
  type CollectionVoucher,
  type FeeDueLine,
  type FeesState,
} from "./fees";
import { emptyMastersShell } from "./masters";
import type { SisStudent } from "./sis";
import {
  paidMonthsCoveredByNewStart,
  parseTransportDueKey,
  transportMonthAmount,
} from "./transportPaidMonths";

console.log("transportPaidMonths.selftest.ts");

const failures: string[] = [];
/** Every case runs, so a regression names each behaviour it breaks. */
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push(`  FAIL ${name}: ${(err as Error).message.split("\n")[0]}`);
    console.log(failures[failures.length - 1]);
  }
}

const AY = "2026-27";
const STU = "stu_9fkxdecg";
const OTHER = "stu_other";
const OLD = "ta_3ey94ij7";
const NEW = "ta_277mlhw9";
const ASOF = "2026-10-15";

/* ── 0. Pure helpers ─────────────────────────────────────────────────── */

assert.deepEqual(parseTransportDueKey(`transport:${STU}:${OLD}:2026-09`), {
  studentId: STU,
  assignmentId: OLD,
  periodKey: "2026-09",
});
assert.equal(parseTransportDueKey(`acad:${STU}:x`), null, "not transport");
assert.equal(parseTransportDueKey(`transport:${STU}:${OLD}`), null, "no month");
assert.equal(parseTransportDueKey(`transport:${STU}:${OLD}:Sept`), null, "bad month");
assert.equal(parseTransportDueKey(`transport:${STU}:a:b:2026-09`), null, "extra part");

{
  const m = new Map<string, number>([
    [`transport:${STU}:${OLD}:2026-09`, 30000],
    [`transport:${STU}:${NEW}:2026-09`, 20000],
    [`transport:${OTHER}:${OLD}:2026-09`, 99900],
    [`acad:${STU}:sl1`, 77700],
  ]);
  assert.equal(transportMonthAmount(m, STU, "2026-09"), 50000, "sum over assignment ids");
  assert.equal(transportMonthAmount(m, OTHER, "2026-09"), 99900, "other child separate");
  assert.equal(transportMonthAmount(m, STU, "2026-10"), 0);
  // Memo must not go stale when the map grows.
  m.set(`transport:${STU}:${NEW}:2026-10`, 100);
  assert.equal(transportMonthAmount(m, STU, "2026-10"), 100, "index rebuilt on growth");
}

assert.deepEqual(
  paidMonthsCoveredByNewStart(
    [
      { periodKey: "2026-08", paidPaise: 50000 },
      { periodKey: "2026-09", paidPaise: 50000 },
      { periodKey: "2026-10", paidPaise: 0 },
      { periodKey: "2026-11", paidPaise: 100 },
    ],
    "2026-09-01",
  ),
  ["2026-09", "2026-11"],
);
assert.deepEqual(paidMonthsCoveredByNewStart([], "2026-09-01"), []);
assert.deepEqual(
  paidMonthsCoveredByNewStart([{ periodKey: "2026-09", paidPaise: 1 }], ""),
  [],
);

/* ── Fixture: Anvi's shape ───────────────────────────────────────────── */

function asg(p: Partial<TransportAssignment>): TransportAssignment {
  return {
    studentId: STU,
    householdId: "hh_1",
    routeId: "tr_magic1",
    stopId: "st_live",
    academicYearCode: AY,
    effectiveFrom: "2026-04-01",
    effectiveTo: null,
    monthlyFeePaise: 0,
    feeOverrideReason: "",
    serviceMode: "both",
    pickupShiftId: "",
    dropShiftId: "",
    boardingSuspended: false,
    createdAt: "2026-08-22T06:17:10.753Z",
    ...p,
  } as TransportAssignment;
}

function state(
  assignments: TransportAssignment[],
  stops: { id: string; name: string; monthlyFeePaise?: number; distanceKm?: number }[] = [
    { id: "st_rk9zlrw4", name: "Ekala", monthlyFeePaise: 50000, distanceKm: 3 },
    { id: "st_fykmlahk", name: "New stop", monthlyFeePaise: 50000, distanceKm: 3 },
  ],
): TransportState {
  return {
    assignments,
    routes: [
      {
        id: "tr_magic1",
        code: "MAGIC-1",
        name: "Magic 1",
        isActive: true,
        busNo: "M1",
        vehicleReg: "",
        vehicleId: "",
        monthlyFeePaise: 0,
        stops: stops.map((s, i) => ({ sequence: i + 1, distanceSource: "manual", ...s })),
        shifts: [],
      },
    ],
    vehicles: [],
    staffRiders: [],
    boardingEvents: [],
    feePolicy: defaultFeePolicy(AY),
  } as unknown as TransportState;
}

const OLD_ASG = asg({
  id: OLD,
  stopId: "st_rk9zlrw4",
  effectiveTo: "2026-08-31",
});
const NEW_ASG = asg({
  id: NEW,
  stopId: "st_fykmlahk",
  effectiveFrom: "2026-09-01",
  monthlyFeePaise: 50000,
  createdAt: "2026-09-14T03:46:25.209Z",
});

let vno = 0;
function voucher(
  lines: { studentId?: string; asgId: string; month: string; paise: number; waived?: number }[],
  opts: { voided?: boolean; at?: string } = {},
): CollectionVoucher {
  vno += 1;
  return {
    id: `v_${vno}`,
    receiptNo: `RCV-${vno}`,
    householdId: "hh_1",
    collectedAt: opts.at ?? `2026-0${Math.min(9, 3 + vno)}-10T05:00:00.000Z`,
    collectionDate: "2026-09-10",
    voidedAt: opts.voided ? "2026-09-11T00:00:00.000Z" : null,
    lines: lines.map((l) => ({
      dueKey: `transport:${l.studentId ?? STU}:${l.asgId}:${l.month}`,
      studentId: l.studentId ?? STU,
      studentName: "Anvi",
      label: `Transport · ${l.month}`,
      kind: "transport",
      amountPaise: l.paise,
      billedPaise: 50000,
      concessionPaise: l.waived ?? 0,
      concessionDetails: l.waived
        ? [{ code: COUNTER_DISCOUNT_CODE, name: "Counter", amountPaise: l.waived }]
        : [],
      transport: {
        assignmentId: l.asgId,
        routeCode: "MAGIC-1",
        routeName: "Magic 1",
        busNo: "M1",
        vehicleReg: "",
        vehicleId: "",
        vehiclePhotoUrl: "",
        stopName: "9XX9+VG Ekala",
        periodLabel: l.month,
        periodKey: l.month,
        effectiveFrom: "2026-04-01",
        monthlyFeePaise: 50000,
      },
    })),
  } as unknown as CollectionVoucher;
}

function fees(vouchers: CollectionVoucher[]): FeesState {
  return { ...emptyFeesState(), vouchers };
}

const student = {
  id: STU,
  householdId: "hh_1",
  fullName: "Anvi",
  status: "active",
  academicYearCode: AY,
  classId: "",
  sectionId: "",
  feeGroupId: "",
} as unknown as SisStudent;

function transportDues(ts: TransportState, fs: FeesState): FeeDueLine[] {
  writeTransportLocalRaw(ts);
  return computeStudentDues(student, emptyMastersShell(), fs, {
    asOf: ASOF,
    includeFuture: false,
    includePaid: true,
  }).filter((d) => d.kind === "transport");
}
function month(dues: FeeDueLine[], ym: string): FeeDueLine[] {
  return dues.filter((d) => (d.transport?.periodKey ?? "") === ym);
}

const AprAug = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
const paidAprAug = voucher(AprAug.map((m) => ({ asgId: OLD, month: m, paise: 50000 })));
const paidSeptOld = voucher([{ asgId: OLD, month: "2026-09", paise: 50000 }], {
  at: "2026-09-10T05:00:00.000Z",
});

/* ── 1. Paid under the old assignment → Sept PAID, Oct owing */
check('1. Paid under the old assignment → Sept PAID, Oct owing', () => {
  const d = transportDues(state([NEW_ASG, OLD_ASG]), fees([paidAprAug, paidSeptOld]));
  const sept = month(d, "2026-09");
  assert.equal(sept.length, 1, "one September line");
  assert.equal(sept[0]!.dueKey, `transport:${STU}:${NEW}:2026-09`, "billed under the new stop");
  assert.equal(sept[0]!.paidPaise, 50000, "September's payment under the old id counts");
  assert.equal(sept[0]!.balancePaise, 0, "September is PAID — the production defect");
  const oct = month(d, "2026-10");
  assert.equal(oct.length, 1);
  assert.equal(oct[0]!.balancePaise, 50000, "October still owes");
  for (const m of AprAug) {
    const l = month(d, m);
    assert.equal(l.length, 1, `${m} shown once`);
    assert.equal(l[0]!.balancePaise, 0, `${m} paid`);
  }
  const owed = d.reduce((s, x) => s + x.balancePaise, 0);
  assert.equal(owed, 50000, "only October is owed");
});

/* ── 2. Partial: ₹300 paid under old → ₹200 owing */
check('2. Partial: ₹300 paid under old → ₹200 owing', () => {
  const d = transportDues(
    state([NEW_ASG, OLD_ASG]),
    fees([voucher([{ asgId: OLD, month: "2026-09", paise: 30000 }])]),
  );
  const sept = month(d, "2026-09");
  assert.equal(sept[0]!.paidPaise, 30000);
  assert.equal(sept[0]!.balancePaise, 20000, "partial payment carries, remainder owing");
});

/* ── 3. Fee change: ₹500 paid under old, new month ₹600 → ₹100 owing */
check('3. Fee change: ₹500 paid under old, new month ₹600 → ₹100 owing', () => {
  const dearer = { ...NEW_ASG, monthlyFeePaise: 60000 };
  const d = transportDues(state([dearer, OLD_ASG]), fees([paidSeptOld]));
  const sept = month(d, "2026-09");
  assert.equal(sept[0]!.billedPaise, 60000);
  assert.equal(sept[0]!.balancePaise, 10000, "₹100 owing — not ₹600, not ₹0");
});

/* ── 4. Voided receipt ignored */
check('4. Voided receipt ignored', () => {
  const d = transportDues(
    state([NEW_ASG, OLD_ASG]),
    fees([voucher([{ asgId: OLD, month: "2026-09", paise: 50000 }], { voided: true })]),
  );
  assert.equal(month(d, "2026-09")[0]!.balancePaise, 50000, "voided money is not money");
});

/* ── 5. Paid under both keys in one month → counted once per payment */
check('5. Paid under both keys in one month → counted once per payment', () => {
  const d = transportDues(
    state([NEW_ASG, OLD_ASG]),
    fees([
      voucher([{ asgId: OLD, month: "2026-09", paise: 25000 }]),
      voucher([{ asgId: NEW, month: "2026-09", paise: 25000 }]),
    ]),
  );
  const sept = month(d, "2026-09");
  assert.equal(sept.length, 1, "still one September line");
  assert.equal(sept[0]!.paidPaise, 50000, "25k + 25k, each once");
  assert.equal(sept[0]!.balancePaise, 0);
});

/* ── 6. Another child's payment never counts */
check("6. Another child's payment never counts", () => {
  const d = transportDues(
    state([NEW_ASG, OLD_ASG]),
    fees([voucher([{ studentId: OTHER, asgId: OLD, month: "2026-09", paise: 50000 }])]),
  );
  assert.equal(month(d, "2026-09")[0]!.balancePaise, 50000, "a sibling's receipt is theirs");
});

/* ── 7. Counter waiver under the old key carries over too */
check('7. Counter waiver under the old key carries over too', () => {
  const d = transportDues(
    state([NEW_ASG, OLD_ASG]),
    fees([voucher([{ asgId: OLD, month: "2026-09", paise: 40000, waived: 10000 }])]),
  );
  const sept = month(d, "2026-09")[0]!;
  assert.equal(sept.paidPaise, 40000);
  assert.equal(sept.balancePaise, 0, "₹400 paid + ₹100 waived settles the month");
});

/* ── 8. Paid months under an assignment whose stop vanished (fee ₹0) */
check('8. Paid months under an assignment whose stop vanished (fee ₹0)', () => {
  const gone = { ...OLD_ASG, stopId: "st_gone" }; // stop-id churn, no own fee
  const d = transportDues(state([NEW_ASG, gone]), fees([paidAprAug, paidSeptOld]));
  for (const m of AprAug) {
    const l = month(d, m);
    assert.equal(l.length, 1, `${m} must still be shown — money taken is never hidden`);
    assert.equal(l[0]!.paidPaise, 50000);
    assert.equal(l[0]!.balancePaise, 0, `${m} owes nothing`);
    assert.equal(l[0]!.transport?.stopName, "9XX9+VG Ekala", "stop from the receipt snapshot");
    assert.equal(l[0]!.transport?.routeCode, "MAGIC-1");
  }
  assert.equal(month(d, "2026-09")[0]!.balancePaise, 0, "Sept still paid");
  const paidTotal = d.reduce((s, x) => s + x.paidPaise, 0);
  assert.equal(paidTotal, 300000, "6 × ₹500, nothing counted twice");

  // Not shown when the caller asked for open dues only.
  writeTransportLocalRaw(state([NEW_ASG, gone]));
  const open = computeStudentDues(student, emptyMastersShell(), fees([paidAprAug, paidSeptOld]), {
    asOf: ASOF,
    includeFuture: false,
    includePaid: false,
  }).filter((x) => x.kind === "transport");
  assert.deepEqual(
    open.map((x) => x.transport?.periodKey),
    ["2026-10"],
    "open dues: only October",
  );
});

/* ── 9. Vanished-stop month AND a later assignment covering it → once */
check('9. Vanished-stop month AND a later assignment covering it → once', () => {
  const gone = { ...OLD_ASG, stopId: "st_gone", effectiveTo: "2026-07-31" };
  const backToAug = { ...NEW_ASG, effectiveFrom: "2026-08-01" };
  const d = transportDues(state([backToAug, gone]), fees([paidAprAug, paidSeptOld]));
  const aug = month(d, "2026-08");
  assert.equal(aug.length, 1, "August once — not a history line AND a due");
  assert.equal(aug[0]!.dueKey, `transport:${STU}:${NEW}:2026-08`);
  assert.equal(aug[0]!.paidPaise, 50000);
  assert.equal(aug[0]!.balancePaise, 0);
  assert.equal(d.reduce((s, x) => s + x.paidPaise, 0), 300000, "no double count");
});

/* ── 10. Compliance alerts agree with the fee card */
check('10. Compliance alerts agree with the fee card', () => {
  const ts = state([NEW_ASG, OLD_ASG]);
  const paid = paidByDueKey(fees([paidSeptOld]));
  const alerts = computeTransportComplianceAlerts({
    state: ts,
    paidByDueKey: paid,
    asOf: "2026-09-20",
    periodKey: "2026-09",
  });
  assert.equal(
    alerts.filter((a) => a.code === "TR_UNPAID").length,
    0,
    "no 'unpaid September' alert for a September paid under the old stop",
  );
});

/* ── 11. Roster: a live rider whose stop vanished is UNBILLED */
check('11. Roster: a live rider whose stop vanished is UNBILLED', () => {
  const broken = asg({ id: "ta_live", stopId: "st_gone", monthlyFeePaise: 0 });
  // A flat-route policy: the case where the roster used to show the route fee
  // while the fee engine billed ₹0.
  const ts = state([broken]);
  (ts.routes[0] as { monthlyFeePaise: number }).monthlyFeePaise = 70000;
  ts.feePolicy = { ...ts.feePolicy, rateMode: "flat_route" } as TransportState["feePolicy"];
  const profile = {
    studentId: STU,
    householdId: "hh_1",
    fullName: "Anvi",
    classLabel: "",
    academicYearCode: AY,
    hasAssignment: true,
    assignment: broken,
  } as unknown as StudentTransportProfile;
  const [roster] = buildFleetRosters(ts, [profile]);
  assert.equal(roster!.riders[0]!.stopLinkBroken, true);
  assert.equal(roster!.riders[0]!.monthlyFeePaise, 0, "roster shows what the engine bills: ₹0");
  assert.equal(roster!.unbilledRiders, 1, "and counts the rider as unbilled");
  writeTransportLocalRaw(ts);
  const d = computeStudentDues(student, emptyMastersShell(), emptyFeesState(), {
    asOf: ASOF,
    includeFuture: false,
  }).filter((x) => x.kind === "transport");
  assert.equal(d.length, 0, "engine bills nothing for it (unchanged) — the roster must say so");
});

/* ── 12. CSV re-import keeps stop ids (stop-id churn) */
check('12. CSV re-import keeps stop ids (stop-id churn)', () => {
  const existing: TransportStop[] = [
    { id: "st_a", name: "Ekala", sequence: 1, distanceKm: 3, distanceSource: "google", geoLat: 25.3, geoLng: 82.9, placeId: "p1", monthlyFeePaise: 50000 },
    { id: "st_b", name: "Sigra", sequence: 2, distanceKm: 5, distanceSource: "manual" },
  ] as TransportStop[];
  const imported: TransportStop[] = [
    { id: "st_new1", name: "Ekala", sequence: 1, distanceKm: 0, distanceSource: "" },
    { id: "st_new2", name: "sigra ", sequence: 2, distanceKm: 6, distanceSource: "manual" },
    { id: "st_new3", name: "Lanka", sequence: 3, distanceKm: 2, distanceSource: "manual" },
  ] as TransportStop[];
  const out = mergeImportedStops(existing, imported);
  assert.equal(out[0]!.id, "st_a", "same stop keeps its id");
  assert.equal(out[1]!.id, "st_b", "name match is loose (case/space)");
  assert.ok(!["st_a", "st_b"].includes(out[2]!.id), "a new stop is new");
  assert.equal(out[0]!.geoLat, 25.3, "pin kept");
  assert.equal(out[0]!.placeId, "p1", "place kept");
  assert.equal(out[0]!.monthlyFeePaise, 50000, "stop price kept");
  assert.equal(out[0]!.distanceKm, 3, "km kept when the file gives none");
  assert.equal(out[0]!.distanceSource, "google", "provenance kept");
  assert.equal(out[1]!.distanceKm, 6, "the file's km wins when given");
});

if (failures.length) {
  console.error(`FAILED ${failures.length} case(s):\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("transportPaidMonths.selftest.ts: all assertions passed");
