import "server-only";

/**
 * UPI payments the school made, with their UTR (table upi_payment_proofs —
 * see its migration for why it is a server table and not a field on the
 * payroll line or advance). Director, 7 Oct 2026.
 *
 * Read by the WhatsApp screenshot flow (lib/waUpiProof.server) to find the
 * payment a screenshot pays, and by the ERP screens to show "Paid ✓ UTR …".
 */

import { randomBytes } from "node:crypto";
import { loadServerMasters } from "@/lib/api/v1/auth";
import { fetchDeskSliceFromDb } from "@/lib/deskSliceNormalized.server";
import { fetchPayrollDeskFromDb } from "@/lib/payrollNormalized.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import type { UpiProof } from "@/lib/upiPay";
import type { UpiCandidate, UpiMatch, UpiTargetKind } from "@/lib/upiProofMatch";

export type UpiProofRow = {
  id: string;
  status: "pending" | "recorded" | "dismissed";
  utr: string;
  amount_paise: number;
  paid_on: string | null;
  payee_name: string;
  payee_vpa: string;
  target_kind: UpiTargetKind | null;
  target_id: string | null;
  target_label: string;
  candidates: { kind: UpiTargetKind; targetId: string; label: string }[];
  source: "whatsapp" | "erp";
};

function monthLabel(month: string): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? month
    : d.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Every payment a screenshot could be paying. `ok:false` = a source could not be read. */
export async function loadUpiCandidates(): Promise<{ ok: boolean; candidates: UpiCandidate[]; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, candidates: [], error: "tenant unavailable" };
  const [masters, payroll, advances, vouchers] = await Promise.all([
    loadServerMasters(),
    fetchPayrollDeskFromDb(),
    fetchDeskSliceFromDb("staff_advances"),
    ctx.sb
      .from("ledger_lines")
      .select("voucher_id, credit_paise, instrument_mode, instrument_ref, ledger_vouchers!inner(id, voucher_no, voucher_type, voucher_date, narration)")
      .eq("tenant_id", ctx.tenantId)
      .eq("instrument_mode", "upi")
      .gt("credit_paise", 0)
      .gte("ledger_vouchers.voucher_date", new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10))
      .limit(500),
  ]);
  // Unknown is not empty: a source that could not be read must not make a
  // screenshot look like it matches nothing.
  if (!payroll.ok || !advances.ok || vouchers.error) {
    return { ok: false, candidates: [], error: "could not read payroll, advances or the ledger" };
  }
  const staffVpa = new Map(masters.staff.map((s) => [s.id, (s.upiId || "").trim()]));
  const out: UpiCandidate[] = [];

  for (const run of payroll.bundle.runs) {
    if (run.status !== "posted" && run.status !== "paid") continue;
    for (const l of run.lines) {
      const amt = l.amountPayable ?? (l.juneHold ? 0 : l.netPay);
      if (!(amt > 0)) continue;
      out.push({
        kind: "payroll_line",
        targetId: `${run.id}|${l.staffId}`,
        label: `${monthLabel(run.month)} salary — ${l.fullName}`,
        amountPaise: Math.round(amt * 100),
        payeeName: l.fullName,
        payeeVpa: staffVpa.get(l.staffId) || "",
        date: `${run.month}-01`,
        dateWindowDays: -1,
      });
    }
  }

  const advRows = Array.isArray(advances.bundle.advances) ? (advances.bundle.advances as Record<string, unknown>[]) : [];
  for (const a of advRows) {
    const amount = Number(a.amount) || 0;
    if (!(amount > 0) || !a.id) continue;
    out.push({
      kind: "staff_advance",
      targetId: String(a.id),
      label: `Advance ${String(a.givenDate || "")} — ${String(a.fullName || "")}`,
      amountPaise: Math.round(amount * 100),
      payeeName: String(a.fullName || ""),
      payeeVpa: staffVpa.get(String(a.staffId || "")) || "",
      date: String(a.givenDate || "").slice(0, 10),
      dateWindowDays: 3,
    });
  }

  type VRow = {
    voucher_id: string;
    credit_paise: number;
    instrument_ref: string | null;
    ledger_vouchers: { id: string; voucher_no: string; voucher_type: string; voucher_date: string; narration: string } | null;
  };
  const byVoucher = new Map<string, { v: NonNullable<VRow["ledger_vouchers"]>; amount: number }>();
  for (const r of (vouchers.data ?? []) as unknown as VRow[]) {
    if (!r.ledger_vouchers || r.ledger_vouchers.voucher_type !== "payment") continue;
    if ((r.instrument_ref || "").trim()) continue; // already carries its reference
    const cur = byVoucher.get(r.voucher_id);
    byVoucher.set(r.voucher_id, { v: r.ledger_vouchers, amount: (cur?.amount ?? 0) + Number(r.credit_paise || 0) });
  }
  for (const [id, { v, amount }] of byVoucher) {
    const payee = (v.narration || "").replace(/\s*\(.*$/, "").trim();
    out.push({
      kind: "ledger_voucher",
      targetId: id,
      label: `${v.voucher_no} — ${payee || "payment"}`,
      amountPaise: amount,
      payeeName: payee,
      payeeVpa: "",
      date: v.voucher_date,
      dateWindowDays: 3,
    });
  }
  return { ok: true, candidates: out };
}

