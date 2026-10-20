/**
 * Ledger v2 — turning gateway settlements into book entries.
 *
 * The pipeline, once:
 *
 *   gateway  →  ledger_pg_settlements        (a mirror of what it says it paid)
 *            →  ledger_pg_settlement_events  (what made that payment up)
 *            →  ledger_post                  (the book, append-only)
 *            →  bank statement matching      (already built, by UTR)
 *
 * Two independent feeds fill the first step: the SETTLEMENT_* webhook, which
 * is fast, and a nightly pull over a date window, which is complete. Neither
 * is trusted alone. A webhook can be missed, replayed, or delivered twice; a
 * nightly pull can run late. Both land through the same upsert keyed on the
 * gateway's settlement id, and the book is written by ledger_post, which is
 * idempotent on (source_type, source_id). So the same settlement can arrive
 * any number of times by any route and be posted exactly once.
 */

import {
  fetchCashfreeSettlementRecon,
  fetchCashfreeSettlements,
  settlementFromWebhook,
  type PgSettlement,
} from "@/lib/cashfreeSettlements.server";
import { L_BANK, L_PG_CLEARING } from "@/lib/ledger/coa";
import { ledgerPost, ledgerReverse } from "@/lib/ledger/ledger.server";
import { buildPgSettlementVoucher } from "@/lib/ledger/projectionMap";
import {
  PAID_SETTLEMENT_STATUSES,
  deriveSettlementStatus,
  failedReconState,
  findRetry,
  mergeStoredStatus,
  settlementPaymentWindow,
  type RetriedAs,
} from "@/lib/ledger/pgSettlementStatus";
import { getServerTenantContext } from "@/lib/serverTenant";

const PROVIDER = "cashfree";

/** Statuses that mean the money is genuinely in the school's bank. */
const PAID_STATUSES = PAID_SETTLEMENT_STATUSES;

export type SettlementSyncOutcome = {
  seen: number;
  stored: number;
  posted: number;
  reversed: number;
  eventsStored: number;
  skipped: { id: string; reason: string }[];
  errors: string[];
};

function emptyOutcome(): SettlementSyncOutcome {
  return { seen: 0, stored: 0, posted: 0, reversed: 0, eventsStored: 0, skipped: [], errors: [] };
}

/* ─── Which bank received it ────────────────────────────────── */

/**
 * Map the gateway's settlement account to one of the school's own.
 *
 * Matching on the last four digits is what the gateway gives us, and on a
 * school with two accounts it is unambiguous. Where it is not — no match, or
 * more than one — we fall back to the account the school has NAMED as its
 * settlement bank (Accounts → settings), and only if that is unset do we land
 * on the 1010 group.
 *
 * The order matters. What the gateway tells us beats what we were told, since
 * a payload that names an account is evidence and a setting is only a
 * standing instruction. But a standing instruction still beats the group: the
 * school knows Cashfree settles to one account, so filing a settlement there
 * is a recorded fact, not a guess. What we must never do is claim a precision
 * we do not have — hence the group when nothing is known.
 */
async function resolveBank(
  last4: string,
): Promise<{ code: string; bankAccountId: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { code: L_BANK, bankAccountId: "" };

  const fallback = await configuredSettlementBank(ctx);
  if (!last4) return fallback;

  const { data: banks } = await ctx.sb
    .from("accounts_desk_bank_accounts")
    .select("id, account_no")
    .eq("tenant_id", ctx.tenantId)
    .eq("is_active", true);

  const hits = (banks ?? []).filter(
    (b) => String(b.account_no ?? "").replace(/\D/g, "").slice(-4) === last4,
  );
  if (hits.length !== 1) return fallback;

  const bankAccountId = String(hits[0].id);
  const { data: acct } = await ctx.sb
    .from("ledger_accounts")
    .select("code")
    .eq("tenant_id", ctx.tenantId)
    .eq("bank_account_id", bankAccountId)
    .eq("is_active", true)
    .maybeSingle();

  return acct?.code
    ? { code: String(acct.code), bankAccountId }
    : { code: L_BANK, bankAccountId };
}

