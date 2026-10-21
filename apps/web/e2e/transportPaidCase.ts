/**
 * The 15 Oct 2026 transport paid-month case (Anvi Yadav), written through the
 * app's own server write paths by `seedTransportPaidCase` — run under tsx
 * (scripts/e2e-seed-transport-paid.ts), because the server modules import
 * each other dynamically through the "@/" alias, which Playwright's loader
 * does not resolve. The specs run that script, then read the screens.
 *
 * Two copies of the same shape, on two children in two different families,
 * so no spec's writes reach another's:
 *   - the office case (TPM_CASE unset): CHILD — specs/transport-paid-month
 *     (which also ends the rider, TPM_STEP=end-new) and dues-screens-transport;
 *   - the parent case (TPM_CASE=parent): PARENT_CHILD — specs/parent-web-dues,
 *     which PAYS for its family. Its family has no other seeded case and no
 *     fixture receipt or charge on any child, so no other spec pays for it
 *     (20 Oct 2026: both cases were one child, and the parent spec's checkout
 *     ran over the office case's rows).
 * Each case MERGES its route, assignments and receipts into the saved desks;
 * nothing another spec seeded is replaced.
 */
import { buildFixture, AY_CURRENT } from "./fixture";
import { assertLocalStack } from "./session";
import { defaultFeePolicy, type TransportState } from "@/lib/transport";
import type { CollectionVoucher } from "@/lib/fees";
import type { SisStudent } from "@/lib/sis";

const fx = buildFixture();

// Current-year active children with a household and no fixture receipt or
// charge voucher. The FIRST is the office case's, the SECOND is
// e2e/duesTransportCase.ts's.
const used = new Set<string>([
  ...fx.growing.receipts.flatMap((v) => v.lines.map((l) => l.studentId)),
  ...fx.growing.chargeVouchers.map((c) => c.studentId),
]);
const spares = fx.sis.students.filter(
  (s) => s.academicYearCode === AY_CURRENT && s.status === "active" && !used.has(s.id) && s.householdId,
);
export const CHILD = spares[0]!;
/** Families another seeded case lives in, or whose children have fixture money. */
const busyHouseholds = new Set<string>([
  spares[0]!.householdId,
  spares[1]!.householdId,
  ...fx.sis.students.filter((s) => used.has(s.id)).map((s) => s.householdId),
]);
export const PARENT_CHILD = spares.find((s) => !busyHouseholds.has(s.householdId))!;

export type TransportPaidCase = {
  child: SisStudent;
  oldId: string;
  newId: string;
  route: string;
  /** Receipt ids start with this; receipt numbers with `receiptNoPrefix`. */
  receiptIdPrefix: string;
  receiptNoPrefix: string;
  routeCode: string;
};

export const OFFICE_CASE: TransportPaidCase = {
  child: CHILD,
  oldId: "ta_e2e_tpm_old",
  newId: "ta_e2e_tpm_new",
  route: "tr_e2e_tpm",
  receiptIdPrefix: "e2e_tpm_rcv_",
  receiptNoPrefix: "E2E-TPM-",
  routeCode: "TPM-1",
};
export const PARENT_CASE: TransportPaidCase = {
  child: PARENT_CHILD,
  oldId: "ta_e2e_tpp_old",
  newId: "ta_e2e_tpp_new",
  route: "tr_e2e_tpp",
  receiptIdPrefix: "e2e_tpp_rcv_",
  receiptNoPrefix: "E2E-TPP-",
  routeCode: "TPM-1",
};
export const OLD = OFFICE_CASE.oldId;
export const NEW = OFFICE_CASE.newId;
export const APR_SEP = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
export const MONTH_NAMES: Record<string, string> = {
  "2026-04": "April",
  "2026-05": "May",
  "2026-06": "June",
  "2026-07": "July",
  "2026-08": "August",
  "2026-09": "September",
  "2026-10": "October",
};

function receipt(c: TransportPaidCase, i: number, ym: string, date: string): CollectionVoucher {
  const CHILD = c.child;
  return {
    id: `${c.receiptIdPrefix}${i}`,
    receiptNo: `${c.receiptNoPrefix}${String(i).padStart(4, "0")}`,
    schoolReceiptNo: "",
    source: "counter",
    manualBookSeries: "",
    manualBookLeaf: "",
    householdId: CHILD.householdId,
    academicYearCode: AY_CURRENT,
    collectionDate: date,
    transactionDate: date,
    transactionId: "",
    collectedAt: `${date}T05:30:00.000Z`,
    cashierName: "E2E Clerk",
    lines: [
      {
        dueKey: `transport:${CHILD.id}:${c.oldId}:${ym}`,
        studentId: CHILD.id,
        studentName: CHILD.fullName,
        label: `Transport · ${MONTH_NAMES[ym]} 2026 · ${c.routeCode}`,
        kind: "transport",
        amountPaise: 50000,
        billedPaise: 50000,
        concessionPaise: 0,
        concessionDetails: [],
        transport: {
          assignmentId: c.oldId,
          routeCode: c.routeCode,
          routeName: "E2E Magic",
          busNo: c.routeCode,
          vehicleReg: "",
          vehicleId: "",
          vehiclePhotoUrl: "",
          stopName: "9XX9+VG Ekala",
          periodLabel: `${MONTH_NAMES[ym]} 2026`,
          periodKey: ym,
          effectiveFrom: "2026-04-01",
          monthlyFeePaise: 50000,
        },
      },
    ],
    tenders: [
      {
        mode: "cash",
        amountPaise: 50000,
        ref: "",
        instrumentDate: "",
        bankName: "",
        bankAccountId: "",
        gatewayProvider: "",
        realisation: "cleared",
      },
    ],
    totalPaise: 50000,
    note: "",
    voidedAt: null,
    whatsappSentAt: null,
  } as CollectionVoucher;
}

