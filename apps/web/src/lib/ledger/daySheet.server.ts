/**
 * One day of money, by tender — what the counter hands to the principal.
 *
 * Deliberately a day and nothing more. The office keys vouchers and runs this
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

export type DaySheetHead = {
  code: string;
  name: string;
  paise: number;
  count: number;
};

export type DaySheetTender = {
  code: string;
  name: string;
  paise: number;
  count: number;
  heads: DaySheetHead[];
};

export type DaySheetSide = {
  totalPaise: number;
  count: number;
  tenders: DaySheetTender[];
};

export type DaySheet = {
  ok: boolean;
  error?: string;
  date: string;
  collections: DaySheetSide;
  expenses: DaySheetSide;
  /** True when the day hit the row cap and the sheet may be short. */
  truncated: boolean;
};

const EMPTY_SIDE: DaySheetSide = { totalPaise: 0, count: 0, tenders: [] };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** One day of a school's book is far below this; the guard is for a bad date. */
const MAX_LINES = 5000;

export async function readDaySheet(date: string): Promise<DaySheet> {
  const blank: DaySheet = {
    ok: false,
    date,
    collections: EMPTY_SIDE,
    expenses: EMPTY_SIDE,
    truncated: false,
  };
  if (!ISO_DATE.test(date)) return { ...blank, error: "Date must be yyyy-mm-dd" };

  const ctx = await getServerTenantContext();
  if (!ctx) return { ...blank, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;

  const [vouchersRes, accountsRes] = await Promise.all([
    sb
      .from("ledger_vouchers")
      .select("id, voucher_no, voucher_type, narration")
      .eq("tenant_id", tenantId)
      .eq("voucher_date", date),
    sb
      .from("ledger_accounts")
      .select("id, code, name, is_cash, is_bank")
      .eq("tenant_id", tenantId),
  ]);
  if (vouchersRes.error) return { ...blank, error: vouchersRes.error.message };
  if (accountsRes.error) return { ...blank, error: accountsRes.error.message };

  const voucherIds = (vouchersRes.data ?? []).map((v) => String((v as { id: string }).id));
  if (voucherIds.length === 0) {
    return { ok: true, date, collections: EMPTY_SIDE, expenses: EMPTY_SIDE, truncated: false };
  }

  type Acct = { id: string; code: string; name: string; isMoney: boolean };
  const accounts = new Map<string, Acct>();
  for (const a of (accountsRes.data ?? []) as Record<string, unknown>[]) {
    accounts.set(String(a.id), {
      id: String(a.id),
      code: String(a.code ?? ""),
      name: String(a.name ?? ""),
      isMoney: !!a.is_cash || !!a.is_bank,
    });
  }

  // PostgREST caps a response at 1,000 rows, so the lines are read in chunks
  // of voucher ids rather than one `.in()` over the whole day.
  const lines: Record<string, unknown>[] = [];
  let truncated = false;
  for (let i = 0; i < voucherIds.length; i += 100) {
    const { data, error } = await sb
      .from("ledger_lines")
      .select("voucher_id, account_id, debit_paise, credit_paise")
      .eq("tenant_id", tenantId)
      .in("voucher_id", voucherIds.slice(i, i + 100))
      .limit(1000);
    if (error) return { ...blank, error: error.message };
    lines.push(...((data ?? []) as Record<string, unknown>[]));
    if (lines.length > MAX_LINES) {
      truncated = true;
      break;
    }
  }

  // Group the lines of each voucher, so a money line can be told what it was
  // for: the contra side of the same voucher.
  const byVoucher = new Map<string, Record<string, unknown>[]>();
  for (const l of lines) {
    const id = String(l.voucher_id);
    const arr = byVoucher.get(id);
    if (arr) arr.push(l);
    else byVoucher.set(id, [l]);
  }

  const collect = new Map<string, DaySheetTender>();
  const spend = new Map<string, DaySheetTender>();

  const bump = (
    side: Map<string, DaySheetTender>,
    tender: Acct,
    head: Acct | undefined,
    paise: number,
  ) => {
    let t = side.get(tender.code);
    if (!t) {
      t = { code: tender.code, name: tender.name, paise: 0, count: 0, heads: [] };
      side.set(tender.code, t);
    }
    t.paise += paise;
    t.count += 1;
    const code = head?.code ?? "—";
    const name = head?.name ?? "Unclassified";
    let h = t.heads.find((x) => x.code === code);
    if (!h) {
      h = { code, name, paise: 0, count: 0 };
      t.heads.push(h);
    }
    h.paise += paise;
    h.count += 1;
  };

  for (const [voucherId, vLines] of byVoucher) {
    void voucherId;
    // The contra is whatever the voucher touched that was NOT cash or bank.
    // Where several heads share one money line, the largest is named — a
    // hand-over sheet wants the head, not a full double-entry dissection.
    const nonMoney = vLines
      .map((l) => accounts.get(String(l.account_id)))
      .filter((a): a is Acct => !!a && !a.isMoney);
    const head = nonMoney.length === 1 ? nonMoney[0] : nonMoney[0];

    for (const l of vLines) {
      const acct = accounts.get(String(l.account_id));
      if (!acct?.isMoney) continue;
      const debit = Number(l.debit_paise ?? 0);
      const credit = Number(l.credit_paise ?? 0);
      // Money in is a debit to cash/bank; money out is a credit.
      if (debit > 0) bump(collect, acct, head, debit);
      else if (credit > 0) bump(spend, acct, head, credit);
    }
  }

  const side = (m: Map<string, DaySheetTender>): DaySheetSide => {
    const tenders = [...m.values()].sort((a, b) => b.paise - a.paise);
    for (const t of tenders) t.heads.sort((a, b) => b.paise - a.paise);
    return {
      tenders,
      totalPaise: tenders.reduce((n, t) => n + t.paise, 0),
      count: tenders.reduce((n, t) => n + t.count, 0),
    };
  };

  return { ok: true, date, collections: side(collect), expenses: side(spend), truncated };
}
