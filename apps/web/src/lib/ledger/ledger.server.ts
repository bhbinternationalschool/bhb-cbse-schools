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
  SCHEDULE_GROUPS,
  defaultCostCentres,
  defaultLedgerAccounts,
  isPostableLedgerCode,
} from "@/lib/ledger/coa";
import type {
  LedgerAccountKind,
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
  if (!r.ok) {
    const error = r.error || "ledger refused the posting";
    // The chart lives in code but the accounts live in the database, so an
    // account added to defaultLedgerAccounts() does not exist for posting
    // until ensureLedgerMasters has run. The bare message names the missing
    // code and leaves the reader to work out why a code they can see in the
    // source is missing — which cost a colleague a debugging cycle on
    // 2026-08-24. Say the next step instead.
    if (/no ledger account with code/i.test(error)) {
      return {
        ok: false,
        error: `${error} — if it was recently added to the chart, run the ensure-masters action to install it`,
      };
    }
    return { ok: false, error };
  }
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
 * Idempotent by code. Missing accounts are inserted; existing ones have their
 * *structural* fields reconciled while their `name` is left alone.
 *
 * That split matters. A name is the school's to edit — "Mess Expenses" may
 * well become "Kitchen & Mess" and nothing should undo that. But `kind`,
 * `is_cash`, `is_bank`, `is_control`, `parent_code` and `schedule_group` are
 * the system's classification of what the account *is*, and a wrong one fails
 * silently in the worst possible way: a Receipts & Payments account is built
 * by finding the accounts flagged as cash or bank, so a chart whose Cash in
 * Hand lost that flag produces a statutory statement that is empty and looks
 * merely quiet. Found exactly that way on 2026-08-24, on a chart seeded before
 * the flags existed.
 */
/**
 * Install every desk chart account that the server book does not have yet.
 *
 * The desk chart is the school's to edit — a head or sub-head added in
 * Accounts must be postable immediately, without anyone editing a seed in
 * this repo. Until this existed the two charts were kept in step BY HAND, so
 * the desk shipped "5010 Milk Expenses" that the book had never heard of and
 * every milk expense was refused with `no ledger account with code 5010` and
 * queued as unposted.
 *
 * Only ADDS. A code the book already has is left alone: names and
 * classification there may have been deliberately reorganised, and this must
 * not undo that.
 *
 * Parent is derived from the code itself, so "5000.01" hangs under "5000"
 * and a flat "5070" hangs under its kind's top-level group.
 */
export async function syncDeskChartToLedger(): Promise<{
  ok: boolean;
  error?: string;
  accountsAdded: number;
  added: string[];
}> {
  const ctx = await getServerTenantContext();
  if (!ctx)
    return {
      ok: false,
      error: "Supabase tenant not configured",
      accountsAdded: 0,
      added: [],
    };
  const { sb, tenantId } = ctx;

  const [deskRes, bookRes] = await Promise.all([
    sb
      .from("accounts_desk_coa_accounts")
      .select("code,name,coa_group,is_active")
      .eq("tenant_id", tenantId),
    sb.from("ledger_accounts").select("code").eq("tenant_id", tenantId),
  ]);
  if (deskRes.error)
    return { ok: false, error: deskRes.error.message, accountsAdded: 0, added: [] };
  if (bookRes.error)
    return { ok: false, error: bookRes.error.message, accountsAdded: 0, added: [] };

  const have = new Set(
    (bookRes.data ?? []).map((r) => String((r as { code: string }).code)),
  );

  const KIND: Record<string, LedgerAccountKind> = {
    assets: "asset",
    liabilities: "liability",
    equity: "equity",
    income: "income",
    expense: "expense",
  };
  // The top-level group each kind rolls up into, matching defaultLedgerAccounts().
  const ROOT: Record<LedgerAccountKind, string> = {
    asset: "1",
    liability: "2",
    equity: "3",
    income: "4",
    expense: "5",
  };
  const SCHEDULE: Record<LedgerAccountKind, string> = {
    asset: SCHEDULE_GROUPS.currentAssets,
    liability: SCHEDULE_GROUPS.currentLiabilities,
    equity: SCHEDULE_GROUPS.corpus,
    income: SCHEDULE_GROUPS.otherIncome,
    expense: SCHEDULE_GROUPS.administrative,
  };

  const rows: {
    tenant_id: string;
    code: string;
    name: string;
    parent_code: string;
    kind: LedgerAccountKind;
    schedule_group: string;
  }[] = [];

  for (const raw of deskRes.data ?? []) {
    const r = raw as {
      code: string;
      name: string;
      coa_group: string;
      is_active: boolean;
    };
    const code = String(r.code ?? "").trim();
    if (!code || have.has(code)) continue;
    // A head the school has retired must not be resurrected in the book.
    if (r.is_active === false) continue;
    // A group heading is never postable, so installing one would only create
    // an account nothing may use.
    if (!isPostableLedgerCode(code)) continue;
    const kind = KIND[String(r.coa_group ?? "").trim()];
    if (!kind) continue;

    // "5000.01" belongs under "5000" when that exists; otherwise fall back to
    // the kind's root so the roll-up still has a parent.
    const dot = code.lastIndexOf(".");
    const prefix = dot > 0 ? code.slice(0, dot) : "";
    const parent = prefix && have.has(prefix) ? prefix : ROOT[kind];

    rows.push({
      tenant_id: tenantId,
      code,
      name: String(r.name ?? "").trim() || code,
      parent_code: parent,
      kind,
      schedule_group: SCHEDULE[kind],
    });
    have.add(code);
  }

  if (rows.length === 0) return { ok: true, accountsAdded: 0, added: [] };

  const { error } = await sb.from("ledger_accounts").insert(rows);
  if (error)
    return { ok: false, error: error.message, accountsAdded: 0, added: [] };

  return {
    ok: true,
    accountsAdded: rows.length,
    added: rows.map((r) => `${r.code} ${r.name}`),
  };
}

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
  const defaults = defaultLedgerAccounts();
  const missing = defaults.filter((a) => !have.has(a.code));

  // Reconcile classification on accounts that already exist. Names are not
  // touched — see the note above on which fields belong to whom.
  const stale = defaults.filter((a) => have.has(a.code));
  for (const a of stale) {
    const { error } = await sb
      .from("ledger_accounts")
      .update({
        kind: a.kind,
        parent_code: a.parentCode ?? "",
        schedule_group: a.scheduleGroup,
        is_cash: !!a.isCash,
        is_bank: !!a.isBank,
        is_control: !!a.isControl,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("code", a.code);
    if (error) return { ok: false, error: error.message, accountsAdded: 0 };
  }

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

  // The school's own heads and sub-heads, not just the shipped defaults —
  // otherwise ensure-masters "fixes" the chart and still leaves a desk
  // account unpostable.
  const deskSync = await syncDeskChartToLedger();
  if (!deskSync.ok)
    return { ok: false, error: deskSync.error, accountsAdded: missing.length };

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

  // Count both, so the caller is told the whole truth about what installed.
  return { ok: true, accountsAdded: missing.length + deskSync.accountsAdded };
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

/**
 * Every postable account, for entry forms. Group headings are excluded, and a
 * category that has sub-heads is marked so the forms offer only its sub-heads.
 * The book itself still accepts a heading (deliberately: reversing an old
 * voucher must be able to touch the account it was posted to) — the guard
 * lives in what the forms offer, not in what the book refuses.
 */
export async function ledgerListAccounts(): Promise<
  {
    code: string;
    name: string;
    kind: string;
    parentCode: string;
    hasChildren: boolean;
    isCash: boolean;
    isBank: boolean;
    /**
     * The desk bank this account IS, when it is a per-bank account.
     *
     * Entry forms asked "which bank?" after the operator had already chosen
     * "1012 · UBI -Main · Union Bank of India" — the same question twice.
     * Carried here so the form can answer it itself.
     */
    bankAccountId: string;
  }[]
> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data } = await ctx.sb
    .from("ledger_accounts")
    .select("code, name, kind, parent_code, is_cash, is_bank, is_active, bank_account_id")
    .eq("tenant_id", ctx.tenantId)
    .order("code", { ascending: true });
  const rows = ((data ?? []) as Record<string, unknown>[]).filter(
    (r) => r.is_active !== false,
  );
  const parents = new Set(rows.map((r) => String(r.parent_code ?? "")));
  return rows
    .filter((r) => isPostableLedgerCode(String(r.code)))
    .map((r) => ({
      code: String(r.code),
      name: String(r.name),
      kind: String(r.kind),
      parentCode: String(r.parent_code ?? ""),
      hasChildren: parents.has(String(r.code)),
      isCash: r.is_cash === true,
      isBank: r.is_bank === true,
      bankAccountId: String(r.bank_account_id ?? ""),
    }));
}

/* ─── Expense heads: category → sub-heads ──────────────────── */

/**
 * Codes the system posts to automatically — the store's COGS, write-offs,
 * concession projection. Giving one of these sub-heads would turn it into a
 * heading the entry forms hide, while the automation kept posting to it: two
 * views of one account. So they stay leaves.
 */
const RESERVED_EXPENSE_CODES = new Set(["5060", "5065", "5066", "5100"]);

/**
 * Create or rename an expense head.
 *
 * Two levels only, mirroring how the office thinks: a CATEGORY (Utilities)
 * holds SUB-HEADS (Electricity, Diesel, Water). Categories get the next free
 * 53xx-58xx code; sub-heads get `<category>.NN`, which sorts under their
 * category in every report without a mapping table. A category that gains its
 * first sub-head stops being offered on entry forms — its history stays put.
 */
export async function ledgerSaveExpenseHead(input: {
  /** Present = rename that account; absent = create. */
  code?: string;
  name: string;
  /** For a new sub-head: the category's code. Absent = new category. */
  parentCode?: string;
}): Promise<{ ok: boolean; error?: string; code?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const name = String(input.name ?? "").trim();
  if (!name) return { ok: false, error: "The head needs a name" };

  if (input.code) {
    const code = String(input.code).trim();
    if (RESERVED_EXPENSE_CODES.has(code)) {
      return { ok: false, error: "That head is posted by the system and cannot be renamed" };
    }
    const { data: acc } = await sb
      .from("ledger_accounts")
      .select("id, kind")
      .eq("tenant_id", tenantId)
      .eq("code", code)
      .maybeSingle();
    if (!acc || String(acc.kind) !== "expense") {
      return { ok: false, error: "No expense head with that code" };
    }
    const { error } = await sb
      .from("ledger_accounts")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("code", code);
    if (error) return { ok: false, error: error.message };
    return { ok: true, code };
  }

  const { data: all } = await sb
    .from("ledger_accounts")
    .select("code, name, kind, parent_code, schedule_group")
    .eq("tenant_id", tenantId);
  const rows = (all ?? []) as Record<string, unknown>[];
  const codes = new Set(rows.map((r) => String(r.code)));

  if (input.parentCode) {
    const parentCode = String(input.parentCode).trim();
    const parent = rows.find((r) => String(r.code) === parentCode);
    if (!parent || String(parent.kind) !== "expense") {
      return { ok: false, error: "Pick an expense category to put this under" };
    }
    if (String(parent.parent_code) !== "5") {
      return { ok: false, error: "Sub-heads sit one level under a category — pick the category itself" };
    }
    if (RESERVED_EXPENSE_CODES.has(parentCode)) {
      return { ok: false, error: "That category is posted by the system and cannot take sub-heads" };
    }
    let n = 1;
    while (codes.has(`${parentCode}.${String(n).padStart(2, "0")}`)) n += 1;
    if (n > 99) return { ok: false, error: "That category already has 99 sub-heads" };
    const code = `${parentCode}.${String(n).padStart(2, "0")}`;
    const { error } = await sb.from("ledger_accounts").insert({
      tenant_id: tenantId,
      code,
      name,
      parent_code: parentCode,
      kind: "expense",
      schedule_group: String(parent.schedule_group ?? ""),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, code };
  }

  // New category: the next free 10-step code between 5300 and 5890 — clear of
  // the seeded 50xx-52xx defaults and of 5900 Other Expenses.
  let candidate = 0;
  for (let c = 5300; c <= 5890; c += 10) {
    if (!codes.has(String(c))) {
      candidate = c;
      break;
    }
  }
  if (!candidate) return { ok: false, error: "No free category codes left" };
  const { error } = await sb.from("ledger_accounts").insert({
    tenant_id: tenantId,
    code: String(candidate),
    name,
    parent_code: "5",
    kind: "expense",
    schedule_group: "Administrative expenses",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, code: String(candidate) };
}

/* ─── Cost centres: the "spent on" tag (Bus-1, Hostel…) ───── */

export async function ledgerListCostCentres(): Promise<
  { code: string; name: string }[]
> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data } = await ctx.sb
    .from("ledger_cost_centres")
    .select("code, name")
    .eq("tenant_id", ctx.tenantId)
    .order("name");
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    code: String(r.code),
    name: String(r.name),
  }));
}