/**
 * The account the school says the gateway settles into, resolved to its
 * ledger code. Empty setting means we genuinely do not know, and the caller
 * falls back to the 1010 group.
 */
async function configuredSettlementBank(
  ctx: NonNullable<Awaited<ReturnType<typeof getServerTenantContext>>>,
): Promise<{ code: string; bankAccountId: string }> {
  const none = { code: L_BANK, bankAccountId: "" };
  const { data: settings } = await ctx.sb
    .from("accounts_desk_settings")
    .select("pg_settlement_bank_account_id")
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();

  const bankAccountId = String(settings?.pg_settlement_bank_account_id ?? "");
  if (!bankAccountId) return none;

  const { data: acct } = await ctx.sb
    .from("ledger_accounts")
    .select("code")
    .eq("tenant_id", ctx.tenantId)
    .eq("bank_account_id", bankAccountId)
    .eq("is_active", true)
    .maybeSingle();

  return acct?.code
    ? { code: String(acct.code), bankAccountId }
    : { code: L_BANK, bankAccountId };
}

/* ─── Store ─────────────────────────────────────────────────── */

async function storeSettlement(
  s: PgSettlement,
  bankAccountId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };

  // A FAILED we were told about is not undone by a later row that merely lacks
  // the failure signals (see mergeStoredStatus). Read it first; a read error
  // refuses the write rather than risk turning FAILED back into "in flight".
  const { data: prior, error: priorErr } = await ctx.sb
    .from("ledger_pg_settlements")
    .select("status")
    .eq("tenant_id", ctx.tenantId)
    .eq("provider", PROVIDER)
    .eq("cf_settlement_id", s.cfSettlementId)
    .maybeSingle();
  if (priorErr) return { ok: false, error: priorErr.message };
  const status = mergeStoredStatus(String(prior?.status ?? ""), s.status);

  const { error } = await ctx.sb.from("ledger_pg_settlements").upsert(
    {
      tenant_id: ctx.tenantId,
      provider: PROVIDER,
      cf_settlement_id: s.cfSettlementId,
      utr: s.utr,
      settlement_type: s.settlementType,
      status,
      payment_amount_paise: s.paymentAmountPaise,
      amount_settled_paise: s.amountSettledPaise,
      service_charge_paise: s.serviceChargePaise,
      service_tax_paise: s.serviceTaxPaise,
      settlement_charge_paise: s.settlementChargePaise,
      settlement_tax_paise: s.settlementTaxPaise,
      adjustment_paise: s.adjustmentPaise,
      settled_on: s.settledOn,
      initiated_at: s.initiatedAt,
      settled_at: s.settledAt,
      bank_account_id: bankAccountId,
      raw: s.raw,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,provider,cf_settlement_id" },
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Pull the event breakdown for the given settlements and store it.
 *
 * The signed total is written back onto the settlement so the recon view can
 * compare three numbers that were derived independently — what the gateway
 * says it paid, what its own breakdown adds up to, and what the book holds.
 * Agreement across all three is the only thing that makes a settlement
 * explained; two out of three is a break with a plausible cover story.
 */
export async function pullSettlementEvents(
  cfSettlementIds: string[],
): Promise<{ ok: true; stored: number } | { ok: false; error: string }> {
  if (cfSettlementIds.length === 0) return { ok: true, stored: 0 };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };

  const res = await fetchCashfreeSettlementRecon(cfSettlementIds);
  if (!res.ok) return res;

  if (res.events.length > 0) {
    const { error } = await ctx.sb.from("ledger_pg_settlement_events").upsert(
      res.events.map((e) => ({
        tenant_id: ctx.tenantId,
        provider: PROVIDER,
        cf_settlement_id: e.cfSettlementId,
        event_id: e.eventId,
        event_type: e.eventType,
        sale_type: e.saleType,
        event_status: e.eventStatus,
        event_amount_paise: e.eventAmountPaise,
        event_settlement_paise: e.eventSettlementPaise,
        signed_paise: e.signedPaise,
        signed_settlement_paise: e.signedSettlementPaise,
        order_id: e.orderId,
        cf_payment_id: e.cfPaymentId,
        refund_id: e.refundId,
        utr: e.utr,
        event_time: e.eventTime,
        raw: e.raw,
      })),
      { onConflict: "tenant_id,provider,event_id" },
    );
    if (error) return { ok: false, error: error.message };
  }

  // Summarise per settlement from what is now stored, not from this batch:
  // an earlier partial pull would otherwise leave a total that looks whole.
  const pulledAt = new Date().toISOString();
  for (const id of cfSettlementIds) {
    const { data: rows } = await ctx.sb
      .from("ledger_pg_settlement_events")
      .select("signed_settlement_paise")
      .eq("tenant_id", ctx.tenantId)
      .eq("provider", PROVIDER)
      .eq("cf_settlement_id", id);

    const list = rows ?? [];
    await ctx.sb
      .from("ledger_pg_settlements")
      .update({
        events_pulled_at: pulledAt,
        event_count: list.length,
        // The net contributions, which are what add up to amount_settled.
        events_total_paise: list.reduce(
          (n, r) => n + Number(r.signed_settlement_paise ?? 0),
          0,
        ),
        updated_at: pulledAt,
      })
      .eq("tenant_id", ctx.tenantId)
      .eq("provider", PROVIDER)
      .eq("cf_settlement_id", id);
  }

  return { ok: true, stored: res.events.length };
}

/* ─── Post ──────────────────────────────────────────────────── */

/**
 * Write one settlement into the book, if it is ready to be written.
 *
 * Only a settlement that has actually been paid is posted. INITIATED means the
 * transfer is in flight and often has no UTR yet; posting it would put money
 * in the bank book that the bank has not sent, which is the same lie the
 * clearing account exists to stop telling.
 */
export async function postSettlement(
  cfSettlementId: string,
  actor: string,
): Promise<{ ok: true; posted: boolean; voucherNo?: string } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };

  const { data: row, error } = await ctx.sb
    .from("ledger_pg_settlements")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("provider", PROVIDER)
    .eq("cf_settlement_id", cfSettlementId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: `settlement ${cfSettlementId} not stored` };

  // Re-derived from the stored gateway record too, so a row stored before the
  // FAILED mapping existed is never posted on the strength of its old status.
  // Only the failure signal is re-read here: the stored status is otherwise
  // kept as it is, never promoted.
  const status = deriveSettlementStatus({
    explicit: String(row.status ?? ""),
    hasSettledDate: false,
    raw: row.raw,
  });

  // A failed settlement never reaches the book. If one somehow already has a
  // voucher, that is money the bank never received sitting in the bank book:
  // flag it loudly (the board shows it as a break) and leave the correction to
  // a person — reversing it here would be a posting decided by a heuristic.
  if (status === "FAILED") {
    if (row.voucher_id) {
      const flag = "Settlement FAILED at the gateway but has a voucher — reverse it after checking the bank statement";
      if (String(row.post_error ?? "") !== flag) {
        await ctx.sb
          .from("ledger_pg_settlements")
          .update({ post_error: flag, updated_at: new Date().toISOString() })
          .eq("tenant_id", ctx.tenantId)
          .eq("provider", PROVIDER)
          .eq("cf_settlement_id", cfSettlementId);
      }
    }
    return { ok: true, posted: false };
  }

  // A reversal undoes a posting rather than editing it — the book is
  // append-only, so the correction is its own voucher pointing at the original.
  if (status === "REVERSED" && row.voucher_id) {
    const rev = await ledgerReverse({
      voucherId: String(row.voucher_id),
      reason: `Settlement ${cfSettlementId} reversed by the bank`,
      createdBy: actor,
    });
    if (!rev.ok) return { ok: false, error: rev.error ?? "reversal refused" };
    await ctx.sb
      .from("ledger_pg_settlements")
      .update({ post_error: "reversed", updated_at: new Date().toISOString() })
      .eq("tenant_id", ctx.tenantId)
      .eq("provider", PROVIDER)
      .eq("cf_settlement_id", cfSettlementId);
    return { ok: true, posted: false };
  }

  if (!PAID_STATUSES.has(status)) return { ok: true, posted: false };
  if (row.voucher_id) return { ok: true, posted: false };

  const built = buildPgSettlementVoucher({
    provider: PROVIDER,
    bankAccountCode: await resolveBankCode(row),
    bankAccountId: String(row.bank_account_id ?? ""),
    settlement: {
      cfSettlementId,
      utr: String(row.utr ?? ""),
      settledOn: String(row.settled_on ?? ""),
      settlementType: String(row.settlement_type ?? ""),
      paymentAmountPaise: Number(row.payment_amount_paise ?? 0),
      amountSettledPaise: Number(row.amount_settled_paise ?? 0),
      serviceChargePaise: Number(row.service_charge_paise ?? 0),
      serviceTaxPaise: Number(row.service_tax_paise ?? 0),
      settlementChargePaise: Number(row.settlement_charge_paise ?? 0),
      settlementTaxPaise: Number(row.settlement_tax_paise ?? 0),
      adjustmentPaise: Number(row.adjustment_paise ?? 0),
    },
  });

  if (!built.ok) {
    await ctx.sb
      .from("ledger_pg_settlements")
      .update({ post_error: built.reason, updated_at: new Date().toISOString() })
      .eq("tenant_id", ctx.tenantId)
      .eq("provider", PROVIDER)
      .eq("cf_settlement_id", cfSettlementId);
    return { ok: false, error: built.reason };
  }

  const res = await ledgerPost({ ...built.voucher, createdBy: actor });
  if (!res.ok) {
    await ctx.sb
      .from("ledger_pg_settlements")
      .update({ post_error: res.error ?? "", updated_at: new Date().toISOString() })
      .eq("tenant_id", ctx.tenantId)
      .eq("provider", PROVIDER)
      .eq("cf_settlement_id", cfSettlementId);
    return { ok: false, error: res.error ?? "ledger refused the settlement" };
  }

  await ctx.sb
    .from("ledger_pg_settlements")
    .update({
      voucher_id: res.voucherId,
      posted_at: new Date().toISOString(),
      post_error: "",
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("provider", PROVIDER)
    .eq("cf_settlement_id", cfSettlementId);

  return { ok: true, posted: res.created !== false, voucherNo: res.voucherNo };
}

/** The bank ledger code for an already-stored settlement row. */
async function resolveBankCode(row: Record<string, unknown>): Promise<string> {
  const bankAccountId = String(row.bank_account_id ?? "");
  if (!bankAccountId) return L_BANK;
  const ctx = await getServerTenantContext();
  if (!ctx) return L_BANK;
  const { data } = await ctx.sb
    .from("ledger_accounts")
    .select("code")
    .eq("tenant_id", ctx.tenantId)
    .eq("bank_account_id", bankAccountId)
    .eq("is_active", true)
    .maybeSingle();
  return data?.code ? String(data.code) : L_BANK;
}

/* ─── Entry points ──────────────────────────────────────────── */

/** One settlement, straight off a SETTLEMENT_* webhook. */
export async function ingestSettlementWebhook(
  data: Record<string, unknown>,
  actor = "cashfree webhook",
  eventType = "",
): Promise<{ ok: boolean; error?: string; posted?: boolean }> {
  const s = settlementFromWebhook(data, eventType);
  if (!s) return { ok: false, error: "no settlement in the event" };

  const bank = await resolveBank(s.bankAccountLast4);
  const stored = await storeSettlement(s, bank.bankAccountId);
  if (!stored.ok) return stored;

  // The webhook carries totals but no breakdown, so fetch the events before
  // posting: it is the only way to know the settlement is understood, and it
  // is what lets a family's payment be traced to the credit that paid it.
  await pullSettlementEvents([s.cfSettlementId]).catch(() => undefined);

  // FAILED goes through postSettlement only so a stray voucher gets flagged;
  // it never posts.
  if (!PAID_STATUSES.has(s.status) && s.status !== "REVERSED" && s.status !== "FAILED") {
    return { ok: true, posted: false };
  }
  const posted = await postSettlement(s.cfSettlementId, actor);
  return posted.ok
    ? { ok: true, posted: posted.posted }
    : { ok: false, error: posted.error };
}

/**
 * The nightly sweep — everything the gateway settled in a window.
 *
 * This is the feed that has to be right. A webhook that never arrived leaves
 * no trace of itself, so nothing that depends only on webhooks can ever tell
 * the difference between "no settlements" and "settlements we missed". A pull
 * over a date range can.
 */
export async function syncCashfreeSettlements(input: {
  from: string;
  to: string;
  actor?: string;
}): Promise<SettlementSyncOutcome> {
  const outcome = emptyOutcome();
  const actor = input.actor || "settlement sync";

  const res = await fetchCashfreeSettlements({ from: input.from, to: input.to });
  if (!res.ok) {
    outcome.errors.push(res.error);
    return outcome;
  }
  outcome.seen = res.settlements.length;

  for (const s of res.settlements) {
    const bank = await resolveBank(s.bankAccountLast4);
    const stored = await storeSettlement(s, bank.bankAccountId);
    if (!stored.ok) {
      outcome.errors.push(`${s.cfSettlementId}: ${stored.error}`);
      continue;
    }
    outcome.stored += 1;
  }

  const ids = res.settlements.map((s) => s.cfSettlementId);
  const events = await pullSettlementEvents(ids);
  if (events.ok) outcome.eventsStored = events.stored;
  else outcome.errors.push(events.error);

  for (const s of res.settlements) {
    if (s.status === "REVERSED") {
      const rev = await postSettlement(s.cfSettlementId, actor);
      if (rev.ok) outcome.reversed += 1;
      else outcome.errors.push(`${s.cfSettlementId}: ${rev.error}`);
      continue;
    }
    if (s.status === "FAILED") {
      // Never posted; postSettlement only flags one that already has a voucher.
      const chk = await postSettlement(s.cfSettlementId, actor);
      if (!chk.ok) outcome.errors.push(`${s.cfSettlementId}: ${chk.error}`);
      outcome.skipped.push({ id: s.cfSettlementId, reason: "FAILED — Cashfree retries it as a new settlement" });
      continue;
    }
    if (!PAID_STATUSES.has(s.status)) {
      outcome.skipped.push({ id: s.cfSettlementId, reason: s.status || "not settled" });
      continue;
    }
    const posted = await postSettlement(s.cfSettlementId, actor);
    if (!posted.ok) {
      outcome.skipped.push({ id: s.cfSettlementId, reason: posted.error });
      continue;
    }
    if (posted.posted) outcome.posted += 1;
  }

  return outcome;
}

/* ─── Reading ───────────────────────────────────────────────── */

export type SettlementReconRow = {
  cfSettlementId: string;
  utr: string;
  status: string;
  settledOn: string;
  amountSettledPaise: number;
  paymentAmountPaise: number;
  feePaise: number;
  adjustmentPaise: number;
  eventCount: number;
  eventsTotalPaise: number;
  derivedNetPaise: number;
  voucherNo: string;
  reconState: string;
  postError: string;
  /** The payment window it covers, as the gateway states it. */
  paymentFrom: string;
  paymentTill: string;
  /** For a failed settlement: the paid one that carried its money, if found. */
  retriedAs: RetriedAs | null;
};

/**
 * What is sitting in clearing right now — captured from parents, not yet paid
 * out by the gateway.
 *
 * This is the number that says whether the pipeline is healthy without reading
 * a single row. It should be about one settlement cycle of online collections.
 * Persistently large means settlements are not being ingested; negative means
 * settlements are being posted for captures that never went through clearing,
 * which is the one failure that quietly overstates the bank.
 */
export async function pgClearingBalancePaise(): Promise<number | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("ledger_v_account_balance")
    .select("balance_paise")
    .eq("tenant_id", ctx.tenantId)
    .eq("code", L_PG_CLEARING)
    .maybeSingle();
  // Null, not zero: an account with no postings and an account we could not
  // read are different facts, and only one of them means "nothing in transit".
  if (error || !data) return null;
  return Number(data.balance_paise ?? 0);
}

