/**
 * Fee Take — dues engine + collection vouchers (demo localStorage).
 * Academic + transport + special + store/books − concessions − paid.
 */

import {
  DEFAULT_AY,
  formatInr,
  loadMasters,
  normalizeMidYearFeePolicy,
  ordinalChildLabel,
  resolveFeeGroupId,
  resolveSpecialFeeAssignees,
  resolveStructureLinesForClass,
  resolveSiblingTierValue,
  shouldBillMidYearLine,
  concessionAmountFromValue,
  type MastersState,
} from "@/lib/masters";
import {
  householdOf,
  householdWhatsApp,
  isValidMobile,
  loadSis,
  normalizeMobile,
  saveSis,
  siblingsOf,
  type Household,
  type SisState,
  type SisStudent,
} from "@/lib/sis";
import {
  listStoreIssuesForStudent,
  loadStore,
  storeDueKey,
  type StoreIssueLine,
} from "@/lib/store";
import {
  computeTransportPeriodDues,
  loadTransport,
} from "@/lib/transport";
import { TENANT } from "@/lib/types";
import {
  activePlanForStudent,
  allocatePlanPayment,
  coveredDueKeySet,
  isPlanFullyPaid,
  mergePlanAllocationsIntoPaidMap,
  nextInstallmentPlanCode,
  normalizeInstallmentPlan,
  normalizePlanAllocation,
  planSliceDues,
  proposeInstallmentSchedule,
  type InstallmentPlan,
  type InstallmentPlanInterval,
  type PlanAllocation,
} from "@/lib/installmentPlans";

export type DueKind =
  | "academic"
  | "transport"
  | "special"
  | "store"
  | "plan";

export type StoreDueItem = {
  sku: string;
  name: string;
  sizeLabel: string;
  qty: number;
  unitPricePaise: number;
  linePaise: number;
};

export type TransportDueDetail = {
  assignmentId: string;
  routeCode: string;
  routeName: string;
  busNo: string;
  vehicleReg: string;
  stopName: string;
  periodLabel: string;
};

export type TenderMode =
  | "cash"
  | "upi"
  | "card"
  | "cheque"
  | "rtgs"
  | "neft"
  | "imps"
  | "bank";

export const TENDER_MODES: {
  value: TenderMode;
  label: string;
  /** Label for instrument / txn reference */
  refLabel: string;
  needsRef: boolean;
  needsInstrumentDate: boolean;
  needsBank: boolean;
}[] = [
  {
    value: "cash",
    label: "Cash",
    refLabel: "Receipt slip no.",
    needsRef: false,
    needsInstrumentDate: false,
    needsBank: false,
  },
  {
    value: "upi",
    label: "UPI",
    refLabel: "UTR / UPI ref",
    needsRef: true,
    needsInstrumentDate: true,
    needsBank: false,
  },
  {
    value: "card",
    label: "Card",
    refLabel: "Auth / RR No.",
    needsRef: true,
    needsInstrumentDate: true,
    needsBank: false,
  },
  {
    value: "cheque",
    label: "Cheque",
    refLabel: "Cheque no.",
    needsRef: true,
    needsInstrumentDate: true,
    needsBank: true,
  },
  {
    value: "rtgs",
    label: "RTGS",
    refLabel: "UTR / txn id",
    needsRef: true,
    needsInstrumentDate: true,
    needsBank: true,
  },
  {
    value: "neft",
    label: "NEFT",
    refLabel: "UTR / txn id",
    needsRef: true,
    needsInstrumentDate: true,
    needsBank: true,
  },
  {
    value: "imps",
    label: "IMPS",
    refLabel: "UTR / txn id",
    needsRef: true,
    needsInstrumentDate: true,
    needsBank: true,
  },
  {
    value: "bank",
    label: "Bank deposit",
    refLabel: "Deposit / challan no.",
    needsRef: true,
    needsInstrumentDate: true,
    needsBank: true,
  },
];

export function tenderModeLabel(mode: TenderMode): string {
  return TENDER_MODES.find((m) => m.value === mode)?.label ?? mode;
}

export type FeeDueLine = {
  /** Stable key across sessions */
  dueKey: string;
  kind: DueKind;
  studentId: string;
  feeHeadId: string;
  feeHeadName: string;
  installmentId: string | null;
  installmentLabel: string;
  specialFeeId: string | null;
  structureLineId: string | null;
  storeIssueId: string | null;
  storeIssueNo: string;
  storeItems: StoreDueItem[];
  transport: TransportDueDetail | null;
  dueOn: string;
  billedPaise: number;
  concessionPaise: number;
  /** Applied concessions with policy / sibling tier detail */
  concessionDetails: FeeConcessionDetail[];
  paidPaise: number;
  balancePaise: number;
  label: string;
};

/** One approved grant applied to a due line. */
export type FeeConcessionDetail = {
  grantId: string;
  concessionId: string;
  code: string;
  name: string;
  kind: string;
  /** e.g. "10%" or "₹500" */
  rateLabel: string;
  /** e.g. "2nd child" for sibling */
  siblingLabel: string;
  amountPaise: number;
};

export type VoucherLine = {
  dueKey: string;
  studentId: string;
  studentName: string;
  label: string;
  kind: DueKind;
  amountPaise: number;
  /** Structure / special billed amount before concession (frozen at collect) */
  billedPaise?: number;
  /** Total concession applied to this head (frozen at collect) */
  concessionPaise?: number;
  /** Policy / sibling-tier break-up frozen at collect */
  concessionDetails?: FeeConcessionDetail[];
  /** Store issue ref when kind = store */
  storeIssueNo?: string;
  /** Item break-up frozen onto the voucher at collect time */
  storeItems?: StoreDueItem[];
  /** Transport details frozen at collect */
  transport?: TransportDueDetail | null;
};

/** Map a selected due into a voucher line (keeps store item details). */
export function voucherLineFromDue(
  d: FeeDueLine,
  studentName: string,
): VoucherLine {
  return {
    dueKey: d.dueKey,
    studentId: d.studentId,
    studentName,
    label: d.label,
    kind: d.kind,
    amountPaise: d.balancePaise,
    billedPaise: d.billedPaise,
    concessionPaise: d.concessionPaise,
    concessionDetails:
      d.concessionDetails?.length > 0
        ? d.concessionDetails.map((c) => ({ ...c }))
        : [],
    ...(d.kind === "store"
      ? {
          storeIssueNo: d.storeIssueNo,
          storeItems: d.storeItems.map((it) => ({ ...it })),
        }
      : {}),
    ...(d.kind === "transport" && d.transport
      ? { transport: { ...d.transport } }
      : {}),
  };
}

export type ChequeRealisation = "cleared" | "subject_to_clearance";

/** Full cheque / DD lifecycle for Accounts tracking. */
export type ChequeStatus =
  | "received"
  | "deposited"
  | "cleared"
  | "bounced";

export const CHEQUE_STATUSES: {
  value: ChequeStatus;
  label: string;
}[] = [
  { value: "received", label: "In hand" },
  { value: "deposited", label: "Deposited" },
  { value: "cleared", label: "Cleared" },
  { value: "bounced", label: "Bounced" },
];

