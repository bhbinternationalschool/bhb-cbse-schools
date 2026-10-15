/**
 * Rows for the month-grouped screens (components/ui/month-grouped-rows.tsx).
 *
 * Pure data, built from the fixture school so every name and id is the
 * seeded one. Each list spans October, September and August 2026 so the
 * newest month is open and two are folded, and each carries the case its
 * screen must get right:
 *
 *   fee receipts      a voided receipt in October (not counted in the
 *                     header total); a receipt counted at 01:30 IST on
 *                     1 Oct (collectedAt 2026-09-30T20:00Z, counter date
 *                     2026-10-01 → October); one child, RECEIPT_SEARCH_CHILD,
 *                     whose only receipt is in August (the search test)
 *   staff leave       a PENDING leave in August → that month starts open
 *                     with "1 need action"
 *   staff requests    built but NOT seeded — no server write path holds
 *                     them (see seed.ts)
 *   outdoor duty      one trip still out (active) → its month opens
 *   fee adjustments   one awaiting approval in August → same
 *
 * The Store tables are written through the procurement server functions in
 * seed.ts (they mint their own numbers), from STORE_PLAN below.
 */
import type { CollectionVoucher, ChargeVoucher } from "@/lib/fees";
import type { FeeAdjustment } from "@/lib/feeAdjustments";
import type { LeaveRequest, StaffHrState, StaffRequestTicket } from "@/lib/staffHr";
import { emptyStaffHrState } from "@/lib/staffHr";
import type { OutdoorDutySession } from "@/lib/staffAttendance";
import type { CertificateIssue, CertificatesState } from "@/lib/certificates";
import type { PayrollAuditEntry } from "@/lib/payroll";
import type { StaffRecord } from "@/lib/foundationMasters";
import type { SisStudent } from "@/lib/sis";

export const GROWING_AY = "2026-27";

type Child = Pick<SisStudent, "id" | "fullName" | "householdId" | "admissionNo">;

const rupees = (r: number) => r * 100;

/** The receipts and what a test should see. */
export function buildReceipts(children: Child[]): { vouchers: CollectionVoucher[]; searchChild: Child } {
  const [a, b, c, d, e, f] = children;
  const rows: { id: string; child: Child; date: string; at?: string; rs: number; mode: "cash" | "upi" | "cheque"; voided?: boolean; cashier?: string }[] = [
    { id: "e2e_rcv_1", child: a!, date: "2026-10-08", rs: 5000, mode: "cash" },
    { id: "e2e_rcv_2", child: b!, date: "2026-10-01", at: "2026-09-30T20:00:00.000Z", rs: 3500, mode: "upi" },
    { id: "e2e_rcv_3", child: c!, date: "2026-10-03", rs: 1000, mode: "cash", voided: true },
    { id: "e2e_rcv_4", child: d!, date: "2026-09-15", rs: 4200, mode: "upi" },
    { id: "e2e_rcv_5", child: e!, date: "2026-09-02", rs: 2800, mode: "cash", cashier: "E2E Second Clerk" },
    { id: "e2e_rcv_6", child: f!, date: "2026-08-20", rs: 6100, mode: "cheque" },
  ];
  const vouchers = rows.map((r, i): CollectionVoucher => ({
    id: r.id,
    receiptNo: `E2E-R-${String(i + 1).padStart(4, "0")}`,
    schoolReceiptNo: "",
    source: "counter",
    manualBookSeries: "",
    manualBookLeaf: "",
    householdId: r.child.householdId,
    academicYearCode: GROWING_AY,
    collectionDate: r.date,
    transactionDate: r.date,
    transactionId: "",
    collectedAt: r.at ?? `${r.date}T05:30:00.000Z`,
    cashierName: r.cashier ?? "E2E Clerk",
    lines: [
      {
        dueKey: `e2e:${r.id}`,
        studentId: r.child.id,
        studentName: r.child.fullName,
        label: "Tuition fee",
        kind: "academic",
        amountPaise: rupees(r.rs),
        billedPaise: rupees(r.rs),
        concessionPaise: 0,
        concessionDetails: [],
      },
    ],
    tenders: [
      {
        mode: r.mode,
        amountPaise: rupees(r.rs),
        ref: r.mode === "cash" ? "" : `E2EREF${i + 1}`,
        instrumentDate: r.mode === "cheque" ? r.date : "",
        bankName: r.mode === "cheque" ? "E2E Bank" : "",
        bankAccountId: "",
        gatewayProvider: "",
        realisation: r.mode === "cheque" ? "subject_to_clearance" : "cleared",
      },
    ],
    totalPaise: rupees(r.rs),
    note: "",
    voidedAt: r.voided ? `${r.date}T09:00:00.000Z` : null,
    whatsappSentAt: null,
  }));
  return { vouchers, searchChild: f! };
}