/**
 * Create or rename a cost centre. The code is a slug of the first name it was
 * given ("Bus-1" → "bus-1") and never changes — ledger lines point at it.
 * IMPORTANT: ledger_post silently drops an unknown cost-centre code, so the
 * centre must exist BEFORE anything posts against it — which is exactly why
 * this management screen exists.
 */
export async function ledgerSaveCostCentre(input: {
  code?: string;
  name: string;
}): Promise<{ ok: boolean; error?: string; code?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const name = String(input.name ?? "").trim();
  if (!name) return { ok: false, error: "The tag needs a name" };

  if (input.code) {
    const { error } = await sb
      .from("ledger_cost_centres")
      .update({ name })
      .eq("tenant_id", tenantId)
      .eq("code", String(input.code).trim());
    if (error) return { ok: false, error: error.message };
    return { ok: true, code: String(input.code).trim() };
  }

  const code = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!code) return { ok: false, error: "The name needs at least one letter or digit" };
  const { data: exists } = await sb
    .from("ledger_cost_centres")
    .select("code")
    .eq("tenant_id", tenantId)
    .eq("code", code)
    .maybeSingle();
  if (exists) return { ok: false, error: `A tag with code ${code} already exists` };
  const { error } = await sb
    .from("ledger_cost_centres")
    .insert({ tenant_id: tenantId, code, name });
  if (error) return { ok: false, error: error.message };
  return { ok: true, code };
}

