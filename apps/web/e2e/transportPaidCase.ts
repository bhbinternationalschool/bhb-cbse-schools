/**
 * The 15 Oct 2026 transport paid-month case (Anvi Yadav), for one fixture
 * child no other spec touches. Written through the app's own server write
 * paths by `seedTransportPaidCase` — run under tsx (scripts/e2e-seed-transport-paid.ts),
 * because the server modules import each other dynamically through the "@/"
 * alias, which Playwright's loader does not resolve. The spec
 * (specs/transport-paid-month.spec.ts) runs that script, then reads the screens.
 */
import { buildFixture, AY_CURRENT } from "./fixture";
import { assertLocalStack } from "./session";
import { defaultFeePolicy, type TransportState } from "@/lib/transport";
import type { CollectionVoucher } from "@/lib/fees";

const fx = buildFixture();

// A current-year active child with no fixture receipt or charge voucher.
const used = new Set<string>([
  ...fx.growing.receipts.flatMap((v) => v.lines.map((l) => l.studentId)),
  ...fx.growing.chargeVouchers.map((c) => c.studentId),
]);
export const CHILD = fx.sis.students.find(
  (s) => s.academicYearCode === AY_CURRENT && s.status === "active" && !used.has(s.id) && s.householdId,
)!;
export const OLD = "ta_e2e_tpm_old";
export const NEW = "ta_e2e_tpm_new";
const ROUTE = "tr_e2e_tpm";
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

function receipt(i: number, ym: string, date: string): CollectionVoucher {
  return {
    id: `e2e_tpm_rcv_${i}`,
    receiptNo: `E2E-TPM-${String(i).padStart(4, "0")}`,
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
        dueKey: `transport:${CHILD.id}:${OLD}:${ym}`,
        studentId: CHILD.id,
        studentName: CHILD.fullName,
        label: `Transport · ${MONTH_NAMES[ym]} 2026 · TPM-1`,
        kind: "transport",
        amountPaise: 50000,
        billedPaise: 50000,
        concessionPaise: 0,
        concessionDetails: [],
        transport: {
          assignmentId: OLD,
          routeCode: "TPM-1",
          routeName: "E2E Magic",
          busNo: "TPM-1",
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

export async function seedTransportPaidCase(): Promise<void> {
  assertLocalStack();
  const { pushTransportDeskToDb } = await import("@/lib/transportNormalized.server");
  const { fetchFeeDeskFromDb, pushFeeDeskToDb } = await import("@/lib/feesNormalized.server");

  const transport = {
    version: 2,
    routes: [
      {
        id: ROUTE,
        code: "TPM-1",
        name: "E2E Magic",
        busNo: "TPM-1",
        vehicleReg: "",
        vehicleId: "",
        monthlyFeePaise: 0,
        isActive: true,
        // The stop the old assignment named is gone (stop-id churn); the same
        // place now has a different id.
        stops: [
          { id: "st_e2e_tpm_ekala", name: "9XX9+VG Ekala", sequence: 1, distanceKm: 3, distanceSource: "manual", monthlyFeePaise: 50000 },
          { id: "st_e2e_tpm_new", name: "New stop", sequence: 2, distanceKm: 3, distanceSource: "manual", monthlyFeePaise: 50000 },
        ],
        shifts: [],
      },
    ],
    assignments: [
      {
        id: OLD,
        studentId: CHILD.id,
        householdId: CHILD.householdId,
        routeId: ROUTE,
        stopId: "st_e2e_tpm_gone",
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
        id: NEW,
        studentId: CHILD.id,
        householdId: CHILD.householdId,
        routeId: ROUTE,
        stopId: "st_e2e_tpm_new",
        academicYearCode: AY_CURRENT,
        effectiveFrom: "2026-09-01",
        effectiveTo: null,
        monthlyFeePaise: 50000,
        feeOverrideReason: "",
        serviceMode: "both",
        pickupShiftId: "",
        dropShiftId: "",
        boardingSuspended: false,
        createdAt: "2026-09-14T03:46:25.209Z",
      },
    ],
    vehicles: [],
    feePolicy: defaultFeePolicy(AY_CURRENT),
  } as unknown as TransportState;
  const t = await pushTransportDeskToDb(transport);
  if (!t.ok) throw new Error(`transport desk: ${t.error}`);

  const desk = await fetchFeeDeskFromDb();
  if (!desk.ok) throw new Error("fee desk unreadable");
  const mine = APR_SEP.map((ym, i) =>
    receipt(i + 1, ym, ym === "2026-09" ? "2026-09-10" : `${ym}-10`),
  );
  const keep = desk.vouchers.filter((v) => !v.id.startsWith("e2e_tpm_"));
  const f = await pushFeeDeskToDb(
    { vouchers: [...keep, ...mine], ...desk.ancillary },
    { academicYearCode: AY_CURRENT, rebuildOpenDues: false },
  );
  if (!f.ok) throw new Error(`fee desk: ${f.error}`);
}