/** "kind:targetId" of everything already recorded, plus every recorded UTR. */
export async function recordedUpiTargets(): Promise<{ targets: Set<string>; utrs: Set<string> }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { targets: new Set(), utrs: new Set() };
  const { data } = await ctx.sb
    .from("upi_payment_proofs")
    .select("utr, target_kind, target_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "recorded")
    .limit(5000);
  const rows = (data ?? []) as { utr: string; target_kind: string; target_id: string }[];
  return {
    targets: new Set(rows.map((r) => `${r.target_kind}:${r.target_id}`)),
    utrs: new Set(rows.map((r) => r.utr)),
  };
}

export async function findRecordedUtr(utr: string): Promise<UpiProofRow | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data } = await ctx.sb
    .from("upi_payment_proofs")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("utr", utr)
    .eq("status", "recorded")
    .maybeSingle();
  return (data as UpiProofRow | null) ?? null;
}

/** A screenshot read on WhatsApp, waiting for the sender to say which payment. */
export async function createPendingUpiProof(input: {
  proof: UpiProof;
  matches: UpiMatch[];
  senderMobile: string;
  senderStaffId: string;
  waMessageId: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "tenant unavailable" };
  const id = `upd_${randomBytes(9).toString("base64url")}`;
  const { error } = await ctx.sb.from("upi_payment_proofs").insert({
    id,
    tenant_id: ctx.tenantId,
    status: "pending",
    utr: input.proof.utr,
    amount_paise: input.proof.amountPaise,
    paid_on: input.proof.paidOn || null,
    payee_name: input.proof.payeeName,
    payee_vpa: input.proof.payeeVpa,
    candidates: input.matches.map((m) => ({ kind: m.kind, targetId: m.targetId, label: m.label })),
    source: "whatsapp",
    sender_mobile: input.senderMobile,
    sender_staff_id: input.senderStaffId,
    wa_message_id: input.waMessageId,
  });
  return error ? { ok: false, error: error.message } : { ok: true, id };
}

/**
 * The sender tapped a button: record the chosen payment, or dismiss. Only
 * the person who sent the screenshot may answer for it.
 */
