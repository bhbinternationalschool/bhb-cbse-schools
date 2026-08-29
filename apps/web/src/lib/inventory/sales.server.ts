/**
 * Inventory — the sales counter.
 *
 * Posting a sale, taking it back and cancelling it are all done by database
 * functions (`inv_post_sale`, `inv_post_sale_return`, `inv_void_sale`), so
 * stock, cost, money and the receivable always move together. This file reads,
 * finds buyers, and shapes payloads.
 *
 * Credit balances live on `inv_sales.balance_paise` and are never pushed into
 * `fee_desk_open_dues`: that table is rebuilt wholesale by the fees client,
 * which deletes every row for the year absent from its payload, so anything
 * written there from here would survive until the next fee push and no longer.
 *
 * The fee counter instead reads them live through `storeDuesForStudents` and
 * settles them through `collectOnSale` with the receipt as `externalRef`, so a
 * retry cannot take the money twice.
 */

import { InvError, invCtx, type InvCtx } from "@/lib/inventory/db.server";
import type {
  InvBuyerKind,
  InvBuyerStudent,
  InvCounterSummary,
  InvSaleLine,
  InvSalePage,
  InvSalePayment,
  InvSaleQuery,
  InvSaleReturn,
  InvSaleStatus,
  InvTenderMode,
} from "@/lib/inventory/types";

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? "" : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const int = (v: unknown): number => Math.trunc(num(v));
const dateOnly = (v: unknown): string => str(v).slice(0, 10);

/** Strip Postgres framing so the counter reads the message, not the plumbing. */
function cleanDbMessage(raw: string): string {
  return String(raw ?? "")
    .replace(/^ERROR:\s*/i, "")
    .replace(/\s*CONTEXT:[\s\S]*$/i, "")
    .trim();
}

/** PostgREST `or()` takes a comma-separated filter list — strip its syntax. */
function sanitizeSearch(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/[,()*\\%]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 60);
}

/* ─── Finding a buyer ──────────────────────────────────────── */

/**
 * Search the student roster for the counter.
 *
 * Reads `sis_students` directly rather than the fees module's client-side
 * copy: the counter must work on a machine that has never opened the roster.
 */
export async function findStudents(
  search: string,
  academicYearCode: string,
  classId = "",
  sectionId = "",
): Promise<InvBuyerStudent[]> {
  const term = sanitizeSearch(search);
  // With a class chosen the counter is browsing a roster, not searching —
  // an empty term then means "everyone in this class".
  if (term.length < 2 && !classId) return [];

  const { sb, tenantId } = await invCtx();
  let q = sb
    .from("sis_students")
    .select(
      "id, full_name, admission_no, class_id, section_id, roll_no, father_name," +
        " father_mobile, mother_mobile, household_id, status, academic_year_code",
    )
    .eq("tenant_id", tenantId);

  if (term.length >= 2) {
    q = q.or(
      `full_name.ilike.%${term}%,admission_no.ilike.%${term}%,` +
        `roll_no.ilike.%${term}%,father_mobile.ilike.%${term}%`,
    );
  }
  if (classId) q = q.eq("class_id", classId);
  if (sectionId) q = q.eq("section_id", sectionId);

  if (academicYearCode) q = q.eq("academic_year_code", academicYearCode);

  const { data, error } = await q.order("full_name").limit(classId ? 80 : 30);
  if (error) throw new InvError(`Student search: ${error.message}`, 500);

  // sis_students is outside this module's generated types, so the row shape
  // is asserted and then read through the same coercion helpers as everything
  // else — nothing is trusted to already be a string.
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: str(r.id),
    fullName: str(r.full_name),
    admissionNo: str(r.admission_no),
    classId: str(r.class_id),
    sectionId: str(r.section_id),
    rollNo: str(r.roll_no),
    fatherName: str(r.father_name),
    phone: str(r.father_mobile) || str(r.mother_mobile),
    householdId: str(r.household_id),
    status: str(r.status),
  }));
}

/**
 * The other children of one household.
 *
 * A parent buying for three children should be served once, not three times.
 * Reads `sis_students` directly for the same reason `findStudents` does: the
 * counter has to work on a machine that has never opened the roster.
 */
