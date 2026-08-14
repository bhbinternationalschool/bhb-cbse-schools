/**
 * Fee Take — dues engine + collection vouchers (demo localStorage).
 * Academic + transport + special + store/books − concessions − paid.
 */

import {
  mergeDiscountRulesFromSeed,
  resolvedConcessionGrantsForStudent,
} from "@/lib/feeDiscountRuntime";
import { assertModulePermission } from "@/lib/rbacGuard";
import {
  getSchoolMirrorSync,
  scheduleClientSchoolMirrorSync,
  setMirrorSlice,
} from "@/lib/schoolDataMirror";
import {
  DEFAULT_AY,
  currentAcademicYearCode,
  dueOnForSessionMonth,
  formatInr,
  listSessionYearOptions,
  loadMasters,
  normalizeMidYearFeePolicy,
  ordinalChildLabel,
  resolveFeeGroupId,
  resolveConcessionRuleForGrant,
  resolveSpecialFeeAssignees,
  resolveStudentFeeGroupId,
  resolveStructureLinesForClass,
  resolveSiblingTierValue,
  shouldBillMidYearLine,
  concessionAmountFromValue,
  type MastersState,
} from "@/lib/masters";
import {
  persistSeriesUse,
  suggestFromSeriesCode,
} from "@/lib/numberSeries";
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
  listAdhocDuesForStudent,
  postedWaiversByDueKey,
  stopFutureBlocks,
} from "@/lib/feeAdjustments";
import {
  isStoreIssueDueOnFeeTake,
  listStoreIssuesForStudent,
  loadStore,
  storeDueKey,
  storeIssueNetBilledPaise,
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
import { writeCacheOrInvalidate } from "@/lib/browserStorage";

export type DueKind =
  | "academic"
  | "transport"
  | "special"
  | "store"
  | "plan"
  | "arrears"
  /** Supplementary charge voucher (extra heads on a month) */
  | "voucher";

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
  vehicleId: string;
  vehiclePhotoUrl: string;
  stopName: string;
  periodLabel: string;
  periodKey: string;
  effectiveFrom: string;
  monthlyFeePaise: number;
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
  amountPaise?: number,
): VoucherLine {
  return {
    dueKey: d.dueKey,
    studentId: d.studentId,
    studentName,
    label: d.label,
    kind: d.kind,
    amountPaise: amountPaise ?? d.balancePaise,
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

/**
 * Spread a collection amount across open due lines (oldest due date first).
 * Used for partial payments when multiple months/heads are selected.
 */
export function allocateCollectionToDues(
  dues: FeeDueLine[],
  amountPaise: number,
  resolveStudentName: (studentId: string) => string,
):
  | { ok: true; lines: VoucherLine[] }
  | { ok: false; error: string } {
  if (amountPaise <= 0) {
    return { ok: false, error: "Collection amount must be positive" };
  }
  const open = openFeeDues(dues);
  if (open.length === 0) {
    return { ok: false, error: "No open dues selected" };
  }
  const maxCollect = open.reduce((s, d) => s + d.balancePaise, 0);
  if (amountPaise > maxCollect) {
    return {
      ok: false,
      error: `Amount exceeds selected balance (${formatInr(maxCollect)})`,
    };
  }

  const sorted = [...open].sort((a, b) => {
    const byDue = a.dueOn.localeCompare(b.dueOn);
    if (byDue !== 0) return byDue;
    return a.dueKey.localeCompare(b.dueKey);
  });

  let remain = amountPaise;
  const lines: VoucherLine[] = [];
  for (const d of sorted) {
    if (remain <= 0) break;
    const take = Math.min(d.balancePaise, remain);
    if (take <= 0) continue;
    lines.push(voucherLineFromDue(d, resolveStudentName(d.studentId), take));
    remain -= take;
  }
  if (remain > 0) {
    return { ok: false, error: "Could not allocate amount across selected dues" };
  }
  return { ok: true, lines };
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
  /** School bank account that received / will receive this tender. */
  bankAccountId?: string;
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
  /** Prior-session balances brought into the current session */
  carriedForwardDues: CarriedForwardDue[];
  /**
   * Supplementary charge vouchers — extra heads for a month that was already
   * (partially) paid; open lines appear on Fee Take for collection.
   */
  chargeVouchers: ChargeVoucher[];
};

/** One head line on a supplementary charge voucher. */
export type ChargeVoucherLine = {
  id: string;
  feeHeadId: string;
  feeHeadName: string;
  amountPaise: number;
  note: string;
};

/**
 * Billing voucher (not a receipt) — creates collectable dues for heads
 * left out of an already-paid month (or any ad-hoc month charge).
 */
export type ChargeVoucher = {
  id: string;
  /** Display code e.g. CV-7K2M */
  code: string;
  studentId: string;
  householdId: string;
  studentName: string;
  academicYearCode: string;
  /** Session month installment this voucher is for */
  installmentId: string | null;
  installmentLabel: string;
  dueOn: string;
  lines: ChargeVoucherLine[];
  totalPaise: number;
  reason: string;
  createdAt: string;
  createdBy: string;
  voidedAt: string | null;
  voidedBy: string;
};

/** Snapshot of last-session open dues moved into the current session. */
export type CarriedForwardDue = {
  id: string;
  studentId: string;
  fromAcademicYearCode: string;
  toAcademicYearCode: string;
  amountPaise: number;
  dueOn: string;
  label: string;
  sourceDueKeys: string[];
  sourceBreakdown: {
    dueKey: string;
    label: string;
    amountPaise: number;
  }[];
  transferredAt: string;
  transferredBy: string;
  voidedAt: string | null;
};

export type LastSessionTransferPreview = {
  studentId: string;
  studentName: string;
  fromAy: string;
  toAy: string;
  totalPaise: number;
  lines: { dueKey: string; label: string; balancePaise: number }[];
  alreadyTransferredPaise: number;
  canTransfer: boolean;
  reason?: string;
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

/** In-tab working copy — survives when localStorage quota is exceeded (IDB backup). */
let feesWorkingCopy: FeesState | null = null;
let feesIdbHydrateStarted = false;

export const FEES_UPDATED_EVENT = "bhb-fees-updated";

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

export function emptyFeesState(): FeesState {
  return {
    version: 1,
    vouchers: [],
    cheques: [],
    manualBooks: defaultManualBooks(),
    dayCloses: [],
    installmentPlans: [],
    planAllocations: [],
    carriedForwardDues: [],
    chargeVouchers: [],
  };
}

/** Remove all receipts / collections; keep arrears, charge vouchers, manual books, EMI plans. */
export function clearFeeCollections(state: FeesState): FeesState {
  return {
    ...state,
    version: 1,
    vouchers: [],
    cheques: [],
    dayCloses: [],
    planAllocations: [],
  };
}

export function countFeeCollections(state: FeesState): number {
  return (state.vouchers ?? []).filter((v) => !v.voidedAt).length;
}

function isStorageQuotaError(err: unknown): boolean {
  if (!(err instanceof DOMException)) return false;
  return (
    err.name === "QuotaExceededError" ||
    err.code === 22 ||
    err.code === 1014
  );
}

/** Slim JSON before persistence — large legacy imports can exceed localStorage. */
export function compactFeesForStorage(state: FeesState): FeesState {
  return {
    ...state,
    vouchers: (state.vouchers ?? []).map((v) => ({
      ...v,
      note:
        (v.note ?? "").length > 280
          ? `${v.note.slice(0, 277)}…`
          : (v.note ?? ""),
      lines: (v.lines ?? []).map((l) => ({
        ...l,
        concessionDetails:
          (l.concessionPaise ?? 0) > 0 ? (l.concessionDetails ?? []) : [],
      })),
    })),
  };
}

function normalizeFeesState(parsed: FeesState): FeesState {
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
  const carriedForwardDues = Array.isArray(parsed.carriedForwardDues)
    ? parsed.carriedForwardDues.map(normalizeCarriedForwardDue)
    : [];
  const chargeVouchers = Array.isArray(parsed.chargeVouchers)
    ? parsed.chargeVouchers.map(normalizeChargeVoucher)
    : [];
  return {
    version: 1,
    vouchers,
    cheques,
    manualBooks,
    dayCloses,
    installmentPlans,
    planAllocations,
    carriedForwardDues,
    chargeVouchers,
  };
}

function parseFeesJson(raw: string): FeesState {
  return normalizeFeesState(JSON.parse(raw) as FeesState);
}

function notifyFeesUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FEES_UPDATED_EVENT));
}