export function buildChargeVouchers(children: Child[]): ChargeVoucher[] {
  const plan = [
    { at: "2026-10-09T06:00:00.000Z", rs: 450, label: "October 2026" },
    { at: "2026-10-02T06:00:00.000Z", rs: 300, label: "October 2026" },
    { at: "2026-09-11T06:00:00.000Z", rs: 600, label: "September 2026" },
    { at: "2026-08-05T06:00:00.000Z", rs: 250, label: "August 2026" },
  ];
  return plan.map((p, i) => {
    const ch = children[i]!;
    return {
      id: `e2e_cv_${i + 1}`,
      code: `CV-E2E${i + 1}`,
      studentId: ch.id,
      householdId: ch.householdId,
      studentName: ch.fullName,
      academicYearCode: GROWING_AY,
      installmentId: null,
      installmentLabel: p.label,
      dueOn: p.at.slice(0, 10),
      lines: [{ id: `e2e_cvl_${i + 1}`, feeHeadId: "e2e_head_activity", feeHeadName: "Activity fee", amountPaise: rupees(p.rs), note: "" }],
      totalPaise: rupees(p.rs),
      reason: "Left out of the month's bill",
      createdAt: p.at,
      createdBy: "E2E Clerk",
      voidedAt: null,
      voidedBy: "",
    };
  });
}

export function buildFeeAdjustments(children: Child[]): FeeAdjustment[] {
  const plan: { at: string; rs: number; status: FeeAdjustment["status"] }[] = [
    { at: "2026-10-10T07:00:00.000Z", rs: 500, status: "posted" },
    { at: "2026-09-18T07:00:00.000Z", rs: 800, status: "posted" },
    { at: "2026-09-04T07:00:00.000Z", rs: 200, status: "rejected" },
    { at: "2026-08-12T07:00:00.000Z", rs: 1200, status: "pending_approval" },
  ];
  return plan.map((p, i) => ({
    id: `e2e_adj_${i + 1}`,
    studentId: children[i]!.id,
    academicYearCode: GROWING_AY,
    type: "waiver",
    dueKey: `e2e:adj:${i + 1}`,
    label: "Tuition fee waiver",
    amountPaise: rupees(p.rs),
    reasonCode: "hardship",
    reason: "E2E fixture",
    status: p.status,
    stopAfterDate: null,
    fromFeeGroupId: null,
    toFeeGroupId: null,
    feeHeadId: null,
    dueOn: null,
    createdAt: p.at,
    createdBy: "E2E Clerk",
    decidedAt: p.status === "pending_approval" ? null : p.at,
    decidedBy: p.status === "pending_approval" ? "" : "E2E Principal",
    decisionNote: "",
  }) as FeeAdjustment);
}

