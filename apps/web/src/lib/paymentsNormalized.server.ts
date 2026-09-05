/**
 * Payment desk ledger — Supabase normalized tables (payment_desk_*).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PaymentLink,
  PaymentLinkLine,
  PaymentLinkStatus,
  PaymentsState,
} from "@/lib/payments";
import { paymentsDualWriteDbEnabled } from "@/lib/paymentsDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages } from "@/lib/supabase/pageAll";

export type PaymentGatewayProvider = "razorpay" | "cashfree" | "demo" | "manual";

export type PaymentGatewayEvent = {
  id: string;
  paymentLinkId: string | null;
  provider: PaymentGatewayProvider;
  eventType: string;
  externalPaymentId: string;
  externalOrderId: string;
  amountPaise: number | null;
  settlementStatus: "received" | "settled" | "failed" | "ignored";
  voucherId: string | null;
  receiptNo: string | null;
  receivedAt: string;
};

export type PaymentDeskSyncMeta = {
  linkCount: number;
  openLinkCount: number;
  paidLinkCount: number;
  gatewayEventCount: number;
  lastPaidAt: string | null;
  updatedAt: string;
};

const META_SELECT =
  "link_count, open_link_count, paid_link_count, gateway_event_count, last_paid_at, updated_at";

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

/**
 * Delete rows the client no longer holds — never on an empty payload.
 *
 * An empty keep-set means every stored row is "stale", so this deleted the
 * entire table. That is never what a sync means: a client with nothing to say
 * is a client whose cache was dropped, not an instruction to erase the
 * school's records.
 *
 * It is not hypothetical. On 2026-08-11 the attendance register for the
 * previous day was gone — pushed away by a phone whose localStorage had been
 * dropped on quota, with the emptiness check running AFTER the delete. This
 * same function is copied into 20 modules and called from 86 places, almost
 * none of them guarded, covering bank and cash ledgers, payroll runs, fee
 * cheques, library issues and 1,919 admission records.
 *
 * This floor stops the catastrophic case everywhere at once. It does NOT make
 * a partial payload safe — a client holding 3 of 900 rows still prunes 897.
 * That needs per-module scoping, the way attendance now prunes only within
 * the dates its payload covers. See docs/TODO.md.
 *
 * The read error is also surfaced now. It was discarded, which happened to
 * fail safe here (no data → nothing deleted), but "we could not read the
 * table" and "the table is empty" must not be the same value in a function
 * that deletes.
 */
async function deleteStale(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  keepIds: Set<string>,
) {
  if (keepIds.size === 0) {
    console.warn(
      `[${table}] refusing to prune: the payload holds no ids at all. ` +
        "An empty client is not an instruction to delete every row.",
    );
    return;
  }
  const { data, error } = await sb
    .from(table)
    .select("id")
    .eq("tenant_id", tenantId);
  if (error) {
    console.error(
      `[${table}] prune skipped — could not read existing ids:`,
      error.message,
    );
    return;
  }
  const stale = (data ?? [])
    .map((r) => String((r as { id: string }).id))
    .filter((id) => !keepIds.has(id));
  if (stale.length > 0) {
    await sb.from(table).delete().in("id", stale);
  }
}

function linkToRows(
  tenantId: string,
  link: PaymentLink,
): {
  header: Record<string, unknown>;
  lines: Record<string, unknown>[];
} {
  const now = new Date().toISOString();
  const header = {
    id: link.id,
    tenant_id: tenantId,
    code: link.code,
    household_id: link.householdId || "",
    student_id: link.studentId || "",
    student_name: link.studentName || "",
    class_label: link.classLabel || "",
    academic_year_code: link.academicYearCode,
    amount_paise: link.amountPaise,
    status: link.status,
    created_at: link.createdAt || now,
    created_by: link.createdBy || "",
    expires_on: link.expiresOn,
    upi_ref: link.upiRef || "",
    paid_at: link.paidAt,
    voucher_id: link.voucherId,
    receipt_no: link.receiptNo,
    note: link.note || "",
    gateway_mode: link.gatewayMode || "demo",
    gateway_checkout_url: link.gatewayCheckoutUrl || "",
    gateway_external_id: link.gatewayExternalId || "",
    link_json: {},
    updated_at: now,
  };

  const lines = (link.lines || []).map((line) => ({
    id: `${link.id}:${line.dueKey}`,
    payment_link_id: link.id,
    tenant_id: tenantId,
    due_key: line.dueKey,
    student_id: line.studentId || "",
    student_name: line.studentName || "",
    label: line.label || "",
    kind: line.kind || "academic",
    amount_paise: line.amountPaise,
  }));

  return { header, lines };
}

