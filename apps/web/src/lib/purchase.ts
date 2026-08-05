/**
 * Purchase — indent → PO → GRN (§20c).
 * Demo store: localStorage `bhb_purchase_v1`.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import {
  createVendorBill,
  creditVendorBill,
  loadAccounts,
  seedAccountsIfEmpty,
  upsertVendor,
} from "@/lib/accounts";
import { DEFAULT_AY, formatInr } from "@/lib/masters";
import {
  describeFilters,
  exportFilterReport,
  type ReportColumn,
} from "@/lib/reportExport";
import { adjustStock, loadStore } from "@/lib/store";
import { parseBillOcrFromText } from "@/lib/ocrParse";
import { TENANT } from "@/lib/types";

const STORAGE_KEY = "bhb_purchase_v1";

let serverPurchaseCache: PurchaseState | null = null;

/* ─── Types ─────────────────────────────────────────────────── */

export type IndentStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "converted"
  | "cancelled";

export type IndentLine = {
  id: string;
  description: string;
  skuItemId?: string;
  qty: number;
  uom: string;
  estRatePaise: number;
};

export type PurchaseIndent = {
  id: string;
  indentNo: string;
  academicYearCode: string;
  requesterName: string;
  requesterStaffId: string;
  department: string;
  urgency: "normal" | "urgent";
  status: IndentStatus;
  lines: IndentLine[];
  note: string;
  createdAt: string;
  submittedAt: string;
  decidedBy: string;
  decidedAt: string;
  decisionNote: string;
  estimatedPaise: number;
};

export type PoStatus =
  | "draft"
  | "issued"
  | "partial_grn"
  | "closed"
  | "cancelled";

export type PoLine = {
  id: string;
  description: string;
  skuItemId?: string;
  qty: number;
  uom: string;
  ratePaise: number;
};

export type PurchaseOrder = {
  id: string;
  poNo: string;
  indentId?: string;
  vendorId: string;
  vendorName: string;
  lines: PoLine[];
  status: PoStatus;
  approvedBy: string;
  approvedAt: string;
  academicYearCode: string;
  note: string;
  createdAt: string;
  discountPaise: number;
  taxPaise: number;
  amountPaise: number;
};

export type GrnDestination = "store" | "library" | "asset" | "expense";

export type GrnLine = {
  id: string;
  poLineId: string;
  description: string;
  skuItemId?: string;
  qtyOrdered: number;
  qtyReceived: number;
  uom: string;
};

export type Grn = {
  id: string;
  grnNo: string;
  poId: string;
  date: string;
  lines: GrnLine[];
  destination: GrnDestination;
  photoNote: string;
  /** Data URL or external URL of bill / challan scan */
  billImageUrl: string;
  /** OCR / stub suggested invoice number used on vendor bill */
  ocrBillNo: string;
  createdBy: string;
  createdAt: string;
  vendorBillId?: string;
  stockApplied: boolean;
};

export type PurchaseReturnLine = {
  id: string;
  grnLineId: string;
  description: string;
  skuItemId?: string;
  qty: number;
  ratePaise: number;
  amountPaise: number;
};

/** School returns goods to vendor against a GRN / vendor bill. */
export type PurchaseReturn = {
  id: string;
  returnNo: string;
  grnId: string;
  vendorBillId: string;
  vendorId: string;
  date: string;
  lines: PurchaseReturnLine[];
  amountPaise: number;
  note: string;
  createdBy: string;
  createdAt: string;
};

export type PurchaseSettings = {
  adminLimitPaise: number;
  principalLimitPaise: number;
};

export type PurchaseState = {
  version: 1;
  indents: PurchaseIndent[];
  orders: PurchaseOrder[];
  grns: Grn[];
  returns: PurchaseReturn[];
  settings: PurchaseSettings;
};

export type PurchaseReportId = "indent_register" | "open_pos" | "grn_register";

export type PurchaseReportFormat = "excel" | "pdf";

export type PurchaseReportDef = {
  id: PurchaseReportId;
  label: string;
  hint?: string;
};

export const PURCHASE_REPORTS: PurchaseReportDef[] = [
  {
    id: "indent_register",
    label: "Indent register",
    hint: "All indents in date range",
  },
  {
    id: "open_pos",
    label: "Open purchase orders",
    hint: "Issued / partial GRN POs",
  },
  {
    id: "grn_register",
    label: "GRN register",
    hint: "Goods received notes",
  },
];

/* ─── Helpers ───────────────────────────────────────────────── */

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function lineAmountPaise(qty: number, ratePaise: number) {
  return Math.round(Math.max(0, qty) * Math.max(0, ratePaise));
}

function sumPoLines(lines: PoLine[]) {
  return lines.reduce((s, l) => s + lineAmountPaise(l.qty, l.ratePaise), 0);
}

function normalizeIndentLine(l: Partial<IndentLine>): IndentLine {
  return {
    id: l.id ?? nid("iln"),
    description: l.description ?? "",
    skuItemId: l.skuItemId || undefined,
    qty: Math.max(0, Number(l.qty) || 0),
    uom: l.uom ?? "nos",
    estRatePaise: Math.max(0, Math.round(Number(l.estRatePaise) || 0)),
  };
}