export async function seedTransportPaidCase(
  c: TransportPaidCase = process.env.TPM_CASE === "parent" ? PARENT_CASE : OFFICE_CASE,
): Promise<void> {
  assertLocalStack();
  if (!c.child) throw new Error("the fixture has no spare child for this case");
  const CHILD = c.child;
  // st_e2e_tpm_… for the office case, as before.
  const stop = (name: string) => `st_${c.route.slice(3)}_${name}`;
  const { fetchTransportDeskFromDb, pushTransportDeskToDb } = await import("@/lib/transportNormalized.server");
  const { fetchFeeDeskFromDb, pushFeeDeskToDb } = await import("@/lib/feesNormalized.server");

  const route = {
    id: c.route,
    code: c.routeCode,
    name: "E2E Magic",
    busNo: c.routeCode,
    vehicleReg: "",
    vehicleId: "",
    monthlyFeePaise: 0,
    isActive: true,
    // The stop the old assignment named is gone (stop-id churn); the same
    // place now has a different id.
    stops: [
      { id: stop("ekala"), name: "9XX9+VG Ekala", sequence: 1, distanceKm: 3, distanceSource: "manual", monthlyFeePaise: 50000 },
      { id: stop("new"), name: "New stop", sequence: 2, distanceKm: 3, distanceSource: "manual", monthlyFeePaise: 50000 },
    ],
    shifts: [],
  };
  const assignments = [
    {
      id: c.oldId,
      studentId: CHILD.id,
      householdId: CHILD.householdId,
      routeId: c.route,
      stopId: stop("gone"),
      academicYearCode: AY_CURRENT,
      effectiveFrom: "2026-04-01",
      effectiveTo: "2026-08-31",
      monthlyFeePaise: 0,
      feeOverrideReason: "",
      serviceMode: "both",
      pickupShiftId: "",
      dropShiftId: "",
      boardingSuspended: false,
      createdAt: "2026-08-22T06:17:10.753Z",
    },
    {
      id: c.newId,
      studentId: CHILD.id,
      householdId: CHILD.householdId,
      routeId: c.route,
      stopId: stop("new"),
      academicYearCode: AY_CURRENT,
      effectiveFrom: "2026-09-01",
      // TPM_STEP=end-new: the rider leaves the bus at the end of September —
      // so the office can re-assign her, and the Riders form can be seen
      // warning about the paid months a backdated start would cover.
      effectiveTo: process.env.TPM_STEP === "end-new" ? "2026-09-30" : null,
      monthlyFeePaise: 50000,
      feeOverrideReason: "",
      serviceMode: "both",
      pickupShiftId: "",
      dropShiftId: "",
      boardingSuspended: false,
      createdAt: "2026-09-14T03:46:25.209Z",
    },
  ];
  // Merged into the saved desk: this case's own rows replaced, everyone
  // else's kept (the desk saves whole lists, so a push of just this case
  // used to erase e2e/duesTransportCase.ts's rider).
  const saved = await fetchTransportDeskFromDb();
  if (!saved.ok) throw new Error("transport desk unreadable");
  const b = saved.bundle;
  const mineIds = new Set(assignments.map((a) => a.id));
  const transport = {
    ...b,
    version: 2,
    feePolicy: b.feePolicy ?? defaultFeePolicy(AY_CURRENT),
    routes: [...b.routes.filter((r) => r.id !== c.route), route],
    assignments: [...b.assignments.filter((a) => !mineIds.has(a.id)), ...assignments],
  } as unknown as TransportState;
  const t = await pushTransportDeskToDb(transport);
  if (!t.ok) throw new Error(`transport desk: ${t.error}`);
  if (process.env.TPM_STEP === "end-new") return;

  const desk = await fetchFeeDeskFromDb();
  if (!desk.ok) throw new Error("fee desk unreadable");
  const mine = APR_SEP.map((ym, i) =>
    receipt(c, i + 1, ym, ym === "2026-09" ? "2026-09-10" : `${ym}-10`),
  );
  const keep = desk.vouchers.filter((v) => !v.id.startsWith(c.receiptIdPrefix));
  const f = await pushFeeDeskToDb(
    { vouchers: [...keep, ...mine], ...desk.ancillary },
    { academicYearCode: AY_CURRENT, rebuildOpenDues: false },
  );
  if (!f.ok) throw new Error(`fee desk: ${f.error}`);
}
