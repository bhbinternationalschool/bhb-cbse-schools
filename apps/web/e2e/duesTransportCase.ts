/**
 * A bus rider for the dues-callers spec (specs/dues-transport-desk.spec.ts):
 * one fixture child no other spec touches, on a ₹500/month stop from April,
 * with April–September paid at the counter. October is owing.
 *
 * Every screen that prints dues derives the bus months from the transport
 * desk, so with the desk not yet loaded this child's dues read as tuition
 * only — the defect the spec catches (15 Oct 2026).
 *
 * Written through the app's own server write paths (pushTransportDeskToDb,
 * pushFeeDeskToDb) by scripts/e2e-seed-dues-transport.ts under tsx — the
 * server modules import each other through the "@/" alias, which
 * Playwright's loader does not resolve. The transport rows are MERGED into
 * the saved desk: nothing another spec reads is replaced.
 */
import { buildFixture, AY_CURRENT } from "./fixture";
import { assertLocalStack } from "./session";
import { defaultFeePolicy, type TransportState } from "@/lib/transport";
import type { CollectionVoucher } from "@/lib/fees";

const fx = buildFixture();

// Current-year active children with a household and no fixture receipt or
// charge voucher. The FIRST is the transport paid-month spec's (#665); this
// spec takes the second.
const used = new Set<string>([
  ...fx.growing.receipts.flatMap((v) => v.lines.map((l) => l.studentId)),
  ...fx.growing.chargeVouchers.map((c) => c.studentId),
]);
export const CHILD = fx.sis.students.filter(
  (s) => s.academicYearCode === AY_CURRENT && s.status === "active" && !used.has(s.id) && s.householdId,
)[1]!;
export const ASSIGNMENT = "ta_e2e_dtd";
const ROUTE = "tr_e2e_dtd";
const STOP = "st_e2e_dtd";
export const PAID = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
export const MONTH_NAMES: Record<string, string> = {
  "2026-04": "April",
  "2026-05": "May",
  "2026-06": "June",
  "2026-07": "July",
  "2026-08": "August",
  "2026-09": "September",
  "2026-10": "October",
};

function receipt(i: number, ym: string): CollectionVoucher {
  const date = `${ym}-10`;
  return {
    id: `e2e_dtd_rcv_${i}`,
    receiptNo: `E2E-DTD-${String(i).padStart(4, "0")}`,
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
        dueKey: `transport:${CHILD.id}:${ASSIGNMENT}:${ym}`,
        studentId: CHILD.id,
        studentName: CHILD.fullName,
        label: `Transport · ${MONTH_NAMES[ym]} 2026 · DTD-1`,
        kind: "transport",
        amountPaise: 50000,
        billedPaise: 50000,
        concessionPaise: 0,
        concessionDetails: [],
        transport: {
          assignmentId: ASSIGNMENT,
          routeCode: "DTD-1",
          routeName: "E2E Dues Desk",
          busNo: "DTD-1",
          vehicleReg: "",
          vehicleId: "",
          vehiclePhotoUrl: "",
          stopName: "E2E Chowk",
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

export async function seedDuesTransportCase(): Promise<void> {
  assertLocalStack();
  const { fetchTransportDeskFromDb, pushTransportDeskToDb } = await import("@/lib/transportNormalized.server");
  const { fetchFeeDeskFromDb, pushFeeDeskToDb } = await import("@/lib/feesNormalized.server");

  const saved = await fetchTransportDeskFromDb();
  if (!saved.ok) throw new Error("transport desk unreadable");
  const route = {
    id: ROUTE,
    code: "DTD-1",
    name: "E2E Dues Desk",
    busNo: "DTD-1",
    vehicleReg: "",
    vehicleId: "",
    monthlyFeePaise: 0,
    isActive: true,
    stops: [
      { id: STOP, name: "E2E Chowk", sequence: 1, distanceKm: 4, distanceSource: "manual", monthlyFeePaise: 50000 },
    ],
    shifts: [],
  };
  const assignment = {
    id: ASSIGNMENT,
    studentId: CHILD.id,
    householdId: CHILD.householdId,
    routeId: ROUTE,
    stopId: STOP,
    academicYearCode: AY_CURRENT,
    effectiveFrom: "2026-04-01",
    effectiveTo: null,
    monthlyFeePaise: 50000,
    feeOverrideReason: "",
    serviceMode: "both",
    pickupShiftId: "",
    dropShiftId: "",
    boardingSuspended: false,
    createdAt: "2026-04-01T04:00:00.000Z",
  };
  const b = saved.bundle;
  const transport = {
    ...b,
    version: 2,
    feePolicy: b.feePolicy ?? defaultFeePolicy(AY_CURRENT),
    routes: [...b.routes.filter((r) => r.id !== ROUTE), route],
    assignments: [...b.assignments.filter((a) => a.id !== ASSIGNMENT), assignment],
  } as unknown as TransportState;
  const t = await pushTransportDeskToDb(transport);
  if (!t.ok) throw new Error(`transport desk: ${t.error}`);

  const desk = await fetchFeeDeskFromDb();
  if (!desk.ok) throw new Error("fee desk unreadable");
  const mine = PAID.map((ym, i) => receipt(i + 1, ym));
  const keep = desk.vouchers.filter((v) => !v.id.startsWith("e2e_dtd_"));
  const f = await pushFeeDeskToDb(
    { vouchers: [...keep, ...mine], ...desk.ancillary },
    { academicYearCode: AY_CURRENT, rebuildOpenDues: false },
  );
  if (!f.ok) throw new Error(`fee desk: ${f.error}`);
}
