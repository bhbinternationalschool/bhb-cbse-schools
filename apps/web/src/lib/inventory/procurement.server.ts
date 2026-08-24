/**
 * Inventory — procurement: indent → purchase order → goods receipt → bill.
 *
 * Reads and document editing live here. The two operations that move stock,
 * cost and money together — posting a receipt and posting a return — are
 * delegated to the `inv_post_grn` / `inv_post_purchase_return` database
 * functions so they happen in one transaction. Splitting them across separate
 * client calls would allow stock to land without its payable.
 */

import {
  clampPct,
  insertOrUpdate,
  INV_DEFAULT_SETTINGS,
  InvError,
  invCtx,
  nullable,
  type InvCtx,
} from "@/lib/inventory/db.server";
import {
  indentStatusLabel,
  lineAmounts,
  poStatusLabel,
  type InvBillStatus,
  type InvGrn,
  type InvGrnLine,
  type InvIndent,
  type InvIndentLine,
  type InvPaymentMode,
  type InvPendingPoLine,
  type InvPoLine,
  type InvPoStatus,
  type InvPurchaseOrder,
  type InvPurchaseReturn,
  type InvVendorBill,
} from "@/lib/inventory/types";

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? "" : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const int = (v: unknown): number => Math.trunc(num(v));
const dateOnly = (v: unknown): string => str(v).slice(0, 10);

function daysBetween(fromIso: string, toIso: string): number {
  if (!fromIso) return 0;
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** Past-tense verbs for refusal messages — "submited" is not a word. */
const INDENT_ACTION_VERB: Record<string, string> = {
  submit: "submitted",
  approve: "approved",
  reject: "rejected",
  cancel: "cancelled",
};

const PO_ACTION_VERB: Record<string, string> = {
  submit: "submitted for approval",
  approve: "approved",
  reject: "rejected",
  issue: "sent to the vendor",
  cancel: "cancelled",
};

/* ─── Indents ──────────────────────────────────────────────── */

function rowToIndentLine(r: Row): InvIndentLine {
  const item = r.item as { name?: string; sku?: string } | null;
  return {
    id: str(r.id),
    indentId: str(r.indent_id),
    itemId: str(r.item_id),
    description: str(r.description),
    qty: num(r.qty),
    uomId: str(r.uom_id),
    estRatePaise: int(r.est_rate_paise),
    sortOrder: int(r.sort_order),
    itemName: str(item?.name),
    sku: str(item?.sku),
  };
}

function rowToIndent(r: Row, lines: InvIndentLine[]): InvIndent {
  return {
    id: str(r.id),
    indentNo: str(r.indent_no),
    academicYearCode: str(r.academic_year_code),
    requestedBy: str(r.requested_by),
    department: str(r.department),
    urgency: str(r.urgency) === "urgent" ? "urgent" : "normal",
    status: str(r.status) as InvIndent["status"],
    neededBy: dateOnly(r.needed_by),
    note: str(r.note),
    decidedBy: str(r.decided_by),
    decidedAt: str(r.decided_at),
    decisionNote: str(r.decision_note),
    estimatedPaise: int(r.estimated_paise),
    createdBy: str(r.created_by),
    createdAt: str(r.created_at),
    lines,
  };
}

export async function listIndents(opts: {
  status?: string;
  academicYearCode?: string;
}): Promise<InvIndent[]> {
  const { sb, tenantId } = await invCtx();
  let q = sb.from("inv_indents").select("*").eq("tenant_id", tenantId);
  if (opts.status && opts.status !== "all") q = q.eq("status", opts.status);
  if (opts.academicYearCode) {
    q = q.eq("academic_year_code", opts.academicYearCode);
  }
  const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
  if (error) throw new InvError(`Indents: ${error.message}`, 500);

  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];

  const { data: lineData } = await sb
    .from("inv_indent_lines")
    .select("*, item:inv_items(name, sku)")
    .eq("tenant_id", tenantId)
    .in("indent_id", rows.map((r) => str(r.id)))
    .order("sort_order");

  const byIndent = new Map<string, InvIndentLine[]>();
  for (const l of (lineData ?? []) as Row[]) {
    const line = rowToIndentLine(l);
    const list = byIndent.get(line.indentId) ?? [];
    list.push(line);
    byIndent.set(line.indentId, list);
  }
  return rows.map((r) => rowToIndent(r, byIndent.get(str(r.id)) ?? []));
}