const PAGE = 1000;

/**
 * The recon board: every settlement in a window and whether it is explained.
 *
 * The view's recon_state predates the FAILED mapping and calls a failed
 * settlement "pending". So each row's status is re-derived here from the
 * stored gateway record — which is what corrects the board the moment this
 * ships, before the next pull rewrites the stored status — and a failed row
 * is labelled with the paid settlement that retried it, looked for beyond the
 * window too, since a retry lands a day or more later.
 */
export async function listSettlementRecon(range: {
  from: string;
  to: string;
}): Promise<{ ok: true; rows: SettlementReconRow[] } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };

  const viewRows: Record<string, unknown>[] = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await ctx.sb
      .from("ledger_v_pg_settlement_recon")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .gte("settled_on", range.from)
      .lte("settled_on", range.to)
      .order("settled_on", { ascending: false })
      .order("cf_settlement_id", { ascending: true })
      .range(off, off + PAGE - 1);
    if (error) return { ok: false, error: error.message };
    viewRows.push(...((data ?? []) as Record<string, unknown>[]));
    if ((data ?? []).length < PAGE) break;
  }

  // The gateway record behind each row: the failure signal and the window.
  const rawById = new Map<string, unknown>();
  const ids = viewRows.map((r) => String(r.cf_settlement_id ?? ""));
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await ctx.sb
      .from("ledger_pg_settlements")
      .select("cf_settlement_id, raw")
      .eq("tenant_id", ctx.tenantId)
      .eq("provider", PROVIDER)
      .in("cf_settlement_id", ids.slice(i, i + 200));
    if (error) return { ok: false, error: error.message };
    for (const r of data ?? []) rawById.set(String(r.cf_settlement_id), r.raw);
  }

  const rows: SettlementReconRow[] = viewRows.map((r) => {
    const id = String(r.cf_settlement_id ?? "");
    const raw = rawById.get(id);
    const status = deriveSettlementStatus({
      explicit: String(r.status ?? ""),
      hasSettledDate: false,
      raw,
    });
    const win = settlementPaymentWindow(raw);
    const voucherNo = String(r.voucher_no ?? "");
    return {
      cfSettlementId: id,
      utr: String(r.utr ?? ""),
      status,
      settledOn: String(r.settled_on ?? ""),
      amountSettledPaise: Number(r.amount_settled_paise ?? 0),
      paymentAmountPaise: Number(r.payment_amount_paise ?? 0),
      feePaise: Number(r.fee_paise ?? 0),
      adjustmentPaise: Number(r.adjustment_paise ?? 0),
      eventCount: Number(r.event_count ?? 0),
      eventsTotalPaise: Number(r.events_total_paise ?? 0),
      derivedNetPaise: Number(r.derived_net_paise ?? 0),
      voucherNo,
      reconState:
        status === "FAILED" ? failedReconState(voucherNo) : String(r.recon_state ?? ""),
      postError: String(r.post_error ?? ""),
      paymentFrom: win.from,
      paymentTill: win.till,
      retriedAs: null,
    };
  });

  const failed = rows.filter((r) => r.status === "FAILED");
  if (failed.length > 0) {
    // Paid settlements from the earliest failure onward — in or after the
    // window. Paged: an old failure must not silently cap the search.
    const earliest = failed.map((r) => r.settledOn).filter(Boolean).sort()[0] || range.from;
    const candidates: Parameters<typeof findRetry>[1] = [];
    for (let off = 0; ; off += PAGE) {
      const { data, error } = await ctx.sb
        .from("ledger_pg_settlements")
        .select("cf_settlement_id, utr, status, raw")
        .eq("tenant_id", ctx.tenantId)
        .eq("provider", PROVIDER)
        .in("status", [...PAID_STATUSES])
        .gte("settled_on", earliest)
        .order("settled_on", { ascending: true })
        .order("cf_settlement_id", { ascending: true })
        .range(off, off + PAGE - 1);
      if (error) return { ok: false, error: error.message };
      for (const c of data ?? []) {
        const win = settlementPaymentWindow(c.raw);
        candidates.push({
          cfSettlementId: String(c.cf_settlement_id ?? ""),
          utr: String(c.utr ?? ""),
          // A paid row whose own record says failed is no retry.
          status: deriveSettlementStatus({ explicit: String(c.status ?? ""), raw: c.raw }),
          paymentFrom: win.from,
          paymentTill: win.till,
        });
      }
      if ((data ?? []).length < PAGE) break;
    }
    for (const r of failed) r.retriedAs = findRetry(r, candidates);
  }

  return { ok: true, rows };
}