export function chequeStatusLabel(status: ChequeStatus): string {
  return CHEQUE_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export type ChequeInstrument = {
  id: string;
  voucherId: string;
  receiptNo: string;
  householdId: string;
  /** Index into voucher.tenders at create time */
  tenderIndex: number;
  chequeNo: string;
  bankName: string;
  chequeDate: string;
  amountPaise: number;
  favouring: string;
  status: ChequeStatus;
  receivedAt: string;
  depositedAt: string | null;
  depositSlipNo: string;
  clearedAt: string | null;
  bouncedAt: string | null;
  bounceReason: string;
};

export type VoucherTender = {
  mode: TenderMode;
  amountPaise: number;
  /** Cheque no / UTR / auth / slip */
  ref: string;
  /** Cheque date or bank value date for this tender */
  instrumentDate: string;
  bankName: string;
  /**
   * Cheque (and similar) — receipt issued but bank clearance pending.
   * Non-cheque modes are always "cleared".
   */
  realisation: ChequeRealisation;
};

export function tenderNeedsClearance(t: VoucherTender): boolean {
  return t.realisation === "subject_to_clearance";
}

export function voucherHasUnclearedCheque(
  v: CollectionVoucher,
  cheques?: ChequeInstrument[],
): boolean {
  if (cheques) {
    return cheques.some(
      (c) =>
        c.voucherId === v.id &&
        (c.status === "received" || c.status === "deposited"),
    );
  }
  return v.tenders.some(tenderNeedsClearance);
}

export type CollectionSource = "counter" | "manual_book" | "payment_link";

export type ManualBookSeries = {
  id: string;
  seriesCode: string;
  label: string;
  isActive: boolean;
};

export type CollectionVoucher = {
  id: string;
  receiptNo: string;
  /** Optional paper / school receipt book number (e.g. FEE-BOOK-A/4521) */
  schoolReceiptNo: string;
  /** How this voucher was created */
  source: CollectionSource;
  /** Manual book series code when source = manual_book */
  manualBookSeries: string;
  /** Leaf / page number in the paper book */
  manualBookLeaf: string;
  householdId: string;
  academicYearCode: string;
  /** When fee was collected (counter date, YYYY-MM-DD) */
  collectionDate: string;
  /** Bank / payment value date (YYYY-MM-DD) */
  transactionDate: string;
  /** Related overall transaction / batch id */
  transactionId: string;
  /** System post timestamp (ISO) */
  collectedAt: string;
  cashierName: string;
  lines: VoucherLine[];
  tenders: VoucherTender[];
  totalPaise: number;
  note: string;
  voidedAt: string | null;
  /** When cashier opened WhatsApp send for this receipt */
  whatsappSentAt: string | null;
};

export type FeesState = {
  version: 1;
  vouchers: CollectionVoucher[];
  cheques: ChequeInstrument[];
  manualBooks: ManualBookSeries[];
  dayCloses: DayCloseSession[];
  /** Recovery EMI plans from Defaulters / Accounts */
  installmentPlans: InstallmentPlan[];
  /** FIFO allocations from plan EMI payments onto original dues */
  planAllocations: PlanAllocation[];
};

export type DayCloseStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected";

export type DayCloseDenomLine = {
  /** Face value in paise (₹500 → 50000) */
  denomPaise: number;
  qty: number;
};

export type DayCloseModeTotal = {
  mode: TenderMode;
  paise: number;
  tenderCount: number;
};

export type DayCloseSession = {
  id: string;
  closeDate: string;
  counterId: string;
  cashierName: string;
  status: DayCloseStatus;
  /** Live vouchers included at submit time */
  voucherIds: string[];
  receiptCount: number;
  totalPaise: number;
  modeTotals: DayCloseModeTotal[];
  systemCashPaise: number;
  denominations: DayCloseDenomLine[];
  physicalCashPaise: number;
  variancePaise: number;
  cashierRemarks: string;
  receiverName: string;
  receiverRemarks: string;
  createdAt: string;
  submittedAt: string | null;
  resolvedAt: string | null;
};

/** Indian notes + coins for cashier count (paise). */
export const CASH_DENOMINATIONS: {
  denomPaise: number;
  label: string;
  kind: "note" | "coin";
}[] = [
  { denomPaise: 500_00, label: "₹500", kind: "note" },
  { denomPaise: 200_00, label: "₹200", kind: "note" },
  { denomPaise: 100_00, label: "₹100", kind: "note" },
  { denomPaise: 50_00, label: "₹50", kind: "note" },
  { denomPaise: 20_00, label: "₹20", kind: "note" },
  { denomPaise: 10_00, label: "₹10", kind: "note" },
  { denomPaise: 5_00, label: "₹5", kind: "coin" },
  { denomPaise: 2_00, label: "₹2", kind: "coin" },
  { denomPaise: 1_00, label: "₹1", kind: "coin" },
];

export function emptyDenominations(): DayCloseDenomLine[] {
  return CASH_DENOMINATIONS.map((d) => ({
    denomPaise: d.denomPaise,
    qty: 0,
  }));
}

export function denomPhysicalTotal(lines: DayCloseDenomLine[]): number {
  return lines.reduce((s, l) => s + l.denomPaise * Math.max(0, l.qty | 0), 0);
}

const STORAGE_KEY = "bhb_fees_v1";
const MANUAL_BACKDATE_DAYS = 3;
const DEFAULT_COUNTER_ID = "front_office";

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function formatManualBookRef(seriesCode: string, leaf: string): string {
  const s = seriesCode.trim().toUpperCase();
  const n = leaf.trim();
  if (!s || !n) return "";
  return `${s}/${n}`;
}

/** True if this school/paper receipt ref is already used on a live voucher. */
export function isSchoolReceiptNoTaken(
  schoolReceiptNo: string,
  fees?: FeesState,
  exceptVoucherId?: string,
): boolean {
  const key = schoolReceiptNo.trim().toUpperCase();
  if (!key) return false;
  const f = fees ?? loadFees();
  return f.vouchers.some((v) => {
    if (v.voidedAt) return false;
    if (exceptVoucherId && v.id === exceptVoucherId) return false;
    if ((v.schoolReceiptNo ?? "").trim().toUpperCase() === key) return true;
    if (
      v.source === "manual_book" &&
      formatManualBookRef(v.manualBookSeries, v.manualBookLeaf).toUpperCase() ===
        key
    ) {
      return true;
    }
    return false;
  });
}

function defaultManualBooks(): ManualBookSeries[] {
  return [
    {
      id: "mb_a",
      seriesCode: "FEE-BOOK-A",
      label: "Fee book A (front office)",
      isActive: true,
    },
    {
      id: "mb_b",
      seriesCode: "FEE-BOOK-B",
      label: "Fee book B (outdoor / camp)",
      isActive: true,
    },
  ];
}

function normalizeManualBook(
  b: Partial<ManualBookSeries>,
): ManualBookSeries {
  return {
    id: b.id ?? id("mb"),
    seriesCode: (b.seriesCode ?? "").trim().toUpperCase() || "FEE-BOOK",
    label: b.label ?? b.seriesCode ?? "Fee book",
    isActive: b.isActive !== false,
  };
}

function normalizeDayClose(d: Partial<DayCloseSession>): DayCloseSession {
  const denoms =
    Array.isArray(d.denominations) && d.denominations.length > 0
      ? CASH_DENOMINATIONS.map((meta) => {
          const found = d.denominations!.find(
            (x) => x.denomPaise === meta.denomPaise,
          );
          return {
            denomPaise: meta.denomPaise,
            qty: Math.max(0, Math.floor(found?.qty ?? 0)),
          };
        })
      : emptyDenominations();
  const physical =
    d.physicalCashPaise ?? denomPhysicalTotal(denoms);
  const systemCash = d.systemCashPaise ?? 0;
  const status: DayCloseStatus =
    d.status === "submitted" ||
    d.status === "approved" ||
    d.status === "rejected" ||
    d.status === "draft"
      ? d.status
      : "draft";
  return {
    id: d.id ?? id("dc"),
    closeDate: d.closeDate ?? new Date().toISOString().slice(0, 10),
    counterId: d.counterId ?? DEFAULT_COUNTER_ID,
    cashierName: d.cashierName ?? "Counter",
    status,
    voucherIds: Array.isArray(d.voucherIds) ? d.voucherIds : [],
    receiptCount: d.receiptCount ?? 0,
    totalPaise: d.totalPaise ?? 0,
    modeTotals: Array.isArray(d.modeTotals) ? d.modeTotals : [],
    systemCashPaise: systemCash,
    denominations: denoms,
    physicalCashPaise: physical,
    variancePaise: d.variancePaise ?? physical - systemCash,
    cashierRemarks: d.cashierRemarks ?? "",
    receiverName: d.receiverName ?? "",
    receiverRemarks: d.receiverRemarks ?? "",
    createdAt: d.createdAt ?? new Date().toISOString(),
    submittedAt: d.submittedAt ?? null,
    resolvedAt: d.resolvedAt ?? null,
  };
}

function normalizeCheque(c: Partial<ChequeInstrument>): ChequeInstrument {
  return {
    id: c.id ?? id("chq"),
    voucherId: c.voucherId ?? "",
    receiptNo: c.receiptNo ?? "",
    householdId: c.householdId ?? "",
    tenderIndex: c.tenderIndex ?? 0,
    chequeNo: c.chequeNo ?? "",
    bankName: c.bankName ?? "",
    chequeDate: c.chequeDate ?? "",
    amountPaise: c.amountPaise ?? 0,
    favouring: c.favouring ?? "BHB International School",
    status: c.status ?? "received",
    receivedAt: c.receivedAt ?? new Date().toISOString(),
    depositedAt: c.depositedAt ?? null,
    depositSlipNo: c.depositSlipNo ?? "",
    clearedAt: c.clearedAt ?? null,
    bouncedAt: c.bouncedAt ?? null,
    bounceReason: c.bounceReason ?? "",
  };
}

/** Backfill cheque instruments from older vouchers that only had tenders. */
function ensureChequesFromVouchers(
  vouchers: CollectionVoucher[],
  existing: ChequeInstrument[],
): ChequeInstrument[] {
  const byKey = new Set(
    existing.map((c) => `${c.voucherId}:${c.tenderIndex}`),
  );
  const extra: ChequeInstrument[] = [];
  for (const v of vouchers) {
    v.tenders.forEach((t, tenderIndex) => {
      if (t.mode !== "cheque") return;
      const key = `${v.id}:${tenderIndex}`;
      if (byKey.has(key)) return;
      const status: ChequeStatus = v.voidedAt
        ? "bounced"
        : t.realisation === "cleared"
          ? "cleared"
          : "received";
      extra.push(
        normalizeCheque({
          voucherId: v.id,
          receiptNo: v.receiptNo,
          householdId: v.householdId,
          tenderIndex,
          chequeNo: t.ref,
          bankName: t.bankName,
          chequeDate: t.instrumentDate,
          amountPaise: t.amountPaise,
          status,
          receivedAt: v.collectedAt,
          clearedAt: status === "cleared" ? v.collectedAt : null,
          bouncedAt: status === "bounced" ? v.voidedAt : null,
          bounceReason: status === "bounced" ? "Legacy void" : "",
        }),
      );
      byKey.add(key);
    });
  }
  return [...extra, ...existing];
}

function emptyFeesState(): FeesState {
  return {
    version: 1,
    vouchers: [],
    cheques: [],
    manualBooks: defaultManualBooks(),
    dayCloses: [],
    installmentPlans: [],
    planAllocations: [],
  };
}

export function loadFees(): FeesState {
  if (typeof window === "undefined") {
    return emptyFeesState();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return emptyFeesState();
    }
    const parsed = JSON.parse(raw) as FeesState;
    const vouchers = Array.isArray(parsed.vouchers)
      ? parsed.vouchers.map(normalizeVoucher)
      : [];
    const cheques = ensureChequesFromVouchers(
      vouchers,
      Array.isArray(parsed.cheques)
        ? parsed.cheques.map(normalizeCheque)
        : [],
    );
    const manualBooks =
      Array.isArray(parsed.manualBooks) && parsed.manualBooks.length > 0
        ? parsed.manualBooks.map(normalizeManualBook)
        : defaultManualBooks();
    const dayCloses = Array.isArray(parsed.dayCloses)
      ? parsed.dayCloses.map(normalizeDayClose)
      : [];
    const installmentPlans = Array.isArray(parsed.installmentPlans)
      ? parsed.installmentPlans.map(normalizeInstallmentPlan)
      : [];
    const planAllocations = Array.isArray(parsed.planAllocations)
      ? parsed.planAllocations.map(normalizePlanAllocation)
      : [];
    return {
      version: 1,
      vouchers,
      cheques,
      manualBooks,
      dayCloses,
      installmentPlans,
      planAllocations,
    };
  } catch {
    return emptyFeesState();
  }
}