export async function saveIndent(
  input: {
    id?: string;
    requestedBy?: string;
    department?: string;
    urgency?: "normal" | "urgent";
    neededBy?: string;
    note?: string;
    lines?: {
      itemId?: string;
      description?: string;
      qty?: number;
      uomId?: string;
      estRatePaise?: number;
    }[];
  },
  actor: string,
  academicYearCode: string,
): Promise<InvIndent> {
  const ctx = await invCtx();
  const { sb, tenantId } = ctx;

  const lines = (input.lines ?? []).filter(
    (l) => l && (l.itemId || String(l.description ?? "").trim()),
  );
  if (lines.length === 0) {
    throw new InvError("An indent needs at least one line", 400);
  }
  const estimated = lines.reduce(
    (s, l) => s + Math.round((Number(l.estRatePaise) || 0) * (Number(l.qty) || 0)),
    0,
  );

  if (input.id) {
    // Editing is only sensible before anyone has acted on the request.
    const { data: current } = await sb
      .from("inv_indents")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("id", input.id)
      .maybeSingle();
    const status = str(current?.status);
    if (status && status !== "draft" && status !== "submitted") {
      throw new InvError(
        `This indent is ${status} — it can no longer be edited`,
        409,
      );
    }
  }

  const row: Row = {
    tenant_id: tenantId,
    requested_by: str(input.requestedBy) || actor,
    department: str(input.department),
    urgency: input.urgency === "urgent" ? "urgent" : "normal",
    needed_by: nullable(input.neededBy),
    note: str(input.note),
    estimated_paise: estimated,
    academic_year_code: academicYearCode,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    row.id = input.id;
  } else {
    row.created_by = actor;
    row.status = "draft";
    row.indent_no = await nextDocNo(ctx, "indent", academicYearCode, "IND");
  }

  const saved = await insertOrUpdate(
    sb,
    "inv_indents",
    tenantId,
    row,
    "*",
    "Save indent",
  );
  const indentId = str(saved.id);

  await sb
    .from("inv_indent_lines")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("indent_id", indentId);

  const { error: lineError } = await sb.from("inv_indent_lines").insert(
    lines.map((l, i) => ({
      tenant_id: tenantId,
      indent_id: indentId,
      item_id: nullable(l.itemId),
      description: str(l.description),
      qty: Math.max(0, num(l.qty)),
      uom_id: nullable(l.uomId),
      est_rate_paise: Math.max(0, int(l.estRatePaise)),
      sort_order: i + 1,
    })),
  );
  if (lineError) throw new InvError(`Save indent lines: ${lineError.message}`, 500);

  const fresh = await listIndents({});
  return fresh.find((i) => i.id === indentId) ?? rowToIndent(saved, []);
}

/** Move an indent through submit / approve / reject / cancel. */
export async function decideIndent(
  input: { id: string; action: "submit" | "approve" | "reject" | "cancel"; note?: string },
  actor: string,
): Promise<{ status: string }> {
  const { sb, tenantId } = await invCtx();
  const { data: current } = await sb
    .from("inv_indents")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("id", input.id)
    .maybeSingle();
  if (!current) throw new InvError("Indent not found", 404);

  const from = str(current.status);
  const allowed: Record<string, string[]> = {
    submit: ["draft"],
    approve: ["submitted"],
    reject: ["submitted"],
    cancel: ["draft", "submitted", "approved"],
  };
  if (!allowed[input.action]?.includes(from)) {
    throw new InvError(
      `An indent that is ${indentStatusLabel(from as InvIndent["status"]).toLowerCase()} cannot be ${INDENT_ACTION_VERB[input.action]}`,
      409,
    );
  }

  const next = {
    submit: "submitted",
    approve: "approved",
    reject: "rejected",
    cancel: "cancelled",
  }[input.action];

  const patch: Row = { status: next, updated_at: new Date().toISOString() };
  if (input.action !== "submit") {
    patch.decided_by = actor;
    patch.decided_at = new Date().toISOString();
    patch.decision_note = str(input.note);
  }

  const { error } = await sb
    .from("inv_indents")
    .update(patch)
    .eq("tenant_id", tenantId)
    .eq("id", input.id);
  if (error) throw new InvError(`Update indent: ${error.message}`, 500);
  return { status: next };
}

/* ─── Purchase orders ──────────────────────────────────────── */

function rowToPoLine(r: Row): InvPoLine {
  const item = r.item as { name?: string; sku?: string } | null;
  const uom = r.uom as { name?: string } | null;
  return {
    id: str(r.id),
    poId: str(r.po_id),
    itemId: str(r.item_id),
    description: str(r.description),
    qty: num(r.qty),
    uomId: str(r.uom_id),
    ratePaise: int(r.rate_paise),
    discountPct: num(r.discount_pct),
    gstRate: num(r.gst_rate),
    lineTotalPaise: int(r.line_total_paise),
    taxPaise: int(r.tax_paise),
    qtyReceived: num(r.qty_received),
    sortOrder: int(r.sort_order),
    itemName: str(item?.name),
    sku: str(item?.sku),
    uomName: str(uom?.name),
  };
}

function rowToPo(r: Row, lines: InvPoLine[], threshold: number): InvPurchaseOrder {
  const vendor = r.vendor as { name?: string } | null;
  const total = int(r.total_paise);
  return {
    id: str(r.id),
    poNo: str(r.po_no),
    indentId: str(r.indent_id),
    vendorId: str(r.vendor_id),
    vendorName: str(vendor?.name),
    academicYearCode: str(r.academic_year_code),
    status: str(r.status) as InvPoStatus,
    orderDate: dateOnly(r.order_date),
    expectedDate: dateOnly(r.expected_date),
    subtotalPaise: int(r.subtotal_paise),
    discountPaise: int(r.discount_paise),
    taxPaise: int(r.tax_paise),
    freightPaise: int(r.freight_paise),
    totalPaise: total,
    approvedBy: str(r.approved_by),
    approvedAt: str(r.approved_at),
    approvalNote: str(r.approval_note),
    issuedAt: str(r.issued_at),
    terms: str(r.terms),
    note: str(r.note),
    createdBy: str(r.created_by),
    createdAt: str(r.created_at),
    lines,
    needsApproval: total > threshold,
  };
}

/**
 * The value above which an order needs approving.
 *
 * A missing settings row must never read as "no approval required". It did:
 * the absent row produced 0, and the old caller only enforced approval when
 * the threshold was above zero, so a ₹2,25,000 order sailed straight through.
 * An unknown limit falls back to the documented default instead, and a limit
 * of exactly 0 now means what it says — everything needs approval.
 */