export async function householdSiblings(
  householdId: string,
  academicYearCode: string,
): Promise<InvBuyerStudent[]> {
  if (!householdId) return [];

  const { sb, tenantId } = await invCtx();
  let q = sb
    .from("sis_students")
    .select(
      "id, full_name, admission_no, class_id, section_id, roll_no, father_name," +
        " father_mobile, mother_mobile, household_id, status, academic_year_code",
    )
    .eq("tenant_id", tenantId)
    .eq("household_id", householdId);

  if (academicYearCode) q = q.eq("academic_year_code", academicYearCode);

  const { data, error } = await q.order("full_name").limit(20);
  if (error) throw new InvError(`Household lookup: ${error.message}`, 500);

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: str(r.id),
    fullName: str(r.full_name),
    admissionNo: str(r.admission_no),
    classId: str(r.class_id),
    sectionId: str(r.section_id),
    rollNo: str(r.roll_no),
    fatherName: str(r.father_name),
    phone: str(r.father_mobile) || str(r.mother_mobile),
    householdId: str(r.household_id),
    status: str(r.status),
  }));
}

/* ─── Reading sales ────────────────────────────────────────── */

function rowToLine(r: Row): InvSaleLine {
  return {
    id: str(r.id),
    saleId: str(r.sale_id),
    itemId: str(r.item_id),
    itemName: str(r.item_name),
    sku: str(r.sku),
    qty: num(r.qty),
    unitPricePaise: int(r.unit_price_paise),
    discountPct: num(r.discount_pct),
    discountPaise: int(r.discount_paise),
    lineTotalPaise: int(r.line_total_paise),
    gstRate: num(r.gst_rate),
    taxPaise: int(r.tax_paise),
    unitCostPaise: int(r.unit_cost_paise),
    sortOrder: int(r.sort_order),
  };
}

function rowToPayment(r: Row): InvSalePayment {
  return {
    id: str(r.id),
    saleId: str(r.sale_id),
    paidOn: dateOnly(r.paid_on),
    amountPaise: int(r.amount_paise),
    mode: str(r.mode) as InvTenderMode,
    reference: str(r.reference),
    bankAccountId: str(r.bank_account_id),
    note: str(r.note),
    createdBy: str(r.created_by),
  };
}

