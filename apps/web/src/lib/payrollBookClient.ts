/**
 * Payroll screen → server book (14 Oct 2026). See app/api/payroll/book.
 */

import { flushPayrollDeskSync } from "@/lib/payrollNormalizedClient";

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

export type PayrollBookState = {
  ok: boolean;
  error?: string;
  skipped?: string;
  accrual?: { voucherNo: string; created: boolean; skipped?: string } | null;
  payment?: { voucherNo: string; created: boolean; skipped?: string } | null;
  payments?: PayrollBookPayment[];
};

async function call<T>(body: Record<string, unknown>): Promise<T | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/payroll/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
    if (!j) return { ok: false, error: `The book did not answer (HTTP ${res.status})` };
    if (!res.ok || !j.ok) return { ok: false, error: j.error || `HTTP ${res.status}` };
    return j;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Reverse the run's payroll vouchers in the server book. Asked BEFORE the
 * run goes back to draft: when this fails, the recall does not happen.
 */
export async function recallRunInBook(
  runId: string,
): Promise<{ ok: true; reversed: PayrollBookReversal[] } | { ok: false; error: string }> {
  await flushPayrollDeskSync();
  return call<{ ok: true; reversed: PayrollBookReversal[] }>({ action: "recall", runId });
}

/** Save what is waiting, then post (or re-read) the run in the book. */
export async function postRunInBook(runId: string): Promise<PayrollBookState> {
  await flushPayrollDeskSync();
  const r = await call<PayrollBookState>({ action: "post", runId });
  return r as PayrollBookState;
}

/** One line for a toast: what the book now holds for the run. */
export function describeBookState(b: PayrollBookState): string {
  if (!b.ok) return `The book refused: ${b.error || "unknown error"}`;
  if (b.skipped) return `Book: ${b.skipped}`;
  const parts: string[] = [];
  if (b.accrual?.voucherNo) parts.push(`salary ${b.accrual.voucherNo}`);
  else if (b.accrual?.skipped) parts.push(`salary not posted — ${b.accrual.skipped}`);
  const live = (b.payments ?? []).filter((p) => p.voucherNo && !p.reversedBy);
  const fresh = live.filter((p) => p.created);
  if (live.length) {
    parts.push(
      `${live.length} payment voucher${live.length === 1 ? "" : "s"}${fresh.length ? ` (${fresh.map((p) => p.voucherNo).join(", ")} new)` : ""}`,
    );
  } else if (b.payment?.voucherNo) {
    parts.push(`payment ${b.payment.voucherNo}`);
  } else if (b.payment?.skipped) {
    parts.push(`payment: ${b.payment.skipped}`);
  }
  const held = (b.payments ?? []).filter((p) => p.skipped);
  if (held.length) parts.push(`${held.length} payment group(s) not posted — ${held[0]!.skipped}`);
  return parts.length ? `Book: ${parts.join(" · ")}` : "Book: nothing to post yet";
}