export async function ledgerRemoveCostCentre(
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const clean = String(code ?? "").trim();
  const { data: cc } = await sb
    .from("ledger_cost_centres")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("code", clean)
    .maybeSingle();
  if (!cc) return { ok: false, error: "No tag with that code" };
  const { count } = await sb
    .from("ledger_lines")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("cost_centre_id", String(cc.id));
  if ((count ?? 0) > 0) {
    return { ok: false, error: "Entries carry this tag — it stays. Rename it instead." };
  }
  const { error } = await sb
    .from("ledger_cost_centres")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("code", clean);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Where the money went, per tag: expense debits net of credits (so a
 * reversal cancels its original), grouped tag × head, for a date range.
 */
export async function ledgerSpendByCentre(input: {
  fromDate: string;
  toDate: string;
}): Promise<
  {
    centreCode: string;
    centreName: string;
    accountCode: string;
    accountName: string;
    amountPaise: number;
  }[]
> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { sb, tenantId } = ctx;
  const { data } = await sb
    .from("ledger_lines")
    .select(
      "debit_paise, credit_paise," +
        " centre:ledger_cost_centres!inner(code, name)," +
        " account:ledger_accounts!inner(code, name, kind)," +
        " voucher:ledger_vouchers!inner(voucher_date)",
    )
    .eq("tenant_id", tenantId)
    .eq("account.kind", "expense")
    .gte("voucher.voucher_date", input.fromDate)
    .lte("voucher.voucher_date", input.toDate)
    .limit(20000);
  const agg = new Map<
    string,
    {
      centreCode: string;
      centreName: string;
      accountCode: string;
      accountName: string;
      amountPaise: number;
    }
  >();
  for (const raw of (data ?? []) as unknown as Record<string, unknown>[]) {
    const centre = raw.centre as { code?: unknown; name?: unknown } | null;
    const account = raw.account as { code?: unknown; name?: unknown } | null;
    if (!centre || !account) continue;
    const key = `${centre.code}|${account.code}`;
    const cur = agg.get(key) ?? {
      centreCode: String(centre.code),
      centreName: String(centre.name),
      accountCode: String(account.code),
      accountName: String(account.name),
      amountPaise: 0,
    };
    cur.amountPaise += Number(raw.debit_paise ?? 0) - Number(raw.credit_paise ?? 0);
    agg.set(key, cur);
  }
  return [...agg.values()]
    .filter((r) => r.amountPaise !== 0)
    .sort((a, b) =>
      a.centreName === b.centreName
        ? a.accountCode.localeCompare(b.accountCode)
        : a.centreName.localeCompare(b.centreName),
    );
}