export async function listSales(query: InvSaleQuery): Promise<InvSalePage> {
  const { sb, tenantId } = await invCtx();

  const page = Math.max(1, Math.trunc(Number(query.page) || 1));
  const pageSize = Math.min(200, Math.max(5, Math.trunc(Number(query.pageSize) || 50)));

  let q = sb
    .from("inv_sales")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenantId);

  if (query.saleId) q = q.eq("id", query.saleId);
  if (query.status === "unpaid") q = q.in("status", ["open", "part_paid"]);
  else if (query.status && query.status !== "all") q = q.eq("status", query.status);
  if (query.buyerKind) q = q.eq("buyer_kind", query.buyerKind);
  if (query.studentId) q = q.eq("student_id", query.studentId);
  if (query.fromDate) q = q.gte("sale_date", query.fromDate);
  if (query.toDate) q = q.lte("sale_date", query.toDate);

  const term = sanitizeSearch(query.search);
  if (term) {
    q = q.or(`sale_no.ilike.%${term}%,buyer_name.ilike.%${term}%,buyer_phone.ilike.%${term}%`);
  }

  const { data, error, count } = await q
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new InvError(`Sales: ${error.message}`, 500);

  const rows = (data ?? []) as Row[];
  if (rows.length === 0) {
    return { rows: [], total: count ?? 0, page, pageSize };
  }

  const saleIds = rows.map((r) => str(r.id));
  const [lineRes, payRes, retRes, voucherRes] = await Promise.all([
    sb
      .from("inv_sale_lines")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("sale_id", saleIds)
      .order("sort_order"),
    sb
      .from("inv_sale_payments")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("sale_id", saleIds)
      .order("paid_on"),
    sb
      .from("inv_sale_return_lines")
      .select("sale_line_id, qty")
      .eq("tenant_id", tenantId),
    // The school books voucher for each sale — the official receipt number
    // the office quotes, alongside the store's own sale number.
    sb
      .from("ledger_vouchers")
      .select("source_id, voucher_no")
      .eq("tenant_id", tenantId)
      .eq("source_type", "inv_sale")
      .in("source_id", saleIds),
  ]);

  const voucherBySale = new Map<string, string>();
  for (const v of (voucherRes.data ?? []) as Row[]) {
    voucherBySale.set(str(v.source_id), str(v.voucher_no));
  }

  const returnedByLine = new Map<string, number>();
  for (const r of (retRes.data ?? []) as Row[]) {
    const key = str(r.sale_line_id);
    if (!key) continue;
    returnedByLine.set(key, (returnedByLine.get(key) ?? 0) + num(r.qty));
  }

  const linesBySale = new Map<string, InvSaleLine[]>();
  for (const l of (lineRes.data ?? []) as Row[]) {
    const line = rowToLine(l);
    line.qtyReturned = returnedByLine.get(line.id) ?? 0;
    const list = linesBySale.get(line.saleId) ?? [];
    list.push(line);
    linesBySale.set(line.saleId, list);
  }

  const paysBySale = new Map<string, InvSalePayment[]>();
  for (const p of (payRes.data ?? []) as Row[]) {
    const pay = rowToPayment(p);
    const list = paysBySale.get(pay.saleId) ?? [];
    list.push(pay);
    paysBySale.set(pay.saleId, list);
  }

  return {
    rows: rows.map((r) => {
      const id = str(r.id);
      const total = int(r.total_paise);
      const cost = int(r.cost_paise);
      return {
        id,
        saleNo: str(r.sale_no),
        academicYearCode: str(r.academic_year_code),
        saleDate: dateOnly(r.sale_date),
        buyerKind: str(r.buyer_kind) as InvBuyerKind,
        studentId: str(r.student_id),
        staffId: str(r.staff_id),
        buyerName: str(r.buyer_name),
        buyerPhone: str(r.buyer_phone),
        classId: str(r.class_id),
        sectionId: str(r.section_id),
        locationId: str(r.location_id),
        priceListId: str(r.price_list_id),
        kitId: str(r.kit_id),
        subtotalPaise: int(r.subtotal_paise),
        discountPaise: int(r.discount_paise),
        taxPaise: int(r.tax_paise),
        totalPaise: total,
        paidPaise: int(r.paid_paise),
        balancePaise: int(r.balance_paise),
        costPaise: cost,
        status: str(r.status) as InvSaleStatus,
        note: str(r.note),
        createdBy: str(r.created_by),
        createdAt: str(r.created_at),
        voidedAt: str(r.voided_at),
        voidReason: str(r.void_reason),
        lines: linesBySale.get(id) ?? [],
        payments: paysBySale.get(id) ?? [],
        // A cancelled sale earned nothing, whatever its line values say.
        marginPaise: str(r.status) === "void" ? 0 : total - cost,
        ledgerVoucherNo: voucherBySale.get(id) ?? "",
        manualReceiptNo: str(r.manual_receipt_no),
      };
    }),
    total: count ?? rows.length,
    page,
    pageSize,
  };
}

/* ─── Posting ──────────────────────────────────────────────── */

