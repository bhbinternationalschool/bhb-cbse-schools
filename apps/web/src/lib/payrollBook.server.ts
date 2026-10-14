/**
 * Payroll ↔ server book (14 Oct 2026).
 *
 * Recall: payroll_ledger_recall reverses the run's live accrual and payment
 * vouchers and records the recall, all or nothing — Payroll's "Recall to
 * draft" asks this first and is refused when it fails, so a run is never
 * back in draft with its salary still in the book (July 2026:
 * PR/FY2026-27/00002 stayed live after the recall until it was reversed by
 * hand as RV/FY2026-27/00983).
 *
 * Post: the same payroll_ledger_post the desk-save trigger runs (the
 * trigger swallows its errors so a book refusal never costs the office its
 * payroll record). Payroll calls it after publishing or marking staff paid,
 * to show the voucher numbers — or the reason the book refused.
 */

import { getServerTenantContext } from "@/lib/serverTenant";

export type PayrollBookReversal = { voucherNo: string; reversalNo: string; sourceType: string };

export type PayrollBookPayment = {
  date: string;
  account: string;
  staff: number;
  amountPaise: number;
  voucherNo: string;
  created: boolean;
  skipped?: string;
  reversedBy?: string;
};

export type PayrollBookPostResult = {
  ok: boolean;
  error?: string;
  skipped?: string;
  accrual?: { voucherNo: string; created: boolean; skipped?: string } | null;
  payment?: { voucherNo: string; created: boolean; skipped?: string } | null;
  payments: PayrollBookPayment[];
};

export async function recallPayrollBook(
  runId: string,
  actor: string,
): Promise<{ ok: true; reversed: PayrollBookReversal[] } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { data, error } = await ctx.sb.rpc("payroll_ledger_recall", {
    p_tenant_id: ctx.tenantId,
    p_run_id: runId,
    p_actor: actor,
    p_reason: "",
  });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as {
    ok?: boolean;
    refused?: string;
    reversed?: { voucher_no?: string; reversal_no?: string; source_type?: string }[];
  };
  if (!r.ok) return { ok: false, error: r.refused || "the book refused the recall" };
  return {
    ok: true,
    reversed: (r.reversed ?? []).map((x) => ({
      voucherNo: String(x.voucher_no ?? ""),
      reversalNo: String(x.reversal_no ?? ""),
      sourceType: String(x.source_type ?? ""),
    })),
  };
}

export async function postPayrollBook(runId: string, actor: string): Promise<PayrollBookPostResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured", payments: [] };
  const { data, error } = await ctx.sb.rpc("payroll_ledger_post", {
    p_tenant_id: ctx.tenantId,
    p_run_id: runId,
    p_actor: actor,
  });
  if (error) return { ok: false, error: error.message, payments: [] };
  const r = (data ?? {}) as {
    ok?: boolean;
    refused?: string;
    skipped?: string;
    accrual?: { voucher_no?: string | null; created?: boolean; skipped?: string } | null;
    payment?: {
      voucher_no?: string | null;
      created?: boolean;
      skipped?: string;
      groups?: {
        date?: string;
        account?: string;
        staff?: number;
        amount_paise?: number;
        voucher_no?: string | null;
        created?: boolean;
        skipped?: string;
        reversed_by?: string;
      }[];
    } | null;
  };
  if (!r.ok) return { ok: false, error: r.refused || "the book refused this run", payments: [] };
  return {
    ok: true,
    skipped: r.skipped,
    accrual: r.accrual
      ? { voucherNo: String(r.accrual.voucher_no ?? ""), created: !!r.accrual.created, skipped: r.accrual.skipped }
      : null,
    payment: r.payment
      ? { voucherNo: String(r.payment.voucher_no ?? ""), created: !!r.payment.created, skipped: r.payment.skipped }
      : null,
    payments: (r.payment?.groups ?? []).map((g) => ({
      date: String(g.date ?? ""),
      account: String(g.account ?? ""),
      staff: Number(g.staff ?? 0),
      amountPaise: Number(g.amount_paise ?? 0),
      voucherNo: String(g.voucher_no ?? ""),
      created: !!g.created,
      skipped: g.skipped,
      reversedBy: g.reversed_by,
    })),
  };
}