async function approvalThreshold(ctx: InvCtx): Promise<number> {
  const { data, error } = await ctx.sb
    .from("inv_settings")
    .select("po_approval_threshold_paise")
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (error || !data || data.po_approval_threshold_paise == null) {
    return INV_DEFAULT_SETTINGS.poApprovalThresholdPaise;
  }
  return int(data.po_approval_threshold_paise);
}

export async function listPurchaseOrders(opts: {
  status?: string;
  vendorId?: string;
  academicYearCode?: string;
}): Promise<InvPurchaseOrder[]> {
  const ctx = await invCtx();
  const { sb, tenantId } = ctx;

  let q = sb
    .from("inv_purchase_orders")
    .select("*, vendor:inv_vendors(name)")
    .eq("tenant_id", tenantId);
  if (opts.status === "open") {
    q = q.in("status", ["draft", "pending_approval", "approved", "issued", "partial_grn"]);
  } else if (opts.status && opts.status !== "all") {
    q = q.eq("status", opts.status);
  }
  if (opts.vendorId) q = q.eq("vendor_id", opts.vendorId);
  if (opts.academicYearCode) {
    q = q.eq("academic_year_code", opts.academicYearCode);
  }

  const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
  if (error) throw new InvError(`Purchase orders: ${error.message}`, 500);

  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];

  const [{ data: lineData }, threshold] = await Promise.all([
    sb
      .from("inv_po_lines")
      .select("*, item:inv_items(name, sku), uom:inv_uoms(name)")
      .eq("tenant_id", tenantId)
      .in("po_id", rows.map((r) => str(r.id)))
      .order("sort_order"),
    approvalThreshold(ctx),
  ]);

  const byPo = new Map<string, InvPoLine[]>();
  for (const l of (lineData ?? []) as Row[]) {
    const line = rowToPoLine(l);
    const list = byPo.get(line.poId) ?? [];
    list.push(line);
    byPo.set(line.poId, list);
  }
  return rows.map((r) => rowToPo(r, byPo.get(str(r.id)) ?? [], threshold));
}