export async function postSale(
  input: {
    buyerKind: InvBuyerKind;
    studentId?: string;
    staffId?: string;
    buyerName?: string;
    buyerPhone?: string;
    classId?: string;
    sectionId?: string;
    locationId?: string;
    priceListId?: string;
    kitId?: string;
    saleDate?: string;
    manualReceiptNo?: string;
    note?: string;
    lines: {
      itemId: string;
      qty: number;
      unitPricePaise: number;
      discountPct?: number;
      gstRate?: number;
    }[];
    payments?: { amountPaise: number; mode?: InvTenderMode; reference?: string }[];
  },
  actor: string,
  academicYearCode: string,
): Promise<{
  saleId: string;
  saleNo: string;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  status: InvSaleStatus;
  /** Empty when the server ledger is not in use for this school. */
  ledgerVoucherNo: string;
}> {
  const lines = (input.lines ?? []).filter((l) => l && l.itemId && Number(l.qty) > 0);
  if (lines.length === 0) {
    throw new InvError("Add at least one item to the sale", 400);
  }
  if (input.buyerKind === "student" && !input.studentId) {
    throw new InvError("Choose the student this sale is for", 400);
  }
  if (input.buyerKind === "walkin" && !String(input.buyerName ?? "").trim()) {
    throw new InvError("A walk-in sale needs a buyer name", 400);
  }

  const { sb, tenantId } = await invCtx();
  const { data, error } = await sb.rpc("inv_post_sale", {
    p_tenant_id: tenantId,
    p_actor: actor,
    p_payload: {
      academic_year_code: academicYearCode,
      buyer_kind: input.buyerKind,
      student_id: str(input.studentId),
      staff_id: str(input.staffId),
      buyer_name: str(input.buyerName),
      buyer_phone: str(input.buyerPhone),
      class_id: str(input.classId),
      section_id: str(input.sectionId),
      location_id: input.locationId || null,
      price_list_id: input.priceListId || null,
      kit_id: input.kitId || null,
      sale_date: input.saleDate || null,
      note: str(input.note),
      lines: lines.map((l) => ({
        item_id: l.itemId,
        qty: Number(l.qty),
        unit_price_paise: Math.max(0, int(l.unitPricePaise)),
        discount_pct: Math.max(0, num(l.discountPct)),
        gst_rate: Math.max(0, num(l.gstRate)),
      })),
      payments: (input.payments ?? [])
        .filter((p) => p && Number(p.amountPaise) > 0)
        .map((p) => ({
          amount_paise: int(p.amountPaise),
          mode: p.mode || "cash",
          reference: str(p.reference),
        })),
    },
  });
  if (error) throw new InvError(cleanDbMessage(error.message), 409);

  const out = (data ?? {}) as Row;

  // Post-insert metadata: the paper receipt-book number the clerk copied
  // from the manual book. Kept out of the posting RPC on purpose — it is
  // reference data, not money, and must never fail a sale.
  const manualNo = str(input.manualReceiptNo).trim().slice(0, 40);
  if (manualNo && out.sale_id) {
    await sb
      .from("inv_sales")
      .update({ manual_receipt_no: manualNo })
      .eq("tenant_id", tenantId)
      .eq("id", str(out.sale_id));
  }

  return {
    saleId: str(out.sale_id),
    saleNo: str(out.sale_no),
    totalPaise: int(out.total_paise),
    paidPaise: int(out.paid_paise),
    balancePaise: int(out.balance_paise),
    status: str(out.status) as InvSaleStatus,
    ledgerVoucherNo: str(out.ledger_voucher_no),
  };
}

/**
 * Collect against an outstanding sale balance.
 *
 * Refuses to take more than is owed — a sale showing more paid than it is
 * worth hides either a keying error or a duplicate receipt.
 */
/**
 * Collect against an outstanding sale balance.
 *
 * Delegates to `inv_collect_on_sale`, so the payment row, the sale's new
 * balance and the ledger receipt commit together. These used to be three
 * separate requests, any of which could land without the others.
 */
export async function collectOnSale(
  input: {
    saleId: string;
    amountPaise: number;
    mode?: InvTenderMode;
    reference?: string;
    /** Bank account that received it — empty for cash. */
    bankAccountId?: string;
    paidOn?: string;
    note?: string;
    /**
     * An outside document this collection belongs to — a fee receipt number.
     * Makes the call safely repeatable: a replay settles once.
     */
    externalRef?: string;
  },
  actor: string,
): Promise<{
  paidPaise: number;
  balancePaise: number;
  status: InvSaleStatus;
  ledgerVoucherNo: string;
  alreadyApplied: boolean;
}> {
  const amount = int(input.amountPaise);
  if (amount <= 0) throw new InvError("Amount must be more than zero", 400);

  const { sb, tenantId } = await invCtx();
  const { data, error } = await sb.rpc("inv_collect_on_sale", {
    p_tenant_id: tenantId,
    p_actor: actor,
    p_payload: {
      sale_id: input.saleId,
      amount_paise: amount,
      mode: input.mode || "cash",
      reference: str(input.reference),
      bank_account_id: str(input.bankAccountId),
      paid_on: input.paidOn || null,
      note: str(input.note),
      external_ref: str(input.externalRef),
    },
  });
  if (error) throw new InvError(cleanDbMessage(error.message), 409);

  const out = (data ?? {}) as Row;
  return {
    paidPaise: int(out.paid_paise),
    balancePaise: int(out.balance_paise),
    status: str(out.status) as InvSaleStatus,
    ledgerVoucherNo: str(out.ledger_voucher_no),
    alreadyApplied: out.already_applied === true,
  };
}