function normalizeIndent(i: Partial<PurchaseIndent>): PurchaseIndent {
  const lines = Array.isArray(i.lines) ? i.lines.map(normalizeIndentLine) : [];
  const estimatedPaise =
    i.estimatedPaise ??
    lines.reduce((s, l) => s + lineAmountPaise(l.qty, l.estRatePaise), 0);
  return {
    id: i.id ?? nid("ind"),
    indentNo: i.indentNo ?? "",
    academicYearCode: i.academicYearCode ?? DEFAULT_AY,
    requesterName: i.requesterName ?? "",
    requesterStaffId: i.requesterStaffId ?? "",
    department: i.department ?? "",
    urgency: i.urgency === "urgent" ? "urgent" : "normal",
    status: (i.status as IndentStatus) ?? "draft",
    lines,
    note: i.note ?? "",
    createdAt: i.createdAt ?? nowIso(),
    submittedAt: i.submittedAt ?? "",
    decidedBy: i.decidedBy ?? "",
    decidedAt: i.decidedAt ?? "",
    decisionNote: i.decisionNote ?? "",
    estimatedPaise,
  };
}

function normalizePoLine(l: Partial<PoLine>): PoLine {
  return {
    id: l.id ?? nid("pln"),
    description: l.description ?? "",
    skuItemId: l.skuItemId || undefined,
    qty: Math.max(0, Number(l.qty) || 0),
    uom: l.uom ?? "nos",
    ratePaise: Math.max(0, Math.round(Number(l.ratePaise) || 0)),
  };
}

function normalizePo(o: Partial<PurchaseOrder>): PurchaseOrder {
  const lines = Array.isArray(o.lines) ? o.lines.map(normalizePoLine) : [];
  const subtotal = sumPoLines(lines);
  const discountPaise = Math.max(0, Math.round(Number(o.discountPaise) || 0));
  const taxPaise = Math.max(0, Math.round(Number(o.taxPaise) || 0));
  const amountPaise =
    o.amountPaise ?? Math.max(0, subtotal - discountPaise + taxPaise);
  return {
    id: o.id ?? nid("po"),
    poNo: o.poNo ?? "",
    indentId: o.indentId || undefined,
    vendorId: o.vendorId ?? "",
    vendorName: o.vendorName ?? "",
    lines,
    status: (o.status as PoStatus) ?? "draft",
    approvedBy: o.approvedBy ?? "",
    approvedAt: o.approvedAt ?? "",
    academicYearCode: o.academicYearCode ?? DEFAULT_AY,
    note: o.note ?? "",
    createdAt: o.createdAt ?? nowIso(),
    discountPaise,
    taxPaise,
    amountPaise,
  };
}

function normalizeGrnLine(l: Partial<GrnLine>): GrnLine {
  return {
    id: l.id ?? nid("gln"),
    poLineId: l.poLineId ?? "",
    description: l.description ?? "",
    skuItemId: l.skuItemId || undefined,
    qtyOrdered: Math.max(0, Number(l.qtyOrdered) || 0),
    qtyReceived: Math.max(0, Number(l.qtyReceived) || 0),
    uom: l.uom ?? "nos",
  };
}

function normalizeGrn(g: Partial<Grn>): Grn {
  return {
    id: g.id ?? nid("grn"),
    grnNo: g.grnNo ?? "",
    poId: g.poId ?? "",
    date: g.date ?? todayIso(),
    lines: Array.isArray(g.lines) ? g.lines.map(normalizeGrnLine) : [],
    destination: (g.destination as GrnDestination) ?? "store",
    photoNote: g.photoNote ?? "",
    billImageUrl: g.billImageUrl ?? "",
    ocrBillNo: g.ocrBillNo ?? "",
    createdBy: g.createdBy ?? "",
    createdAt: g.createdAt ?? nowIso(),
    vendorBillId: g.vendorBillId || undefined,
    stockApplied: !!g.stockApplied,
  };
}

function normalizePurchaseReturn(r: Partial<PurchaseReturn>): PurchaseReturn {
  const lines = Array.isArray(r.lines)
    ? r.lines.map((l) => ({
        id: l.id ?? nid("prln"),
        grnLineId: l.grnLineId ?? "",
        description: l.description ?? "",
        skuItemId: l.skuItemId || undefined,
        qty: Math.max(0, Math.floor(Number(l.qty) || 0)),
        ratePaise: Math.max(0, Math.round(Number(l.ratePaise) || 0)),
        amountPaise: Math.max(0, Math.round(Number(l.amountPaise) || 0)),
      }))
    : [];
  return {
    id: r.id ?? nid("pret"),
    returnNo: r.returnNo ?? "",
    grnId: r.grnId ?? "",
    vendorBillId: r.vendorBillId ?? "",
    vendorId: r.vendorId ?? "",
    date: r.date ?? todayIso(),
    lines,
    amountPaise:
      r.amountPaise != null
        ? Math.max(0, Math.round(Number(r.amountPaise)))
        : lines.reduce((s, l) => s + l.amountPaise, 0),
    note: r.note ?? "",
    createdBy: r.createdBy ?? "",
    createdAt: r.createdAt ?? nowIso(),
  };
}

function defaultSettings(): PurchaseSettings {
  return { adminLimitPaise: 500_000, principalLimitPaise: 5_000_000 };
}

export function emptyPurchaseState(): PurchaseState {
  return {
    version: 1,
    indents: [],
    orders: [],
    grns: [],
    returns: [],
    settings: defaultSettings(),
  };
}

