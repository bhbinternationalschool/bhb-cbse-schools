/**
 * Ledger v2 — the server-side gateway to the book.
 *
 * Everything here runs on the server over the service_role connection and
 * calls the `ledger_*` RPCs. No browser code writes the ledger directly: the
 * guarantees the ledger makes (balance, period, gap-free numbering,
 * idempotency, append-only) live inside those functions, and a client that
 * reached past them would be able to break every one of them.
 *
 * Reads come from the views, which derive every balance from the lines — there
 * is no stored balance anywhere in this module by design.
 *
 * Server-only by the `.server.ts` convention this project uses: it reaches for
 * the service-role key, which must never reach a browser bundle.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import {
  defaultCostCentres,
  defaultLedgerAccounts,
  isPostableLedgerCode,
} from "@/lib/ledger/coa";
import type {
  LedgerPeriodStatus,
  LedgerPostResult,
  LedgerTrialBalanceRow,
  LedgerVoucherInput,
} from "@/lib/ledger/types";

/** Row shape the ledger_post RPC expects — snake_case, as the SQL reads it. */
function lineToRpc(line: LedgerVoucherInput["lines"][number]) {
  return {
    account_code: line.accountCode,
    debit_paise: Math.round(line.debitPaise || 0),
    credit_paise: Math.round(line.creditPaise || 0),
    narration: line.narration ?? "",
    subledger_kind: line.subledgerKind ?? "",
    subledger_id: line.subledgerId ?? "",
    cost_centre_code: line.costCentreCode ?? "",
    ...(line.party
      ? {
          party: {
            kind: line.party.kind,
            external_id: line.party.externalId,
            name: line.party.name ?? "",
          },
        }
      : {}),
    ...(line.instrument
      ? {
          instrument: {
            mode: line.instrument.mode ?? "",
            ref: line.instrument.ref ?? "",
            date: line.instrument.date ?? null,
          },
        }
      : {}),
  };
}

type RpcResult = {
  ok?: boolean;
  error?: string;
  created?: boolean;
  voucher_id?: string;
  voucher_no?: string;
  amount_paise?: number;
};

function toPostResult(data: unknown, rpcError?: string | null): LedgerPostResult {
  if (rpcError) return { ok: false, error: rpcError };
  const r = (data ?? {}) as RpcResult;
  if (!r.ok) return { ok: false, error: r.error || "ledger refused the posting" };
  return {
    ok: true,
    created: r.created !== false,
    voucherId: String(r.voucher_id ?? ""),
    voucherNo: String(r.voucher_no ?? ""),
    amountPaise: Number(r.amount_paise ?? 0),
  };
}

/* ─── Writes ────────────────────────────────────────────────── */

export async function ledgerPost(
  voucher: LedgerVoucherInput,
): Promise<LedgerPostResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };

  const bad = voucher.lines.find((l) => !isPostableLedgerCode(l.accountCode));
  if (bad) {
    return {
      ok: false,
      error: `${bad.accountCode} is a group heading, not a postable account`,
    };
  }

  const { data, error } = await ctx.sb.rpc("ledger_post", {
    p_tenant_id: ctx.tenantId,
    p_voucher: {
      voucher_type: voucher.voucherType,
      date: voucher.date,
      narration: voucher.narration ?? "",
      source_type: voucher.sourceType ?? "",
      source_id: voucher.sourceId ?? "",
      created_by: voucher.createdBy ?? "",
      lines: voucher.lines.map(lineToRpc),
    },
  });
  return toPostResult(data, error?.message);
}

export async function ledgerReverse(input: {
  voucherId: string;
  reason?: string;
  date?: string;
  createdBy?: string;
}): Promise<LedgerPostResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };

  const { data, error } = await ctx.sb.rpc("ledger_reverse", {
    p_tenant_id: ctx.tenantId,
    p_voucher_id: input.voucherId,
    p_reason: input.reason ?? "",
    p_date: input.date ?? null,
    p_created_by: input.createdBy ?? "",
  });
  return toPostResult(data, error?.message);
}

export async function ledgerLockPeriod(input: {
  period: string;
  status: LedgerPeriodStatus;
  actor?: string;
  note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };

  const { data, error } = await ctx.sb.rpc("ledger_lock_period", {
    p_tenant_id: ctx.tenantId,
    p_period: input.period,
    p_status: input.status,
    p_actor: input.actor ?? "",
    p_note: input.note ?? "",
  });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as RpcResult;
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function ledgerOpenBalances(input: {
  fyCode: string;
  rows: { accountCode: string; debitPaise: number; creditPaise: number }[];
  createdBy?: string;
}): Promise<LedgerPostResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };

  const { data, error } = await ctx.sb.rpc("ledger_open_balances", {
    p_tenant_id: ctx.tenantId,
    p_fy_code: input.fyCode,
    p_rows: input.rows.map((r) => ({
      account_code: r.accountCode,
      debit_paise: Math.round(r.debitPaise || 0),
      credit_paise: Math.round(r.creditPaise || 0),
    })),
    p_created_by: input.createdBy ?? "",
  });
  return toPostResult(data, error?.message);
}