export async function postSaleReturn(
  input: {
    saleId: string;
    reason: string;
    settlement?: "reduce_balance" | "refund";
    refundMode?: string;
    /** Required for a non-cash refund: money out must be traceable. */
    refundReference?: string;
    restock?: boolean;
    returnDate?: string;
    note?: string;
    lines: { saleLineId: string; qty: number }[];
  },
  actor: string,
  academicYearCode: string,
): Promise<{
  returnId: string;
  returnNo: string;
  totalPaise: number;
  refundedPaise: number;
  balanceReducedPaise: number;
  /** Empty when the server ledger is not in use for this school. */
  ledgerVoucherNo: string;
  /** Echoed back so a receipt can quote it. Empty when no money moved. */
  refundReference: string;
}> {
  if (!String(input.reason ?? "").trim()) {
    throw new InvError("A reason is required for a sale return", 400);
  }
  const lines = (input.lines ?? []).filter((l) => l && l.saleLineId && Number(l.qty) > 0);
  if (lines.length === 0) {
    throw new InvError("Enter a return quantity on at least one line", 400);
  }

  const { sb, tenantId } = await invCtx();
  const { data, error } = await sb.rpc("inv_post_sale_return", {
    p_tenant_id: tenantId,
    p_actor: actor,
    p_payload: {
      academic_year_code: academicYearCode,
      sale_id: input.saleId,
      reason: String(input.reason).trim(),
      settlement: input.settlement || "reduce_balance",
      refund_mode: str(input.refundMode) || "cash",
      refund_reference: str(input.refundReference).trim(),
      restock: input.restock !== false,
      return_date: input.returnDate || null,
      note: str(input.note),
      lines: lines.map((l) => ({
        sale_line_id: l.saleLineId,
        qty: Number(l.qty),
      })),
    },
  });
  if (error) throw new InvError(cleanDbMessage(error.message), 409);

  const out = (data ?? {}) as Row;
  return {
    returnId: str(out.return_id),
    returnNo: str(out.return_no),
    totalPaise: int(out.total_paise),
    refundedPaise: int(out.refunded_paise),
    balanceReducedPaise: int(out.balance_reduced_paise),
    ledgerVoucherNo: str(out.ledger_voucher_no),
    refundReference: str(out.refund_reference),
  };
}

export async function voidSale(
  saleId: string,
  reason: string,
  actor: string,
): Promise<{ saleNo: string; status: string; ledgerVoucherNo: string }> {
  if (!String(reason ?? "").trim()) {
    throw new InvError("A reason is required to cancel a sale", 400);
  }
  const { sb, tenantId } = await invCtx();
  const { data, error } = await sb.rpc("inv_void_sale", {
    p_tenant_id: tenantId,
    p_actor: actor,
    p_sale_id: saleId,
    p_reason: String(reason).trim(),
  });
  if (error) throw new InvError(cleanDbMessage(error.message), 409);
  const out = (data ?? {}) as Row;
  return {
    saleNo: str(out.sale_no),
    status: str(out.status),
    ledgerVoucherNo: str(out.ledger_voucher_no),
  };
}

/* ─── Returns listing ──────────────────────────────────────── */