export async function answerPendingUpiProof(
  id: string,
  choice: number | "no",
  senderMobile: string,
  by: string,
): Promise<{ ok: true; recorded: UpiProofRow | null } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "tenant unavailable" };
  const { data } = await ctx.sb.from("upi_payment_proofs").select("*").eq("tenant_id", ctx.tenantId).eq("id", id).maybeSingle();
  const row = data as (UpiProofRow & { sender_mobile: string }) | null;
  if (!row) return { ok: false, error: "That screenshot is no longer waiting — send it again." };
  if (row.sender_mobile !== senderMobile) return { ok: false, error: "Only the person who sent the screenshot can answer for it." };
  if (row.status !== "pending") {
    return { ok: false, error: row.status === "recorded" ? `Already recorded on ${row.target_label}.` : "That screenshot was set aside." };
  }
  const now = new Date().toISOString();
  if (choice === "no") {
    await ctx.sb.from("upi_payment_proofs").update({ status: "dismissed", recorded_by: by, updated_at: now }).eq("id", id);
    return { ok: true, recorded: null };
  }
  const pick = row.candidates[choice];
  if (!pick) return { ok: false, error: "That choice is no longer on offer — send the screenshot again." };
  const blocked = await cashgramBlocks(pick.kind, pick.targetId);
  if (blocked) return { ok: false, error: blocked };
  const { data: upd, error } = await ctx.sb
    .from("upi_payment_proofs")
    .update({
      status: "recorded",
      target_kind: pick.kind,
      target_id: pick.targetId,
      target_label: pick.label,
      recorded_by: by,
      updated_at: now,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) {
    // The two unique indexes: this UTR, or this payment, is already recorded.
    return {
      ok: false,
      error: /duplicate key|unique/i.test(error.message)
        ? "This UTR, or this payment, is already recorded — nothing changed."
        : error.message,
    };
  }
  return { ok: true, recorded: (upd as UpiProofRow | null) ?? null };
}

/**
 * Why a UTR must not be recorded against this item now: a Cashgram pay link is
 * open for it, or already collected. "" when nothing blocks it. Fails closed —
 * an unreadable check blocks, since recording would mark a salary paid that a
 * link may be paying too.
 */
async function cashgramBlocks(kind: string, targetId: string): Promise<string> {
  const { liveCashgramForTarget } = await import("@/lib/cashgramRefunds.server");
  const link = await liveCashgramForTarget(kind, targetId);
  if (!link.ok) return link.error;
  if (!link.row) return "";
  return link.row.status === "REDEEMED"
    ? "Already paid by a Cashgram link — this would be a second payment."
    : "A Cashgram pay link is open for this — cancel it first, or this is paid twice.";
}

/** Recorded from the ERP's own Pay by UPI button. */
export async function recordUpiProofFromErp(input: {
  utr: string;
  amountPaise: number;
  paidOn: string;
  payeeName: string;
  payeeVpa: string;
  targetKind: UpiTargetKind;
  targetId: string;
  targetLabel: string;
  by: string;
  staffId: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "tenant unavailable" };
  const blocked = await cashgramBlocks(input.targetKind, input.targetId);
  if (blocked) return { ok: false, error: blocked };
  const id = `upr_${randomBytes(9).toString("base64url")}`;
  const { error } = await ctx.sb.from("upi_payment_proofs").insert({
    id,
    tenant_id: ctx.tenantId,
    status: "recorded",
    utr: input.utr,
    amount_paise: input.amountPaise,
    paid_on: input.paidOn || null,
    payee_name: input.payeeName,
    payee_vpa: input.payeeVpa,
    target_kind: input.targetKind,
    target_id: input.targetId,
    target_label: input.targetLabel,
    source: "erp",
    sender_staff_id: input.staffId,
    recorded_by: input.by,
  });
  if (error) {
    return {
      ok: false,
      error: /duplicate key|unique/i.test(error.message)
        ? "This UTR, or this payment, is already recorded."
        : error.message,
    };
  }
  return { ok: true, id };
}

/** Recorded proofs for some paid items, for the screens to show. */
export async function listRecordedUpiProofs(
  kind: UpiTargetKind,
  targetIds: string[],
): Promise<Pick<UpiProofRow, "utr" | "paid_on" | "target_id" | "source">[]> {
  const ctx = await getServerTenantContext();
  if (!ctx || targetIds.length === 0) return [];
  const { data } = await ctx.sb
    .from("upi_payment_proofs")
    .select("utr, paid_on, target_id, source")
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "recorded")
    .eq("target_kind", kind)
    .in("target_id", targetIds.slice(0, 500));
  return (data ?? []) as Pick<UpiProofRow, "utr" | "paid_on" | "target_id" | "source">[];
}

/** The recorded proof for one paid item, if any. */
export async function findRecordedTargetProof(kind: UpiTargetKind, targetId: string): Promise<UpiProofRow | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data } = await ctx.sb
    .from("upi_payment_proofs")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "recorded")
    .eq("target_kind", kind)
    .eq("target_id", targetId)
    .maybeSingle();
  return (data as UpiProofRow | null) ?? null;
}