function kickFeesIdbHydrate() {
  if (feesIdbHydrateStarted || typeof window === "undefined") return;
  feesIdbHydrateStarted = true;
  void import("@/lib/feesLocalStore").then(async (idb) => {
    if (!idb.feesIdbAvailable()) return;
    const remote = await idb.readFeesFromIdb();
    if (!remote) return;
    const next = normalizeFeesState(remote);
    const localCount = feesWorkingCopy?.vouchers?.length ?? 0;
    const remoteCount = next.vouchers?.length ?? 0;
    if (remoteCount > localCount) {
      feesWorkingCopy = next;
      notifyFeesUpdated();
    }
  });
}

/**
 * Pull fees from IndexedDB when localStorage is empty or flagged over quota.
 * Call from Fee Take / import panels on mount.
 */
export async function hydrateFeesStore(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const { feesPreferIdb, readFeesFromIdb, feesIdbAvailable } = await import(
    "@/lib/feesLocalStore"
  );
  if (!feesIdbAvailable()) return false;

  const fromIdb = await readFeesFromIdb();
  if (!fromIdb) return false;

  const next = normalizeFeesState(fromIdb);
  const localCount = feesWorkingCopy?.vouchers?.length ?? 0;
  const remoteCount = next.vouchers?.length ?? 0;
  const shouldUse =
    feesPreferIdb() || remoteCount > localCount || localCount === 0;
  if (!shouldUse) return false;

  feesWorkingCopy = next;
  notifyFeesUpdated();
  return true;
}

function persistFeesClient(state: FeesState) {
  feesWorkingCopy = state;
  const compact = compactFeesForStorage(state);

  void import("@/lib/feesLocalStore").then(async (idb) => {
    if (idb.feesIdbAvailable()) {
      try {
        await idb.writeFeesToIdb(compact);
      } catch (e) {
        console.warn("[fees] IndexedDB write failed", e);
      }
    }
  });

  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(compact));
  } catch (err) {
    if (!isStorageQuotaError(err)) throw err;
    console.warn(
      "[fees] localStorage quota exceeded — using IndexedDB + server mirror",
    );
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    void import("@/lib/feesLocalStore").then((idb) => {
      idb.markFeesPreferIdb();
    });
  }

  scheduleClientSchoolMirrorSync({ fees: state });
  void import("@/lib/feesPersistence").then(({ scheduleFeesSync }) => {
    scheduleFeesSync(state);
  });
  notifyFeesUpdated();
}

export function loadFees(): FeesState {
  if (typeof window === "undefined") {
    const mirrored = getSchoolMirrorSync().fees as FeesState | null;
    if (mirrored && Array.isArray(mirrored.vouchers)) {
      return mirrored;
    }
    return emptyFeesState();
  }

  if (feesWorkingCopy) return feesWorkingCopy;

  try {
    if (!feesIdbHydrateStarted) {
      void import("@/lib/feesLocalStore").then(async (idb) => {
        if (idb.feesPreferIdb()) {
          const hydrated = await hydrateFeesStore();
          if (hydrated) return;
        }
        kickFeesIdbHydrate();
      });
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      feesWorkingCopy = parseFeesJson(raw);
      return feesWorkingCopy;
    }
  } catch {
    feesWorkingCopy = emptyFeesState();
    kickFeesIdbHydrate();
    return feesWorkingCopy;
  }

  feesWorkingCopy = emptyFeesState();
  kickFeesIdbHydrate();
  return feesWorkingCopy;
}

function normalizeCarriedForwardDue(
  row: Partial<CarriedForwardDue>,
): CarriedForwardDue {
  return {
    id: row.id || id("cf"),
    studentId: row.studentId || "",
    fromAcademicYearCode: row.fromAcademicYearCode || "",
    toAcademicYearCode: row.toAcademicYearCode || DEFAULT_AY,
    amountPaise: Math.max(0, Math.round(row.amountPaise || 0)),
    dueOn: row.dueOn || `${DEFAULT_AY.slice(0, 4)}-04-01`,
    label: row.label || "Previous session arrears",
    sourceDueKeys: Array.isArray(row.sourceDueKeys) ? row.sourceDueKeys : [],
    sourceBreakdown: Array.isArray(row.sourceBreakdown)
      ? row.sourceBreakdown.map((b) => ({
          dueKey: b.dueKey || "",
          label: b.label || "",
          amountPaise: Math.max(0, Math.round(b.amountPaise || 0)),
        }))
      : [],
    transferredAt: row.transferredAt || new Date().toISOString(),
    transferredBy: row.transferredBy || "",
    voidedAt: row.voidedAt ?? null,
  };
}

function chargeVoucherCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `CV-${s}`;
}

function normalizeChargeVoucherLine(
  l: Partial<ChargeVoucherLine>,
): ChargeVoucherLine {
  return {
    id: l.id || id("cvl"),
    feeHeadId: l.feeHeadId || "",
    feeHeadName: l.feeHeadName || "Fee",
    amountPaise: Math.max(0, Math.round(l.amountPaise || 0)),
    note: l.note || "",
  };
}