export async function listSaleReturns(opts: {
  saleId?: string;
}): Promise<InvSaleReturn[]> {
  const { sb, tenantId } = await invCtx();

  let q = sb
    .from("inv_sale_returns")
    .select("*, sale:inv_sales(sale_no, buyer_name)")
    .eq("tenant_id", tenantId);
  if (opts.saleId) q = q.eq("sale_id", opts.saleId);

  const { data, error } = await q.order("created_at", { ascending: false }).limit(300);
  if (error) throw new InvError(`Sale returns: ${error.message}`, 500);
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return [];

  const { data: lineData } = await sb
    .from("inv_sale_return_lines")
    .select("*, item:inv_items(name)")
    .eq("tenant_id", tenantId)
    .in("return_id", rows.map((r) => str(r.id)))
    .order("sort_order");

  const byReturn = new Map<string, InvSaleReturn["lines"]>();
  for (const l of (lineData ?? []) as Row[]) {
    const item = l.item as { name?: string } | null;
    const key = str(l.return_id);
    const list = byReturn.get(key) ?? [];
    list.push({
      id: str(l.id),
      saleLineId: str(l.sale_line_id),
      itemId: str(l.item_id),
      itemName: str(item?.name),
      qty: num(l.qty),
      unitPricePaise: int(l.unit_price_paise),
      amountPaise: int(l.amount_paise),
    });
    byReturn.set(key, list);
  }

  return rows.map((r) => {
    const sale = r.sale as { sale_no?: string; buyer_name?: string } | null;
    return {
      id: str(r.id),
      returnNo: str(r.return_no),
      saleId: str(r.sale_id),
      saleNo: str(sale?.sale_no),
      returnDate: dateOnly(r.return_date),
      reason: str(r.reason),
      subtotalPaise: int(r.subtotal_paise),
      taxPaise: int(r.tax_paise),
      totalPaise: int(r.total_paise),
      settlement: str(r.settlement) === "refund" ? "refund" : "reduce_balance",
      refundedPaise: int(r.refunded_paise),
      refundMode: str(r.refund_mode),
      restock: r.restock !== false,
      note: str(r.note),
      createdBy: str(r.created_by),
      buyerName: str(sale?.buyer_name),
      lines: byReturn.get(str(r.id)) ?? [],
    };
  });
}

/**
 * Give a store collection back when the fee receipt that paid it is voided.
 *
 * Keyed on the fee receipt number the collection was stamped with, so one
 * call undoes every store line that receipt settled. Idempotent: a payment
 * already reversed is skipped, so a retry cannot double-credit.
 */
export async function reverseCollectionByReceipt(input: {
  receiptNo: string;
  actor: string;
  reason?: string;
}): Promise<{
  reversed: number;
  amountPaise: number;
  sales: { saleNo: string; status: string; amountPaise: number }[];
}> {
  const { sb, tenantId } = await invCtx();
  const { data, error } = await sb.rpc("inv_reverse_collection", {
    p_tenant_id: tenantId,
    p_actor: input.actor,
    p_external_ref: input.receiptNo,
    p_reason: input.reason ?? "Fee receipt voided",
  });
  if (error) throw new InvError(cleanDbMessage(error.message), 422);
  const out = (data ?? {}) as Row;
  return {
    reversed: int(out.reversed),
    amountPaise: int(out.amount_paise),
    sales: ((out.sales ?? []) as Row[]).map((r) => ({
      saleNo: str(r.sale_no),
      status: str(r.status),
      amountPaise: int(r.amount_paise),
    })),
  };
}

/* ─── Counter summary ──────────────────────────────────────── */