function normalizeState(raw: Partial<PurchaseState> | null): PurchaseState {
  const base = emptyPurchaseState();
  if (!raw || typeof raw !== "object") return base;
  return {
    version: 1,
    indents: Array.isArray(raw.indents)
      ? raw.indents.map(normalizeIndent)
      : [],
    orders: Array.isArray(raw.orders) ? raw.orders.map(normalizePo) : [],
    grns: Array.isArray(raw.grns) ? raw.grns.map(normalizeGrn) : [],
    returns: Array.isArray(raw.returns)
      ? raw.returns.map(normalizePurchaseReturn)
      : [],
    settings: {
      adminLimitPaise:
        raw.settings?.adminLimitPaise ?? base.settings.adminLimitPaise,
      principalLimitPaise:
        raw.settings?.principalLimitPaise ?? base.settings.principalLimitPaise,
    },
  };
}

/* ─── Persistence ───────────────────────────────────────────── */

export function loadPurchase(): PurchaseState {
  if (typeof window === "undefined") {
    if (serverPurchaseCache) return serverPurchaseCache;
    return emptyPurchaseState();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyPurchaseState();
    return normalizeState(JSON.parse(raw) as Partial<PurchaseState>);
  } catch {
    return emptyPurchaseState();
  }
}

export function savePurchase(state: PurchaseState): void {
  if (!assertModulePermission("purchase", "edit", "savePurchase")) return;

  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  void import("@/lib/purchasePersistence").then(({ schedulePurchaseSync }) => {
    schedulePurchaseSync(state);
  });
}