/**
 * Remove an expense head — only one nothing ever touched. A head with
 * postings is history and history does not get deleted; a category with
 * sub-heads goes only after its sub-heads do.
 */
export async function ledgerRemoveExpenseHead(
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const clean = String(code ?? "").trim();
  if (RESERVED_EXPENSE_CODES.has(clean)) {
    return { ok: false, error: "That head is posted by the system" };
  }
  const { data: acc } = await sb
    .from("ledger_accounts")
    .select("id, kind")
    .eq("tenant_id", tenantId)
    .eq("code", clean)
    .maybeSingle();
  if (!acc || String(acc.kind) !== "expense") {
    return { ok: false, error: "No expense head with that code" };
  }
  const { count: kids } = await sb
    .from("ledger_accounts")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("parent_code", clean);
  if ((kids ?? 0) > 0) {
    return { ok: false, error: "Remove its sub-heads first" };
  }
  const { count: lines } = await sb
    .from("ledger_lines")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("account_id", String(acc.id));
  if ((lines ?? 0) > 0) {
    return { ok: false, error: "This head has entries in the book — it stays. Rename it instead." };
  }
  const { error } = await sb
    .from("ledger_accounts")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("code", clean);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Resolve a voucher number to its id — what a reversal needs when the caller
 * only has the number a statement line shows.
 */
export async function ledgerFindVoucher(
  voucherNo: string,
): Promise<{ id: string; voucherNo: string; voucherType: string; date: string } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data } = await ctx.sb
    .from("ledger_vouchers")
    .select("id, voucher_no, voucher_type, voucher_date")
    .eq("tenant_id", ctx.tenantId)
    .eq("voucher_no", voucherNo.trim())
    .maybeSingle();
  if (!data) return null;
  return {
    id: String(data.id),
    voucherNo: String(data.voucher_no),
    voucherType: String(data.voucher_type),
    date: String(data.voucher_date),
  };
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