export async function counterSummary(): Promise<InvCounterSummary> {
  const { sb, tenantId } = await invCtx();
  const today = new Date().toISOString().slice(0, 10);

  const [todayRes, openRes, payRes] = await Promise.all([
    sb
      .from("inv_sales")
      .select("total_paise, cost_paise, status")
      .eq("tenant_id", tenantId)
      .eq("sale_date", today)
      .neq("status", "void"),
    sb
      .from("inv_sales")
      .select("balance_paise")
      .eq("tenant_id", tenantId)
      .in("status", ["open", "part_paid"]),
    // Payments on a sale that was later CANCELLED do not count as money
    // taken: the void hands the money back and reverses the receipt in the
    // books, but the payment row stays as history — so the summary must
    // exclude it, the same way "Sold today" already excludes void sales.
    sb
      .from("inv_sale_payments")
      .select("amount_paise, sale:inv_sales!inner(status)")
      .eq("tenant_id", tenantId)
      .eq("paid_on", today)
      .neq("sale.status", "void"),
  ]);

  const todayRows = (todayRes.data ?? []) as Row[];
  const openRows = (openRes.data ?? []) as Row[];
  const payRows = (payRes.data ?? []) as Row[];

  const billed = todayRows.reduce((s, r) => s + int(r.total_paise), 0);
  const cost = todayRows.reduce((s, r) => s + int(r.cost_paise), 0);
  const outstanding = openRows.reduce((s, r) => s + int(r.balance_paise), 0);

  return {
    salesToday: todayRows.length,
    // Money actually taken today, including collections against older sales.
    collectedTodayPaise: payRows.reduce((s, r) => s + int(r.amount_paise), 0),
    billedTodayPaise: billed,
    marginTodayPaise: billed - cost,
    outstandingPaise: outstanding,
    outstandingCount: openRows.filter((r) => int(r.balance_paise) > 0).length,
  };
}

/**
 * Prices for a set of items on a price list, for the counter's cart.
 *
 * Returns the sale price and the discount cap together: the cart needs both
 * to show a line and to stop the clerk exceeding the cap before the database
 * has to refuse the whole sale.
 */
export async function counterPrices(
  itemIds: string[],
  priceListId: string,
): Promise<
  Record<string, { salePaise: number; mrpPaise: number; maxDiscountPct: number }>
> {
  const ids = (itemIds ?? []).filter(Boolean);
  if (ids.length === 0) return {};

  const ctx: InvCtx = await invCtx();
  let listId = priceListId;
  if (!listId) {
    const { data } = await ctx.sb
      .from("inv_price_lists")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("is_default", true)
      .limit(1)
      .maybeSingle();
    listId = data?.id ? str(data.id) : "";
  }
  if (!listId) return {};

  const { data } = await ctx.sb
    .from("inv_price_list_items")
    .select("item_id, sale_paise, mrp_paise, max_discount_pct")
    .eq("tenant_id", ctx.tenantId)
    .eq("price_list_id", listId)
    .in("item_id", ids);

  const out: Record<
    string,
    { salePaise: number; mrpPaise: number; maxDiscountPct: number }
  > = {};
  for (const r of (data ?? []) as Row[]) {
    out[str(r.item_id)] = {
      salePaise: int(r.sale_paise),
      mrpPaise: int(r.mrp_paise),
      maxDiscountPct: num(r.max_discount_pct),
    };
  }
  return out;
}


/* ─── Store dues for the fee counter ───────────────────────── */

export type InvStoreDue = {
  saleId: string;
  saleNo: string;
  studentId: string;
  buyerName: string;
  saleDate: string;
  academicYearCode: string;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  itemSummary: string;
};

/**
 * What these students still owe the store.
 *
 * Read live rather than mirrored into the fee module's own tables: the fees
 * client rebuilds those wholesale and would delete anything it did not
 * produce. One request per household on the counter is cheap; a mirror that
 * silently empties is not.
 */
export async function storeDuesForStudents(
  studentIds: string[],
): Promise<InvStoreDue[]> {
  const ids = [...new Set((studentIds ?? []).filter(Boolean))];
  if (ids.length === 0) return [];

  const { sb, tenantId } = await invCtx();
  const { data, error } = await sb.rpc("inv_store_dues_for_students", {
    p_tenant_id: tenantId,
    p_student_ids: ids,
  });
  if (error) throw new InvError(`Store dues: ${error.message}`, 500);

  return ((data ?? []) as Row[]).map((r) => ({
    saleId: str(r.sale_id),
    saleNo: str(r.sale_no),
    studentId: str(r.student_id),
    buyerName: str(r.buyer_name),
    saleDate: dateOnly(r.sale_date),
    academicYearCode: str(r.academic_year_code),
    totalPaise: int(r.total_paise),
    paidPaise: int(r.paid_paise),
    balancePaise: int(r.balance_paise),
    itemSummary: str(r.item_summary),
  }));
}