function rowToLink(
  header: Record<string, unknown>,
  lineRows: Record<string, unknown>[],
): PaymentLink {
  return {
    id: String(header.id),
    code: String(header.code),
    householdId: String(header.household_id || ""),
    studentId: String(header.student_id || ""),
    studentName: String(header.student_name || ""),
    classLabel: String(header.class_label || ""),
    academicYearCode: String(header.academic_year_code),
    amountPaise: Number(header.amount_paise || 0),
    status: String(header.status) as PaymentLinkStatus,
    createdAt: String(header.created_at),
    createdBy: String(header.created_by || ""),
    expiresOn: String(header.expires_on).slice(0, 10),
    upiRef: String(header.upi_ref || ""),
    paidAt: (header.paid_at as string | null) ?? null,
    voucherId: (header.voucher_id as string | null) ?? null,
    receiptNo: (header.receipt_no as string | null) ?? null,
    note: String(header.note || ""),
    gatewayMode: (header.gateway_mode as PaymentLink["gatewayMode"]) || "demo",
    gatewayCheckoutUrl: String(header.gateway_checkout_url || "") || undefined,
    gatewayExternalId: String(header.gateway_external_id || "") || undefined,
    lines: lineRows.map(
      (r): PaymentLinkLine => ({
        dueKey: String(r.due_key),
        studentId: String(r.student_id || ""),
        studentName: String(r.student_name || ""),
        label: String(r.label || ""),
        kind: r.kind as PaymentLinkLine["kind"],
        amountPaise: Number(r.amount_paise || 0),
      }),
    ),
  };
}

function mapMetaRow(
  metaRow: Record<string, unknown> | null,
): PaymentDeskSyncMeta | null {
  if (!metaRow) return null;
  return {
    linkCount: metaRow.link_count as number,
    openLinkCount: metaRow.open_link_count as number,
    paidLinkCount: metaRow.paid_link_count as number,
    gatewayEventCount: metaRow.gateway_event_count as number,
    lastPaidAt: metaRow.last_paid_at as string | null,
    updatedAt: String(metaRow.updated_at),
  };
}