function normalizeChargeVoucher(
  row: Partial<ChargeVoucher>,
): ChargeVoucher {
  const lines = Array.isArray(row.lines)
    ? row.lines.map(normalizeChargeVoucherLine)
    : [];
  return {
    id: row.id || id("cv"),
    code: row.code || chargeVoucherCode(),
    studentId: row.studentId || "",
    householdId: row.householdId || "",
    studentName: row.studentName || "",
    academicYearCode: row.academicYearCode || DEFAULT_AY,
    installmentId: row.installmentId ?? null,
    installmentLabel: row.installmentLabel || "Session",
    dueOn: row.dueOn || new Date().toISOString().slice(0, 10),
    lines,
    totalPaise:
      row.totalPaise != null
        ? Math.max(0, Math.round(row.totalPaise))
        : lines.reduce((s, l) => s + l.amountPaise, 0),
    reason: row.reason || "",
    createdAt: row.createdAt || new Date().toISOString(),
    createdBy: row.createdBy || "",
    voidedAt: row.voidedAt ?? null,
    voidedBy: row.voidedBy || "",
  };
}

export function chargeVoucherDueKey(
  voucherId: string,
  lineId: string,
): string {
  return `cv:${voucherId}:${lineId}`;
}

export function listChargeVouchers(
  fees?: FeesState,
  filters?: { studentId?: string; includeVoided?: boolean },
): ChargeVoucher[] {
  const state = fees ?? loadFees();
  let list = state.chargeVouchers ?? [];
  if (!filters?.includeVoided) {
    list = list.filter((v) => !v.voidedAt);
  }
  if (filters?.studentId) {
    list = list.filter((v) => v.studentId === filters.studentId);
  }
  return list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function openChargeVoucherCount(fees?: FeesState): number {
  const state = fees ?? loadFees();
  const paid = paidByDueKey(state);
  let n = 0;
  for (const v of state.chargeVouchers ?? []) {
    if (v.voidedAt) continue;
    for (const line of v.lines) {
      const dueKey = chargeVoucherDueKey(v.id, line.id);
      const balance = Math.max(0, line.amountPaise - (paid.get(dueKey) ?? 0));
      if (balance > 0) {
        n += 1;
        break;
      }
    }
  }
  return n;
}

export function createChargeVoucher(input: {
  studentId: string;
  installmentId?: string | null;
  installmentLabel?: string;
  dueOn?: string;
  reason: string;
  createdBy: string;
  academicYearCode?: string;
  lines: {
    feeHeadId: string;
    feeHeadName?: string;
    amountPaise: number;
    note?: string;
  }[];
}):
  | { ok: true; voucher: ChargeVoucher }
  | { ok: false; error: string } {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "Reason is required" };
  const linesIn = (input.lines ?? []).filter((l) => l.amountPaise > 0);
  if (linesIn.length === 0) {
    return { ok: false, error: "Add at least one head with amount > 0" };
  }

  const sis = loadSis();
  const student = sis.students.find((s) => s.id === input.studentId);
  if (!student) return { ok: false, error: "Student not found" };

  const masters = loadMasters();
  const ay =
    input.academicYearCode ||
    student.academicYearCode ||
    currentAcademicYearCode(masters);

  let installmentLabel = input.installmentLabel || "Session";
  let dueOn = input.dueOn || new Date().toISOString().slice(0, 10);
  const installmentId = input.installmentId ?? null;
  if (installmentId) {
    const inst = masters.installments.find((i) => i.id === installmentId);
    if (inst) {
      installmentLabel = inst.label || inst.code;
      dueOn = input.dueOn || inst.dueOn;
    }
  }

  const lines: ChargeVoucherLine[] = linesIn.map((l) => {
    const head =
      masters.feeHeads.find((h) => h.id === l.feeHeadId)?.nameEn ||
      l.feeHeadName ||
      "Fee";
    return {
      id: id("cvl"),
      feeHeadId: l.feeHeadId,
      feeHeadName: head,
      amountPaise: Math.round(l.amountPaise),
      note: l.note?.trim() || "",
    };
  });

  const voucher: ChargeVoucher = {
    id: id("cv"),
    code: chargeVoucherCode(),
    studentId: student.id,
    householdId: student.householdId,
    studentName: student.fullName,
    academicYearCode: ay,
    installmentId,
    installmentLabel,
    dueOn,
    lines,
    totalPaise: lines.reduce((s, l) => s + l.amountPaise, 0),
    reason,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
    voidedAt: null,
    voidedBy: "",
  };

  const state = loadFees();
  saveFees({
    ...state,
    chargeVouchers: [voucher, ...(state.chargeVouchers ?? [])],
  });
  return { ok: true, voucher };
}

export function voidChargeVoucher(
  voucherId: string,
  by: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadFees();
  const idx = (state.chargeVouchers ?? []).findIndex((v) => v.id === voucherId);
  if (idx < 0) return { ok: false, error: "Voucher not found" };
  const row = state.chargeVouchers[idx]!;
  if (row.voidedAt) return { ok: false, error: "Already voided" };
  const next = [...state.chargeVouchers];
  next[idx] = {
    ...row,
    voidedAt: new Date().toISOString(),
    voidedBy: by,
  };
  saveFees({ ...state, chargeVouchers: next });
  return { ok: true };
}

/**
 * Heads in the student's fee structure for a month that have no open due
 * (and optionally already fully paid) — candidates for a supplementary voucher.
 */
export function suggestChargeVoucherHeads(input: {
  studentId: string;
  installmentId: string;
  masters?: MastersState;
  fees?: FeesState;
}): {
  feeHeadId: string;
  feeHeadName: string;
  structureAmountPaise: number;
  alreadyPaidPaise: number;
  openBalancePaise: number;
  suggestedPaise: number;
  status: "missing" | "partial" | "unpaid" | "paid";
}[] {
  const masters = input.masters ?? loadMasters();
  const fees = input.fees ?? loadFees();
  const sis = loadSis();
  const student = sis.students.find((s) => s.id === input.studentId);
  if (!student?.feeGroupId) return [];

  const structure = resolveStructureLinesForClass(
    masters,
    student.feeGroupId,
    student.classId,
  ).filter((l) => l.installmentId === input.installmentId);

  const dues = computeStudentDues(student, masters, fees, {
    includeFuture: true,
    includePaid: true,
    includeInactive: true,
  });

  const out: {
    feeHeadId: string;
    feeHeadName: string;
    structureAmountPaise: number;
    alreadyPaidPaise: number;
    openBalancePaise: number;
    suggestedPaise: number;
    status: "missing" | "partial" | "unpaid" | "paid";
  }[] = [];

  for (const sl of structure) {
    const headName =
      masters.feeHeads.find((h) => h.id === sl.feeHeadId)?.nameEn ?? "Fee";
    const matching = dues.filter(
      (d) =>
        d.kind === "academic" &&
        d.feeHeadId === sl.feeHeadId &&
        d.installmentId === input.installmentId,
    );
    const paid = matching.reduce((s, d) => s + d.paidPaise, 0);
    const open = matching.reduce((s, d) => s + d.balancePaise, 0);
    const billed = matching.reduce((s, d) => s + d.billedPaise, 0);

    let status: "missing" | "partial" | "unpaid" | "paid" = "unpaid";
    let suggested = sl.amountPaise;
    if (matching.length === 0) {
      status = "missing";
      suggested = sl.amountPaise;
    } else if (open <= 0 && paid > 0) {
      status = "paid";
      suggested = 0;
    } else if (paid > 0 && open > 0) {
      status = "partial";
      suggested = open;
    } else if (open > 0) {
      status = "unpaid";
      suggested = 0; // already on Fee Take as structure due
    }

    // Also check existing open charge vouchers for this head+month
    const cvOpen = (fees.chargeVouchers ?? [])
      .filter(
        (v) =>
          !v.voidedAt &&
          v.studentId === student.id &&
          v.installmentId === input.installmentId,
      )
      .flatMap((v) =>
        v.lines
          .filter((l) => l.feeHeadId === sl.feeHeadId)
          .map((l) => {
            const dueKey = chargeVoucherDueKey(v.id, l.id);
            const p = paidByDueKey(fees).get(dueKey) ?? 0;
            return Math.max(0, l.amountPaise - p);
          }),
      )
      .reduce((s, n) => s + n, 0);

    out.push({
      feeHeadId: sl.feeHeadId,
      feeHeadName: headName,
      structureAmountPaise: sl.amountPaise,
      alreadyPaidPaise: paid,
      openBalancePaise: open + cvOpen,
      suggestedPaise: status === "missing" ? suggested : 0,
      status:
        matching.length === 0 && billed === 0
          ? "missing"
          : status,
    });
  }

  return out;
}

