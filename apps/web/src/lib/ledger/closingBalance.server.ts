/**
 * Ledger v2 — reading the book's cash and bank position on a date, and moving
 * it onto the counted figures. See closingBalance.ts for the rules; this file
 * only talks to the database.
 */

import "server-only";

import {
  buildClosingBalancePlan,
  CLOSING_BALANCE_SOURCE_TYPE,
  closingBalanceSourceId,
  isClosingDate,
  type ClosingBalancePlan,
} from "@/lib/ledger/closingBalance";
import { L_BALANCE_DIFFERENCE, L_BANK, L_CASH } from "@/lib/ledger/coa";
import { ensureLedgerMasters, ledgerPost } from "@/lib/ledger/ledger.server";
import { periodBalances } from "@/lib/ledger/reports.server";
import { getServerTenantContext } from "@/lib/serverTenant";

/**
 * Cash and bank are balance-sheet accounts, so their balance on a date is
 * every voucher ever posted up to it — not the movement within one year.
 * Starting the window before the school existed is what makes that true
 * regardless of which fiscal years have been closed.
 */
const BEGINNING_OF_TIME = "1900-01-01";

export type ClosingPosition = {
  ok: boolean;
  error?: string;
  asOn: string;
  bookCashPaise: number;
  bookBankPaise: number;
  /** An adjustment already posted for this date, if there is one. */
  existing: { voucherId: string; voucherNo: string; narration: string; postedAt: string } | null;
};

export async function readClosingPosition(asOn: string): Promise<ClosingPosition> {
  const empty = { asOn, bookCashPaise: 0, bookBankPaise: 0, existing: null };
  if (!isClosingDate(asOn)) {
    return { ok: false, error: "Closing date must be yyyy-mm-dd", ...empty };
  }

  const balances = await periodBalances({ from: BEGINNING_OF_TIME, to: asOn });
  if (!balances.ok) return { ok: false, error: balances.error, ...empty };

  // A school with more than one bank ledger rolls them up: the panel asks for
  // one bank figure, so it must compare against every bank account together.
  let cash = 0;
  let bank = 0;
  for (const r of balances.rows) {
    if (r.code === L_CASH) cash += r.closingPaise;
    else if (r.code === L_BANK || r.code.startsWith(`${L_BANK}.`)) bank += r.closingPaise;
  }

  return {
    ok: true,
    asOn,
    bookCashPaise: cash,
    bookBankPaise: bank,
    existing: await findExistingAdjustment(asOn),
  };
}

/**
 * The closing voucher for a date, if one stands.
 *
 * There is no `reversed_at` column on ledger_vouchers — a reversal is its own
 * voucher pointing back through `reverses_voucher_id`. Asking the original
 * whether it was reversed would silently return nothing and let a second
 * closing post on top of a live one.
 */
async function findExistingAdjustment(asOn: string): Promise<ClosingPosition["existing"]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;

  const { data } = await ctx.sb
    .from("ledger_vouchers")
    .select("id, voucher_no, narration, created_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("source_type", CLOSING_BALANCE_SOURCE_TYPE)
    .eq("source_id", closingBalanceSourceId(asOn))
    .limit(1);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const { data: reversals } = await ctx.sb
    .from("ledger_vouchers")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("reverses_voucher_id", String(row.id))
    .limit(1);
  // Reversed means the date is open again and a fresh closing may be posted.
  if ((reversals ?? []).length > 0) return null;

  return {
    voucherId: String(row.id ?? ""),
    voucherNo: String(row.voucher_no ?? ""),
    narration: String(row.narration ?? ""),
    postedAt: String(row.created_at ?? ""),
  };
}

export type ClosingBalanceResult = {
  ok: boolean;
  error?: string;
  plan?: ClosingBalancePlan;
  voucherNo?: string;
  /** True when the book already agreed and nothing needed posting. */
  noChange?: boolean;
};

/**
 * Post the closing adjustment for one date.
 *
 * Idempotent by (sourceType, sourceId=date): the same date posts once. Running
 * it a second time with different figures is refused rather than silently
 * doubling — the first voucher must be reversed first, so the correction is
 * visible in the book instead of being papered over.
 */
export async function postClosingBalances(input: {
  asOn: string;
  actualCashPaise: number;
  actualBankPaise: number;
  createdBy?: string;
}): Promise<ClosingBalanceResult> {
  if (!isClosingDate(input.asOn)) {
    return { ok: false, error: "Closing date must be yyyy-mm-dd" };
  }
  for (const [label, v] of [
    ["cash", input.actualCashPaise],
    ["bank", input.actualBankPaise],
  ] as const) {
    if (!Number.isFinite(v) || v < 0) {
      return { ok: false, error: `Counted ${label} balance must be zero or more` };
    }
  }

  const position = await readClosingPosition(input.asOn);
  if (!position.ok) return { ok: false, error: position.error };
  if (position.existing) {
    return {
      ok: false,
      error: `Closing balances for ${input.asOn} were already posted as ${position.existing.voucherNo}. Reverse that voucher before posting again.`,
    };
  }

  const plan = buildClosingBalancePlan({
    asOn: input.asOn,
    bookCashPaise: position.bookCashPaise,
    bookBankPaise: position.bookBankPaise,
    actualCashPaise: Math.round(input.actualCashPaise),
    actualBankPaise: Math.round(input.actualBankPaise),
  });

  // Nothing to post is a success, not an error: the book already agrees.
  if (plan.lines.length === 0) return { ok: true, plan, noChange: true };

  // L_BALANCE_DIFFERENCE is newer than this tenant's chart, so on the first
  // closing it does not exist yet and the post would be rejected for an
  // unknown account. Seeding is additive and idempotent — it inserts only the
  // codes that are missing — so it is safe to run on the way through.
  if (plan.lines.some((l) => l.accountCode === L_BALANCE_DIFFERENCE)) {
    const masters = await ensureLedgerMasters();
    if (!masters.ok) {
      return { ok: false, error: `Could not create the difference account: ${masters.error}`, plan };
    }
  }

  const posted = await ledgerPost({
    // "closing" rather than "journal": the anomaly checker exempts it from the
    // backdating rule, which is right — a closing is dated the day the cash was
    // counted and keyed whenever the office gets to it.
    voucherType: "closing",
    date: input.asOn,
    narration: plan.narration,
    sourceType: CLOSING_BALANCE_SOURCE_TYPE,
    sourceId: closingBalanceSourceId(input.asOn),
    createdBy: input.createdBy ?? "",
    lines: plan.lines.map((l) => ({
      accountCode: l.accountCode,
      debitPaise: l.debitPaise,
      creditPaise: l.creditPaise,
      narration: l.narration,
    })),
  });
  if (!posted.ok) return { ok: false, error: posted.error, plan };
  return { ok: true, plan, voucherNo: posted.voucherNo };
}