export async function pushPaymentLinksToDb(
  links: PaymentLink[],
): Promise<{ ok: boolean; count: number; error?: string }> {
  if (!paymentsDualWriteDbEnabled()) return { ok: true, count: 0 };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, count: 0, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();
  const active = links ?? [];

  await deleteStale(sb, tenantId, "payment_desk_links", new Set(active.map((l) => l.id)));

  if (!active.length) {
    await sb.from("payment_desk_sync_meta").upsert(
      {
        tenant_id: tenantId,
        link_count: 0,
        open_link_count: 0,
        paid_link_count: 0,
        updated_at: now,
      },
      { onConflict: "tenant_id" },
    );
    return { ok: true, count: 0 };
  }

  const headers: Record<string, unknown>[] = [];
  const lines: Record<string, unknown>[] = [];
  let lastPaidAt: string | null = null;

  for (const link of active) {
    const { header, lines: lrows } = linkToRows(tenantId, link);
    headers.push(header);
    lines.push(...lrows);
    if (link.paidAt && (!lastPaidAt || link.paidAt > lastPaidAt)) {
      lastPaidAt = link.paidAt;
    }
  }

  for (let i = 0; i < headers.length; i += 100) {
    const { error } = await sb
      .from("payment_desk_links")
      .upsert(headers.slice(i, i + 100));
    if (error) return { ok: false, count: 0, error: error.message };
  }

  const linkIds = new Set(active.map((l) => l.id));
  const { rows: existingLines } = await fetchAllPages<{ id: string; payment_link_id: string }>(
    (from, to) =>
      sb
        .from("payment_desk_link_lines")
        .select("id, payment_link_id")
        .eq("tenant_id", tenantId)
        .order("id", { ascending: true })
        .range(from, to),
  );
  const staleLineIds = (existingLines ?? [])
    .filter((r) => linkIds.has(String(r.payment_link_id)))
    .map((r) => String(r.id));
  if (staleLineIds.length) {
    await sb.from("payment_desk_link_lines").delete().in("id", staleLineIds);
  }

  for (let i = 0; i < lines.length; i += 500) {
    const { error } = await sb
      .from("payment_desk_link_lines")
      .upsert(lines.slice(i, i + 500));
    if (error) return { ok: false, count: 0, error: error.message };
  }

  const openCount = active.filter((l) => l.status === "open").length;
  const paidCount = active.filter((l) => l.status === "paid").length;

  await sb.from("payment_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      link_count: active.length,
      open_link_count: openCount,
      paid_link_count: paidCount,
      last_paid_at: lastPaidAt,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true, count: active.length };
}