export function saveFees(state: FeesState) {
  if (!assertModulePermission("fees", "edit", "saveFees")) return;

  if (typeof window === "undefined") {
    setMirrorSlice("fees", state);
    return;
  }
  persistFeesClient(state);
}

/** Hydrate path — write localStorage + mirror without closed-session guard / cloud schedule. */
export function writeFeesLocalRaw(state: FeesState) {
  if (typeof window === "undefined") {
    setMirrorSlice("fees", state);
    return;
  }
  persistFeesClient(state);
}

/** Wipe all collection vouchers from desk + IndexedDB + mirror sync. */
export async function wipeFeeCollections(): Promise<{
  removedVouchers: number;
  fees: FeesState;
}> {
  const current = loadFees();
  const removedVouchers = (current.vouchers ?? []).length;
  const next = clearFeeCollections(current);
  if (typeof window !== "undefined") {
    const compact = compactFeesForStorage(next);
    feesWorkingCopy = next;
    try {
      writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(compact));
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    const idb = await import("@/lib/feesLocalStore");
    if (idb.feesIdbAvailable()) {
      await idb.writeFeesToIdb(compact);
    }
    scheduleClientSchoolMirrorSync({ fees: next });
    notifyFeesUpdated();
  } else {
    setMirrorSlice("fees", next);
  }
  return { removedVouchers, fees: next };
}

export function feesStateIsEmpty(state: FeesState): boolean {
  return (
    (state.vouchers?.length ?? 0) === 0 &&
    (state.cheques?.length ?? 0) === 0 &&
    (state.dayCloses?.length ?? 0) === 0 &&
    (state.installmentPlans?.length ?? 0) === 0 &&
    (state.planAllocations?.length ?? 0) === 0 &&
    (state.carriedForwardDues?.length ?? 0) === 0 &&
    (state.chargeVouchers?.length ?? 0) === 0
  );
}

const FEES_MIRROR_META = "bhb_fees_mirror_meta_v1";

function readFeesMirrorMeta(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(FEES_MIRROR_META);
    if (!raw) return "";
    return String((JSON.parse(raw) as { updatedAt?: string }).updatedAt || "");
  } catch {
    return "";
  }
}

function writeFeesMirrorMeta(iso: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(FEES_MIRROR_META, JSON.stringify({ updatedAt: iso }));
}

export function hydrateFeesFromMirror(
  raw: unknown,
  remoteAt: string,
  remoteIsNewer: boolean,
): boolean {
  if (!raw || typeof raw !== "object") return false;
  const local = loadFees();
  const localAt = readFeesMirrorMeta();
  const takeRemote =
    remoteIsNewer ||
    feesStateIsEmpty(local) ||
    !localAt ||
    (remoteAt && remoteAt > localAt);
  if (!takeRemote) return false;
  writeFeesLocalRaw(raw as FeesState);
  writeFeesMirrorMeta(remoteAt || new Date().toISOString());
  return true;
}