export async function savePurchaseOrder(
  input: {
    id?: string;
    vendorId?: string;
    indentId?: string;
    orderDate?: string;
    expectedDate?: string;
    freightPaise?: number;
    discountPaise?: number;
    terms?: string;
    note?: string;
    lines?: {
      itemId: string;
      description?: string;
      qty: number;
      uomId?: string;
      ratePaise: number;
      discountPct?: number;
      gstRate?: number;
    }[];
  },
  actor: string,
  academicYearCode: string,
): Promise<InvPurchaseOrder> {
  const ctx = await invCtx();
  const { sb, tenantId } = ctx;

  if (!input.vendorId) throw new InvError("A vendor is required", 400);
  const lines = (input.lines ?? []).filter((l) => l && l.itemId && Number(l.qty) > 0);
  if (lines.length === 0) {
    throw new InvError("A purchase order needs at least one line", 400);
  }

  if (input.id) {
    // Once goods are on the way the order is a record of what was agreed.
    const { data: current } = await sb
      .from("inv_purchase_orders")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("id", input.id)
      .maybeSingle();
    const status = str(current?.status);
    if (!["draft", "pending_approval", "approved"].includes(status)) {
      throw new InvError(
        `This order is ${status} — edit it before it is sent, or cancel and raise a new one`,
        409,
      );
    }
  }

  const priced = lines.map((l) => ({
    ...l,
    ...lineAmounts({
      qty: Number(l.qty),
      ratePaise: Number(l.ratePaise),
      discountPct: l.discountPct,
      gstRate: l.gstRate,
    }),
  }));

  const subtotal = priced.reduce((s, l) => s + l.lineTotalPaise, 0);
  const tax = priced.reduce((s, l) => s + l.taxPaise, 0);
  const freight = Math.max(0, int(input.freightPaise));
  const discount = Math.max(0, int(input.discountPaise));
  const total = subtotal + tax + freight - discount;

  const row: Row = {
    tenant_id: tenantId,
    vendor_id: input.vendorId,
    indent_id: nullable(input.indentId),
    order_date: input.orderDate || new Date().toISOString().slice(0, 10),
    expected_date: nullable(input.expectedDate),
    subtotal_paise: subtotal,
    discount_paise: discount,
    tax_paise: tax,
    freight_paise: freight,
    total_paise: total,
    terms: str(input.terms),
    note: str(input.note),
    academic_year_code: academicYearCode,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    row.id = input.id;
  } else {
    row.created_by = actor;
    row.status = "draft";
    row.po_no = await nextDocNo(ctx, "po", academicYearCode, "PO");
  }

  const saved = await insertOrUpdate(
    sb,
    "inv_purchase_orders",
    tenantId,
    row,
    "*, vendor:inv_vendors(name)",
    "Save purchase order",
  );
  const poId = str(saved.id);

  await sb.from("inv_po_lines").delete().eq("tenant_id", tenantId).eq("po_id", poId);
  const { error: lineError } = await sb.from("inv_po_lines").insert(
    priced.map((l, i) => ({
      tenant_id: tenantId,
      po_id: poId,
      item_id: l.itemId,
      description: str(l.description),
      qty: Number(l.qty),
      uom_id: nullable(l.uomId),
      rate_paise: Math.max(0, int(l.ratePaise)),
      discount_pct: clampPct(l.discountPct),
      gst_rate: clampPct(l.gstRate),
      line_total_paise: l.lineTotalPaise,
      tax_paise: l.taxPaise,
      sort_order: i + 1,
    })),
  );
  if (lineError) throw new InvError(`Save order lines: ${lineError.message}`, 500);

  // Ordering against an approved indent closes it out.
  if (input.indentId) {
    await sb
      .from("inv_indents")
      .update({ status: "converted", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", input.indentId)
      .eq("status", "approved");
  }

  const list = await listPurchaseOrders({});
  const found = list.find((p) => p.id === poId);
  if (!found) throw new InvError("Order saved but could not be read back", 500);
  return found;
}

/**
 * Advance an order: submit for approval, approve, reject, send, or cancel.
 *
 * Approval is only demanded above the configured threshold — a ₹300 stationery
 * order should not wait on the director. Approving is a separate RBAC action,
 * checked by the route.
 */
export async function decidePurchaseOrder(
  input: {
    id: string;
    action: "submit" | "approve" | "reject" | "issue" | "cancel";
    note?: string;
  },
  actor: string,
): Promise<{ status: string }> {
  const ctx = await invCtx();
  const { sb, tenantId } = ctx;

  const { data: current } = await sb
    .from("inv_purchase_orders")
    .select("status, total_paise")
    .eq("tenant_id", tenantId)
    .eq("id", input.id)
    .maybeSingle();
  if (!current) throw new InvError("Purchase order not found", 404);

  const from = str(current.status);
  const total = int(current.total_paise);
  const threshold = await approvalThreshold(ctx);

  const allowed: Record<string, string[]> = {
    submit: ["draft"],
    approve: ["pending_approval"],
    reject: ["pending_approval"],
    issue: ["draft", "approved"],
    cancel: ["draft", "pending_approval", "approved", "issued", "partial_grn"],
  };
  if (!allowed[input.action]?.includes(from)) {
    throw new InvError(
      `An order that is ${poStatusLabel(from as InvPoStatus).toLowerCase()} cannot be ${PO_ACTION_VERB[input.action]}`,
      409,
    );
  }

  if (input.action === "issue" && from === "draft" && total > threshold) {
    throw new InvError(
      "This order is above the approval limit — submit it for approval first",
      409,
    );
  }

  const next = {
    submit: "pending_approval",
    approve: "approved",
    reject: "draft",
    issue: "issued",
    cancel: "cancelled",
  }[input.action];

  const patch: Row = { status: next, updated_at: new Date().toISOString() };
  if (input.action === "approve" || input.action === "reject") {
    patch.approved_by = actor;
    patch.approved_at = new Date().toISOString();
    patch.approval_note = str(input.note);
  }
  if (input.action === "issue") patch.issued_at = new Date().toISOString();

  const { error } = await sb
    .from("inv_purchase_orders")
    .update(patch)
    .eq("tenant_id", tenantId)
    .eq("id", input.id);
  if (error) throw new InvError(`Update order: ${error.message}`, 500);
  return { status: next };
}

/** Order lines still awaiting delivery — the receipt screen's worklist. */
export async function pendingPoLines(opts: {
  vendorId?: string;
  poId?: string;
}): Promise<InvPendingPoLine[]> {
  const { sb, tenantId } = await invCtx();

  let q = sb
    .from("inv_purchase_orders")
    .select(
      "id, po_no, vendor_id, order_date, expected_date, status, vendor:inv_vendors(name)",
    )
    .eq("tenant_id", tenantId)
    .in("status", ["issued", "partial_grn", "approved"]);
  if (opts.vendorId) q = q.eq("vendor_id", opts.vendorId);
  if (opts.poId) q = q.eq("id", opts.poId);

  const { data: pos, error } = await q.order("order_date", { ascending: false }).limit(200);
  if (error) throw new InvError(`Open orders: ${error.message}`, 500);
  const orders = (pos ?? []) as Row[];
  if (orders.length === 0) return [];

  const { data: lineData } = await sb
    .from("inv_po_lines")
    .select("*, item:inv_items(name, sku), uom:inv_uoms(name)")
    .eq("tenant_id", tenantId)
    .in("po_id", orders.map((o) => str(o.id)))
    .order("sort_order");

  const byId = new Map(orders.map((o) => [str(o.id), o]));

  return ((lineData ?? []) as Row[])
    .map((l) => {
      const line = rowToPoLine(l);
      const po = byId.get(line.poId);
      const vendor = po?.vendor as { name?: string } | null;
      return {
        ...line,
        poNo: str(po?.po_no),
        vendorId: str(po?.vendor_id),
        vendorName: str(vendor?.name),
        qtyPending: Math.max(0, line.qty - line.qtyReceived),
        orderDate: dateOnly(po?.order_date),
        expectedDate: dateOnly(po?.expected_date),
      };
    })
    .filter((l) => l.qtyPending > 0);
}

/* ─── Goods receipts ───────────────────────────────────────── */

function rowToGrnLine(r: Row): InvGrnLine {
  const item = r.item as { name?: string; sku?: string } | null;
  return {
    id: str(r.id),
    grnId: str(r.grn_id),
    poLineId: str(r.po_line_id),
    itemId: str(r.item_id),
    qtyReceived: num(r.qty_received),
    qtyRejected: num(r.qty_rejected),
    rejectionReason: str(r.rejection_reason),
    ratePaise: int(r.rate_paise),
    discountPct: num(r.discount_pct),
    gstRate: num(r.gst_rate),
    lineTotalPaise: int(r.line_total_paise),
    taxPaise: int(r.tax_paise),
    landedUnitCostPaise: int(r.landed_unit_cost_paise),
    batchNo: str(r.batch_no),
    expiryDate: dateOnly(r.expiry_date),
    itemName: str(item?.name),
    sku: str(item?.sku),
  };
}

export async function listGoodsReceipts(opts: {
  vendorId?: string;
  poId?: string;
  academicYearCode?: string;
}): Promise<InvGrn[]> {
  const { sb, tenantId } = await invCtx();

  let q = sb
    .from("inv_goods_receipts")
    // The FK constraint is named explicitly: bills also point back at
    // receipts (bills.grn_id), so two relationships exist between these
    // tables and an unqualified embed is ambiguous.
    .select(
      "*, vendor:inv_vendors(name), po:inv_purchase_orders(po_no)," +
        " bill:inv_vendor_bills!inv_goods_receipts_bill_id_fkey(bill_no)",
    )
    .eq("tenant_id", tenantId);
  if (opts.vendorId) q = q.eq("vendor_id", opts.vendorId);
  if (opts.poId) q = q.eq("po_id", opts.poId);
  if (opts.academicYearCode) q = q.eq("academic_year_code", opts.academicYearCode);

  const { data, error } = await q.order("created_at", { ascending: false }).limit(300);
  if (error) throw new InvError(`Goods receipts: ${error.message}`, 500);
  // The `!constraint` embed defeats the client's row-type inference, so the
  // shape is asserted here and read through the same string/number helpers
  // every other mapper uses.
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return [];

  const grnIds = rows.map((r) => str(r.id));
  const [{ data: lineData }, { data: returnData }] = await Promise.all([
    sb
      .from("inv_grn_lines")
      .select("*, item:inv_items(name, sku)")
      .eq("tenant_id", tenantId)
      .in("grn_id", grnIds)
      .order("sort_order"),
    sb
      .from("inv_purchase_return_lines")
      .select("grn_line_id, qty")
      .eq("tenant_id", tenantId),
  ]);

  const returnedByLine = new Map<string, number>();
  for (const r of (returnData ?? []) as Row[]) {
    const key = str(r.grn_line_id);
    if (!key) continue;
    returnedByLine.set(key, (returnedByLine.get(key) ?? 0) + num(r.qty));
  }

  const byGrn = new Map<string, InvGrnLine[]>();
  for (const l of (lineData ?? []) as Row[]) {
    const line = rowToGrnLine(l);
    line.qtyReturned = returnedByLine.get(line.id) ?? 0;
    const list = byGrn.get(line.grnId) ?? [];
    list.push(line);
    byGrn.set(line.grnId, list);
  }

  return rows.map((r) => {
    const vendor = r.vendor as { name?: string } | null;
    const po = r.po as { po_no?: string } | null;
    const bill = r.bill as { bill_no?: string } | null;
    return {
      id: str(r.id),
      grnNo: str(r.grn_no),
      poId: str(r.po_id),
      poNo: str(po?.po_no),
      vendorId: str(r.vendor_id),
      vendorName: str(vendor?.name),
      locationId: str(r.location_id),
      receiptDate: dateOnly(r.receipt_date),
      supplierInvoiceNo: str(r.supplier_invoice_no),
      supplierInvoiceDate: dateOnly(r.supplier_invoice_date),
      status: str(r.status) || "posted",
      voidReason: str(r.void_reason),
      voidedBy: str(r.voided_by),
      subtotalPaise: int(r.subtotal_paise),
      taxPaise: int(r.tax_paise),
      freightPaise: int(r.freight_paise),
      otherChargesPaise: int(r.other_charges_paise),
      totalPaise: int(r.total_paise),
      billId: str(r.bill_id),
      billNo: str(bill?.bill_no),
      note: str(r.note),
      createdBy: str(r.created_by),
      createdAt: str(r.created_at),
      lines: byGrn.get(str(r.id)) ?? [],
    };
  });
}

/**
 * Post a goods receipt.
 *
 * Everything real happens inside inv_post_grn: stock, landed cost, the
 * weighted average, vendor rate history, order progress and the bill, in one
 * transaction. This wrapper only shapes the payload and surfaces the database
 * error verbatim — those messages ("only 40 of 100 remain on the order line")
 * are written for the person at the counter.
 */
export async function postGoodsReceipt(
  input: {
    poId?: string;
    vendorId: string;
    locationId?: string;
    receiptDate?: string;
    supplierInvoiceNo?: string;
    supplierInvoiceDate?: string;
    freightPaise?: number;
    otherChargesPaise?: number;
    createBill?: boolean;
    note?: string;
    lines: {
      poLineId?: string;
      itemId: string;
      qtyReceived: number;
      qtyRejected?: number;
      rejectionReason?: string;
      ratePaise: number;
      discountPct?: number;
      gstRate?: number;
      batchNo?: string;
      expiryDate?: string;
    }[];
  },
  actor: string,
  academicYearCode: string,
): Promise<{
  grnId: string;
  grnNo: string;
  billId: string;
  billNo: string;
  totalPaise: number;
  /** Empty when the server ledger is not in use for this school. */
  ledgerVoucherNo: string;
}> {
  const { sb, tenantId } = await invCtx();

  if (!input.vendorId) throw new InvError("A vendor is required", 400);
  const lines = (input.lines ?? []).filter(
    (l) => l && l.itemId && Number(l.qtyReceived) > 0,
  );
  if (lines.length === 0) {
    throw new InvError("Enter a received quantity on at least one line", 400);
  }

  const payload = {
    academic_year_code: academicYearCode,
    po_id: input.poId || null,
    vendor_id: input.vendorId,
    location_id: input.locationId || null,
    receipt_date: input.receiptDate || null,
    supplier_invoice_no: str(input.supplierInvoiceNo),
    supplier_invoice_date: input.supplierInvoiceDate || null,
    freight_paise: Math.max(0, int(input.freightPaise)),
    other_charges_paise: Math.max(0, int(input.otherChargesPaise)),
    create_bill: input.createBill !== false,
    note: str(input.note),
    lines: lines.map((l) => ({
      po_line_id: l.poLineId || null,
      item_id: l.itemId,
      qty_received: Number(l.qtyReceived),
      qty_rejected: Math.max(0, num(l.qtyRejected)),
      rejection_reason: str(l.rejectionReason),
      rate_paise: Math.max(0, int(l.ratePaise)),
      discount_pct: clampPct(l.discountPct),
      gst_rate: clampPct(l.gstRate),
      batch_no: str(l.batchNo),
      expiry_date: l.expiryDate || null,
    })),
  };

  const { data, error } = await sb.rpc("inv_post_grn", {
    p_tenant_id: tenantId,
    p_actor: actor,
    p_payload: payload,
  });
  if (error) {
    throw new InvError(cleanDbMessage(error.message), 409);
  }

  const out = (data ?? {}) as Row;
  return {
    grnId: str(out.grn_id),
    grnNo: str(out.grn_no),
    billId: str(out.bill_id),
    billNo: str(out.bill_no),
    totalPaise: int(out.total_paise),
    ledgerVoucherNo: str(out.ledger_voucher_no),
  };
}

/** Strip Postgres framing so the user reads the message, not the plumbing. */
function cleanDbMessage(raw: string): string {
  return String(raw ?? "")
    .replace(/^ERROR:\s*/i, "")
    .replace(/\s*CONTEXT:[\s\S]*$/i, "")
    .trim();
}

/* ─── Vendor bills and payments ────────────────────────────── */

export async function listVendorBills(opts: {
  vendorId?: string;
  status?: string;
}): Promise<InvVendorBill[]> {
  const { sb, tenantId } = await invCtx();
  const today = new Date().toISOString().slice(0, 10);

  let q = sb
    .from("inv_vendor_bills")
    // Named FK again: receipts also point at bills (receipts.bill_id), so the
    // relationship between these two tables is ambiguous without it.
    .select(
      "*, vendor:inv_vendors(name)," +
        " grn:inv_goods_receipts!inv_vendor_bills_grn_id_fkey(grn_no)",
    )
    .eq("tenant_id", tenantId);
  if (opts.vendorId) q = q.eq("vendor_id", opts.vendorId);
  if (opts.status === "unpaid") q = q.in("status", ["open", "part_paid"]);
  else if (opts.status && opts.status !== "all") q = q.eq("status", opts.status);

  const { data, error } = await q.order("bill_date", { ascending: false }).limit(500);
  if (error) throw new InvError(`Vendor bills: ${error.message}`, 500);

  return ((data ?? []) as unknown as Row[]).map((r) => {
    const vendor = r.vendor as { name?: string } | null;
    const grn = r.grn as { grn_no?: string } | null;
    const total = int(r.total_paise);
    const paid = int(r.paid_paise);
    const due = dateOnly(r.due_date);
    const status = str(r.status) as InvBillStatus;
    return {
      id: str(r.id),
      billNo: str(r.bill_no),
      vendorId: str(r.vendor_id),
      vendorName: str(vendor?.name),
      grnId: str(r.grn_id),
      grnNo: str(grn?.grn_no),
      supplierInvoiceNo: str(r.supplier_invoice_no),
      billDate: dateOnly(r.bill_date),
      dueDate: due,
      subtotalPaise: int(r.subtotal_paise),
      taxPaise: int(r.tax_paise),
      freightPaise: int(r.freight_paise),
      totalPaise: total,
      paidPaise: paid,
      balancePaise: Math.max(0, total - paid),
      status,
      postedToAccounts: r.posted_to_accounts === true,
      note: str(r.note),
      createdAt: str(r.created_at),
      // Only an unsettled bill can be overdue.
      overdueDays:
        due && status !== "paid" && status !== "cancelled"
          ? daysBetween(due, today)
          : 0,
    };
  });
}

/**
 * Record a payment against a bill.
 *
 * Over-payment is refused rather than silently absorbed: a bill showing more
 * paid than it is worth hides either a keying error or a duplicate payment.
 */
/**
 * Record a payment against a bill.
 *
 * Delegates to `inv_pay_vendor_bill`, so the payment row, the bill's new
 * balance and the ledger entry commit together — and over-payment is refused
 * by the same code that writes them. A bill showing more paid than it is worth
 * hides either a keying error or a duplicate payment.
 */
export async function recordVendorPayment(
  input: {
    billId: string;
    paidOn?: string;
    amountPaise: number;
    mode?: InvPaymentMode;
    reference?: string;
    note?: string;
  },
  actor: string,
): Promise<{
  paidPaise: number;
  balancePaise: number;
  status: InvBillStatus;
  paymentNo: string;
  /** Empty when the server ledger is not in use for this school. */
  ledgerVoucherNo: string;
}> {
  const amount = int(input.amountPaise);
  if (amount <= 0) throw new InvError("Payment amount must be more than zero", 400);

  const { sb, tenantId } = await invCtx();
  const { data, error } = await sb.rpc("inv_pay_vendor_bill", {
    p_tenant_id: tenantId,
    p_actor: actor,
    p_payload: {
      bill_id: input.billId,
      amount_paise: amount,
      mode: input.mode || "bank",
      paid_on: input.paidOn || null,
      reference: str(input.reference),
      note: str(input.note),
    },
  });
  if (error) throw new InvError(cleanDbMessage(error.message), 409);

  const out = (data ?? {}) as Row;
  return {
    paidPaise: int(out.paid_paise),
    balancePaise: int(out.balance_paise),
    status: str(out.status) as InvBillStatus,
    paymentNo: str(out.payment_no),
    ledgerVoucherNo: str(out.ledger_voucher_no),
  };
}

/* ─── Purchase returns ─────────────────────────────────────── */

export async function listPurchaseReturns(opts: {
  vendorId?: string;
}): Promise<InvPurchaseReturn[]> {
  const { sb, tenantId } = await invCtx();

  let q = sb
    .from("inv_purchase_returns")
    .select(
      "*, vendor:inv_vendors(name)," +
        " grn:inv_goods_receipts!inv_purchase_returns_grn_id_fkey(grn_no)",
    )
    .eq("tenant_id", tenantId);
  if (opts.vendorId) q = q.eq("vendor_id", opts.vendorId);

  const { data, error } = await q.order("created_at", { ascending: false }).limit(300);
  if (error) throw new InvError(`Purchase returns: ${error.message}`, 500);
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return [];

  const { data: lineData } = await sb
    .from("inv_purchase_return_lines")
    .select("*, item:inv_items(name, sku)")
    .eq("tenant_id", tenantId)
    .in("return_id", rows.map((r) => str(r.id)))
    .order("sort_order");

  const byReturn = new Map<string, InvPurchaseReturn["lines"]>();
  for (const l of (lineData ?? []) as Row[]) {
    const item = l.item as { name?: string; sku?: string } | null;
    const key = str(l.return_id);
    const list = byReturn.get(key) ?? [];
    list.push({
      id: str(l.id),
      returnId: key,
      grnLineId: str(l.grn_line_id),
      itemId: str(l.item_id),
      qty: num(l.qty),
      ratePaise: int(l.rate_paise),
      amountPaise: int(l.amount_paise),
      gstRate: num(l.gst_rate),
      taxPaise: int(l.tax_paise),
      itemName: str(item?.name),
      sku: str(item?.sku),
    });
    byReturn.set(key, list);
  }

  return rows.map((r) => {
    const vendor = r.vendor as { name?: string } | null;
    const grn = r.grn as { grn_no?: string } | null;
    return {
      id: str(r.id),
      returnNo: str(r.return_no),
      grnId: str(r.grn_id),
      grnNo: str(grn?.grn_no),
      vendorId: str(r.vendor_id),
      vendorName: str(vendor?.name),
      returnDate: dateOnly(r.return_date),
      locationId: str(r.location_id),
      reason: str(r.reason),
      subtotalPaise: int(r.subtotal_paise),
      taxPaise: int(r.tax_paise),
      totalPaise: int(r.total_paise),
      note: str(r.note),
      createdBy: str(r.created_by),
      createdAt: str(r.created_at),
      lines: byReturn.get(str(r.id)) ?? [],
    };
  });
}

export async function postPurchaseReturn(
  input: {
    grnId?: string;
    vendorId: string;
    locationId?: string;
    returnDate?: string;
    reason: string;
    note?: string;
    lines: {
      grnLineId?: string;
      itemId: string;
      qty: number;
      ratePaise?: number;
      gstRate?: number;
    }[];
  },
  actor: string,
  academicYearCode: string,
): Promise<{
  returnId: string;
  returnNo: string;
  totalPaise: number;
  ledgerVoucherNo: string;
}> {
  const { sb, tenantId } = await invCtx();

  if (!input.vendorId) throw new InvError("A vendor is required", 400);
  if (!String(input.reason ?? "").trim()) {
    throw new InvError("A reason is required for a purchase return", 400);
  }
  const lines = (input.lines ?? []).filter((l) => l && l.itemId && Number(l.qty) > 0);
  if (lines.length === 0) {
    throw new InvError("Enter a return quantity on at least one line", 400);
  }

  const { data, error } = await sb.rpc("inv_post_purchase_return", {
    p_tenant_id: tenantId,
    p_actor: actor,
    p_payload: {
      academic_year_code: academicYearCode,
      grn_id: input.grnId || null,
      vendor_id: input.vendorId,
      location_id: input.locationId || null,
      return_date: input.returnDate || null,
      reason: String(input.reason).trim(),
      note: str(input.note),
      lines: lines.map((l) => ({
        grn_line_id: l.grnLineId || null,
        item_id: l.itemId,
        qty: Number(l.qty),
        rate_paise: l.ratePaise === undefined ? null : Math.max(0, int(l.ratePaise)),
        gst_rate: clampPct(l.gstRate),
      })),
    },
  });
  if (error) throw new InvError(cleanDbMessage(error.message), 409);

  const out = (data ?? {}) as Row;
  return {
    returnId: str(out.return_id),
    returnNo: str(out.return_no),
    totalPaise: int(out.total_paise),
    ledgerVoucherNo: str(out.ledger_voucher_no),
  };
}

/* ─── Shared ───────────────────────────────────────────────── */

async function nextDocNo(
  ctx: InvCtx,
  docType: string,
  period: string,
  fallbackPrefix: string,
): Promise<string> {
  const { data: settings } = await ctx.sb
    .from("inv_settings")
    .select("doc_prefixes")
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  const prefixes = (settings?.doc_prefixes ?? {}) as Record<string, string>;
  const prefix = prefixes[docType] || fallbackPrefix;

  const { data, error } = await ctx.sb.rpc("inv_next_doc_no", {
    p_tenant_id: ctx.tenantId,
    p_doc_type: docType,
    p_period: period,
    p_prefix: prefix,
  });
  if (error || typeof data !== "string") {
    throw new InvError(
      `Could not allocate a ${docType} number: ${error?.message ?? "no value returned"}`,
      500,
    );
  }
  return data;
}

/** Headline numbers for the procurement dashboard. */
export async function procurementSummary(): Promise<{
  openOrders: number;
  awaitingApproval: number;
  pendingReceipt: number;
  unpaidBills: number;
  unpaidPaise: number;
  overduePaise: number;
}> {
  const { sb, tenantId } = await invCtx();
  const today = new Date().toISOString().slice(0, 10);

  const [orders, bills] = await Promise.all([
    sb
      .from("inv_purchase_orders")
      .select("status")
      .eq("tenant_id", tenantId)
      .in("status", ["draft", "pending_approval", "approved", "issued", "partial_grn"]),
    sb
      .from("inv_vendor_bills")
      .select("total_paise, paid_paise, due_date, status")
      .eq("tenant_id", tenantId)
      .in("status", ["open", "part_paid"]),
  ]);

  const orderRows = (orders.data ?? []) as Row[];
  const billRows = (bills.data ?? []) as Row[];

  let unpaid = 0;
  let overdue = 0;
  for (const b of billRows) {
    const bal = Math.max(0, int(b.total_paise) - int(b.paid_paise));
    unpaid += bal;
    if (dateOnly(b.due_date) && dateOnly(b.due_date) < today) overdue += bal;
  }

  return {
    openOrders: orderRows.length,
    awaitingApproval: orderRows.filter((o) => str(o.status) === "pending_approval").length,
    pendingReceipt: orderRows.filter((o) =>
      ["issued", "partial_grn"].includes(str(o.status)),
    ).length,
    unpaidBills: billRows.length,
    unpaidPaise: unpaid,
    overduePaise: overdue,
  };
}

/* ─── Vendor dues, for the Accounts screens ────────────────── */

export type InvVendorDue = {
  vendorId: string;
  name: string;
  gstin: string;
  phone: string;
  email: string;
  contactPerson: string;
  paymentTermsDays: number;
  isActive: boolean;
  /** The vendor's balance on account 2000. This is the authority. */
  ledgerDuePaise: number;
  /** What the store's own bill records still show open. */
  billsOpenPaise: number;
  openBillCount: number;
  oldestBillDate: string;
  lastBillDate: string;
};

/**
 * Every store vendor with what the books say we owe them.
 *
 * The ledger figure and the store's own open-bill figure are returned side by
 * side rather than reconciled into one number. They should agree; when they
 * do not, something posted on one side and not the other, and a single
 * blended figure would hide exactly the discrepancy worth seeing.
 */
export async function vendorDues(): Promise<InvVendorDue[]> {
  const { sb, tenantId } = await invCtx();
  const { data, error } = await sb.rpc("inv_vendor_dues", {
    p_tenant_id: tenantId,
  });
  if (error) throw new InvError(`Vendor dues: ${error.message}`, 500);
  return ((data ?? []) as Row[]).map((r) => ({
    vendorId: str(r.vendor_id),
    name: str(r.name),
    gstin: str(r.gstin),
    phone: str(r.phone),
    email: str(r.email),
    contactPerson: str(r.contact_person),
    paymentTermsDays: int(r.payment_terms_days),
    isActive: r.is_active === true,
    ledgerDuePaise: int(r.ledger_due_paise),
    billsOpenPaise: int(r.bills_open_paise),
    openBillCount: int(r.open_bill_count),
    oldestBillDate: str(r.oldest_bill_date),
    lastBillDate: str(r.last_bill_date),
  }));
}

/* ─── Correcting a receipt ─────────────────────────────────── */

/**
 * Cancel a goods receipt and everything it caused.
 *
 * Refuses rather than forces when the goods have gone out, the bill has been
 * paid, a purchase return already exists, or the ledger will not take the
 * reversal. Each of those would otherwise leave the books describing something
 * that did not happen.
 */
export async function voidGoodsReceipt(
  grnId: string,
  reason: string,
  actor: string,
): Promise<{
  grnId: string;
  grnNo: string;
  status: string;
  reversalVoucherNo: string;
}> {
  const { sb, tenantId } = await invCtx();
  const { data, error } = await sb.rpc("inv_void_grn", {
    p_tenant_id: tenantId,
    p_actor: actor,
    p_grn_id: grnId,
    p_reason: reason,
  });
  if (error) throw new InvError(error.message, 422);
  const out = (data ?? {}) as Row;
  return {
    grnId: str(out.grn_id),
    grnNo: str(out.grn_no),
    status: str(out.status),
    reversalVoucherNo: str(out.reversal_voucher_no),
  };
}

/**
 * Amend the descriptive parts of a receipt — the supplier's invoice number and
 * date, and the note. Quantities and rates are deliberately not editable: they
 * have already moved stock and money, so changing them is a void and a
 * re-entry.
 */
export async function amendGoodsReceipt(
  input: {
    grnId: string;
    supplierInvoiceNo?: string;
    supplierInvoiceDate?: string;
    note?: string;
  },
  actor: string,
): Promise<{ grnId: string; amended: boolean }> {
  const { sb, tenantId } = await invCtx();
  const payload: Record<string, unknown> = { grn_id: input.grnId };
  if (input.supplierInvoiceNo !== undefined)
    payload.supplier_invoice_no = input.supplierInvoiceNo;
  if (input.supplierInvoiceDate !== undefined)
    payload.supplier_invoice_date = input.supplierInvoiceDate;
  if (input.note !== undefined) payload.note = input.note;

  const { data, error } = await sb.rpc("inv_amend_grn", {
    p_tenant_id: tenantId,
    p_actor: actor,
    p_payload: payload,
  });
  if (error) throw new InvError(error.message, 422);
  const out = (data ?? {}) as Row;
  return { grnId: str(out.grn_id), amended: out.amended === true };
}