export async function ledgerCloseFiscalYear(input: {
  fyCode: string;
  surplusAccountCode?: string;
  actor?: string;
}): Promise<{ ok: boolean; error?: string; surplusPaise?: number }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };

  const { data, error } = await ctx.sb.rpc("ledger_close_fiscal_year", {
    p_tenant_id: ctx.tenantId,
    p_fy_code: input.fyCode,
    p_surplus_account_code: input.surplusAccountCode ?? "3000",
    p_actor: input.actor ?? "",
  });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as RpcResult & { surplus_paise?: number };
  return r.ok
    ? { ok: true, surplusPaise: Number(r.surplus_paise ?? 0) }
    : { ok: false, error: r.error };
}

/* ─── Masters ───────────────────────────────────────────────── */

/**
 * Install the chart of accounts, cost centres and one fiscal year.
 *
 * Idempotent by code, and it never overwrites a name the school has edited —
 * only missing rows are inserted. The desk's own COA codes keep their meaning,
 * so a journal mirrored from the desk maps straight across.
 */
export async function ensureLedgerMasters(input?: {
  fyCode?: string;
  fyStartDate?: string;
  fyEndDate?: string;
}): Promise<{ ok: boolean; error?: string; accountsAdded: number }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured", accountsAdded: 0 };
  const { sb, tenantId } = ctx;

  const { data: existing, error: readErr } = await sb
    .from("ledger_accounts")
    .select("code")
    .eq("tenant_id", tenantId);
  if (readErr) return { ok: false, error: readErr.message, accountsAdded: 0 };

  const have = new Set((existing ?? []).map((r) => String((r as { code: string }).code)));
  const missing = defaultLedgerAccounts().filter((a) => !have.has(a.code));

  if (missing.length > 0) {
    const { error } = await sb.from("ledger_accounts").insert(
      missing.map((a) => ({
        tenant_id: tenantId,
        code: a.code,
        name: a.name,
        parent_code: a.parentCode ?? "",
        kind: a.kind,
        schedule_group: a.scheduleGroup,
        is_cash: !!a.isCash,
        is_bank: !!a.isBank,
        is_control: !!a.isControl,
      })),
    );
    if (error) return { ok: false, error: error.message, accountsAdded: 0 };
  }

  await sb.from("ledger_cost_centres").upsert(
    defaultCostCentres().map((c) => ({
      tenant_id: tenantId,
      code: c.code,
      name: c.name,
    })),
    { onConflict: "tenant_id,code" },
  );

  const fyCode = input?.fyCode ?? currentFyCode();
  const startYear = Number(fyCode.replace(/^FY/, "").slice(0, 4));
  await sb.from("ledger_fiscal_years").upsert(
    {
      tenant_id: tenantId,
      code: fyCode,
      label: fyCode.replace(/^FY/, "FY "),
      start_date: input?.fyStartDate ?? `${startYear}-04-01`,
      end_date: input?.fyEndDate ?? `${startYear + 1}-03-31`,
    },
    { onConflict: "tenant_id,code", ignoreDuplicates: true },
  );

  return { ok: true, accountsAdded: missing.length };
}

/** Indian fiscal year (April–March) for a date. */
export function currentFyCode(date = new Date()): string {
  const y = date.getFullYear();
  const startYear = date.getMonth() + 1 >= 4 ? y : y - 1;
  return `FY${startYear}-${String(startYear + 1).slice(-2)}`;
}

/**
 * Make sure a fiscal year exists for an arbitrary date.
 *
 * ledger_post refuses a voucher whose date falls outside every defined year —
 * deliberately, so nothing is filed under a blank year. Backfill reads dates
 * going back as far as the desk has records, so it has to be able to open the
 * years those records belong to. The year is created open; nothing is posted
 * into it by this call.
 */