function normalizeVoucherLine(l: Partial<VoucherLine>): VoucherLine {
  const kind: DueKind =
    l.kind === "special" ||
    l.kind === "store" ||
    l.kind === "transport" ||
    l.kind === "plan" ||
    l.kind === "arrears" ||
    l.kind === "voucher" ||
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
              : l.dueKey?.startsWith("arrears:")
                ? "arrears"
                : l.dueKey?.startsWith("cv:")
                  ? "voucher"
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
      bankAccountId: t.bankAccountId ?? "",
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
  student: { id: string; admissionNo: string; academicYearCode?: string },
  feeHeadId: string,
  billedPaise: number,
  asOf: string,
): { totalPaise: number; details: FeeConcessionDetail[] } {
  const mastersWithRules = mergeDiscountRulesFromSeed(masters);
  const grants = resolvedConcessionGrantsForStudent(
    mastersWithRules,
    student,
    asOf,
  );
  const details: FeeConcessionDetail[] = [];
  let total = 0;
  for (const g of grants) {
    const rule = resolveConcessionRuleForGrant(mastersWithRules, g, {
      preferAy: student.academicYearCode,
    });
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
    /** Include inactive students (inactive dues register). Default false. */
    includeInactive?: boolean;
  },
): FeeDueLine[] {
  if (student.status !== "active" && !options?.includeInactive) return [];
  const asOf = options?.asOf ?? new Date().toISOString().slice(0, 10);
  const includeFuture = options?.includeFuture ?? true;
  const includePaid = options?.includePaid ?? true;
  const paidMap = paidByDueKey(fees);
  const waiverMap = postedWaiversByDueKey(student.id);
  const lines: FeeDueLine[] = [];
  const midYearPolicy = normalizeMidYearFeePolicy(masters.midYearFeePolicy);

  const headName = (hid: string) =>
    masters.feeHeads.find((h) => h.id === hid)?.nameEn ?? "Fee";

  function pushLine(line: FeeDueLine) {
    if (stopFutureBlocks(student.id, line.dueOn)) return;
    lines.push(line);
  }

  const feeGroupId = resolveStudentFeeGroupId(masters, student);
  if (feeGroupId) {
    const structure = resolveStructureLinesForClass(
      masters,
      feeGroupId,
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
        student,
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
      pushLine({
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
    const transportHeadId =
      masters.feeHeads.find((h) => h.code === "TRANSPORT")?.id ?? "";
    const transportConcession = transportHeadId
      ? concessionForHead(masters, student, transportHeadId, td.amountPaise, asOf)
      : { totalPaise: 0, details: [] as FeeConcessionDetail[] };
    const balance = Math.max(
      0,
      td.amountPaise - transportConcession.totalPaise - paid,
    );
    if (balance <= 0) {
      if (!(includePaid && paid > 0)) continue;
    }
    if (!includeFuture && isAfterRunningSessionMonth(td.dueOn, asOf)) continue;

    lines.push({
      dueKey: td.dueKey,
      kind: "transport",
      studentId: student.id,
      feeHeadId: transportHeadId,
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
        vehicleId: td.vehicleId,
        vehiclePhotoUrl: td.vehiclePhotoUrl,
        stopName: td.stopName,
        periodLabel: td.periodLabel,
        periodKey: td.periodKey,
        effectiveFrom:
          transport.assignments.find((a) => a.id === td.assignmentId)
            ?.effectiveFrom ?? "",
        monthlyFeePaise: td.amountPaise,
      },
      dueOn: td.dueOn,
      billedPaise: td.amountPaise,
      concessionPaise: transportConcession.totalPaise,
      concessionDetails: transportConcession.details,
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
      student,
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
    // Cash / already settled at counter — not a Fee Take due
    if (
      iss.paymentStatus === "paid" ||
      iss.paymentStatus === "void" ||
      iss.recipientKind === "staff" ||
      !iss.studentId
    ) {
      continue;
    }
    if (!isStoreIssueDueOnFeeTake(iss)) {
      continue;
    }
    if (!includeFuture && isAfterRunningSessionMonth(iss.issuedOn, asOf)) {
      continue;
    }
    const dueKey = storeDueKey(student.id, iss.id);
    const billed = storeIssueNetBilledPaise(iss);
    const counterPaid = Math.max(0, iss.counterPaidPaise || 0);
    const paid = (paidMap.get(dueKey) ?? 0) + counterPaid;
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
  // Apply stop-future + waivers to lines collected via raw push (transport/special/store)
  const adjusted = lines
    .filter((l) => !stopFutureBlocks(student.id, l.dueOn))
    .map((l) => {
      const waived = waiverMap.get(l.dueKey) ?? 0;
      if (waived <= 0) return l;
      const balance = Math.max(0, l.balancePaise - waived);
      return {
        ...l,
        concessionPaise: l.concessionPaise + waived,
        balancePaise: balance,
        label:
          balance <= 0
            ? `${l.label} · waived`
            : `${l.label} · −${formatInr(waived)} waived`,
      };
    })
    .filter(
      (l) =>
        l.balancePaise > 0 ||
        (includePaid && (l.paidPaise > 0 || (waiverMap.get(l.dueKey) ?? 0) > 0)),
    );

  // Late fee on overdue academic/special balances
  for (const late of computeLateFeeDues(
    student,
    masters,
    adjusted,
    paidMap,
    asOf,
  )) {
    adjusted.push(late);
  }

  // Ad-hoc charges from adjustments
  for (const ad of listAdhocDuesForStudent(student.id, paidMap)) {
    if (stopFutureBlocks(student.id, ad.dueOn)) continue;
    adjusted.push(ad);
  }

  // Supplementary charge vouchers (extra heads on a paid / partial month)
  for (const cv of fees.chargeVouchers ?? []) {
    if (cv.voidedAt || cv.studentId !== student.id) continue;
    if (!includeFuture && isAfterRunningSessionMonth(cv.dueOn, asOf)) continue;
    for (const line of cv.lines) {
      if (stopFutureBlocks(student.id, cv.dueOn)) continue;
      const dueKey = chargeVoucherDueKey(cv.id, line.id);
      const paid = paidMap.get(dueKey) ?? 0;
      const balance = Math.max(0, line.amountPaise - paid);
      if (balance <= 0) {
        if (!(includePaid && paid > 0)) continue;
      }
      adjusted.push({
        dueKey,
        kind: "voucher",
        studentId: student.id,
        feeHeadId: line.feeHeadId,
        feeHeadName: line.feeHeadName,
        installmentId: cv.installmentId,
        installmentLabel: cv.installmentLabel,
        specialFeeId: null,
        structureLineId: null,
        storeIssueId: null,
        storeIssueNo: "",
        storeItems: [],
        transport: null,
        dueOn: cv.dueOn,
        billedPaise: line.amountPaise,
        concessionPaise: 0,
        concessionDetails: [],
        paidPaise: paid,
        balancePaise: balance,
        label: `Voucher ${cv.code} · ${line.feeHeadName} · ${cv.installmentLabel}`,
      });
    }
  }

  if (plan) {
    const covered = coveredDueKeySet(plan);
    const filtered = adjusted.filter((l) => !covered.has(l.dueKey));
    const slices = planSliceDues(plan, paidMapRaw, {
      includePaid,
      asOf,
      includeFuture,
    });
    return appendArrearsDues(
      [...filtered, ...slices],
      student,
      fees,
      paidMap,
      includePaid,
    ).sort((a, b) =>
      a.dueOn === b.dueOn
        ? a.label.localeCompare(b.label)
        : a.dueOn.localeCompare(b.dueOn),
    );
  }

  return appendArrearsDues(
    adjusted,
    student,
    fees,
    paidMap,
    includePaid,
  ).sort((a, b) =>
    a.dueOn === b.dueOn
      ? a.label.localeCompare(b.label)
      : a.dueOn.localeCompare(b.dueOn),
  );
}

/** Apply active late-fee rules to overdue open dues. */
export function computeLateFeeDues(
  student: SisStudent,
  masters: MastersState,
  baseLines: FeeDueLine[],
  paidMap: Map<string, number>,
  asOf: string,
): FeeDueLine[] {
  const ay = student.academicYearCode || DEFAULT_AY;
  const rules = (masters.lateFeeRules ?? []).filter(
    (r) => r.isActive && r.academicYearCode === ay,
  );
  if (!rules.length) return [];

  const out: FeeDueLine[] = [];
  for (const line of baseLines) {
    if (line.balancePaise <= 0) continue;
    if (line.kind === "arrears" || line.kind === "plan") continue;
    if (line.dueOn >= asOf) continue;

    const daysLate = Math.floor(
      (Date.parse(asOf) - Date.parse(line.dueOn)) / 86_400_000,
    );
    if (!Number.isFinite(daysLate) || daysLate < 0) continue;

    for (const rule of rules) {
      const lateHeadId = masters.feeHeads.find((h) => h.code === "LATE")?.id;
      const heads =
        rule.feeHeadIds?.length > 0
          ? rule.feeHeadIds
          : rule.feeHeadId
            ? [rule.feeHeadId]
            : [];
      // Seed/legacy rules often list only the LATE posting head — treat that as “all dues”.
      const appliesToAll =
        heads.length === 0 ||
        (lateHeadId != null && heads.every((id) => id === lateHeadId));
      if (
        !appliesToAll &&
        line.feeHeadId &&
        !heads.includes(line.feeHeadId)
      ) {
        continue;
      }
      if (daysLate <= (rule.graceDays || 0)) continue;

      let charge =
        rule.mode === "percent"
          ? Math.round((line.balancePaise * rule.value) / 10_000)
          : rule.value;
      if (rule.maxAmountPaise != null) {
        charge = Math.min(charge, rule.maxAmountPaise);
      }
      if (charge <= 0) continue;

      const dueKey = `late:${student.id}:${line.dueKey}:${rule.id}`;
      const paid = paidMap.get(dueKey) ?? 0;
      const balance = Math.max(0, charge - paid);
      if (balance <= 0) continue;

      out.push({
        dueKey,
        kind: "special",
        studentId: student.id,
        feeHeadId: rule.feeHeadId || line.feeHeadId,
        feeHeadName: "Late fee",
        installmentId: null,
        installmentLabel: "Late",
        specialFeeId: null,
        structureLineId: null,
        storeIssueId: null,
        storeIssueNo: "",
        storeItems: [],
        transport: null,
        dueOn: asOf,
        billedPaise: charge,
        concessionPaise: 0,
        concessionDetails: [],
        paidPaise: paid,
        balancePaise: balance,
        label: `Late fee · ${line.label} (${daysLate}d)`,
      });
    }
  }
  return out;
}

function appendArrearsDues(
  lines: FeeDueLine[],
  student: SisStudent,
  fees: FeesState,
  paidMap: Map<string, number>,
  includePaid: boolean,
): FeeDueLine[] {
  const studentAy = student.academicYearCode || DEFAULT_AY;
  const sourceSettled = new Set<string>();
  for (const cf of fees.carriedForwardDues ?? []) {
    if (cf.voidedAt || cf.studentId !== student.id) continue;
    for (const k of cf.sourceDueKeys) sourceSettled.add(k);
  }

  const withoutSettled = lines.filter((l) => !sourceSettled.has(l.dueKey));

  for (const cf of fees.carriedForwardDues ?? []) {
    if (cf.voidedAt || cf.studentId !== student.id) continue;
    if (cf.toAcademicYearCode !== studentAy) continue;
    const dueKey = `arrears:${cf.id}`;
    const paid = paidMap.get(dueKey) ?? 0;
    const balance = Math.max(0, cf.amountPaise - paid);
    if (balance <= 0) {
      if (!(includePaid && paid > 0)) continue;
    }
    withoutSettled.push({
      dueKey,
      kind: "arrears",
      studentId: student.id,
      feeHeadId: "",
      feeHeadName: "Arrears",
      installmentId: null,
      installmentLabel: `From ${cf.fromAcademicYearCode}`,
      specialFeeId: null,
      structureLineId: null,
      storeIssueId: null,
      storeIssueNo: "",
      storeItems: [],
      transport: null,
      dueOn: cf.dueOn,
      billedPaise: cf.amountPaise,
      concessionPaise: 0,
      concessionDetails: [],
      paidPaise: paid,
      balancePaise: balance,
      label: cf.label,
    });
  }
  return withoutSettled;
}

/** Closed / previous session before the current academic year. */
export function previousAcademicYearCode(
  toAy?: string,
  masters?: MastersState | null,
): string | null {
  const current = toAy || currentAcademicYearCode(masters);
  const years = listSessionYearOptions(masters ?? undefined)
    .map((y) => y.code)
    .filter((c) => c && c !== current)
    .sort((a, b) => b.localeCompare(a));
  const older = years.filter((c) => c < current);
  if (older[0]) return older[0];
  const closed = listSessionYearOptions(masters ?? undefined).find(
    (y) => y.status === "closed" && y.code !== current,
  );
  return closed?.code ?? null;
}

/**
 * Open dues as billed for a prior academic session (fee groups for that AY,
 * or the student’s own group while they are still on that session).
 */
export function computeLastSessionOpenDues(
  student: SisStudent,
  masters: MastersState,
  fees: FeesState,
  fromAy: string,
): FeeDueLine[] {
  if (student.status !== "active") return [];

  const studentAy = student.academicYearCode || DEFAULT_AY;
  // Prefer students still enrolled on the last session — their open ledger is authoritative.
  // Also allow when they already have collection vouchers stamped with fromAy.
  const hasPriorVouchers = fees.vouchers.some(
    (v) =>
      !v.voidedAt &&
      v.academicYearCode === fromAy &&
      v.lines.some((l) => l.studentId === student.id),
  );
  if (studentAy !== fromAy && !hasPriorVouchers) {
    return [];
  }

  let groupId = resolveFeeGroupId(masters, {
    studentType: student.studentType,
    classId: student.classId,
    academicYearCode: fromAy,
    preferPublished: true,
  });

  if (!groupId && studentAy === fromAy && student.feeGroupId) {
    groupId = student.feeGroupId;
  }

  if (!groupId) {
    for (const t of ["PROMOTE", "NEW", "MID_YEAR", "RTE"] as const) {
      groupId = resolveFeeGroupId(masters, {
        studentType: t,
        classId: student.classId,
        academicYearCode: fromAy,
        preferPublished: true,
      });
      if (groupId) break;
    }
  }

  if (!groupId) return [];

  const group = masters.feeGroups.find((g) => g.id === groupId);
  if (
    group &&
    group.academicYearCode !== fromAy &&
    studentAy !== fromAy
  ) {
    return [];
  }

  const clone: SisStudent = {
    ...student,
    academicYearCode: fromAy,
    feeGroupId: groupId,
  };

  return computeStudentDues(clone, masters, fees, {
    includeFuture: true,
    includePaid: false,
  }).filter((d) => d.kind !== "arrears" && d.balancePaise > 0);
}

export function previewLastSessionTransfer(
  student: SisStudent,
  masters?: MastersState,
  fees?: FeesState,
  options?: { fromAy?: string; toAy?: string },
): LastSessionTransferPreview {
  const m = masters ?? loadMasters();
  const f = fees ?? loadFees();
  const toAy = options?.toAy || currentAcademicYearCode(m);
  const fromAy =
    options?.fromAy || previousAcademicYearCode(toAy, m) || "";
  const already = (f.carriedForwardDues ?? [])
    .filter(
      (c) =>
        !c.voidedAt &&
        c.studentId === student.id &&
        c.fromAcademicYearCode === fromAy &&
        c.toAcademicYearCode === toAy,
    )
    .reduce((s, c) => s + c.amountPaise, 0);

  if (!fromAy) {
    return {
      studentId: student.id,
      studentName: student.fullName,
      fromAy: "",
      toAy,
      totalPaise: 0,
      lines: [],
      alreadyTransferredPaise: already,
      canTransfer: false,
      reason: "No previous academic session found in Masters",
    };
  }

  if (already > 0) {
    return {
      studentId: student.id,
      studentName: student.fullName,
      fromAy,
      toAy,
      totalPaise: 0,
      lines: [],
      alreadyTransferredPaise: already,
      canTransfer: false,
      reason: `Already transferred ${formatInr(already)} from ${fromAy}`,
    };
  }

  const open = computeLastSessionOpenDues(student, m, f, fromAy);
  const lines = open.map((d) => ({
    dueKey: d.dueKey,
    label: d.label,
    balancePaise: d.balancePaise,
  }));
  const totalPaise = lines.reduce((s, l) => s + l.balancePaise, 0);

  if (totalPaise <= 0) {
    const hasFromAyGroup = m.feeGroups.some(
      (g) => g.isActive && g.academicYearCode === fromAy,
    );
    const onLastSession =
      (student.academicYearCode || DEFAULT_AY) === fromAy;
    return {
      studentId: student.id,
      studentName: student.fullName,
      fromAy,
      toAy,
      totalPaise: 0,
      lines: [],
      alreadyTransferredPaise: already,
      canTransfer: false,
      reason: !onLastSession
        ? `Student is on ${student.academicYearCode || toAy}. Set their session to ${fromAy} (with open dues) to transfer, or keep fee groups for ${fromAy}.`
        : hasFromAyGroup
          ? `No open dues in ${fromAy}`
          : `No fee groups for ${fromAy}. Copy fee structure from ${toAy} in Masters, or assign a fee group while the student is on ${fromAy}.`,
    };
  }

  return {
    studentId: student.id,
    studentName: student.fullName,
    fromAy,
    toAy,
    totalPaise,
    lines,
    alreadyTransferredPaise: already,
    canTransfer: true,
  };
}

/**
 * Move last-session open balances into current-session arrears lines.
 * Also rolls the student onto toAy (and resolves fee group) when they were
 * still on fromAy.
 */
export function transferLastSessionDues(options: {
  studentIds: string[];
  transferredBy: string;
  fromAy?: string;
  toAy?: string;
}):
  | {
      ok: true;
      transferred: number;
      totalPaise: number;
      fees: FeesState;
    }
  | { ok: false; error: string } {
  const m = loadMasters();
  const sis = loadSis();
  let fees = loadFees();
  const toAy = options.toAy || currentAcademicYearCode(m);
  const fromAy =
    options.fromAy || previousAcademicYearCode(toAy, m) || "";
  if (!fromAy) {
    return { ok: false, error: "No previous academic session found" };
  }

  const carried = [...(fees.carriedForwardDues ?? [])];
  let transferred = 0;
  let totalPaise = 0;
  const dueOn = dueOnForSessionMonth(toAy, 4, 1);

  const students = sis.students.map((st) => {
    if (!options.studentIds.includes(st.id)) return st;
    if (st.status !== "active") return st;

    const preview = previewLastSessionTransfer(st, m, fees, { fromAy, toAy });
    if (!preview.canTransfer || preview.totalPaise <= 0) return st;

    const cf: CarriedForwardDue = {
      id: id("cf"),
      studentId: st.id,
      fromAcademicYearCode: fromAy,
      toAcademicYearCode: toAy,
      amountPaise: preview.totalPaise,
      dueOn,
      label: `Arrears from ${fromAy}`,
      sourceDueKeys: preview.lines.map((l) => l.dueKey),
      sourceBreakdown: preview.lines.map((l) => ({
        dueKey: l.dueKey,
        label: l.label,
        amountPaise: l.balancePaise,
      })),
      transferredAt: new Date().toISOString(),
      transferredBy: options.transferredBy || "",
      voidedAt: null,
    };
    carried.push(cf);
    transferred += 1;
    totalPaise += preview.totalPaise;

    // Roll student onto current session if they were still on last session
    const nextAy =
      (st.academicYearCode || DEFAULT_AY) === fromAy ? toAy : st.academicYearCode;
    const nextGroupId =
      nextAy === toAy
        ? resolveFeeGroupId(m, {
            studentType:
              st.studentType === "NEW" ? "PROMOTE" : st.studentType,
            classId: st.classId,
            academicYearCode: toAy,
            preferPublished: true,
          }) || st.feeGroupId
        : st.feeGroupId;

    return {
      ...st,
      academicYearCode: nextAy || toAy,
      feeGroupId: nextGroupId,
      studentType:
        (st.academicYearCode || DEFAULT_AY) === fromAy && st.studentType === "NEW"
          ? ("PROMOTE" as const)
          : st.studentType,
    };
  });

  if (transferred === 0) {
    return {
      ok: false,
      error:
        "No last-session dues to transfer for the selected student(s)",
    };
  }

  fees = { ...fees, carriedForwardDues: carried };
  saveFees(fees);
  saveSis({ ...sis, students });
  return { ok: true, transferred, totalPaise, fees };
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
          k === "arrears"
            ? 0
            : k === "academic"
              ? 1
              : k === "transport"
                ? 2
                : k === "special"
                  ? 3
                  : 4;
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

export type FeeReceiptSeries = "F" | "R";

/**
 * Fee Take assigned dues → F/{ay}/####
 * Registration desk / field collect → R/{ay}/####
 * Legacy REC/{ay}/ counts toward F sequence.
 */
export function nextReceiptNo(
  fees: FeesState,
  ayCode = DEFAULT_AY,
  series: FeeReceiptSeries = "F",
): string {
  if (typeof window !== "undefined") {
    const masters = loadMasters();
    const fromSeries = suggestFromSeriesCode(
      masters.numberSeries,
      "RECEIPT",
      ayCode,
      fees.vouchers.map((v) => v.receiptNo),
    );
    if (fromSeries) return fromSeries;
  }

  const prefixes =
    series === "R"
      ? [`R/${ayCode}/`]
      : [`F/${ayCode}/`, `REC/${ayCode}/`];
  let max = 0;
  for (const v of fees.vouchers) {
    for (const prefix of prefixes) {
      if (!v.receiptNo.startsWith(prefix)) continue;
      const n = Number(v.receiptNo.slice(prefix.length));
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `${series}/${ayCode}/${String(max + 1).padStart(4, "0")}`;
}

export function receiptSeriesOf(receiptNo: string): FeeReceiptSeries | "" {
  if (receiptNo.startsWith("R/")) return "R";
  if (receiptNo.startsWith("F/") || receiptNo.startsWith("REC/")) return "F";
  return "";
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
  /** F = regular Fee Take · R = registration fee (daybook / cashbook) */
  receiptSeries?: FeeReceiptSeries;
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
      code?: "backdate" | "duplicate" | "manual_no" | "day_closed" | "rbac";
    } {
  if (!assertModulePermission("fees", "create", "collectPayment")) {
    return {
      ok: false,
      error: "You do not have permission to collect fees.",
      code: "rbac",
    };
  }
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
    receiptNo: nextReceiptNo(
      fees,
      input.academicYearCode ?? DEFAULT_AY,
      input.receiptSeries ?? "F",
    ),
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

  persistSeriesUse(
    "RECEIPT",
    input.academicYearCode ?? DEFAULT_AY,
    voucher.receiptNo,
  );

  void import("@/lib/accountsPostings")
    .then((m) => {
      const storeAmountPaise = voucher.lines
        .filter((l) => l.kind === "store")
        .reduce((n, l) => n + l.amountPaise, 0);
      m.postFeeCollectionToAccounts({
        voucherId: voucher.id,
        collectionDate: voucher.collectionDate,
        receiptNo: voucher.receiptNo,
        label: voucher.householdId,
        tenders: voucher.tenders.map((t) => ({
          mode: t.mode,
          amountPaise: t.amountPaise,
          bankAccountId: t.bankAccountId,
        })),
        storeAmountPaise,
      });
    })
    .catch(() => {
      /* accounts optional */
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
 * Best-effort push notification alongside a fee receipt — never blocks or
 * affects the WhatsApp flow, which stays the primary channel (Round 14).
 */
function notifyFeeReceiptPush(householdId: string, voucher: CollectionVoucher) {
  if (typeof window === "undefined") return;
  void fetch("/api/push/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      householdId,
      title: "Fee receipt",
      body: `Receipt ${voucher.receiptNo} — ${formatInr(voucher.totalPaise)} received. Thank you.`,
      url: "/parent?tab=fees",
    }),
  }).catch(() => undefined);
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
      mode: "share_file" | "wa_link" | "api";
      pdfDownloaded: boolean;
      receiptUrl: string;
      apiFallbackReason?: string;
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

  // Live WhatsApp Business API — message from school number (+91 94519 38805)
  if (typeof window !== "undefined") {
    try {
      const { loadWaTemplates, listApprovedTemplates } = await import(
        "@/lib/waTemplates"
      );
      const approvedFees = listApprovedTemplates(loadWaTemplates(), {
        module: "fees",
      });
      const feeTpl = approvedFees[0];
      const template = feeTpl
        ? {
            name: feeTpl.metaName,
            language: feeTpl.metaLanguage || feeTpl.language,
            variables: {
              "1": input.voucher.receiptNo,
              "2": String(input.voucher.totalPaise / 100),
            },
          }
        : undefined;

      const fallbackMobile = normalizeMobile(hh?.altMobile ?? "") || undefined;
      const res = await fetch("/api/wa/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ mobile, fallbackMobile, body: message, template }],
        }),
      });
      const dispatch = (await res.json()) as {
        results?: { status: string; error?: string }[];
        hint?: string;
      };
      const row = dispatch.results?.[0];
      if (row?.status === "sent") {
        if (input.markSent !== false) {
          markWhatsAppReceiptSent(input.voucher.id);
        }
        notifyFeeReceiptPush(input.voucher.householdId, input.voucher);
        return {
          ok: true,
          mobile,
          mode: "api",
          pdfDownloaded: false,
          receiptUrl,
        };
      }
      const apiErr = (row?.error || dispatch.hint || "").toLowerCase();
      const sessionBlocked =
        apiErr.includes("24 hour") ||
        apiErr.includes("customer service") ||
        apiErr.includes("re-engagement") ||
        apiErr.includes("131047") ||
        apiErr.includes("131026");
      if (!sessionBlocked && row?.error) {
        return {
          ok: false,
          error: `WhatsApp API: ${row.error}`,
        };
      }
    } catch {
      /* fall through to wa.me / share */
    }
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
      notifyFeeReceiptPush(input.voucher.householdId, input.voucher);
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
  notifyFeeReceiptPush(input.voucher.householdId, input.voucher);
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

function normAyCode(code: string): string {
  const t = (code || "").trim().replace(/\s+/g, "").replace(/–/g, "-");
  const full = t.match(/^(20\d{2})-(20\d{2})$/);
  if (full) return `${full[1]}-${full[2]!.slice(2)}`;
  return t;
}

export function searchFeeStudents(
  query: string,
  sis?: SisState,
  masters?: MastersState,
  fees?: FeesState,
  filters?: {
    classId?: string;
    sectionId?: string;
    includeInactive?: boolean;
    /** Session scope; defaults to the current academic year. */
    academicYearCode?: string;
    /** Include fee months after the running session month in balance. Default false. */
    includeFuture?: boolean;
    /** Search every session record (legacy behaviour, repeats promoted students). */
    allSessions?: boolean;
  },
): StudentSearchHit[] {
  const s = sis ?? loadSis();
  const m = masters ?? loadMasters();
  const f = fees ?? loadFees();
  const q = query.trim().toLowerCase();
  const classId = filters?.classId ?? "";
  const sectionId = filters?.sectionId ?? "";
  // Index once. These were linear finds called per student: householdOf over
  // 193 households inside the filter for ~680 active students is ~131,000
  // comparisons per search, and className/sectionName repeated it for every
  // result. Debouncing hid the cost without removing it — the work still
  // blocked the main thread, which is what made typing feel like it hung.
  const classNameById = new Map(m.classes.map((c) => [c.id, c.name]));
  const sectionNameById = new Map(m.sections.map((x) => [x.id, x.name]));
  const householdById = new Map(s.households.map((h) => [h.id, h]));
  const className = (id: string) => classNameById.get(id) ?? "—";
  const sectionName = (id: string) => sectionNameById.get(id) ?? "";

  let list = filters?.includeInactive
    ? s.students.slice()
    : s.students.filter((st) => st.status === "active");
  if (!filters?.allSessions) {
    // One record per student: only the selected session (default = current AY),
    // so a child promoted across years is not repeated in pickers.
    const scope = normAyCode(
      filters?.academicYearCode || currentAcademicYearCode(m),
    );
    const scoped = list.filter(
      (st) => normAyCode(st.academicYearCode) === scope,
    );
    // Fall back to all records if the scope matches nothing (odd AY codes).
    if (scoped.length || list.length === 0) list = scoped;
  }
  if (classId) {
    list = list.filter((st) => st.classId === classId);
  }
  if (sectionId) {
    list = list.filter((st) => st.sectionId === sectionId);
  }
  if (q) {
    list = list.filter((st) => {
      const hh = householdById.get(st.householdId);
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
      const dues = computeStudentDues(student, m, f, {
        includeFuture: filters?.includeFuture ?? false,
      });
      const balancePaise = openFeeDues(dues).reduce(
        (sum, d) => sum + d.balancePaise,
        0,
      );
      const hh = householdById.get(student.householdId) ?? null;
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
        line.kind === "arrears" ||
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
                  : line.dueKey.startsWith("arrears:")
                    ? "arrears"
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
    { kind: "arrears", label: "Previous session arrears" },
    { kind: "academic", label: "Academic fees" },
    { kind: "transport", label: "Transport" },
    { kind: "special", label: "Special / misc" },
    { kind: "store", label: "Store / books" },
    { kind: "voucher", label: "Charge vouchers" },
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
  void import("@/lib/accountsPostings")
    .then((m) => {
      m.applyDayCloseHandover(session);
    })
    .catch(() => {
      /* accounts optional */
    });
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