export async function fetchPaymentLinksFromDb(): Promise<{
  links: PaymentLink[];
  meta: PaymentDeskSyncMeta | null;
  /** false = tenant/query could not be resolved; result is NOT a confirmed empty state. */
  ok: boolean;
}> {
  const ctx = await resolveCtx();
  if (!ctx) return { links: [], meta: null, ok: false };
  const { sb, tenantId } = ctx;

  const headersRes = await fetchAllPages<Record<string, unknown>>((from, to) =>
    sb
      .from("payment_desk_links")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const hErr = headersRes.error ? { message: headersRes.error } : null;
  const headers = headersRes.rows.sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
  );

  if (hErr) {
    console.warn("[payments-db] fetch failed", hErr.message);
    return { links: [], meta: null, ok: false };
  }

  if (!headers?.length) {
    const { data: metaRow, error: metaErr } = await sb
      .from("payment_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (metaErr) {
      console.warn("[payments-db] meta fetch failed", metaErr.message);
      return { links: [], meta: null, ok: false };
    }
    return {
      links: [],
      meta: mapMetaRow(metaRow as Record<string, unknown> | null),
      ok: true,
    };
  }

  const ids = headers.map((h) => h.id as string);
  const [
    { data: lineRows, error: lErr },
    { data: metaRow, error: metaErr },
  ] = await Promise.all([
    sb
      .from("payment_desk_link_lines")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("payment_link_id", ids),
    sb
      .from("payment_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (lErr || metaErr) {
    console.warn("[payments-db] fetch failed", lErr?.message, metaErr?.message);
    return { links: [], meta: null, ok: false };
  }

  const linesByLink = new Map<string, Record<string, unknown>[]>();
  for (const row of lineRows ?? []) {
    const lid = String(row.payment_link_id);
    const list = linesByLink.get(lid) ?? [];
    list.push(row as Record<string, unknown>);
    linesByLink.set(lid, list);
  }

  const links = headers.map((h) =>
    rowToLink(
      h as Record<string, unknown>,
      linesByLink.get(String(h.id)) ?? [],
    ),
  );

  return {
    links,
    meta: mapMetaRow(metaRow as Record<string, unknown> | null),
    ok: true,
  };
}

export async function pushPaymentDeskToDb(
  state: Pick<PaymentsState, "links">,
): Promise<{ ok: boolean; error?: string; linkCount: number }> {
  const result = await pushPaymentLinksToDb(state.links ?? []);
  return {
    ok: result.ok,
    error: result.error,
    linkCount: result.count,
  };
}

export async function fetchPaymentDeskFromDb(): Promise<{
  links: PaymentLink[];
  meta: PaymentDeskSyncMeta | null;
  /** false = tenant/query could not be resolved; result is NOT a confirmed empty state. */
  ok: boolean;
}> {
  return fetchPaymentLinksFromDb();
}

export async function pushPaymentLinkToDb(
  link: PaymentLink,
): Promise<{ ok: boolean; error?: string }> {
  if (!paymentsDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "No tenant" };
  const { sb, tenantId } = ctx;
  const { header, lines } = linkToRows(tenantId, link);

  const { error: hErr } = await sb.from("payment_desk_links").upsert(header);
  if (hErr) return { ok: false, error: hErr.message };

  await sb
    .from("payment_desk_link_lines")
    .delete()
    .eq("payment_link_id", link.id);

  if (lines.length) {
    const { error: lErr } = await sb.from("payment_desk_link_lines").upsert(lines);
    if (lErr) return { ok: false, error: lErr.message };
  }

  const now = new Date().toISOString();
  await sb.from("payment_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      last_paid_at: link.paidAt || null,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function recordPaymentGatewayEvent(input: {
  id?: string;
  paymentLinkId?: string | null;
  provider: PaymentGatewayProvider;
  eventType: string;
  externalPaymentId?: string;
  externalOrderId?: string;
  amountPaise?: number | null;
  settlementStatus?: PaymentGatewayEvent["settlementStatus"];
  voucherId?: string | null;
  receiptNo?: string | null;
  eventJson?: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: string; id: string }> {
  if (!paymentsDualWriteDbEnabled()) {
    return { ok: true, id: input.id || "" };
  }
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "No tenant", id: "" };
  const { sb, tenantId } = ctx;
  const id =
    input.id ||
    `pge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const { error } = await sb.from("payment_desk_gateway_events").upsert({
    id,
    tenant_id: tenantId,
    payment_link_id: input.paymentLinkId || null,
    provider: input.provider,
    event_type: input.eventType || "",
    external_payment_id: input.externalPaymentId || "",
    external_order_id: input.externalOrderId || "",
    amount_paise: input.amountPaise ?? null,
    settlement_status: input.settlementStatus || "received",
    voucher_id: input.voucherId || null,
    receipt_no: input.receiptNo || null,
    event_json: input.eventJson ?? {},
    received_at: now,
  });
  if (error) return { ok: false, error: error.message, id };

  const { count } = await sb
    .from("payment_desk_gateway_events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  await sb.from("payment_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      gateway_event_count: count ?? undefined,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true, id };
}

export async function fetchPaymentGatewayEvents(
  paymentLinkId?: string,
  limit = 50,
): Promise<PaymentGatewayEvent[]> {
  const ctx = await resolveCtx();
  if (!ctx) return [];
  let q = ctx.sb
    .from("payment_desk_gateway_events")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .order("received_at", { ascending: false })
    .limit(limit);
  if (paymentLinkId) {
    q = q.eq("payment_link_id", paymentLinkId);
  }
  const { data } = await q;
  return (data ?? []).map(
    (r): PaymentGatewayEvent => ({
      id: String(r.id),
      paymentLinkId: (r.payment_link_id as string | null) ?? null,
      provider: r.provider as PaymentGatewayProvider,
      eventType: String(r.event_type || ""),
      externalPaymentId: String(r.external_payment_id || ""),
      externalOrderId: String(r.external_order_id || ""),
      amountPaise:
        r.amount_paise === null || r.amount_paise === undefined
          ? null
          : Number(r.amount_paise),
      settlementStatus: r.settlement_status as PaymentGatewayEvent["settlementStatus"],
      voucherId: (r.voucher_id as string | null) ?? null,
      receiptNo: (r.receipt_no as string | null) ?? null,
      receivedAt: String(r.received_at),
    }),
  );
}