export function writePurchaseLocalRaw(state: PurchaseState): void {
  if (typeof window === "undefined") {
    serverPurchaseCache = state;
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function purchaseStateIsEmpty(state: PurchaseState): boolean {
  return (
    (state.indents?.length ?? 0) === 0 &&
    (state.orders?.length ?? 0) === 0 &&
    (state.grns?.length ?? 0) === 0 &&
    (state.returns?.length ?? 0) === 0
  );
}

export function nextDocNo(
  prefix: string,
  ay: string,
  existingNos: string[],
): string {
  const esc = ay.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${prefix}/${esc}/(\\d+)$`);
  let max = 0;
  for (const no of existingNos) {
    const m = no.match(pattern);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}/${ay}/${String(max + 1).padStart(3, "0")}`;
}

export function requiredApproverHint(
  amountPaise: number,
  settings?: PurchaseSettings,
): string {
  const s = settings ?? loadPurchase().settings;
  if (amountPaise <= s.adminLimitPaise) {
    return `Admin (≤ ${formatInr(s.adminLimitPaise)})`;
  }
  if (amountPaise <= s.principalLimitPaise) {
    return `Principal (${formatInr(s.adminLimitPaise + 1)} – ${formatInr(s.principalLimitPaise)})`;
  }
  return `Owner / Managing Trustee (> ${formatInr(s.principalLimitPaise)})`;
}

export function seedPurchaseIfEmpty(): PurchaseState {
  const state = loadPurchase();
  if (state.indents.length > 0 || state.orders.length > 0) return state;

  const ay = DEFAULT_AY;
  const indentNo = nextDocNo("IND", ay, []);
  const lines: IndentLine[] = [
    normalizeIndentLine({
      description: "A4 ruled notebooks (200 pages)",
      qty: 500,
      uom: "nos",
      estRatePaise: 4500,
    }),
    normalizeIndentLine({
      description: "Blue ball pens",
      qty: 200,
      uom: "nos",
      estRatePaise: 1200,
    }),
  ];
  const indent = normalizeIndent({
    indentNo,
    academicYearCode: ay,
    requesterName: "Store incharge",
    requesterStaffId: "",
    department: "Store",
    urgency: "normal",
    status: "approved",
    lines,
    note: "Term-start stationery replenishment",
    submittedAt: nowIso(),
    decidedBy: "Admin",
    decidedAt: nowIso(),
    decisionNote: requiredApproverHint(
      lines.reduce((s, l) => s + lineAmountPaise(l.qty, l.estRatePaise), 0),
    ),
  });

  const next = { ...state, indents: [indent] };
  savePurchase(next);
  return next;
}

/* ─── Indent workflow ───────────────────────────────────────── */

export function createIndent(input: {
  academicYearCode: string;
  requesterName: string;
  requesterStaffId?: string;
  department: string;
  urgency?: "normal" | "urgent";
  lines: Array<Omit<IndentLine, "id">>;
  note?: string;
}): { ok: true; indent: PurchaseIndent } | { ok: false; error: string } {
  if (!input.requesterName.trim()) return fail("Requester name required");
  if (!input.department.trim()) return fail("Department required");
  if (!input.lines.length) return fail("Add at least one line");
  if (input.lines.some((l) => !l.description.trim() || l.qty <= 0)) {
    return fail("Each line needs description and quantity");
  }

  const state = loadPurchase();
  const indentNo = nextDocNo(
    "IND",
    input.academicYearCode,
    state.indents.map((i) => i.indentNo),
  );
  const indent = normalizeIndent({
    indentNo,
    academicYearCode: input.academicYearCode,
    requesterName: input.requesterName.trim(),
    requesterStaffId: input.requesterStaffId ?? "",
    department: input.department.trim(),
    urgency: input.urgency ?? "normal",
    status: "draft",
    lines: input.lines.map((l) => normalizeIndentLine(l)),
    note: input.note?.trim() ?? "",
  });
  savePurchase({ ...state, indents: [indent, ...state.indents] });
  return { ok: true, indent };
}

export function submitIndent(
  indentId: string,
): { ok: true; indent: PurchaseIndent } | { ok: false; error: string } {
  const state = loadPurchase();
  const i = state.indents.findIndex((x) => x.id === indentId);
  if (i < 0) return fail("Indent not found");
  const cur = state.indents[i];
  if (cur.status !== "draft") return fail("Only draft indents can be submitted");
  const indent: PurchaseIndent = {
    ...cur,
    status: "submitted",
    submittedAt: nowIso(),
  };
  const indents = [...state.indents];
  indents[i] = indent;
  savePurchase({ ...state, indents });
  return { ok: true, indent };
}

export function decideIndent(input: {
  indentId: string;
  approve: boolean;
  by: string;
  note?: string;
}): { ok: true; indent: PurchaseIndent } | { ok: false; error: string } {
  const state = loadPurchase();
  const i = state.indents.findIndex((x) => x.id === input.indentId);
  if (i < 0) return fail("Indent not found");
  const cur = state.indents[i];
  if (cur.status !== "submitted") {
    return fail("Only submitted indents can be decided");
  }
  const hint = requiredApproverHint(cur.estimatedPaise, state.settings);
  const decisionNote = [
    input.note?.trim(),
    input.approve ? `Approver tier: ${hint}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const indent: PurchaseIndent = {
    ...cur,
    status: input.approve ? "approved" : "rejected",
    decidedBy: input.by,
    decidedAt: nowIso(),
    decisionNote,
  };
  const indents = [...state.indents];
  indents[i] = indent;
  savePurchase({ ...state, indents });
  return { ok: true, indent };
}

/* ─── Purchase orders ───────────────────────────────────────── */

function poNetAmount(
  lines: PoLine[],
  discountPaise: number,
  taxPaise: number,
) {
  return Math.max(0, sumPoLines(lines) - discountPaise + taxPaise);
}

function receivedQtyForPoLine(
  state: PurchaseState,
  poId: string,
  poLineId: string,
): number {
  return state.grns
    .filter((g) => g.poId === poId)
    .flatMap((g) => g.lines)
    .filter((l) => l.poLineId === poLineId)
    .reduce((s, l) => s + l.qtyReceived, 0);
}

function recomputePoStatus(
  po: PurchaseOrder,
  state: PurchaseState,
): PoStatus {
  if (po.status === "draft" || po.status === "cancelled") return po.status;
  let anyReceived = false;
  let allClosed = true;
  for (const line of po.lines) {
    const prev = receivedQtyForPoLine(state, po.id, line.id);
    if (prev > 0) anyReceived = true;
    if (prev < line.qty) allClosed = false;
  }
  if (allClosed && po.lines.length > 0) return "closed";
  if (anyReceived) return "partial_grn";
  return "issued";
}

export function convertIndentToPo(input: {
  indentId: string;
  vendorId: string;
  vendorName: string;
  rates?: Record<string, number>;
  discountPaise?: number;
  taxPaise?: number;
  note?: string;
}): { ok: true; order: PurchaseOrder } | { ok: false; error: string } {
  const state = loadPurchase();
  const indent = state.indents.find((x) => x.id === input.indentId);
  if (!indent) return fail("Indent not found");
  if (indent.status !== "approved") {
    return fail("Only approved indents can be converted");
  }
  if (!input.vendorName.trim()) return fail("Vendor required");

  const lines: PoLine[] = indent.lines.map((l) =>
    normalizePoLine({
      description: l.description,
      skuItemId: l.skuItemId,
      qty: l.qty,
      uom: l.uom,
      ratePaise: input.rates?.[l.id] ?? l.estRatePaise,
    }),
  );
  const discountPaise = Math.max(0, Math.round(Number(input.discountPaise) || 0));
  const taxPaise = Math.max(0, Math.round(Number(input.taxPaise) || 0));
  const poNo = nextDocNo(
    "PO",
    indent.academicYearCode,
    state.orders.map((o) => o.poNo),
  );
  const order = normalizePo({
    poNo,
    indentId: indent.id,
    vendorId: input.vendorId,
    vendorName: input.vendorName.trim(),
    lines,
    status: "draft",
    academicYearCode: indent.academicYearCode,
    note: input.note?.trim() ?? indent.note,
    discountPaise,
    taxPaise,
    amountPaise: poNetAmount(lines, discountPaise, taxPaise),
  });

  const indents = state.indents.map((x) =>
    x.id === indent.id ? { ...x, status: "converted" as IndentStatus } : x,
  );
  savePurchase({
    ...state,
    indents,
    orders: [order, ...state.orders],
  });
  return { ok: true, order };
}

export function createPoDirect(input: {
  academicYearCode: string;
  vendorId: string;
  vendorName: string;
  lines: Array<Omit<PoLine, "id">>;
  discountPaise?: number;
  taxPaise?: number;
  note?: string;
}): { ok: true; order: PurchaseOrder } | { ok: false; error: string } {
  if (!input.vendorName.trim()) return fail("Vendor required");
  if (!input.lines.length) return fail("Add at least one line");
  if (input.lines.some((l) => !l.description.trim() || l.qty <= 0)) {
    return fail("Each line needs description and quantity");
  }

  const state = loadPurchase();
  const lines = input.lines.map((l) => normalizePoLine(l));
  const discountPaise = Math.max(0, Math.round(Number(input.discountPaise) || 0));
  const taxPaise = Math.max(0, Math.round(Number(input.taxPaise) || 0));
  const poNo = nextDocNo(
    "PO",
    input.academicYearCode,
    state.orders.map((o) => o.poNo),
  );
  const order = normalizePo({
    poNo,
    vendorId: input.vendorId,
    vendorName: input.vendorName.trim(),
    lines,
    status: "draft",
    academicYearCode: input.academicYearCode,
    note: input.note?.trim() ?? "",
    discountPaise,
    taxPaise,
    amountPaise: poNetAmount(lines, discountPaise, taxPaise),
  });
  savePurchase({ ...state, orders: [order, ...state.orders] });
  return { ok: true, order };
}

export function issuePo(input: {
  poId: string;
  by: string;
}): { ok: true; order: PurchaseOrder } | { ok: false; error: string } {
  const state = loadPurchase();
  const i = state.orders.findIndex((x) => x.id === input.poId);
  if (i < 0) return fail("PO not found");
  const cur = state.orders[i];
  if (cur.status !== "draft") return fail("Only draft POs can be issued");
  const order: PurchaseOrder = {
    ...cur,
    status: "issued",
    approvedBy: input.by,
    approvedAt: nowIso(),
  };
  const orders = [...state.orders];
  orders[i] = order;
  savePurchase({ ...state, orders });
  return { ok: true, order };
}

/* ─── GRN ───────────────────────────────────────────────────── */

function resolvePurchaseExpenseCategoryId(): string {
  seedAccountsIfEmpty();
  const accounts = loadAccounts();
  const office = accounts.expenseCategories.find(
    (c) => c.name.toLowerCase() === "office" && c.isActive !== false,
  );
  const academic = accounts.expenseCategories.find(
    (c) => c.name.toLowerCase() === "academic" && c.isActive !== false,
  );
  return (
    office?.id ||
    academic?.id ||
    accounts.expenseCategories.find((c) => c.isActive !== false)?.id ||
    ""
  );
}

function ensureAccountsVendor(
  vendorId: string,
  vendorName: string,
): { ok: true; vendorId: string } | { ok: false; error: string } {
  seedAccountsIfEmpty();
  const accounts = loadAccounts();
  const existing = accounts.vendors.find((v) => v.id === vendorId);
  if (existing) return { ok: true, vendorId: existing.id };
  const byName = accounts.vendors.find(
    (v) => v.name.toLowerCase() === vendorName.trim().toLowerCase(),
  );
  if (byName) return { ok: true, vendorId: byName.id };
  const res = upsertVendor({ name: vendorName.trim(), type: "supplier" });
  if (!res.ok) return res;
  return { ok: true, vendorId: res.vendor.id };
}

export function receiveGrn(input: {
  poId: string;
  lines: Array<{
    poLineId: string;
    qtyReceived: number;
    /** Editable per-line description (used on VendorBill line). */
    description?: string;
    /** Editable per-line rate (in paise). Defaults to PO line rate. */
    ratePaise?: number;
    /** Editable per-line purchase ledger (expense category / COA bucket). */
    ledgerCategoryId?: string;
  }>;
  destination: GrnDestination;
  by: string;
  date?: string;
  /** Optional override for the GRN number (used as `receiptNo` on VendorBill). */
  grnNo?: string;
  /** Optional vendor override for Accounts AP. Defaults to PO vendor. */
  vendorId?: string;
  vendorName?: string;
  /** Optional narration for the VendorBill (shown in AP note). */
  vendorNarration?: string;
  /** Discount on (sum of above items rates). */
  discountType?: "none" | "percent" | "amount";
  discountPaise?: number;
  /** Tax amount to be added on net amount. */
  taxPaise?: number;
  photoNote?: string;
  billImageUrl?: string;
  /** When set, overrides auto bill no / amount / due on vendor bill */
  ocr?: {
    billNo?: string;
    /** Kept for backward compatibility; vendor bill amount is computed from item lines. */
    amountPaise?: number;
    dueOn?: string;
    billDate?: string;
  };
}): { ok: true; grn: Grn; order: PurchaseOrder } | { ok: false; error: string } {
  const state = loadPurchase();
  const po = state.orders.find((x) => x.id === input.poId);
  if (!po) return fail("PO not found");
  if (po.status !== "issued" && po.status !== "partial_grn") {
    return fail("PO must be issued before GRN");
  }
  if (!input.lines.some((l) => l.qtyReceived > 0)) {
    return fail("Enter received quantity for at least one line");
  }

  const grnLines: GrnLine[] = [];
  const vendorBillLines: import("@/lib/accounts").VendorBillLine[] = [];
  let grossPaise = 0;
  let stockApplied = false;

  const vendorRes = ensureAccountsVendor(
    input.vendorId ?? po.vendorId,
    input.vendorName ?? po.vendorName,
  );
  if (!vendorRes.ok) return vendorRes;

  const fallbackLedgerCategoryId = resolvePurchaseExpenseCategoryId();
  if (!fallbackLedgerCategoryId) return fail("No expense category in accounts");

  const billDate = input.ocr?.billDate || input.date || todayIso();

  for (const row of input.lines) {
    if (row.qtyReceived <= 0) continue;
    const poLine = po.lines.find((l) => l.id === row.poLineId);
    if (!poLine) return fail("Invalid PO line");
    const already = receivedQtyForPoLine(state, po.id, poLine.id);
    const remaining = poLine.qty - already;
    if (row.qtyReceived > remaining) {
      return fail(`Cannot receive more than remaining for ${poLine.description}`);
    }
    grnLines.push(
      normalizeGrnLine({
        poLineId: poLine.id,
        description: poLine.description,
        skuItemId: poLine.skuItemId,
        qtyOrdered: poLine.qty,
        qtyReceived: row.qtyReceived,
        uom: poLine.uom,
      }),
    );

    const ratePaise = row.ratePaise ?? poLine.ratePaise;
    const ledgerCategoryId =
      row.ledgerCategoryId && row.ledgerCategoryId.trim()
        ? row.ledgerCategoryId
        : fallbackLedgerCategoryId;
    const amountPaise = lineAmountPaise(row.qtyReceived, ratePaise);
    grossPaise += amountPaise;
    vendorBillLines.push({
      id: nid("vbln"),
      lineDate: billDate,
      itemName: row.description ?? poLine.description,
      description: row.description ?? poLine.description,
      qty: row.qtyReceived,
      unit: poLine.uom || "pcs",
      ratePaise,
      discountPaise: 0,
      taxPaise: 0,
      amountPaise,
      categoryId: ledgerCategoryId,
    });
  }

  if (input.destination === "store") {
    for (const line of grnLines) {
      if (!line.skuItemId) continue;
      const res = adjustStock({
        itemId: line.skuItemId,
        qtyDelta: line.qtyReceived,
        kind: "purchase_in",
        note: `GRN for ${po.poNo}`,
        by: input.by,
      });
      if (res.ok) stockApplied = true;
    }
  }

  const billNo = input.ocr?.billNo?.trim() || `GRN-${po.poNo}`;
  const dueOn = input.ocr?.dueOn?.trim() || billDate;

  const discountPaise = Math.max(0, Math.round(Number(input.discountPaise) || 0));
  const taxPaise = Math.max(0, Math.round(Number(input.taxPaise) || 0));
  const safeDiscountPaise = Math.min(discountPaise, grossPaise);
  const grandTotalPaise = Math.max(0, grossPaise - safeDiscountPaise + taxPaise);

  if (grandTotalPaise <= 0) return fail("Computed vendor bill amount must be greater than zero");

  const attachParts = [
    input.photoNote?.trim(),
    input.billImageUrl ? "Bill scan attached" : "",
    input.ocr?.billNo ? `OCR supplier invoice# ${input.ocr.billNo}` : "",
  ].filter(Boolean);

  const overrideGrnNo = input.grnNo?.trim();
  if (overrideGrnNo && state.grns.some((g) => g.grnNo === overrideGrnNo)) {
    return fail("GRN number already exists");
  }
  const grnNo = overrideGrnNo
    ? overrideGrnNo
    : nextDocNo(
        "GRN",
        po.academicYearCode,
        state.grns.map((g) => g.grnNo),
      );

  const billRes = createVendorBill({
    vendorId: vendorRes.vendorId,
    billNo,
    billDate,
    dueOn,
    amountPaise: grandTotalPaise,
    categoryId: vendorBillLines[0]?.categoryId ?? fallbackLedgerCategoryId,
    receiptNo: grnNo,
    supplierInvoiceNo: billNo,
    discountType: input.discountType ?? "none",
    discountPaise: safeDiscountPaise,
    taxPaise,
    grandTotalPaise,
    lines: vendorBillLines,
    narration: input.vendorNarration ?? `GRN against ${po.poNo} · ${po.vendorName}`,
    attachmentNote: attachParts.join(" · "),
  });
  if (!billRes.ok) return billRes;
  const grn = normalizeGrn({
    grnNo,
    poId: po.id,
    date: billDate,
    lines: grnLines,
    destination: input.destination,
    photoNote: input.photoNote?.trim() ?? "",
    billImageUrl: input.billImageUrl?.trim() ?? "",
    ocrBillNo: input.ocr?.billNo?.trim() ?? "",
    createdBy: input.by,
    vendorBillId: billRes.bill.id,
    stockApplied,
  });

  const grns = [grn, ...state.grns];
  const draftState: PurchaseState = { ...state, grns };
  const order: PurchaseOrder = {
    ...po,
    status: recomputePoStatus(po, draftState),
  };
  const orders = state.orders.map((x) => (x.id === po.id ? order : x));
  savePurchase({ ...draftState, orders });
  return { ok: true, grn, order };
}

/* ─── Labels ────────────────────────────────────────────────── */

export function indentStatusLabel(status: IndentStatus): string {
  const map: Record<IndentStatus, string> = {
    draft: "Draft",
    submitted: "Submitted",
    approved: "Approved",
    rejected: "Rejected",
    converted: "Converted to PO",
    cancelled: "Cancelled",
  };
  return map[status] ?? status;
}

export function poStatusLabel(status: PoStatus): string {
  const map: Record<PoStatus, string> = {
    draft: "Draft",
    issued: "Issued",
    partial_grn: "Partial GRN",
    closed: "Closed",
    cancelled: "Cancelled",
  };
  return map[status] ?? status;
}

export function grnDestinationLabel(dest: GrnDestination): string {
  const map: Record<GrnDestination, string> = {
    store: "Store",
    library: "Library",
    asset: "Fixed asset",
    expense: "Direct expense",
  };
  return map[dest] ?? dest;
}

/* ─── Reports ───────────────────────────────────────────────── */

function finishReport(
  title: string,
  filterNote: string,
  columns: ReportColumn[],
  rows: Record<string, string | number>[],
  format: PurchaseReportFormat,
): { ok: true; message: string } | { ok: false; error: string } {
  const r = exportFilterReport(
    {
      title,
      subtitle: TENANT.shortName,
      filterNote,
      columns,
      rows,
      fileBaseName: `purchase_${title.replace(/\W+/g, "_").toLowerCase()}`,
    },
    format,
  );
  if (!r.ok) return r;
  return { ok: true, message: `${title}: ${rows.length} row(s) exported` };
}

export function runPurchaseReport(
  id: PurchaseReportId,
  filters: {
    academicYearCode: string;
    fromDate: string;
    toDate: string;
    format: PurchaseReportFormat;
    purchase?: PurchaseState;
  },
): { ok: true; message: string } | { ok: false; error: string } {
  const purchase = filters.purchase ?? loadPurchase();
  const note = describeFilters([
    `AY ${filters.academicYearCode}`,
    `${filters.fromDate} → ${filters.toDate}`,
  ]);
  const from = filters.fromDate;
  const to = filters.toDate;

  switch (id) {
    case "indent_register": {
      const rows = purchase.indents
        .filter(
          (i) =>
            i.academicYearCode === filters.academicYearCode &&
            i.createdAt.slice(0, 10) >= from &&
            i.createdAt.slice(0, 10) <= to,
        )
        .map((i) => ({
          indentNo: i.indentNo,
          date: i.createdAt.slice(0, 10),
          requester: i.requesterName,
          department: i.department,
          urgency: i.urgency,
          status: indentStatusLabel(i.status),
          lines: i.lines.length,
          estimated: formatInr(i.estimatedPaise),
          decidedBy: i.decidedBy || "—",
        }));
      const cols: ReportColumn[] = [
        { key: "indentNo", header: "Indent no." },
        { key: "date", header: "Date" },
        { key: "requester", header: "Requester" },
        { key: "department", header: "Department" },
        { key: "urgency", header: "Urgency" },
        { key: "status", header: "Status" },
        { key: "lines", header: "Lines", align: "right" },
        { key: "estimated", header: "Estimated", align: "right" },
        { key: "decidedBy", header: "Decided by" },
      ];
      return finishReport("Indent register", note, cols, rows, filters.format);
    }
    case "open_pos": {
      const rows = purchase.orders
        .filter(
          (o) =>
            o.academicYearCode === filters.academicYearCode &&
            (o.status === "issued" || o.status === "partial_grn"),
        )
        .map((o) => {
          const received = o.lines.reduce(
            (s, l) => s + receivedQtyForPoLine(purchase, o.id, l.id),
            0,
          );
          const ordered = o.lines.reduce((s, l) => s + l.qty, 0);
          return {
            poNo: o.poNo,
            vendor: o.vendorName,
            status: poStatusLabel(o.status),
            ordered,
            received,
            pending: ordered - received,
            amount: formatInr(o.amountPaise),
            issued: o.approvedAt.slice(0, 10) || "—",
          };
        });
      const cols: ReportColumn[] = [
        { key: "poNo", header: "PO no." },
        { key: "vendor", header: "Vendor" },
        { key: "status", header: "Status" },
        { key: "ordered", header: "Ordered qty", align: "right" },
        { key: "received", header: "Received", align: "right" },
        { key: "pending", header: "Pending", align: "right" },
        { key: "amount", header: "PO amount", align: "right" },
        { key: "issued", header: "Issued on" },
      ];
      return finishReport("Open purchase orders", note, cols, rows, filters.format);
    }
    case "grn_register": {
      const poMap = new Map(purchase.orders.map((o) => [o.id, o]));
      const rows = purchase.grns
        .filter((g) => g.date >= from && g.date <= to)
        .map((g) => {
          const po = poMap.get(g.poId);
          const qty = g.lines.reduce((s, l) => s + l.qtyReceived, 0);
          return {
            grnNo: g.grnNo,
            date: g.date,
            poNo: po?.poNo ?? g.poId,
            vendor: po?.vendorName ?? "—",
            destination: grnDestinationLabel(g.destination),
            lines: g.lines.length,
            qtyReceived: qty,
            stockApplied: g.stockApplied ? "Yes" : "No",
            createdBy: g.createdBy,
          };
        });
      const cols: ReportColumn[] = [
        { key: "grnNo", header: "GRN no." },
        { key: "date", header: "Date" },
        { key: "poNo", header: "PO no." },
        { key: "vendor", header: "Vendor" },
        { key: "destination", header: "Destination" },
        { key: "lines", header: "Lines", align: "right" },
        { key: "qtyReceived", header: "Qty received", align: "right" },
        { key: "stockApplied", header: "Stock applied" },
        { key: "createdBy", header: "Received by" },
      ];
      return finishReport("GRN register", note, cols, rows, filters.format);
    }
    default:
      return fail("Unknown report");
  }
}

/** Active vendors from accounts (for PO vendor picker). */
export function listPurchaseVendors() {
  seedAccountsIfEmpty();
  return loadAccounts().vendors.filter((v) => v.isActive !== false);
}

/** Qty already returned per GRN line. */
export function purchaseReturnedQtyByGrnLine(
  grnId: string,
  state?: PurchaseState,
): Map<string, number> {
  const s = state ?? loadPurchase();
  const map = new Map<string, number>();
  for (const ret of s.returns) {
    if (ret.grnId !== grnId) continue;
    for (const line of ret.lines) {
      map.set(line.grnLineId, (map.get(line.grnLineId) ?? 0) + line.qty);
    }
  }
  return map;
}

function nextPurchaseReturnNo(state: PurchaseState): string {
  const n = state.returns.length + 1;
  const y = new Date().getFullYear().toString().slice(-2);
  return `PR${y}${String(n).padStart(4, "0")}`;
}

/**
 * Return goods to vendor against a GRN.
 * - Stock out (purchase_return_out) when destination was store
 * - Credits vendor bill / payable (reduces purchase amount & due)
 */
export function createPurchaseReturn(input: {
  grnId: string;
  date?: string;
  note?: string;
  createdBy?: string;
  lines: { grnLineId: string; qty: number; ratePaise?: number }[];
}):
  | { ok: true; purchaseReturn: PurchaseReturn; state: PurchaseState }
  | { ok: false; error: string } {
  const state = loadPurchase();
  const grn = state.grns.find((g) => g.id === input.grnId);
  if (!grn) return fail("GRN not found");
  if (!grn.vendorBillId) {
    return fail("GRN has no vendor bill — cannot return against AP");
  }
  const po = state.orders.find((o) => o.id === grn.poId);
  const accounts = loadAccounts();
  const bill = accounts.vendorBills.find((b) => b.id === grn.vendorBillId);
  if (!bill) return fail("Vendor bill not found");

  const already = purchaseReturnedQtyByGrnLine(grn.id, state);
  const returnLines: PurchaseReturnLine[] = [];
  let amountPaise = 0;

  for (const row of input.lines) {
    const qty = Math.max(0, Math.floor(Number(row.qty) || 0));
    if (!qty) continue;
    const gl = grn.lines.find((l) => l.id === row.grnLineId);
    if (!gl) return fail("GRN line not found");
    const left = gl.qtyReceived - (already.get(gl.id) ?? 0);
    if (qty > left) {
      return fail(`Cannot return more than ${left} of ${gl.description}`);
    }
    // Prefer explicit rate, else bill line match by description, else PO rate
    const billLine = bill.lines.find(
      (l) =>
        l.description === gl.description ||
        (gl.skuItemId && l.description.includes(gl.skuItemId)),
    );
    const poLine = po?.lines.find((l) => l.id === gl.poLineId);
    const ratePaise = Math.max(
      0,
      Math.round(
        Number(
          row.ratePaise ??
            billLine?.ratePaise ??
            poLine?.ratePaise ??
            0,
        ) || 0,
      ),
    );
    const lineAmount = ratePaise * qty;
    returnLines.push({
      id: nid("prln"),
      grnLineId: gl.id,
      description: gl.description,
      skuItemId: gl.skuItemId,
      qty,
      ratePaise,
      amountPaise: lineAmount,
    });
    amountPaise += lineAmount;
    already.set(gl.id, (already.get(gl.id) ?? 0) + qty);
  }

  if (!returnLines.length) return fail("Enter return quantities");
  if (amountPaise <= 0) {
    return fail("Return amount is zero — set rates on bill / PO lines");
  }
  if (amountPaise > bill.amountPaise) {
    return fail("Return amount exceeds vendor bill balance");
  }

  const purchaseReturn = normalizePurchaseReturn({
    id: nid("pret"),
    returnNo: nextPurchaseReturnNo(state),
    grnId: grn.id,
    vendorBillId: bill.id,
    vendorId: bill.vendorId,
    date: input.date || todayIso(),
    lines: returnLines,
    amountPaise,
    note: input.note?.trim() || "",
    createdBy: input.createdBy || "",
    createdAt: nowIso(),
  });

  if (grn.destination === "store" && grn.stockApplied) {
    for (const line of returnLines) {
      if (!line.skuItemId) continue;
      const stockRes = adjustStock({
        itemId: line.skuItemId,
        qtyDelta: -line.qty,
        kind: "purchase_return_out",
        note: `Purchase return ${purchaseReturn.returnNo}`,
        by: input.createdBy || "",
      });
      if (!stockRes.ok) return stockRes;
    }
  }

  const creditRes = creditVendorBill(
    bill.id,
    amountPaise,
    purchaseReturn.returnNo,
  );
  if (!creditRes.ok) return creditRes;

  const next: PurchaseState = {
    ...state,
    returns: [purchaseReturn, ...state.returns],
  };
  savePurchase(next);
  return { ok: true, purchaseReturn, state: next };
}

/** Store SKUs for indent / PO line linking. */
export function listPurchaseStoreItems() {
  return loadStore().items.filter((i) => i.isActive !== false);
}

/* ─── WhatsApp + OCR (demo) ─────────────────────────────────── */

export function composeWhatsAppPoIssued(input: {
  vendorName: string;
  poNo: string;
  amountPaise: number;
  lines: Array<{ description: string; qty: number; uom: string }>;
  schoolName?: string;
}): string {
  const school = input.schoolName || TENANT.nameDisplay || TENANT.shortName;
  const lineBrief = input.lines
    .slice(0, 6)
    .map((l) => `• ${l.description} × ${l.qty} ${l.uom}`)
    .join("\n");
  const more =
    input.lines.length > 6 ? `\n… +${input.lines.length - 6} more` : "";
  return [
    `*${school}*`,
    `Purchase order issued`,
    "",
    `Dear ${input.vendorName},`,
    `PO: *${input.poNo}*`,
    `Amount: ${formatInr(input.amountPaise)}`,
    "",
    lineBrief + more,
    "",
    "Please confirm delivery ETA. Thank you.",
  ].join("\n");
}

export type BillOcrSuggestion = {
  billNo: string;
  billDate: string;
  dueOn: string;
  amountPaise: number;
  note: string;
  /** Demo or Vision confidence label */
  confidence:
    | "vision_high"
    | "vision_medium"
    | "vision_low"
    | "demo_high"
    | "demo_medium"
    | "demo_low";
  rawTextPreview?: string;
};

/**
 * Demo / offline bill OCR: parses invoice # / ₹ amount from file name + note.
 * Prefer POST /api/ocr/bill with image for Google Vision.
 */
export function suggestBillOcr(input: {
  fileName?: string;
  photoNote?: string;
  fallbackAmountPaise: number;
  billDate?: string;
}): BillOcrSuggestion {
  return parseBillOcrFromText(`${input.fileName || ""} ${input.photoNote || ""}`, {
    fallbackAmountPaise: input.fallbackAmountPaise,
    billDate: input.billDate,
    fileName: input.fileName,
    photoNote: input.photoNote,
    engine: "demo",
  });
}
