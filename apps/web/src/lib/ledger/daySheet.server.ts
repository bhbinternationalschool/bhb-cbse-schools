/**
 * Days of money, by tender — what the counter hands to the principal.
 *
 * Deliberately movements over a short range (a day by default, at most
 * DAY_SHEET_MAX_DAYS) and nothing more. The office keys vouchers and runs this
 * sheet; what the school holds in cash and bank, and what it has earned and
 * spent across the session, sit behind `accounts_position` and are not read
 * here. So this is safe to leave open to whoever works the counter.
 *
 * "Tender" is the cash or bank account the money actually moved through —
 * Cash in Hand, UBI, the UPI clearing account — because that is what a
 * hand-over is reconciled against. The contra head on each line says what the
 * money was for.
 */

import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages, fetchByIds } from "@/lib/supabase/pageAll";
import {
  buildDaySheet,
  daySheetRange,
  type DaySheet,
  type DsAccount,
  type DsLine,
  type DsVoucher,
} from "@/lib/ledger/daySheet";

export type {
  DaySheet,
  DaySheetCancelled,
  DaySheetDay,
  DaySheetHead,
  DaySheetSide,
  DaySheetTender,
} from "@/lib/ledger/daySheet";

const EMPTY_SIDE = { totalPaise: 0, count: 0, tenders: [] };

type VoucherRow = {
  id: string;
  voucher_no: string;
  voucher_date: string;
  narration: string | null;
  reverses_voucher_id: string | null;
};

const toVoucher = (r: VoucherRow): DsVoucher => ({
  id: String(r.id),
  voucherNo: String(r.voucher_no ?? ""),
  date: String(r.voucher_date ?? "").slice(0, 10),
  narration: String(r.narration ?? ""),
  reversesVoucherId: r.reverses_voucher_id ? String(r.reverses_voucher_id) : "",
});

/**
 * Every read is paged: PostgREST stops at 1,000 rows and calls it success,
 * and a month of this school's book is several thousand lines. A failed read
 * is an error on the sheet, never a shorter sheet.
 */
export async function readDaySheet(input: {
  date?: string;
  from?: string;
  to?: string;
}): Promise<DaySheet> {
  const range = daySheetRange(input);
  const blank: DaySheet = {
    ok: false,
    date: range.from,
    from: range.from,
    to: range.to,
    collections: EMPTY_SIDE,
    expenses: EMPTY_SIDE,
    days: [],
    cancelled: [],
    crossRange: [],
    truncated: false,
  };
  if (!range.ok) return { ...blank, error: range.error };

  const ctx = await getServerTenantContext();
  if (!ctx) return { ...blank, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const cols = "id, voucher_no, voucher_date, narration, reverses_voucher_id";

  const [vouchersRes, accountsRes, reversalsRes] = await Promise.all([
    fetchAllPages<VoucherRow>((from, to) =>
      sb
        .from("ledger_vouchers")
        .select(cols)
        .eq("tenant_id", tenantId)
        .gte("voucher_date", range.from)
        .lte("voucher_date", range.to)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    sb
      .from("ledger_accounts")
      .select("id, code, name, is_cash, is_bank")
      .eq("tenant_id", tenantId),
    // Every reversal in the book, whatever its date: a voucher on this sheet
    // cancelled months later is still counted here, but labelled (66 of 982
    // were dated off their original's day on 13 Oct 2026 — voided fee
    // receipts, mostly).
    fetchAllPages<VoucherRow>((from, to) =>
      sb
        .from("ledger_vouchers")
        .select(cols)
        .eq("tenant_id", tenantId)
        .not("reverses_voucher_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);
  if (vouchersRes.error) return { ...blank, error: vouchersRes.error };
  if (accountsRes.error) return { ...blank, error: accountsRes.error.message };
  if (reversalsRes.error) return { ...blank, error: reversalsRes.error };

  const vouchers = vouchersRes.rows.map(toVoucher);
  const accounts: DsAccount[] = ((accountsRes.data ?? []) as Record<string, unknown>[]).map((a) => ({
    id: String(a.id),
    code: String(a.code ?? ""),
    name: String(a.name ?? ""),
    isMoney: !!a.is_cash || !!a.is_bank,
  }));

  const linesRes = await fetchByIds<Record<string, unknown>>(
    vouchers.map((v) => v.id),
    (chunk, from, to) =>
      sb
        .from("ledger_lines")
        .select("id, voucher_id, account_id, debit_paise, credit_paise")
        .eq("tenant_id", tenantId)
        .in("voucher_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
  );
  if (linesRes.error) return { ...blank, error: linesRes.error };
  const lines: DsLine[] = linesRes.rows.map((l) => ({
    voucherId: String(l.voucher_id),
    accountId: String(l.account_id),
    debitPaise: Number(l.debit_paise ?? 0),
    creditPaise: Number(l.credit_paise ?? 0),
  }));

  // The originals that in-range reversals cancel but that fall outside the
  // range: read only for their number and date, to label the reversal.
  const inRange = new Set(vouchers.map((v) => v.id));
  const missing = vouchers
    .map((v) => v.reversesVoucherId)
    .filter((id) => id && !inRange.has(id));
  const originalsRes = await fetchByIds<VoucherRow>(missing, (chunk, from, to) =>
    sb
      .from("ledger_vouchers")
      .select(cols)
      .eq("tenant_id", tenantId)
      .in("id", chunk)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (originalsRes.error) return { ...blank, error: originalsRes.error };

  return {
    ok: true,
    // Real, not assumed: the paged reader stops at its row ceiling and says so.
    truncated: vouchersRes.truncated || reversalsRes.truncated,
    ...buildDaySheet({
      from: range.from,
      to: range.to,
      vouchers,
      lines,
      accounts,
      reversals: reversalsRes.rows.map(toVoucher),
      originals: originalsRes.rows.map(toVoucher),
    }),
  };
}