export function saveFees(state: FeesState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeVoucherLine(l: Partial<VoucherLine>): VoucherLine {
  const kind: DueKind =
    l.kind === "special" ||
    l.kind === "store" ||
    l.kind === "transport" ||
    l.kind === "plan" ||
    l.kind === "academic"
      ? l.kind
      : l.dueKey?.startsWith("store:")
        ? "store"
        : l.dueKey?.startsWith("transport:")
          ? "transport"
          : l.dueKey?.startsWith("spec:")
            ? "special"
            : l.dueKey?.startsWith("plan:")
              ? "plan"
              : "academic";
  let storeItems = Array.isArray(l.storeItems) ? l.storeItems : [];
  let storeIssueNo = l.storeIssueNo ?? "";
  const transportDetail = l.transport ?? null;

  // Backfill item details for older store receipts from the issue register
  if (kind === "store" && storeItems.length === 0 && l.dueKey) {
    const parts = l.dueKey.split(":");
    const issueId = parts[2];
    if (issueId) {
      const iss = loadStore().issues.find((i) => i.id === issueId);
      if (iss) {
        storeIssueNo = storeIssueNo || iss.issueNo;
        storeItems = iss.lines.map((x) => ({
          sku: x.sku,
          name: x.name,
          sizeLabel: x.sizeLabel,
          qty: x.qty,
          unitPricePaise: x.unitPricePaise,
          linePaise: x.linePaise,
        }));
      }
    }
  }

  const concessionDetails = Array.isArray(l.concessionDetails)
    ? l.concessionDetails.map((c) => ({
        grantId: c.grantId ?? "",
        concessionId: c.concessionId ?? "",
        code: c.code ?? "",
        name: c.name ?? "Concession",
        kind: c.kind ?? "",
        rateLabel: c.rateLabel ?? "",
        siblingLabel: c.siblingLabel ?? "",
        amountPaise: c.amountPaise ?? 0,
      }))
    : [];

  return {
    dueKey: l.dueKey ?? "",
    studentId: l.studentId ?? "",
    studentName: l.studentName ?? "Student",
    label: l.label ?? "",
    kind,
    amountPaise: l.amountPaise ?? 0,
    billedPaise: l.billedPaise,
    concessionPaise: l.concessionPaise ?? 0,
    concessionDetails,
    ...(kind === "store"
      ? { storeIssueNo, storeItems }
      : {}),
    ...(kind === "transport" && transportDetail
      ? { transport: transportDetail }
      : {}),
  };
}

function normalizeVoucher(v: Partial<CollectionVoucher>): CollectionVoucher {
  const collectedAt = v.collectedAt ?? new Date().toISOString();
  const day = collectedAt.slice(0, 10);
  const source: CollectionSource =
    v.source === "payment_link"
      ? "payment_link"
      : v.source === "manual_book" ||
          (!!v.manualBookSeries && !!v.manualBookLeaf)
        ? "manual_book"
        : "counter";
  return {
    id: v.id ?? id("rcv"),
    receiptNo: v.receiptNo ?? "",
    schoolReceiptNo: v.schoolReceiptNo ?? "",
    source,
    manualBookSeries: v.manualBookSeries ?? "",
    manualBookLeaf: v.manualBookLeaf ?? "",
    householdId: v.householdId ?? "",
    academicYearCode: v.academicYearCode ?? DEFAULT_AY,
    collectionDate: v.collectionDate ?? day,
    transactionDate: v.transactionDate ?? v.collectionDate ?? day,
    transactionId: v.transactionId ?? "",
    collectedAt,
    cashierName: v.cashierName ?? "Counter",
    lines: (v.lines ?? []).map(normalizeVoucherLine),
    tenders: (v.tenders ?? []).map((t) => ({
      mode: t.mode,
      amountPaise: t.amountPaise,
      ref: t.ref ?? "",
      instrumentDate: t.instrumentDate ?? "",
      bankName: t.bankName ?? "",
      realisation:
        t.realisation ??
        (t.mode === "cheque" ? "subject_to_clearance" : "cleared"),
    })),
    totalPaise: v.totalPaise ?? 0,
    note: v.note ?? "",
    voidedAt: v.voidedAt ?? null,
    whatsappSentAt: v.whatsappSentAt ?? null,
  };
}

export function paidByDueKey(fees: FeesState): Map<string, number> {
  const map = new Map<string, number>();
  for (const v of fees.vouchers) {
    if (v.voidedAt) continue;
    for (const line of v.lines) {
      map.set(line.dueKey, (map.get(line.dueKey) ?? 0) + line.amountPaise);
    }
  }
  return mergePlanAllocationsIntoPaidMap(map, fees.planAllocations);
}

/** Preview how Fee Take will bill students on a fee group after structure edits. */
export function previewFeeStructureImpact(
  feeGroupId: string,
  masters?: MastersState,
  sis?: SisState,
): {
  studentCount: number;
  dueLineCount: number;
  totalBilledPaise: number;
  unassignedMatching: number;
} {
  const m = masters ?? loadMasters();
  const s = sis ?? loadSis();
  const group = m.feeGroups.find((g) => g.id === feeGroupId);
  if (!group) {
    return {
      studentCount: 0,
      dueLineCount: 0,
      totalBilledPaise: 0,
      unassignedMatching: 0,
    };
  }

  const onGroup = s.students.filter(
    (st) =>
      st.status === "active" &&
      st.feeGroupId === feeGroupId &&
      st.academicYearCode === (group.academicYearCode || DEFAULT_AY),
  );

  const classOk = (classId: string) =>
    group.classIds.length === 0 || group.classIds.includes(classId);

  const unassignedMatching = s.students.filter(
    (st) =>
      st.status === "active" &&
      !st.feeGroupId &&
      st.studentType === group.studentType &&
      classOk(st.classId) &&
      st.academicYearCode === (group.academicYearCode || DEFAULT_AY),
  ).length;

  let dueLineCount = 0;
  let totalBilledPaise = 0;
  for (const st of onGroup) {
    const lines = resolveStructureLinesForClass(m, feeGroupId, st.classId);
    dueLineCount += lines.length;
    totalBilledPaise += lines.reduce((sum, l) => sum + l.amountPaise, 0);
  }

  return {
    studentCount: onGroup.length,
    dueLineCount,
    totalBilledPaise,
    unassignedMatching,
  };
}

/**
 * Assign this fee group to active students that match type/class.
 * overwrite=false (default): only students with no fee group yet.
 * overwrite=true: also fix students on a different group for the same type/class.
 */
export function assignFeeGroupToMatchingStudents(
  feeGroupId: string,
  options?: { overwrite?: boolean },
):
  | { ok: true; assigned: number }
  | { ok: false; error: string } {
  const m = loadMasters();
  const group = m.feeGroups.find((g) => g.id === feeGroupId);
  if (!group) return { ok: false, error: "Fee group not found" };
  const sis = loadSis();
  const classOk = (classId: string) =>
    group.classIds.length === 0 || group.classIds.includes(classId);
  const overwrite = options?.overwrite ?? false;

  let assigned = 0;
  const students = sis.students.map((st) => {
    if (st.status !== "active") return st;
    if (st.studentType !== group.studentType) return st;
    if (!classOk(st.classId)) return st;
    if (st.academicYearCode !== (group.academicYearCode || DEFAULT_AY)) {
      return st;
    }
    if (st.feeGroupId === group.id) return st;
    if (st.feeGroupId && !overwrite) return st;
    assigned += 1;
    return { ...st, feeGroupId: group.id };
  });

  if (assigned === 0) {
    return {
      ok: false,
      error: overwrite
        ? "No students to sync for this group"
        : "No unmatched students for this group",
    };
  }
  saveSis({ ...sis, students });
  return { ok: true, assigned };
}

/**
 * Re-resolve fee group for every active student from type + class
 * (NEW / MID_YEAR → admission class groups, PROMOTE → continuing).
 */
export function syncAllStudentFeeGroups(options?: {
  overwrite?: boolean;
}): { updated: number; skipped: number } {
  const m = loadMasters();
  const sis = loadSis();
  const overwrite = options?.overwrite ?? true;
  let updated = 0;
  let skipped = 0;

  const students = sis.students.map((st) => {
    if (st.status !== "active") {
      skipped += 1;
      return st;
    }
    const nextId = resolveFeeGroupId(m, {
      studentType: st.studentType,
      classId: st.classId,
      academicYearCode: st.academicYearCode || DEFAULT_AY,
      preferPublished: true,
    });
    if (!nextId) {
      skipped += 1;
      return st;
    }
    if (st.feeGroupId === nextId) {
      skipped += 1;
      return st;
    }
    if (st.feeGroupId && !overwrite) {
      skipped += 1;
      return st;
    }
    updated += 1;
    return { ...st, feeGroupId: nextId };
  });

  if (updated > 0) {
    saveSis({ ...sis, students });
  }
  return { updated, skipped };
}

function concessionForHead(
  masters: MastersState,
  studentId: string,
  feeHeadId: string,
  billedPaise: number,
  asOf: string,
): { totalPaise: number; details: FeeConcessionDetail[] } {
  const grants = (masters.concessionGrants ?? []).filter(
    (g) =>
      g.studentId === studentId &&
      g.status === "approved" &&
      g.effectiveFrom <= asOf &&
      (g.effectiveTo == null || g.effectiveTo >= asOf),
  );
  const details: FeeConcessionDetail[] = [];
  let total = 0;
  for (const g of grants) {
    const rule = masters.concessions.find((c) => c.id === g.concessionId);
    if (!rule || !rule.isActive) continue;
    if (
      rule.feeHeadIds.length > 0 &&
      !rule.feeHeadIds.includes(feeHeadId)
    ) {
      continue;
    }

    let mode = rule.mode;
    let value = rule.value;
    let siblingLabel = "";
    if (rule.kind === "sibling") {
      const childNo = g.siblingChildNo ?? 2;
      const tier = resolveSiblingTierValue(rule, childNo);
      if (!tier) continue;
      mode = tier.mode;
      value = tier.value;
      siblingLabel = `${ordinalChildLabel(childNo)} child`;
    }
    const amount = concessionAmountFromValue(mode, value, billedPaise);
    if (amount <= 0) continue;
    const rateLabel =
      mode === "percent" ? `${value}%` : formatInr(value);
    details.push({
      grantId: g.id,
      concessionId: rule.id,
      code: rule.code,
      name: rule.name,
      kind: rule.kind,
      rateLabel,
      siblingLabel,
      amountPaise: amount,
    });
    total += amount;
  }
  const capped = Math.min(total, billedPaise);
  if (capped < total && details.length > 0) {
    // Scale last line if stacked concessions exceed billed
    let remain = capped;
    const scaled = details.map((d, i) => {
      if (i === details.length - 1) {
        return { ...d, amountPaise: Math.max(0, remain) };
      }
      const take = Math.min(d.amountPaise, remain);
      remain -= take;
      return { ...d, amountPaise: take };
    });
    return { totalPaise: capped, details: scaled.filter((d) => d.amountPaise > 0) };
  }
  return { totalPaise: capped, details };
}

export function formatConcessionDetailLine(d: FeeConcessionDetail): string {
  const bits = [d.name, d.rateLabel];
  if (d.siblingLabel) bits.push(d.siblingLabel);
  bits.push(`−${formatInr(d.amountPaise)}`);
  return bits.join(" · ");
}

/** Apr=0 … Mar=11 (Indian session order). */
export function sessionMonthIndex(calendarMonth: number): number {
  return (calendarMonth + 8) % 12;
}

/**
 * True when due month is after the running calendar month in session order
 * (e.g. in July, Aug–Mar are future; Apr–Jul are current/past).
 */
export function isAfterRunningSessionMonth(
  dueOn: string,
  asOf: string,
): boolean {
  const dueMonth = Number(dueOn.slice(5, 7));
  const asOfMonth = Number(asOf.slice(5, 7));
  if (
    !Number.isFinite(dueMonth) ||
    !Number.isFinite(asOfMonth) ||
    dueMonth < 1 ||
    dueMonth > 12 ||
    asOfMonth < 1 ||
    asOfMonth > 12
  ) {
    return dueOn > asOf;
  }
  return sessionMonthIndex(dueMonth) > sessionMonthIndex(asOfMonth);
}

/** True when this head/month line is fully cleared (shown as Paid, not selectable). */
export function isFeeDuePaid(d: FeeDueLine): boolean {
  return d.balancePaise <= 0 && d.paidPaise > 0;
}

export function openFeeDues(dues: FeeDueLine[]): FeeDueLine[] {
  return dues.filter((d) => d.balancePaise > 0);
}

/** Build dues for one student from masters + prior payments. */
export function computeStudentDues(
  student: SisStudent,
  masters: MastersState,
  fees: FeesState,
  options?: {
    asOf?: string;
    includeFuture?: boolean;
    /** Keep fully paid heads/months on the card (green, non-selectable). Default true. */
    includePaid?: boolean;
  },
): FeeDueLine[] {
  if (student.status !== "active") return [];
  const asOf = options?.asOf ?? new Date().toISOString().slice(0, 10);
  const includeFuture = options?.includeFuture ?? true;
  const includePaid = options?.includePaid ?? true;
  const paidMap = paidByDueKey(fees);
  const lines: FeeDueLine[] = [];
  const midYearPolicy = normalizeMidYearFeePolicy(masters.midYearFeePolicy);

  const headName = (hid: string) =>
    masters.feeHeads.find((h) => h.id === hid)?.nameEn ?? "Fee";

  if (student.feeGroupId) {
    const structure = resolveStructureLinesForClass(
      masters,
      student.feeGroupId,
      student.classId,
    );

    for (const sl of structure) {
      const inst = sl.installmentId
        ? masters.installments.find((i) => i.id === sl.installmentId)
        : null;
      if (sl.installmentId && inst && !inst.isActive) continue;
      const dueOn = inst?.dueOn ?? `${DEFAULT_AY.slice(0, 4)}-04-01`;
      if (!includeFuture && isAfterRunningSessionMonth(dueOn, asOf)) continue;

      const head = masters.feeHeads.find((h) => h.id === sl.feeHeadId);
      if (
        !shouldBillMidYearLine({
          studentType: student.studentType,
          joinedOn: student.joinedOn,
          academicYearCode: student.academicYearCode || DEFAULT_AY,
          dueOn,
          feeHead: head,
          policy: midYearPolicy,
        })
      ) {
        continue;
      }

      const dueKey = `acad:${student.id}:${sl.id}`;
      const billed = sl.amountPaise;
      const concession = concessionForHead(
        masters,
        student.id,
        sl.feeHeadId,
        billed,
        asOf,
      );
      const paid = paidMap.get(dueKey) ?? 0;
      const balance = Math.max(0, billed - concession.totalPaise - paid);
      if (balance <= 0) {
        if (!(includePaid && paid > 0)) continue;
      }

      const instLabel = inst?.label ?? inst?.code ?? "Session";
      lines.push({
        dueKey,
        kind: "academic",
        studentId: student.id,
        feeHeadId: sl.feeHeadId,
        feeHeadName: headName(sl.feeHeadId),
        installmentId: sl.installmentId,
        installmentLabel: instLabel,
        specialFeeId: null,
        structureLineId: sl.id,
        storeIssueId: null,
        storeIssueNo: "",
        storeItems: [],
        transport: null,
        dueOn,
        billedPaise: billed,
        concessionPaise: concession.totalPaise,
        concessionDetails: concession.details,
        paidPaise: paid,
        balancePaise: balance,
        label: `${headName(sl.feeHeadId)} · ${instLabel}`,
      });
    }
  }

  const transport = loadTransport();
  for (const td of computeTransportPeriodDues(student.id, {
    academicYearCode: student.academicYearCode || DEFAULT_AY,
    asOf,
    includeFuture,
    state: transport,
  })) {
    if (
      !shouldBillMidYearLine({
        studentType: student.studentType,
        joinedOn: student.joinedOn,
        academicYearCode: student.academicYearCode || DEFAULT_AY,
        dueOn: td.dueOn,
        policy: midYearPolicy,
        isTransportDue: true,
      })
    ) {
      continue;
    }
    const paid = paidMap.get(td.dueKey) ?? 0;
    const balance = Math.max(0, td.amountPaise - paid);
    if (balance <= 0) {
      if (!(includePaid && paid > 0)) continue;
    }
    if (!includeFuture && isAfterRunningSessionMonth(td.dueOn, asOf)) continue;

    lines.push({
      dueKey: td.dueKey,
      kind: "transport",
      studentId: student.id,
      feeHeadId: "",
      feeHeadName: "Transport",
      installmentId: null,
      installmentLabel: td.periodLabel,
      specialFeeId: null,
      structureLineId: null,
      storeIssueId: null,
      storeIssueNo: "",
      storeItems: [],
      transport: {
        assignmentId: td.assignmentId,
        routeCode: td.routeCode,
        routeName: td.routeName,
        busNo: td.busNo,
        vehicleReg: td.vehicleReg,
        stopName: td.stopName,
        periodLabel: td.periodLabel,
      },
      dueOn: td.dueOn,
      billedPaise: td.amountPaise,
      concessionPaise: 0,
      concessionDetails: [],
      paidPaise: paid,
      balancePaise: balance,
      label: `Transport · ${td.periodLabel} · ${td.routeCode}`,
    });
  }

  for (const sf of masters.specialFees.filter((f) => f.isActive)) {
    if (sf.academicYearCode !== (student.academicYearCode || DEFAULT_AY)) {
      continue;
    }
    const assigns = masters.specialFeeAssignments.filter(
      (a) => a.specialFeeId === sf.id,
    );
    const covered = assigns.some((a) =>
      resolveSpecialFeeAssignees(masters, a).some((s) => s.id === student.id),
    );
    if (!covered) continue;
    if (!includeFuture && isAfterRunningSessionMonth(sf.dueOn, asOf)) continue;

    const dueKey = `spec:${student.id}:${sf.id}`;
    const billed = sf.amountPaise;
    const concession = concessionForHead(
      masters,
      student.id,
      sf.feeHeadId,
      billed,
      asOf,
    );
    const paid = paidMap.get(dueKey) ?? 0;
    const balance = Math.max(0, billed - concession.totalPaise - paid);
    if (balance <= 0) {
      if (!(includePaid && paid > 0)) continue;
    }

    lines.push({
      dueKey,
      kind: "special",
      studentId: student.id,
      feeHeadId: sf.feeHeadId,
      feeHeadName: headName(sf.feeHeadId),
      installmentId: null,
      installmentLabel: "Special",
      specialFeeId: sf.id,
      structureLineId: null,
      storeIssueId: null,
      storeIssueNo: "",
      storeItems: [],
      transport: null,
      dueOn: sf.dueOn,
      billedPaise: billed,
      concessionPaise: concession.totalPaise,
      concessionDetails: concession.details,
      paidPaise: paid,
      balancePaise: balance,
      label: `${sf.name} · Special`,
    });
  }

  const store = loadStore();
  for (const iss of listStoreIssuesForStudent(student.id, store)) {
    if (iss.academicYearCode !== (student.academicYearCode || DEFAULT_AY)) {
      continue;
    }
    if (!includeFuture && isAfterRunningSessionMonth(iss.issuedOn, asOf)) {
      continue;
    }
    const dueKey = storeDueKey(student.id, iss.id);
    const billed = iss.totalPaise;
    const paid = paidMap.get(dueKey) ?? 0;
    const balance = Math.max(0, billed - paid);
    if (balance <= 0) {
      if (!(includePaid && paid > 0)) continue;
    }
    const itemCount = iss.lines.reduce((s, l) => s + l.qty, 0);
    lines.push({
      dueKey,
      kind: "store",
      studentId: student.id,
      feeHeadId: "",
      feeHeadName: "Store",
      installmentId: null,
      installmentLabel: "Store",
      specialFeeId: null,
      structureLineId: null,
      storeIssueId: iss.id,
      storeIssueNo: iss.issueNo,
      storeItems: iss.lines.map((l: StoreIssueLine) => ({
        sku: l.sku,
        name: l.name,
        sizeLabel: l.sizeLabel,
        qty: l.qty,
        unitPricePaise: l.unitPricePaise,
        linePaise: l.linePaise,
      })),
      transport: null,
      dueOn: iss.issuedOn,
      billedPaise: billed,
      concessionPaise: 0,
      concessionDetails: [],
      paidPaise: paid,
      balancePaise: balance,
      label: `Store · ${iss.issueNo} · ${itemCount} item${itemCount === 1 ? "" : "s"}`,
    });
  }

  const paidMapRaw = new Map<string, number>();
  for (const v of fees.vouchers) {
    if (v.voidedAt) continue;
    for (const line of v.lines) {
      paidMapRaw.set(
        line.dueKey,
        (paidMapRaw.get(line.dueKey) ?? 0) + line.amountPaise,
      );
    }
  }

  const plan = activePlanForStudent(fees.installmentPlans, student.id);
  if (plan) {
    const covered = coveredDueKeySet(plan);
    const filtered = lines.filter((l) => !covered.has(l.dueKey));
    const slices = planSliceDues(plan, paidMapRaw, {
      includePaid,
      asOf,
      includeFuture,
    });
    return [...filtered, ...slices].sort((a, b) =>
      a.dueOn === b.dueOn
        ? a.label.localeCompare(b.label)
        : a.dueOn.localeCompare(b.dueOn),
    );
  }

  return lines.sort((a, b) =>
    a.dueOn === b.dueOn
      ? a.label.localeCompare(b.label)
      : a.dueOn.localeCompare(b.dueOn),
  );
}

export function computeHouseholdDues(
  householdId: string,
  sis: SisState,
  masters: MastersState,
  fees: FeesState,
  options?: {
    asOf?: string;
    includeFuture?: boolean;
    includePaid?: boolean;
  },
): { student: SisStudent; dues: FeeDueLine[] }[] {
  const members = sis.students.filter(
    (s) => s.householdId === householdId && s.status === "active",
  );
  return members.map((student) => ({
    student,
    dues: computeStudentDues(student, masters, fees, options),
  }));
}

/** One calendar month of open dues (YYYY-MM), for head-level selection UI. */
export type DueMonthGroup = {
  monthKey: string;
  monthLabel: string;
  earliestDueOn: string;
  dues: FeeDueLine[];
  totalPaise: number;
};

const CALENDAR_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function monthLabelFromKey(monthKey: string): string {
  const [ys, ms] = monthKey.split("-");
  const year = Number(ys);
  const month = Number(ms);
  if (!Number.isFinite(year) || month < 1 || month > 12) return monthKey;
  return `${CALENDAR_MONTH_NAMES[month - 1]} ${year}`;
}

/** Group open dues by due month (session order). Each line stays one fee head. */
export function groupDuesByMonth(dues: FeeDueLine[]): DueMonthGroup[] {
  const buckets = new Map<string, FeeDueLine[]>();
  for (const d of dues) {
    const key = d.dueOn.slice(0, 7) || "unknown";
    const list = buckets.get(key);
    if (list) list.push(d);
    else buckets.set(key, [d]);
  }

  const groups: DueMonthGroup[] = [...buckets.entries()].map(
    ([monthKey, list]) => {
      const sorted = [...list].sort((a, b) => {
        const aPaid = a.balancePaise <= 0 && a.paidPaise > 0 ? 1 : 0;
        const bPaid = b.balancePaise <= 0 && b.paidPaise > 0 ? 1 : 0;
        if (aPaid !== bPaid) return aPaid - bPaid;
        const kindRank = (k: FeeDueLine["kind"]) =>
          k === "academic"
            ? 0
            : k === "transport"
              ? 1
              : k === "special"
                ? 2
                : 3;
        const kr = kindRank(a.kind) - kindRank(b.kind);
        if (kr !== 0) return kr;
        return a.feeHeadName.localeCompare(b.feeHeadName) ||
          a.label.localeCompare(b.label);
      });
      return {
        monthKey,
        monthLabel: monthLabelFromKey(monthKey),
        earliestDueOn: sorted.reduce(
          (min, d) => (d.dueOn < min ? d.dueOn : min),
          sorted[0]?.dueOn ?? "",
        ),
        dues: sorted,
        totalPaise: sorted.reduce((s, d) => s + d.balancePaise, 0),
      };
    },
  );

  return groups.sort((a, b) => {
    const am = Number(a.monthKey.slice(5, 7));
    const bm = Number(b.monthKey.slice(5, 7));
    if (
      Number.isFinite(am) &&
      Number.isFinite(bm) &&
      am >= 1 &&
      am <= 12 &&
      bm >= 1 &&
      bm <= 12
    ) {
      const ai = sessionMonthIndex(am);
      const bi = sessionMonthIndex(bm);
      if (ai !== bi) return ai - bi;
    }
    return a.monthKey.localeCompare(b.monthKey);
  });
}

export function nextReceiptNo(
  fees: FeesState,
  ayCode = DEFAULT_AY,
): string {
  const prefix = `REC/${ayCode}/`;
  let max = 0;
  for (const v of fees.vouchers) {
    if (!v.receiptNo.startsWith(prefix)) continue;
    const n = Number(v.receiptNo.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export function collectPayment(input: {
  householdId: string;
  lines: VoucherLine[];
  tenders: VoucherTender[];
  cashierName: string;
  note?: string;
  academicYearCode?: string;
  collectionDate: string;
  transactionDate: string;
  transactionId?: string;
  schoolReceiptNo?: string;
  source?: CollectionSource;
  manualBookSeries?: string;
  manualBookLeaf?: string;
  /** Skip backdate / duplicate soft checks when already confirmed by UI */
  allowBackdate?: boolean;
  allowDuplicate?: boolean;
}):
  | { ok: true; voucher: CollectionVoucher }
  | {
      ok: false;
      error: string;
      code?: "backdate" | "duplicate" | "manual_no" | "day_closed";
    } {
  const total = input.lines.reduce((s, l) => s + l.amountPaise, 0);
  const activeTenders = input.tenders.filter((t) => t.amountPaise > 0);
  const tenderSum = activeTenders.reduce((s, t) => s + t.amountPaise, 0);
  const source: CollectionSource = input.source ?? "counter";
  const series = (input.manualBookSeries ?? "").trim().toUpperCase();
  const leaf = (input.manualBookLeaf ?? "").trim();
  const manualRef =
    source === "manual_book"
      ? formatManualBookRef(series, leaf)
      : input.schoolReceiptNo?.trim() ?? "";

  if (input.lines.length === 0) {
    return { ok: false, error: "Select at least one due line" };
  }
  if (total <= 0) {
    return { ok: false, error: "Collection amount must be positive" };
  }
  if (!input.collectionDate) {
    return { ok: false, error: "Collection date is required" };
  }
  if (!input.transactionDate) {
    return { ok: false, error: "Transaction date is required" };
  }
  if (tenderSum !== total) {
    return {
      ok: false,
      error: `Tenders (${formatInr(tenderSum)}) must equal dues (${formatInr(total)})`,
    };
  }
  for (const t of activeTenders) {
    const meta = TENDER_MODES.find((m) => m.value === t.mode);
    if (meta?.needsRef && !t.ref.trim()) {
      return {
        ok: false,
        error: `${meta.label}: enter ${meta.refLabel.toLowerCase()}`,
      };
    }
    if (meta?.needsInstrumentDate && !t.instrumentDate) {
      return {
        ok: false,
        error: `${meta.label}: enter instrument / txn date`,
      };
    }
  }

  const fees = loadFees();

  if (isCollectionDateLocked(input.collectionDate, fees)) {
    return {
      ok: false,
      error: `Day ${input.collectionDate} is closed — reopen day-close (reject) or choose another date`,
      code: "day_closed",
    };
  }

  if (manualRef && isSchoolReceiptNoTaken(manualRef, fees)) {
    return {
      ok: false,
      error: `School / paper receipt no. "${manualRef}" is already used on another receipt`,
      code: "manual_no",
    };
  }

  if (source === "manual_book") {
    if (!series || !leaf) {
      return {
        ok: false,
        error: "Enter manual book series and receipt number",
        code: "manual_no",
      };
    }
    if (!/^\d+$/.test(leaf)) {
      return {
        ok: false,
        error: "Manual receipt # must be numeric",
        code: "manual_no",
      };
    }

    const today = new Date();
    const paper = new Date(`${input.collectionDate}T12:00:00`);
    const diffDays = Math.floor(
      (today.getTime() - paper.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (diffDays > MANUAL_BACKDATE_DAYS && !input.allowBackdate) {
      return {
        ok: false,
        error: `Paper date is ${diffDays} days old (limit ${MANUAL_BACKDATE_DAYS}). Confirm to post anyway.`,
        code: "backdate",
      };
    }

    if (!input.allowDuplicate) {
      const studentIds = new Set(input.lines.map((l) => l.studentId));
      const dup = fees.vouchers.find(
        (v) =>
          !v.voidedAt &&
          v.collectionDate === input.collectionDate &&
          v.totalPaise === total &&
          v.lines.some((l) => studentIds.has(l.studentId)),
      );
      if (dup) {
        return {
          ok: false,
          error: `Similar posting exists (${dup.receiptNo} · ${formatInr(dup.totalPaise)} on ${dup.collectionDate}). Confirm if not a duplicate.`,
          code: "duplicate",
        };
      }
    }
  }

  const voucher: CollectionVoucher = {
    id: id("rcv"),
    receiptNo: nextReceiptNo(fees, input.academicYearCode ?? DEFAULT_AY),
    schoolReceiptNo: manualRef,
    source,
    manualBookSeries: source === "manual_book" ? series : "",
    manualBookLeaf: source === "manual_book" ? leaf : "",
    householdId: input.householdId,
    academicYearCode: input.academicYearCode ?? DEFAULT_AY,
    collectionDate: input.collectionDate,
    transactionDate: input.transactionDate,
    transactionId: input.transactionId?.trim() ?? "",
    collectedAt: new Date().toISOString(),
    cashierName: input.cashierName || "Counter",
    lines: input.lines,
    tenders: activeTenders.map((t) => ({
      ...t,
      ref: t.ref.trim(),
      bankName: t.bankName.trim(),
      realisation:
        t.mode === "cheque"
          ? (t.realisation ?? "subject_to_clearance")
          : "cleared",
    })),
    totalPaise: total,
    note:
      source === "manual_book"
        ? [input.note?.trim(), `Posted from manual ${manualRef}`]
            .filter(Boolean)
            .join(" · ")
        : input.note?.trim() ?? "",
    voidedAt: null,
    whatsappSentAt: null,
  };

  const newCheques: ChequeInstrument[] = voucher.tenders
    .map((t, tenderIndex) =>
      t.mode === "cheque"
        ? normalizeCheque({
            voucherId: voucher.id,
            receiptNo: voucher.receiptNo,
            householdId: voucher.householdId,
            tenderIndex,
            chequeNo: t.ref,
            bankName: t.bankName,
            chequeDate: t.instrumentDate,
            amountPaise: t.amountPaise,
            status: "received",
            receivedAt: voucher.collectedAt,
          })
        : null,
    )
    .filter((c): c is ChequeInstrument => c != null);

  const finalized = finalizePlansAfterCollection(fees, voucher, input.lines);

  saveFees({
    ...fees,
    vouchers: [voucher, ...fees.vouchers],
    cheques: [...newCheques, ...fees.cheques],
    installmentPlans: finalized.installmentPlans,
    planAllocations: finalized.planAllocations,
  });
  return { ok: true, voucher };
}

function finalizePlansAfterCollection(
  fees: FeesState,
  voucher: CollectionVoucher,
  lines: VoucherLine[],
): Pick<FeesState, "installmentPlans" | "planAllocations"> {
  const planPay = new Map<string, number>();
  for (const line of lines) {
    if (line.kind !== "plan" && !line.dueKey.startsWith("plan:")) continue;
    const parts = line.dueKey.split(":");
    const planId = parts[1];
    if (!planId) continue;
    planPay.set(planId, (planPay.get(planId) ?? 0) + line.amountPaise);
  }
  if (planPay.size === 0) {
    return {
      installmentPlans: fees.installmentPlans ?? [],
      planAllocations: fees.planAllocations ?? [],
    };
  }

  const allocByDue = new Map<string, number>();
  for (const a of fees.planAllocations ?? []) {
    allocByDue.set(a.dueKey, (allocByDue.get(a.dueKey) ?? 0) + a.amountPaise);
  }

  const newAllocs: PlanAllocation[] = [];
  let plans = [...(fees.installmentPlans ?? [])];

  for (const [planId, amount] of planPay) {
    const plan = plans.find((p) => p.id === planId && p.status === "active");
    if (!plan) continue;
    newAllocs.push(
      ...allocatePlanPayment({
        plan,
        amountPaise: amount,
        alreadyAllocatedByDueKey: allocByDue,
        voucherId: voucher.id,
      }),
    );
  }

  const paidMap = paidByDueKey({
    ...fees,
    vouchers: [voucher, ...fees.vouchers],
    planAllocations: [...newAllocs, ...(fees.planAllocations ?? [])],
  });

  plans = plans.map((p) => {
    if (p.status !== "active") return p;
    if (!isPlanFullyPaid(p, paidMap)) return p;
    return {
      ...p,
      status: "completed" as const,
      completedAt: new Date().toISOString(),
    };
  });

  return {
    installmentPlans: plans,
    planAllocations: [...newAllocs, ...(fees.planAllocations ?? [])],
  };
}

export function listManualBooks(fees?: FeesState): ManualBookSeries[] {
  const f = fees ?? loadFees();
  return f.manualBooks.filter((b) => b.isActive);
}

export function listManualPostings(fees?: FeesState): CollectionVoucher[] {
  const f = fees ?? loadFees();
  return f.vouchers
    .filter((v) => v.source === "manual_book")
    .slice()
    .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
}

export function voidVoucher(voucherId: string): boolean {
  const fees = loadFees();
  const voucher = fees.vouchers.find((v) => v.id === voucherId);
  if (!voucher || voucher.voidedAt) return false;
  const now = new Date().toISOString();
  const nextVouchers = fees.vouchers.map((v) =>
    v.id === voucherId ? { ...v, voidedAt: now } : v,
  );
  const nextCheques = fees.cheques.map((c) => {
    if (c.voucherId !== voucherId) return c;
    if (c.status === "cleared" || c.status === "bounced") return c;
    return {
      ...c,
      status: "bounced" as const,
      bouncedAt: now,
      bounceReason: c.bounceReason || "Receipt voided",
    };
  });
  const nextAllocations = (fees.planAllocations ?? []).filter(
    (a) => a.voucherId !== voucherId,
  );
  const paidMap = paidByDueKey({
    ...fees,
    vouchers: nextVouchers,
    planAllocations: nextAllocations,
  });
  const nextPlans = (fees.installmentPlans ?? []).map((p) => {
    if (p.status === "completed" && !isPlanFullyPaid(p, paidMap)) {
      return { ...p, status: "active" as const, completedAt: null };
    }
    return p;
  });
  saveFees({
    ...fees,
    vouchers: nextVouchers,
    cheques: nextCheques,
    planAllocations: nextAllocations,
    installmentPlans: nextPlans,
  });
  return true;
}

/** 10-digit IN mobile → WhatsApp E.164 without plus (e.g. 9198…). */
export function toWhatsAppE164(
  mobile: string,
  countryCode = "91",
): string | null {
  const digits = normalizeMobile(mobile);
  if (!isValidMobile(digits)) return null;
  return `${countryCode}${digits}`;
}

function formatReceiptDateShort(isoDate: string): string {
  if (!isoDate) return "—";
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Plain-text fee receipt for WhatsApp (parent-friendly). */
export function composeWhatsAppFeeReceipt(
  voucher: CollectionVoucher,
  sis?: SisState | null,
  masters?: MastersState | null,
): string {
  const s = sis ?? loadSis();
  const m = masters ?? loadMasters();
  const hh = householdOf(s, voucher.householdId);
  const lines: string[] = [
    `*${TENANT.shortName}*`,
    "Fee payment receipt",
    "",
    `Receipt: ${voucher.receiptNo}`,
  ];
  if (voucher.schoolReceiptNo) {
    lines.push(`School book: ${voucher.schoolReceiptNo}`);
  }
  lines.push(`Date: ${formatReceiptDateShort(voucher.collectionDate)}`);
  if (hh?.guardianName) {
    lines.push(`Guardian: ${hh.guardianName}`);
  }
  lines.push("");

  const byStudent = new Map<
    string,
    { name: string; classLabel: string; items: string[] }
  >();
  for (const line of voucher.lines) {
    let row = byStudent.get(line.studentId);
    if (!row) {
      const st = s.students.find((x) => x.id === line.studentId);
      const className =
        m.classes.find((c) => c.id === st?.classId)?.name ?? "";
      const sectionName =
        m.sections.find((sec) => sec.id === st?.sectionId)?.name ?? "";
      const classLabel = sectionName
        ? `${className}-${sectionName}`
        : className || "—";
      row = {
        name: st?.fullName || line.studentName,
        classLabel,
        items: [],
      };
      byStudent.set(line.studentId, row);
    }
    row.items.push(`  • ${line.label}: ${formatInr(line.amountPaise)}`);
    if (line.billedPaise && line.concessionPaise) {
      row.items.push(
        `     Billed ${formatInr(line.billedPaise)} − discount ${formatInr(line.concessionPaise)}`,
      );
    }
    if (line.concessionDetails?.length) {
      for (const c of line.concessionDetails) {
        row.items.push(`     – Discount · ${formatConcessionDetailLine(c)}`);
      }
    }
    if (line.kind === "store" && line.storeItems?.length) {
      for (const it of line.storeItems) {
        row.items.push(
          `     – ${it.sku} · ${it.name}${
            it.sizeLabel ? ` (${it.sizeLabel})` : ""
          } ×${it.qty} @ ${formatInr(it.unitPricePaise)} = ${formatInr(it.linePaise)}`,
        );
      }
    }
    if (line.kind === "transport" && line.transport) {
      const t = line.transport;
      row.items.push(
        `     – ${t.routeCode} · ${t.busNo} · Stop ${t.stopName} · ${t.periodLabel}`,
      );
    }
  }

  lines.push("Students / fees:");
  for (const row of byStudent.values()) {
    lines.push(`*${row.name}* (${row.classLabel})`);
    lines.push(...row.items);
  }

  lines.push("");
  const discountTotal = voucher.lines.reduce(
    (s, l) => s + (l.concessionPaise ?? 0),
    0,
  );
  if (discountTotal > 0) {
    lines.push(`Discount applied: −${formatInr(discountTotal)}`);
  }
  lines.push(`*Amount paid: ${formatInr(voucher.totalPaise)}*`);
  lines.push(
    `Payment: ${voucher.tenders
      .map(
        (t) =>
          `${tenderModeLabel(t.mode)} ${formatInr(t.amountPaise)}${
            t.ref ? ` (${t.ref})` : ""
          }`,
      )
      .join(" + ")}`,
  );
  if (voucherHasUnclearedCheque(voucher)) {
    lines.push("Note: Cheque realisation subject to bank clearance.");
  }
  if (voucher.voidedAt) {
    lines.push("⚠ This receipt has been VOIDED.");
  }
  lines.push("");
  lines.push(`Thank you — ${TENANT.city}`);
  lines.push("Please keep this message for your records.");
  return lines.join("\n");
}

export function whatsAppFeeReceiptUrl(
  mobile: string,
  message: string,
): string | null {
  const e164 = toWhatsAppE164(mobile);
  if (!e164) return null;
  return `https://wa.me/${e164}?text=${encodeURIComponent(message)}`;
}

export function markWhatsAppReceiptSent(voucherId: string): boolean {
  const fees = loadFees();
  const voucher = fees.vouchers.find((v) => v.id === voucherId);
  if (!voucher) return false;
  const now = new Date().toISOString();
  saveFees({
    ...fees,
    vouchers: fees.vouchers.map((v) =>
      v.id === voucherId ? { ...v, whatsappSentAt: now } : v,
    ),
  });
  return true;
}

/**
 * Deliver fee receipt on WhatsApp: PDF attachment (when share supported) +
 * full receipt text + digital receipt link. Demo without Business API.
 */
export async function deliverWhatsAppFeeReceipt(input: {
  voucher: CollectionVoucher;
  mobile?: string;
  sis?: SisState | null;
  masters?: MastersState | null;
  householdHint?: string;
  receiptElement?: HTMLElement | null;
  markSent?: boolean;
}): Promise<
  | {
      ok: true;
      mobile: string;
      mode: "share_file" | "wa_link";
      pdfDownloaded: boolean;
      receiptUrl: string;
    }
  | { ok: false; error: string }
> {
  const {
    buildReceiptShareUrl,
    buildReceiptSharePayload,
    captureReceiptPdfFile,
    composeWhatsAppFeeReceiptMessage,
    downloadReceiptFile,
    shareReceiptToWhatsApp,
  } = await import("@/lib/receiptShare");

  if (input.voucher.voidedAt) {
    return { ok: false, error: "Cannot send a voided receipt" };
  }
  const s = input.sis ?? loadSis();
  const hh = householdOf(s, input.voucher.householdId);
  const mobile =
    normalizeMobile(input.mobile ?? "") || householdWhatsApp(hh);
  if (!isValidMobile(mobile)) {
    return {
      ok: false,
      error: "Add a valid 10-digit WhatsApp number for this household",
    };
  }

  const hint =
    input.householdHint ?? hh?.guardianName ?? "";
  const payload = buildReceiptSharePayload(
    input.voucher,
    s,
    input.masters,
    hint,
  );
  const receiptUrl = buildReceiptShareUrl(payload);
  /** Keep wa.me usable — very long hashes may truncate on some clients */
  const receiptUrlForChat =
    receiptUrl.length <= 2200 ? receiptUrl : `${window.location.origin}/receipt/share`;

  let pdfFile: File | null = null;
  let pdfDownloaded = false;
  const el =
    input.receiptElement ??
    (typeof document !== "undefined"
      ? document.getElementById(`receipt-${input.voucher.id}`)
      : null);

  if (el instanceof HTMLElement) {
    try {
      pdfFile = await captureReceiptPdfFile(el, input.voucher.receiptNo);
    } catch {
      pdfFile = null;
    }
  }

  const messageBase = composeWhatsAppFeeReceiptMessage(input.voucher, {
    students: payload.students,
    householdHint: hint,
    receiptUrl:
      receiptUrlForChat === receiptUrl ? receiptUrl : undefined,
    pdfFileName: pdfFile?.name,
  });
  const message =
    receiptUrlForChat === receiptUrl
      ? messageBase
      : `${messageBase}\n\nDigital receipt link was copied to clipboard — paste it into this chat so the parent can open the full receipt.`;

  if (
    receiptUrlForChat !== receiptUrl &&
    typeof navigator !== "undefined" &&
    navigator.clipboard?.writeText
  ) {
    void navigator.clipboard.writeText(receiptUrl).catch(() => undefined);
  }

  if (pdfFile) {
    const shared = await shareReceiptToWhatsApp({
      file: pdfFile,
      text: message,
      title: `Fee receipt ${input.voucher.receiptNo}`,
    });
    if (shared) {
      if (input.markSent !== false) {
        markWhatsAppReceiptSent(input.voucher.id);
      }
      return {
        ok: true,
        mobile,
        mode: "share_file",
        pdfDownloaded: false,
        receiptUrl,
      };
    }
    // Desktop / share cancelled — still download PDF so cashier can attach
    downloadReceiptFile(pdfFile);
    pdfDownloaded = true;
  }

  const url = whatsAppFeeReceiptUrl(mobile, message);
  if (!url) {
    return { ok: false, error: "Could not build WhatsApp link" };
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
  if (input.markSent !== false) {
    markWhatsAppReceiptSent(input.voucher.id);
  }
  return {
    ok: true,
    mobile,
    mode: "wa_link",
    pdfDownloaded,
    receiptUrl,
  };
}

/** @deprecated Prefer deliverWhatsAppFeeReceipt — text-only open */
export function openWhatsAppFeeReceipt(input: {
  voucher: CollectionVoucher;
  mobile?: string;
  sis?: SisState | null;
  masters?: MastersState | null;
  markSent?: boolean;
}):
  | { ok: true; url: string; mobile: string }
  | { ok: false; error: string } {
  if (input.voucher.voidedAt) {
    return { ok: false, error: "Cannot send a voided receipt" };
  }
  const s = input.sis ?? loadSis();
  const hh = householdOf(s, input.voucher.householdId);
  const mobile =
    normalizeMobile(input.mobile ?? "") || householdWhatsApp(hh);
  if (!isValidMobile(mobile)) {
    return {
      ok: false,
      error: "Add a valid 10-digit WhatsApp number for this household",
    };
  }
  const message = composeWhatsAppFeeReceipt(
    input.voucher,
    s,
    input.masters,
  );
  const url = whatsAppFeeReceiptUrl(mobile, message);
  if (!url) {
    return { ok: false, error: "Could not build WhatsApp link" };
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
  if (input.markSent !== false) {
    markWhatsAppReceiptSent(input.voucher.id);
  }
  return { ok: true, url, mobile };
}

function syncVoucherTenderRealisation(
  voucher: CollectionVoucher,
  tenderIndex: number,
  realisation: ChequeRealisation,
): CollectionVoucher {
  return {
    ...voucher,
    tenders: voucher.tenders.map((t, i) =>
      i === tenderIndex ? { ...t, realisation } : t,
    ),
  };
}

export function listCheques(
  fees?: FeesState,
  filter?: ChequeStatus | "open" | "all",
): ChequeInstrument[] {
  const f = fees ?? loadFees();
  let list = f.cheques.slice();
  if (filter === "open") {
    list = list.filter(
      (c) => c.status === "received" || c.status === "deposited",
    );
  } else if (filter && filter !== "all") {
    list = list.filter((c) => c.status === filter);
  }
  return list.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export function chequeStats(fees?: FeesState): {
  receivedCount: number;
  receivedPaise: number;
  depositedCount: number;
  depositedPaise: number;
  clearedCount: number;
  clearedPaise: number;
  bouncedCount: number;
  bouncedPaise: number;
} {
  const f = fees ?? loadFees();
  const sum = (status: ChequeStatus) => {
    const rows = f.cheques.filter((c) => c.status === status);
    return {
      count: rows.length,
      paise: rows.reduce((s, c) => s + c.amountPaise, 0),
    };
  };
  const received = sum("received");
  const deposited = sum("deposited");
  const cleared = sum("cleared");
  const bounced = sum("bounced");
  return {
    receivedCount: received.count,
    receivedPaise: received.paise,
    depositedCount: deposited.count,
    depositedPaise: deposited.paise,
    clearedCount: cleared.count,
    clearedPaise: cleared.paise,
    bouncedCount: bounced.count,
    bouncedPaise: bounced.paise,
  };
}

export function depositCheque(
  chequeId: string,
  input: { depositSlipNo: string; depositedAt?: string },
): { ok: true; cheque: ChequeInstrument } | { ok: false; error: string } {
  const slip = input.depositSlipNo.trim();
  if (!slip) return { ok: false, error: "Enter pay-in / deposit slip no." };
  const fees = loadFees();
  const cheque = fees.cheques.find((c) => c.id === chequeId);
  if (!cheque) return { ok: false, error: "Cheque not found" };
  if (cheque.status !== "received") {
    return { ok: false, error: "Only in-hand cheques can be deposited" };
  }
  const voucher = fees.vouchers.find((v) => v.id === cheque.voucherId);
  if (!voucher || voucher.voidedAt) {
    return { ok: false, error: "Linked receipt is missing or voided" };
  }
  const now = input.depositedAt ?? new Date().toISOString();
  const nextCheque: ChequeInstrument = {
    ...cheque,
    status: "deposited",
    depositedAt: now,
    depositSlipNo: slip,
  };
  saveFees({
    ...fees,
    cheques: fees.cheques.map((c) => (c.id === chequeId ? nextCheque : c)),
    vouchers: fees.vouchers.map((v) =>
      v.id === cheque.voucherId
        ? syncVoucherTenderRealisation(
            v,
            cheque.tenderIndex,
            "subject_to_clearance",
          )
        : v,
    ),
  });
  return { ok: true, cheque: nextCheque };
}

export function clearCheque(
  chequeId: string,
  input?: { clearedAt?: string },
): { ok: true; cheque: ChequeInstrument } | { ok: false; error: string } {
  const fees = loadFees();
  const cheque = fees.cheques.find((c) => c.id === chequeId);
  if (!cheque) return { ok: false, error: "Cheque not found" };
  if (cheque.status !== "received" && cheque.status !== "deposited") {
    return { ok: false, error: "Only open cheques can be cleared" };
  }
  const voucher = fees.vouchers.find((v) => v.id === cheque.voucherId);
  if (!voucher || voucher.voidedAt) {
    return { ok: false, error: "Linked receipt is missing or voided" };
  }
  const now = input?.clearedAt ?? new Date().toISOString();
  const nextCheque: ChequeInstrument = {
    ...cheque,
    status: "cleared",
    depositedAt: cheque.depositedAt ?? now,
    clearedAt: now,
  };
  saveFees({
    ...fees,
    cheques: fees.cheques.map((c) => (c.id === chequeId ? nextCheque : c)),
    vouchers: fees.vouchers.map((v) =>
      v.id === cheque.voucherId
        ? syncVoucherTenderRealisation(v, cheque.tenderIndex, "cleared")
        : v,
    ),
  });
  return { ok: true, cheque: nextCheque };
}

/**
 * Mark cheque bounced and void the linked receipt so dues reopen.
 * (Split-tender vouchers are fully voided — re-collect cleared modes if needed.)
 */
export function bounceCheque(
  chequeId: string,
  input: { reason: string; bouncedAt?: string },
): { ok: true; cheque: ChequeInstrument } | { ok: false; error: string } {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "Enter bounce reason" };
  const fees = loadFees();
  const cheque = fees.cheques.find((c) => c.id === chequeId);
  if (!cheque) return { ok: false, error: "Cheque not found" };
  if (cheque.status === "cleared") {
    return { ok: false, error: "Cleared cheques cannot be bounced here" };
  }
  if (cheque.status === "bounced") {
    return { ok: false, error: "Cheque already bounced" };
  }
  const voucher = fees.vouchers.find((v) => v.id === cheque.voucherId);
  if (!voucher) return { ok: false, error: "Linked receipt not found" };

  const now = input.bouncedAt ?? new Date().toISOString();
  const nextCheque: ChequeInstrument = {
    ...cheque,
    status: "bounced",
    bouncedAt: now,
    bounceReason: reason,
  };

  const noteExtra = `Cheque ${cheque.chequeNo || "—"} bounced: ${reason}`;
  const nextVoucher: CollectionVoucher = {
    ...syncVoucherTenderRealisation(
      voucher,
      cheque.tenderIndex,
      "subject_to_clearance",
    ),
    voidedAt: voucher.voidedAt ?? now,
    note: [voucher.note, noteExtra].filter(Boolean).join(" · "),
  };

  // Sibling cheques on same voided voucher → mark bounced too if still open
  const nextCheques = fees.cheques.map((c) => {
    if (c.id === chequeId) return nextCheque;
    if (
      c.voucherId === cheque.voucherId &&
      (c.status === "received" || c.status === "deposited")
    ) {
      return {
        ...c,
        status: "bounced" as const,
        bouncedAt: now,
        bounceReason: `Linked receipt voided (${reason})`,
      };
    }
    return c;
  });

  saveFees({
    ...fees,
    vouchers: fees.vouchers.map((v) =>
      v.id === voucher.id ? nextVoucher : v,
    ),
    cheques: nextCheques,
  });
  return { ok: true, cheque: nextCheque };
}

export type StudentSearchHit = {
  student: SisStudent;
  household: Household | null;
  classLabel: string;
  balancePaise: number;
};

export function searchFeeStudents(
  query: string,
  sis?: SisState,
  masters?: MastersState,
  fees?: FeesState,
  filters?: { classId?: string; sectionId?: string; includeInactive?: boolean },
): StudentSearchHit[] {
  const s = sis ?? loadSis();
  const m = masters ?? loadMasters();
  const f = fees ?? loadFees();
  const q = query.trim().toLowerCase();
  const classId = filters?.classId ?? "";
  const sectionId = filters?.sectionId ?? "";
  const className = (id: string) =>
    m.classes.find((c) => c.id === id)?.name ?? "—";
  const sectionName = (id: string) =>
    m.sections.find((x) => x.id === id)?.name ?? "";

  let list = filters?.includeInactive
    ? s.students.slice()
    : s.students.filter((st) => st.status === "active");
  if (classId) {
    list = list.filter((st) => st.classId === classId);
  }
  if (sectionId) {
    list = list.filter((st) => st.sectionId === sectionId);
  }
  if (q) {
    list = list.filter((st) => {
      const hh = householdOf(s, st.householdId);
      return (
        st.fullName.toLowerCase().includes(q) ||
        st.admissionNo.toLowerCase().includes(q) ||
        (hh?.mobile ?? "").includes(q) ||
        (hh?.whatsappMobile ?? "").includes(q) ||
        (hh?.guardianName ?? "").toLowerCase().includes(q) ||
        (st.fatherName ?? "").toLowerCase().includes(q)
      );
    });
  }

  return list
    .slice(0, classId || sectionId ? 80 : 40)
    .map((student) => {
      const dues = computeStudentDues(student, m, f, { includeFuture: true });
      const balancePaise = dues.reduce((sum, d) => sum + d.balancePaise, 0);
      const hh = householdOf(s, student.householdId) ?? null;
      return {
        student,
        household: hh,
        classLabel: `${className(student.classId)}-${sectionName(student.sectionId)}`,
        balancePaise,
      };
    })
    .sort((a, b) => a.student.fullName.localeCompare(b.student.fullName));
}

export function householdSiblingIds(
  sis: SisState,
  student: SisStudent,
): SisStudent[] {
  const self = [student];
  const sibs = siblingsOf(sis, student);
  return [...self, ...sibs].filter(
    (s, i, arr) => arr.findIndex((x) => x.id === s.id) === i,
  );
}

export { formatInr };

/** Indian-style amount in words for fee receipts (rupees only; paise as and xx/100 if needed). */
export function amountInWordsPaise(paise: number): string {
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const leftover = abs % 100;
  const words = numberToIndianWords(rupees);
  const rupeePart = `${words} ${rupees === 1 ? "Rupee" : "Rupees"}`;
  if (leftover === 0) return `${rupeePart} Only`;
  return `${rupeePart} and ${leftover}/100 Only`;
}

function numberToIndianWords(n: number): string {
  if (n === 0) return "Zero";
  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];

  function underThousand(x: number): string {
    if (x === 0) return "";
    if (x < 20) return ones[x];
    if (x < 100) {
      const t = Math.floor(x / 10);
      const o = x % 10;
      return `${tens[t]}${o ? ` ${ones[o]}` : ""}`.trim();
    }
    const h = Math.floor(x / 100);
    const rest = x % 100;
    return `${ones[h]} Hundred${rest ? ` ${underThousand(rest)}` : ""}`;
  }

  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rem = n % 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${underThousand(crore)} Crore`);
  if (lakh) parts.push(`${underThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${underThousand(thousand)} Thousand`);
  if (rem) parts.push(underThousand(rem));
  return parts.join(" ");
}

/** Active (non-void) vouchers for a collection calendar date. */
export function vouchersForCollectionDate(
  closeDate: string,
  fees?: FeesState,
): CollectionVoucher[] {
  const f = fees ?? loadFees();
  return f.vouchers
    .filter((v) => !v.voidedAt && v.collectionDate === closeDate)
    .sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
}

/** Day book totals by tender mode + due kind for one collection date. */
export function buildDayBook(
  closeDate: string,
  fees?: FeesState,
): {
  vouchers: CollectionVoucher[];
  receiptCount: number;
  totalPaise: number;
  cashPaise: number;
  modeTotals: DayCloseModeTotal[];
  /** Collected amount split by voucher line kind */
  kindTotals: { kind: DueKind; label: string; paise: number; lineCount: number }[];
  /** Store credit issues raised on this calendar date (may still be unpaid) */
  storeIssues: {
    issueId: string;
    issueNo: string;
    studentId: string;
    totalPaise: number;
    itemCount: number;
    voided: boolean;
  }[];
  storeIssuedPaise: number;
  storeCollectedPaise: number;
} {
  const vouchers = vouchersForCollectionDate(closeDate, fees);
  const byMode = new Map<TenderMode, { paise: number; tenderCount: number }>();
  const byKind = new Map<DueKind, { paise: number; lineCount: number }>();

  for (const v of vouchers) {
    for (const t of v.tenders) {
      if (t.amountPaise <= 0) continue;
      const cur = byMode.get(t.mode) ?? { paise: 0, tenderCount: 0 };
      cur.paise += t.amountPaise;
      cur.tenderCount += 1;
      byMode.set(t.mode, cur);
    }
    for (const line of v.lines) {
      if (line.amountPaise <= 0) continue;
      const kind: DueKind =
        line.kind === "store" ||
        line.kind === "special" ||
        line.kind === "transport" ||
        line.kind === "plan" ||
        line.kind === "academic"
          ? line.kind
          : line.dueKey.startsWith("store:")
            ? "store"
            : line.dueKey.startsWith("transport:")
              ? "transport"
              : line.dueKey.startsWith("spec:")
                ? "special"
                : line.dueKey.startsWith("plan:")
                  ? "plan"
                  : "academic";
      const cur = byKind.get(kind) ?? { paise: 0, lineCount: 0 };
      cur.paise += line.amountPaise;
      cur.lineCount += 1;
      byKind.set(kind, cur);
    }
  }

  const modeOrder = TENDER_MODES.map((m) => m.value);
  const modeTotals: DayCloseModeTotal[] = modeOrder
    .filter((m) => byMode.has(m))
    .map((mode) => {
      const row = byMode.get(mode)!;
      return { mode, paise: row.paise, tenderCount: row.tenderCount };
    });

  const kindMeta: { kind: DueKind; label: string }[] = [
    { kind: "academic", label: "Academic fees" },
    { kind: "transport", label: "Transport" },
    { kind: "special", label: "Special / misc" },
    { kind: "store", label: "Store / books" },
    { kind: "plan", label: "Installment plan" },
  ];
  const kindTotals = kindMeta
    .filter((k) => byKind.has(k.kind))
    .map((k) => {
      const row = byKind.get(k.kind)!;
      return {
        kind: k.kind,
        label: k.label,
        paise: row.paise,
        lineCount: row.lineCount,
      };
    });

  const store = loadStore();
  const storeIssues = store.issues
    .filter((i) => i.issuedOn === closeDate)
    .map((i) => ({
      issueId: i.id,
      issueNo: i.issueNo,
      studentId: i.studentId,
      totalPaise: i.totalPaise,
      itemCount: i.lines.reduce((s, l) => s + l.qty, 0),
      voided: !!i.voidedAt,
    }))
    .sort((a, b) => a.issueNo.localeCompare(b.issueNo));

  const storeIssuedPaise = storeIssues
    .filter((i) => !i.voided)
    .reduce((s, i) => s + i.totalPaise, 0);
  const storeCollectedPaise = byKind.get("store")?.paise ?? 0;

  const totalPaise = vouchers.reduce((s, v) => s + v.totalPaise, 0);
  const cashPaise = byMode.get("cash")?.paise ?? 0;
  return {
    vouchers,
    receiptCount: vouchers.length,
    totalPaise,
    cashPaise,
    modeTotals,
    kindTotals,
    storeIssues,
    storeIssuedPaise,
    storeCollectedPaise,
  };
}

export function getDayCloseForDate(
  closeDate: string,
  fees?: FeesState,
  counterId = DEFAULT_COUNTER_ID,
): DayCloseSession | null {
  const f = fees ?? loadFees();
  const rows = f.dayCloses
    .filter((d) => d.closeDate === closeDate && d.counterId === counterId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows[0] ?? null;
}

/** Submitted or approved → no new collections for that date. */
export function isCollectionDateLocked(
  closeDate: string,
  fees?: FeesState,
  counterId = DEFAULT_COUNTER_ID,
): boolean {
  const session = getDayCloseForDate(closeDate, fees, counterId);
  return (
    !!session &&
    (session.status === "submitted" || session.status === "approved")
  );
}

export function dayCloseNeedsAttention(fees?: FeesState): boolean {
  const f = fees ?? loadFees();
  const today = new Date().toISOString().slice(0, 10);
  const book = buildDayBook(today, f);
  if (book.receiptCount === 0) return false;
  const session = getDayCloseForDate(today, f);
  return !session || session.status === "draft" || session.status === "rejected";
}

function upsertDayClose(session: DayCloseSession, fees: FeesState): FeesState {
  const others = fees.dayCloses.filter(
    (d) =>
      !(
        d.closeDate === session.closeDate &&
        d.counterId === session.counterId &&
        d.id !== session.id
      ) && d.id !== session.id,
  );
  // Keep one active row per date/counter — replace same id or prior draft for date
  const withoutSameDate = others.filter(
    (d) =>
      !(
        d.closeDate === session.closeDate &&
        d.counterId === session.counterId
      ),
  );
  return {
    ...fees,
    dayCloses: [session, ...withoutSameDate],
  };
}

export function saveDayCloseDraft(input: {
  closeDate: string;
  cashierName: string;
  denominations: DayCloseDenomLine[];
  cashierRemarks?: string;
  counterId?: string;
}):
  | { ok: true; session: DayCloseSession }
  | { ok: false; error: string } {
  const fees = loadFees();
  const counterId = input.counterId ?? DEFAULT_COUNTER_ID;
  const existing = getDayCloseForDate(input.closeDate, fees, counterId);
  if (existing?.status === "submitted" || existing?.status === "approved") {
    return {
      ok: false,
      error: "This day is already submitted or approved — cannot edit count",
    };
  }
  const book = buildDayBook(input.closeDate, fees);
  const denoms = CASH_DENOMINATIONS.map((meta) => {
    const found = input.denominations.find(
      (x) => x.denomPaise === meta.denomPaise,
    );
    return {
      denomPaise: meta.denomPaise,
      qty: Math.max(0, Math.floor(found?.qty ?? 0)),
    };
  });
  const physical = denomPhysicalTotal(denoms);
  const now = new Date().toISOString();
  const session = normalizeDayClose({
    id: existing?.id ?? id("dc"),
    closeDate: input.closeDate,
    counterId,
    cashierName: input.cashierName,
    status: "draft",
    voucherIds: book.vouchers.map((v) => v.id),
    receiptCount: book.receiptCount,
    totalPaise: book.totalPaise,
    modeTotals: book.modeTotals,
    systemCashPaise: book.cashPaise,
    denominations: denoms,
    physicalCashPaise: physical,
    variancePaise: physical - book.cashPaise,
    cashierRemarks: input.cashierRemarks ?? existing?.cashierRemarks ?? "",
    createdAt: existing?.createdAt ?? now,
    submittedAt: null,
    resolvedAt: null,
  });
  saveFees(upsertDayClose(session, fees));
  return { ok: true, session };
}

export function submitDayClose(input: {
  closeDate: string;
  cashierName: string;
  denominations: DayCloseDenomLine[];
  cashierRemarks?: string;
  counterId?: string;
}):
  | { ok: true; session: DayCloseSession }
  | { ok: false; error: string } {
  const fees = loadFees();
  const counterId = input.counterId ?? DEFAULT_COUNTER_ID;
  const existing = getDayCloseForDate(input.closeDate, fees, counterId);
  if (existing?.status === "submitted" || existing?.status === "approved") {
    return { ok: false, error: "Day-close already submitted or approved" };
  }
  const book = buildDayBook(input.closeDate, fees);
  if (book.receiptCount === 0 && book.cashPaise === 0) {
    return {
      ok: false,
      error: "No receipts for this date — nothing to close",
    };
  }
  const denoms = CASH_DENOMINATIONS.map((meta) => {
    const found = input.denominations.find(
      (x) => x.denomPaise === meta.denomPaise,
    );
    return {
      denomPaise: meta.denomPaise,
      qty: Math.max(0, Math.floor(found?.qty ?? 0)),
    };
  });
  const physical = denomPhysicalTotal(denoms);
  const variance = physical - book.cashPaise;
  const remarks = (input.cashierRemarks ?? "").trim();
  if (variance !== 0 && !remarks) {
    return {
      ok: false,
      error: "Cash variance needs a remark before submit",
    };
  }
  const now = new Date().toISOString();
  const session = normalizeDayClose({
    id: existing?.id ?? id("dc"),
    closeDate: input.closeDate,
    counterId,
    cashierName: input.cashierName,
    status: "submitted",
    voucherIds: book.vouchers.map((v) => v.id),
    receiptCount: book.receiptCount,
    totalPaise: book.totalPaise,
    modeTotals: book.modeTotals,
    systemCashPaise: book.cashPaise,
    denominations: denoms,
    physicalCashPaise: physical,
    variancePaise: variance,
    cashierRemarks: remarks,
    createdAt: existing?.createdAt ?? now,
    submittedAt: now,
    resolvedAt: null,
  });
  saveFees(upsertDayClose(session, fees));
  return { ok: true, session };
}

export function approveDayClose(input: {
  closeDate: string;
  receiverName: string;
  receiverRemarks?: string;
  counterId?: string;
}):
  | { ok: true; session: DayCloseSession }
  | { ok: false; error: string } {
  const fees = loadFees();
  const counterId = input.counterId ?? DEFAULT_COUNTER_ID;
  const existing = getDayCloseForDate(input.closeDate, fees, counterId);
  if (!existing || existing.status !== "submitted") {
    return { ok: false, error: "No submitted handover waiting for approval" };
  }
  const name = input.receiverName.trim();
  if (!name) {
    return { ok: false, error: "Receiver name is required" };
  }
  const now = new Date().toISOString();
  const session: DayCloseSession = {
    ...existing,
    status: "approved",
    receiverName: name,
    receiverRemarks: (input.receiverRemarks ?? "").trim(),
    resolvedAt: now,
  };
  saveFees(upsertDayClose(session, fees));
  return { ok: true, session };
}

export function rejectDayClose(input: {
  closeDate: string;
  receiverName: string;
  receiverRemarks?: string;
  counterId?: string;
}):
  | { ok: true; session: DayCloseSession }
  | { ok: false; error: string } {
  const fees = loadFees();
  const counterId = input.counterId ?? DEFAULT_COUNTER_ID;
  const existing = getDayCloseForDate(input.closeDate, fees, counterId);
  if (!existing || existing.status !== "submitted") {
    return { ok: false, error: "No submitted handover to reject" };
  }
  const remarks = (input.receiverRemarks ?? "").trim();
  if (!remarks) {
    return { ok: false, error: "Add a reason when rejecting" };
  }
  const now = new Date().toISOString();
  const session: DayCloseSession = {
    ...existing,
    status: "rejected",
    receiverName: input.receiverName.trim() || "Accounts",
    receiverRemarks: remarks,
    resolvedAt: now,
  };
  saveFees(upsertDayClose(session, fees));
  return { ok: true, session };
}

export function listDayCloses(fees?: FeesState): DayCloseSession[] {
  const f = fees ?? loadFees();
  return f.dayCloses
    .slice()
    .sort((a, b) => {
      const byDate = b.closeDate.localeCompare(a.closeDate);
      if (byDate !== 0) return byDate;
      return b.createdAt.localeCompare(a.createdAt);
    });
}

export function listInstallmentPlans(fees?: FeesState): InstallmentPlan[] {
  const f = fees ?? loadFees();
  return [...(f.installmentPlans ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function createInstallmentPlan(input: {
  studentId: string;
  householdId: string;
  dues: FeeDueLine[];
  parts: number;
  firstDueOn: string;
  interval: InstallmentPlanInterval;
  note?: string;
  createdBy: string;
  academicYearCode?: string;
}):
  | { ok: true; plan: InstallmentPlan }
  | { ok: false; error: string } {
  const open = openFeeDues(input.dues).filter((d) => d.kind !== "plan");
  if (open.length === 0) {
    return { ok: false, error: "Select overdue dues to put on a plan" };
  }
  const totalPaise = open.reduce((s, d) => s + d.balancePaise, 0);
  if (totalPaise <= 0) {
    return { ok: false, error: "Plan amount must be positive" };
  }
  if (!input.firstDueOn) {
    return { ok: false, error: "First due date is required" };
  }

  const fees = loadFees();
  if (activePlanForStudent(fees.installmentPlans, input.studentId)) {
    return {
      ok: false,
      error: "Student already has an active installment plan — cancel it first",
    };
  }

  const schedule = proposeInstallmentSchedule({
    totalPaise,
    parts: input.parts,
    firstDueOn: input.firstDueOn,
    interval: input.interval,
  });
  if (schedule.length === 0) {
    return { ok: false, error: "Could not build schedule" };
  }

  const plan = normalizeInstallmentPlan({
    id: id("ip"),
    code: nextInstallmentPlanCode(fees.installmentPlans ?? []),
    studentId: input.studentId,
    householdId: input.householdId,
    academicYearCode: input.academicYearCode ?? DEFAULT_AY,
    status: "active",
    coveredLines: open.map((d) => ({
      dueKey: d.dueKey,
      label: d.label,
      amountPaise: d.balancePaise,
    })),
    totalPaise,
    slices: schedule.map((s, i) => ({
      id: id("isl"),
      seq: i + 1,
      dueOn: s.dueOn,
      amountPaise: s.amountPaise,
      label: s.label,
    })),
    interval: input.interval,
    note: input.note?.trim() ?? "",
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
  });

  saveFees({
    ...fees,
    installmentPlans: [plan, ...(fees.installmentPlans ?? [])],
  });
  return { ok: true, plan };
}

export function cancelInstallmentPlan(
  planId: string,
): { ok: true } | { ok: false; error: string } {
  const fees = loadFees();
  const plan = (fees.installmentPlans ?? []).find((p) => p.id === planId);
  if (!plan) return { ok: false, error: "Plan not found" };
  if (plan.status !== "active") {
    return { ok: false, error: "Only an active plan can be cancelled" };
  }
  saveFees({
    ...fees,
    installmentPlans: (fees.installmentPlans ?? []).map((p) =>
      p.id === planId
        ? {
            ...p,
            status: "cancelled" as const,
            cancelledAt: new Date().toISOString(),
          }
        : p,
    ),
  });
  return { ok: true };
}