export function buildStaffHr(staff: StaffRecord[]): StaffHrState {
  const base = emptyStaffHrState();
  const leave = (
    i: number,
    from: string,
    to: string,
    days: number,
    status: LeaveRequest["status"],
  ): LeaveRequest => ({
    id: `e2e_leave_${i}`,
    academicYearCode: GROWING_AY,
    staffId: staff[i + 5]!.id,
    typeCode: base.leaveTypes[0]!.code,
    fromDate: from,
    toDate: to,
    days,
    halfDay: false,
    reason: "E2E fixture",
    status,
    origin: "request",
    appliedBy: staff[i + 5]!.fullName,
    appliedAt: `${from}T04:00:00.000Z`,
    decidedBy: status === "approved" ? "E2E Principal" : "",
    decidedAt: status === "approved" ? `${from}T08:00:00.000Z` : "",
    decisionNote: "",
    level1By: "",
    level1At: "",
  });
  const request = (
    i: number,
    at: string,
    status: StaffRequestTicket["status"],
  ): StaffRequestTicket => ({
    id: `e2e_sreq_${i}`,
    staffId: staff[i + 10]!.id,
    raisedByName: staff[i + 10]!.fullName,
    type: "supplies",
    subject: `E2E request ${i}`,
    description: "",
    date: at.slice(0, 10),
    assignedToStaffId: "",
    status,
    resolutionNote: status === "resolved" ? "Done" : "",
    resolvedAt: status === "resolved" ? at : null,
    createdAt: at,
    updatedAt: at,
  });
  return {
    ...base,
    leaveRequests: [
      leave(1, "2026-10-12", "2026-10-13", 2, "approved"),
      leave(2, "2026-10-05", "2026-10-05", 1, "approved"),
      leave(3, "2026-09-22", "2026-09-24", 3, "approved"),
      leave(4, "2026-08-18", "2026-08-19", 2, "pending"),
      leave(5, "2026-08-04", "2026-08-04", 1, "rejected"),
    ],
    staffRequests: [
      request(1, "2026-10-11T05:00:00.000Z", "resolved"),
      request(2, "2026-09-25T05:00:00.000Z", "resolved"),
      request(3, "2026-09-10T05:00:00.000Z", "closed"),
      request(4, "2026-08-14T05:00:00.000Z", "open"),
    ],
  };
}

export function buildOutdoorDuty(staff: StaffRecord[]): OutdoorDutySession[] {
  const plan: { start: string; end: string | null }[] = [
    { start: "2026-10-13T05:00:00.000Z", end: "2026-10-13T07:15:00.000Z" },
    { start: "2026-10-06T05:00:00.000Z", end: "2026-10-06T06:00:00.000Z" },
    { start: "2026-09-19T05:00:00.000Z", end: "2026-09-19T08:00:00.000Z" },
    { start: "2026-08-21T05:00:00.000Z", end: null },
  ];
  return plan.map((p, i) => ({
    id: `e2e_od_${i + 1}`,
    staffId: staff[i + 15]!.id,
    purpose: "bank",
    destination: `E2E Bank branch ${i + 1}`,
    note: "",
    startedAt: p.start,
    startGeo: null,
    endedAt: p.end,
    endGeo: null,
    status: p.end ? "ended" : "active",
    createdBy: staff[i + 15]!.fullName,
  }));
}

export function buildCertificates(children: Child[]): CertificatesState {
  const plan = ["2026-10-07", "2026-10-02", "2026-09-16", "2026-08-26"];
  const issues = plan.map((on, i) => {
    const ch = children[i]!;
    return {
      id: `e2e_cert_${i + 1}`,
      kind: "bonafide",
      certNo: `E2E-BON-${i + 1}`,
      studentId: ch.id,
      householdId: ch.householdId,
      academicYearCode: GROWING_AY,
      studentName: ch.fullName,
      admissionNo: ch.admissionNo,
      issuedOn: on,
      issuedBy: "E2E Principal",
      createdAt: `${on}T06:00:00.000Z`,
      voidedAt: null,
    } as Partial<CertificateIssue>;
  });
  return { version: 1, issues: issues as CertificateIssue[] };
}

export function buildPayrollAudit(runs: { id: string; month: string; createdAt: string }[]): PayrollAuditEntry[] {
  return runs.map((r, i) => ({
    id: `e2e_pa_${i + 1}`,
    at: r.createdAt,
    by: "E2E Principal",
    action: "draft_created",
    runId: r.id,
    month: r.month,
    academicYearCode: GROWING_AY,
    detail: "E2E fixture",
  }));
}

/** Store rows: one vendor, one item, and dated documents per month. */
export const STORE_PLAN = {
  vendor: { name: "E2E Stationery Mart" },
  item: { name: "E2E Notebook", sku: "E2E-NB-01" },
  orders: [
    { date: "2026-10-09", qty: 40, ratePaise: 4500 },
    { date: "2026-09-17", qty: 25, ratePaise: 4500 },
    { date: "2026-08-08", qty: 60, ratePaise: 4200 },
  ],
  receipts: [
    { date: "2026-10-11", qty: 20, ratePaise: 4500 },
    { date: "2026-09-20", qty: 25, ratePaise: 4500 },
    { date: "2026-08-12", qty: 60, ratePaise: 4200 },
  ],
  returns: [
    { date: "2026-10-12", qty: 2, ratePaise: 4500 },
    { date: "2026-08-14", qty: 5, ratePaise: 4200 },
  ],
} as const;