/* ─── What a student already bought ────────────────────────── */

export type InvStudentPurchase = {
  itemId: string;
  itemName: string;
  totalQty: number;
  saleCount: number;
  lastSaleDate: string;
  lastSaleNo: string;
};

/**
 * What this student has already taken this academic year.
 *
 * The counter shows it while the cart is still open, so a clerk about to ring
 * up a second set of the same books sees that the child already has them.
 * A warning, never a block: a replacement set in March is ordinary, and a
 * counter that refuses honest work gets worked around.
 */
export async function studentPurchases(
  studentId: string,
  academicYearCode = "",
): Promise<InvStudentPurchase[]> {
  if (!studentId) return [];
  const { sb, tenantId } = await invCtx();
  const { data, error } = await sb.rpc("inv_student_purchases", {
    p_tenant_id: tenantId,
    p_student_id: studentId,
    p_academic_year_code: academicYearCode,
  });
  if (error) throw new InvError(`Student purchases: ${error.message}`, 500);
  return ((data ?? []) as Row[]).map((r) => ({
    itemId: str(r.item_id),
    itemName: str(r.item_name),
    totalQty: num(r.total_qty),
    saleCount: int(r.sale_count),
    lastSaleDate: str(r.last_sale_date),
    lastSaleNo: str(r.last_sale_no),
  }));
}

/* ─── One payment, several children ────────────────────────── */

export type InvHouseholdSaleResult = {
  sales: {
    saleId: string;
    saleNo: string;
    studentId: string;
    buyerName: string;
    totalPaise: number;
  }[];
  totalPaise: number;
  tenderedPaise: number;
  balancePaise: number;
};

/**
 * Serve several children of one household against a single payment.
 *
 * One sale per child, so each keeps their own receipt, their own dues line at
 * the fee counter and their own ledger party. Only the money is shared. It is
 * one transaction in the database: every child gets their books and their
 * receipt, or none do and the drawer is untouched.
 */
export async function postHouseholdSale(
  input: {
    sales: Record<string, unknown>[];
    payments: {
      amountPaise: number;
      mode: string;
      reference: string;
      paidOn?: string;
    }[];
    /** Paper receipt-book number — one payment, so one number for all children. */
    manualReceiptNo?: string;
  },
  actor: string,
  academicYearCode: string,
): Promise<InvHouseholdSaleResult> {
  const { sb, tenantId } = await invCtx();
  const { data, error } = await sb.rpc("inv_post_household_sale", {
    p_tenant_id: tenantId,
    p_actor: actor,
    p_payload: {
      // inv_post_sale numbers each receipt from academic_year_code — without
      // it the household path fell into a separate "SL/0001" series.
      sales: input.sales.map((s) => ({
        academic_year_code: academicYearCode,
        ...s,
      })),
      payments: input.payments.map((p) => ({
        amount_paise: p.amountPaise,
        mode: p.mode,
        reference: p.reference,
        // Collection date — falls back to the first sale's sale_date in SQL.
        paid_on: p.paidOn || "",
      })),
    },
  });
  if (error) throw new InvError(error.message, 422);
  const out = (data ?? {}) as Row;

  const manualNo = str(input.manualReceiptNo).trim().slice(0, 40);
  const saleIds = ((out.sales ?? []) as Row[])
    .map((r) => str(r.sale_id))
    .filter(Boolean);
  if (manualNo && saleIds.length > 0) {
    await sb
      .from("inv_sales")
      .update({ manual_receipt_no: manualNo })
      .eq("tenant_id", tenantId)
      .in("id", saleIds);
  }

  return {
    sales: ((out.sales ?? []) as Row[]).map((r) => ({
      saleId: str(r.sale_id),
      saleNo: str(r.sale_no),
      studentId: str(r.student_id),
      buyerName: str(r.buyer_name),
      totalPaise: int(r.total_paise),
    })),
    totalPaise: int(out.total_paise),
    tenderedPaise: int(out.tendered_paise),
    balancePaise: int(out.balance_paise),
  };
}
