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
import { fetchAllPages, fetchByIds } from "@/lib/supabase/pageAll";
import { linkStatusRegresses } from "@/lib/paymentLinkStatusGuard";
import { replaceChildRows } from "./replaceChildRows.server";

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
 * Delete rows by id in chunks. One .in("id", [...]) with hundreds of long
 * ids ("pl_…:acad:stu_…:fsl_…") makes a URL past PostgREST's limit and the
 * whole DELETE is refused (400) — 21 times on 8–9 Oct 2026, unnoticed
 * because nothing read the error.
 */
async function deleteIdsInChunks(
  sb: NonNullable<Awaited<ReturnType<typeof getServerTenantContext>>>["sb"],
  table: string,
  tenantId: string,
  ids: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (let i = 0; i < ids.length; i += 50) {
    const { error } = await sb.from(table).delete().eq("tenant_id", tenantId).in("id", ids.slice(i, i + 50));
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
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
): Promise<{ ok: boolean; count: number; error?: string; kept?: string[] }> {
  if (!paymentsDualWriteDbEnabled()) return { ok: true, count: 0 };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, count: 0, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();
  const active = links ?? [];

  // No prune. Links are written by many hands that never pass through this
  // browser — /pay/due, the WhatsApp bot, autopay, parent checkout, gateway
  // webhooks — and by the server from its own cached copy. A link is never
  // hard-deleted (cancel, expire and paid are statuses), so deleting the
  // links a payload lacks only ever erased someone else's, paid ones included.

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

  // A link's status only moves forward (paymentLinkStatusGuard): a save may
  // not write "open" back over a paid, cancelled or expired link, nor take a
  // paid one out of "paid". Those links keep their stored row — header and
  // lines — and the rest of the save goes through. The stored statuses must
  // be read to know: if they can't be, nothing is written.
  const storedStatus = new Map<string, string>();
  {
    const read = await fetchByIds<{ id: string; status: string }>(
      active.map((l) => l.id),
      (chunk, from, to) =>
        sb
          .from("payment_desk_links")
          .select("id, status")
          .eq("tenant_id", tenantId)
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
      { chunkSize: 50 },
    );
    if (read.error) {
      return { ok: false, count: 0, error: `Could not read the stored links — nothing was written: ${read.error}` };
    }
    for (const r of read.rows) storedStatus.set(String(r.id), String(r.status));
  }
  const kept: string[] = [];
  const writable = active.filter((l) => {
    if (linkStatusRegresses(storedStatus.get(l.id), l.status)) {
      kept.push(l.id);
      return false;
    }
    return true;
  });
  if (kept.length) {
    console.warn(
      `[payments-db] kept ${kept.length} link(s) as stored — the save would have moved their status backwards:`,
      kept.slice(0, 20).join(", "),
    );
  }

  const headers: Record<string, unknown>[] = [];
  const lines: Record<string, unknown>[] = [];
  let lastPaidAt: string | null = null;

  for (const link of writable) {
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

  const linkIds = new Set(writable.map((l) => l.id));
  const { rows: existingLines } = await fetchAllPages<{ id: string; payment_link_id: string }>(
    (from, to) =>
      sb
        .from("payment_desk_link_lines")
        .select("id, payment_link_id")
        .eq("tenant_id", tenantId)
        .order("id", { ascending: true })
        .range(from, to),
  );
  // Only lines that are GONE from a link are deleted — the rest are upserted
  // below. Deleting every line of every active link in one request made a URL
  // too long for PostgREST: the delete was refused (400) and a line removed
  // from a link (a waived fee) lived on beside the current ones.
  const currentLineIds = new Set(lines.map((l) => String((l as { id: string }).id)));
  const staleLineIds = (existingLines ?? [])
    .filter((r) => linkIds.has(String(r.payment_link_id)) && !currentLineIds.has(String(r.id)))
    .map((r) => String(r.id));
  const delLines = await deleteIdsInChunks(sb, "payment_desk_link_lines", tenantId, staleLineIds);
  if (!delLines.ok) return { ok: false, count: 0, error: `Could not remove old link lines: ${delLines.error}` };

  for (let i = 0; i < lines.length; i += 500) {
    const { error } = await sb
      .from("payment_desk_link_lines")
      .upsert(lines.slice(i, i + 500));
    if (error) return { ok: false, count: 0, error: error.message };
  }

  const openCount = writable.filter((l) => l.status === "open").length;
  const paidCount = writable.filter((l) => l.status === "paid").length;

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

  return { ok: true, count: writable.length, kept };
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
    // Paged and chunked: a link's lines that fall past the 1,000-row cap
    // reach the browser missing, and its next save would delete them.
    fetchByIds<Record<string, unknown>>(
      ids,
      (chunk, from, to) =>
        sb
          .from("payment_desk_link_lines")
          .select("*")
          .eq("tenant_id", tenantId)
          .in("payment_link_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
      { chunkSize: 50 },
    ).then((r) => ({ data: r.rows, error: r.error ? { message: r.error } : null })),
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
): Promise<{ ok: boolean; error?: string; linkCount: number; kept?: string[] }> {
  const result = await pushPaymentLinksToDb(state.links ?? []);
  return {
    ok: result.ok,
    error: result.error,
    linkCount: result.count,
    kept: result.kept,
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

/**
 * Read ONE pay-link straight from the desk table, lines included.
 *
 * The settlement path must never depend on the school mirror having been
 * hydrated: the mirror is a cache behind a 45-second TTL and a table
 * fingerprint, and a cache that is merely stale still answers "no such
 * link". On 26 Sep 2026 that answer lost AADVIK SINGH's Rs 2,500 three
 * times over — Cashfree had the money, the desk table had the link, and
 * the only thing between them was a mirror slice with zero links in it
 * that nothing would refresh because the table had not changed since.
 *
 * Returns null only when this link genuinely is not in the table (or the
 * tenant cannot be resolved, which is indistinguishable from the caller's
 * point of view and is logged here).
 */
export async function fetchPaymentLinkFromDb(
  linkId: string,
): Promise<PaymentLink | null> {
  const id = linkId.trim();
  if (!id) return null;
  const ctx = await resolveCtx();
  if (!ctx) {
    console.warn("[payments-db] single link fetch: no tenant", id);
    return null;
  }
  const { sb, tenantId } = ctx;

  const { data: header, error: hErr } = await sb
    .from("payment_desk_links")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (hErr) {
    console.warn("[payments-db] single link fetch failed", id, hErr.message);
    return null;
  }
  if (!header) return null;

  // Lines are not optional: a link settled without them books an amount
  // that cannot be attributed to any due.
  const { data: lineRows, error: lErr } = await sb
    .from("payment_desk_link_lines")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("payment_link_id", id);
  if (lErr) {
    console.warn("[payments-db] single link lines failed", id, lErr.message);
    return null;
  }

  return rowToLink(
    header as Record<string, unknown>,
    (lineRows ?? []) as Record<string, unknown>[],
  );
}

export async function pushPaymentLinkToDb(
  link: PaymentLink,
): Promise<{ ok: boolean; error?: string }> {
  if (!paymentsDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "No tenant" };
  const { sb, tenantId } = ctx;
  const { header, lines } = linkToRows(tenantId, link);

  // Same rule as the whole-desk save: never move a stored link backwards
  // (a stale server copy patching gateway details onto a link already paid).
  {
    const { data: cur, error: curErr } = await sb
      .from("payment_desk_links")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("id", link.id)
      .maybeSingle();
    if (curErr) return { ok: false, error: `Could not read the stored link — nothing was written: ${curErr.message}` };
    const stored = (cur as { status?: string } | null)?.status;
    if (linkStatusRegresses(stored, link.status)) {
      console.warn(`[payments-db] kept link ${link.id} as stored (${stored}); refused a write moving it to ${link.status}`);
      return { ok: true };
    }
  }

  const { error: hErr } = await sb.from("payment_desk_links").upsert(header);
  if (hErr) return { ok: false, error: hErr.message };

  // One transaction: a payment link that loses its lines is a link for an
  // amount nobody can attribute to a due.
  const lineWrite = await replaceChildRows(sb, {
    table: "payment_desk_link_lines",
    tenantId,
    match: { payment_link_id: link.id },
    rows: lines,
  });
  if (!lineWrite.ok) return { ok: false, error: lineWrite.error };

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