export async function ensureFiscalYearForDate(
  isoDate: string,
): Promise<{ ok: boolean; fyCode?: string; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };

  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { ok: false, error: `bad date ${isoDate}` };
  const y = d.getUTCFullYear();
  const startYear = d.getUTCMonth() + 1 >= 4 ? y : y - 1;
  const fyCode = `FY${startYear}-${String(startYear + 1).slice(-2)}`;

  const { error } = await ctx.sb.from("ledger_fiscal_years").upsert(
    {
      tenant_id: ctx.tenantId,
      code: fyCode,
      label: `FY ${startYear}-${String(startYear + 1).slice(-2)}`,
      start_date: `${startYear}-04-01`,
      end_date: `${startYear + 1}-03-31`,
    },
    { onConflict: "tenant_id,code", ignoreDuplicates: true },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, fyCode };
}

/* ─── Reads ─────────────────────────────────────────────────── */

export async function ledgerTrialBalance(): Promise<{
  ok: boolean;
  rows: LedgerTrialBalanceRow[];
  error?: string;
}> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, rows: [], error: "Supabase tenant not configured" };

  const { data, error } = await ctx.sb
    .from("ledger_v_trial_balance")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .order("code");
  if (error) return { ok: false, rows: [], error: error.message };

  const rows = (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      accountId: String(row.account_id ?? ""),
      code: String(row.code ?? ""),
      name: String(row.name ?? ""),
      kind: String(row.kind ?? "asset") as LedgerTrialBalanceRow["kind"],
      scheduleGroup: String(row.schedule_group ?? ""),
      debitPaise: Number(row.debit_paise ?? 0),
      creditPaise: Number(row.credit_paise ?? 0),
      closingDebitPaise: Number(row.closing_debit_paise ?? 0),
      closingCreditPaise: Number(row.closing_credit_paise ?? 0),
      balancePaise: Number(row.balance_paise ?? 0),
    };
  });
  return { ok: true, rows };
}

export async function ledgerSubledgerBalances(): Promise<
  { kind: string; subledgerId: string; balancePaise: number }[]
> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data } = await ctx.sb
    .from("ledger_v_subledger_balance")
    .select("*")
    .eq("tenant_id", ctx.tenantId);
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      kind: String(row.subledger_kind ?? ""),
      subledgerId: String(row.subledger_id ?? ""),
      balancePaise: Number(row.balance_paise ?? 0),
    };
  });
}

export async function ledgerRecentVouchers(limit = 50): Promise<
  {
    id: string;
    voucherNo: string;
    voucherType: string;
    date: string;
    narration: string;
    createdBy: string;
    sourceType: string;
    sourceId: string;
    reversesVoucherId: string | null;
  }[]
> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data } = await ctx.sb
    .from("ledger_vouchers")
    .select(
      "id, voucher_no, voucher_type, voucher_date, narration, created_by, source_type, source_id, reverses_voucher_id",
    )
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id ?? ""),
      voucherNo: String(row.voucher_no ?? ""),
      voucherType: String(row.voucher_type ?? ""),
      date: String(row.voucher_date ?? ""),
      narration: String(row.narration ?? ""),
      createdBy: String(row.created_by ?? ""),
      sourceType: String(row.source_type ?? ""),
      sourceId: String(row.source_id ?? ""),
      reversesVoucherId: row.reverses_voucher_id
        ? String(row.reverses_voucher_id)
        : null,
    };
  });
}

/**
 * Does the ledger agree with the desk?
 *
 * The exit criterion for the cutover, and the thing to watch during the
 * parallel run: for each well-known code, the desk's own trial balance figure
 * against the ledger's. Any row that differs is a posting path that has not
 * been mirrored, or one that was mirrored twice.
 */
export async function ledgerParityAgainstDesk(
  deskRows: { code: string; balancePaise: number }[],
): Promise<{
  ok: boolean;
  matched: number;
  mismatches: { code: string; deskPaise: number; ledgerPaise: number; diffPaise: number }[];
  error?: string;
}> {
  const tb = await ledgerTrialBalance();
  if (!tb.ok) return { ok: false, matched: 0, mismatches: [], error: tb.error };

  const ledgerByCode = new Map(tb.rows.map((r) => [r.code, r.balancePaise]));
  const codes = new Set([
    ...deskRows.map((r) => r.code),
    ...tb.rows.filter((r) => r.balancePaise !== 0).map((r) => r.code),
  ]);

  const mismatches: {
    code: string;
    deskPaise: number;
    ledgerPaise: number;
    diffPaise: number;
  }[] = [];
  let matched = 0;

  for (const code of codes) {
    const deskPaise = deskRows.find((r) => r.code === code)?.balancePaise ?? 0;
    const ledgerPaise = ledgerByCode.get(code) ?? 0;
    if (deskPaise === ledgerPaise) matched += 1;
    else mismatches.push({ code, deskPaise, ledgerPaise, diffPaise: ledgerPaise - deskPaise });
  }

  return { ok: mismatches.length === 0, matched, mismatches };
}
