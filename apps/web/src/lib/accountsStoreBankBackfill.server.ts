/**
 * The store's bank movements, in the shape the DESK bank book wants them.
 *
 * Store banks and pays through the `inv_*` server module, which writes the
 * ledger and nothing else. The desk's own bank ledger therefore held fee
 * receipts and not one store entry — 170 debits, zero credits — so the
 * Accounts dashboard's "Bank balances" read about ₹2.6 lakh under what the
 * book said for the same accounts.
 *
 * The counter now writes its own entry when it pays a vendor. This module is
 * for the history that predates that.
 *
 * Read from the store's OWN payment tables rather than from ledger lines.
 * Both give the same totals (verified against production: ₹3,50,435.66 in and
 * ₹2,50,000 out either way), but the payment rows carry the real tender mode
 * and the real bank account, where the ledger only records which account the
 * money passed through — most of it against the legacy `1010` parent, which
 * names no bank at all. Reading the source of truth means nothing has to be
 * inferred.
 *
 * Read-only. The client is the only place that may write these: a desk push
 * deletes accounts_desk_bank_ledger rows whose ids it does not carry, so a
 * server-side insert would be destroyed by the next browser sync.
 */

import { getServerTenantContext } from "@/lib/serverTenant";

/** One store movement to mirror, already resolved to a DESK bank account. */
export type StoreBankMovement = {
  sourceType: "inv_sale_payment" | "inv_vendor_payment";
  /** Stable across runs, so applying twice cannot double the money. */
  sourceId: string;
  deskBankId: string;
  date: string;
  /** "dr" = into the bank, "cr" = out of it. */
  direction: "dr" | "cr";
  amountPaise: number;
  /** The tender the store actually recorded — never guessed. */
  mode: string;
  narration: string;
  reference: string;
};

export type StoreBankBackfillPlan = {
  ok: boolean;
  error?: string;
  movements: StoreBankMovement[];
  /** Anything assumed or skipped, so the operator sees it before applying. */
  notes: string[];
};

export async function buildStoreBankBackfillPlan(): Promise<StoreBankBackfillPlan> {
  const ctx = await getServerTenantContext();
  if (!ctx)
    return {
      ok: false,
      error: "Supabase tenant not configured",
      movements: [],
      notes: [],
    };
  const { sb, tenantId } = ctx;
  const notes: string[] = [];

  // Which desk bank a movement belongs to. The payment row names it when the
  // operator chose one; otherwise fall back to the single bank the book has
  // linked, and say so rather than guessing between several.
  const { data: accRows, error: accErr } = await sb
    .from("ledger_accounts")
    .select("code,name,bank_account_id")
    .eq("tenant_id", tenantId)
    .eq("is_bank", true);
  if (accErr)
    return { ok: false, error: accErr.message, movements: [], notes };
  const linked = (accRows ?? [])
    .map((a) => String((a as { bank_account_id: string | null }).bank_account_id ?? "").trim())
    .filter(Boolean);
  const fallbackDeskBankId = new Set(linked).size === 1 ? linked[0]! : "";

  const movements: StoreBankMovement[] = [];
  let unbanked = 0;

  /* ─── Money IN: store sales settled to a bank ─────────────── */
  const { data: saleRows, error: saleErr } = await sb
    .from("inv_sale_payments")
    .select("id,mode,amount_paise,paid_on,bank_account_id,reference,receipt_no,reversed_at")
    .eq("tenant_id", tenantId);
  if (saleErr)
    return { ok: false, error: saleErr.message, movements: [], notes };

  for (const raw of saleRows ?? []) {
    const p = raw as {
      id: string;
      mode: string;
      amount_paise: number;
      paid_on: string;
      bank_account_id: string | null;
      reference: string | null;
      receipt_no: string | null;
      reversed_at: string | null;
    };
    // Cash belongs to the cash pools, and a reversed payment never happened.
    if (p.reversed_at) continue;
    if (String(p.mode ?? "").toLowerCase() === "cash") continue;
    const amount = Math.round(p.amount_paise || 0);
    if (amount <= 0) continue;

    const deskBankId = String(p.bank_account_id ?? "").trim() || fallbackDeskBankId;
    if (!deskBankId) {
      unbanked += 1;
      continue;
    }
    movements.push({
      sourceType: "inv_sale_payment",
      sourceId: `inv_sale_payment:${p.id}`,
      deskBankId,
      date: String(p.paid_on ?? "").slice(0, 10),
      direction: "dr",
      amountPaise: amount,
      mode: String(p.mode ?? ""),
      narration: `Store sale receipt${p.receipt_no ? ` ${p.receipt_no}` : ""}`,
      reference: String(p.reference ?? ""),
    });
  }

  /* ─── Money OUT: vendor bills paid from a bank ────────────── */
  const { data: vendorRows, error: vendorErr } = await sb
    .from("inv_vendor_payments")
    .select("id,mode,amount_paise,paid_on,payment_no,reference")
    .eq("tenant_id", tenantId);
  if (vendorErr)
    return { ok: false, error: vendorErr.message, movements: [], notes };

  for (const raw of vendorRows ?? []) {
    const p = raw as {
      id: string;
      mode: string;
      amount_paise: number;
      paid_on: string;
      payment_no: string | null;
      reference: string | null;
    };
    if (String(p.mode ?? "").toLowerCase() === "cash") continue;
    const amount = Math.round(p.amount_paise || 0);
    if (amount <= 0) continue;
    // Vendor payments carry no bank of their own, so they follow the linked one.
    if (!fallbackDeskBankId) {
      unbanked += 1;
      continue;
    }
    movements.push({
      sourceType: "inv_vendor_payment",
      sourceId: `inv_vendor_payment:${p.id}`,
      deskBankId: fallbackDeskBankId,
      date: String(p.paid_on ?? "").slice(0, 10),
      direction: "cr",
      amountPaise: amount,
      mode: String(p.mode ?? ""),
      narration: `Vendor payment${p.payment_no ? ` ${p.payment_no}` : ""}`,
      reference: String(p.reference ?? ""),
    });
  }

  if (unbanked > 0) {
    notes.push(
      `${unbanked} payment(s) name no bank account, and the book has no single linked bank to attribute them to — they were SKIPPED. Link the bank in Accounts → Masters, then run this again.`,
    );
  }
  if (fallbackDeskBankId) {
    notes.push(
      "Payments that named no bank were attributed to the only bank account linked in the book.",
    );
  }

  movements.sort((a, b) => a.date.localeCompare(b.date));
  return { ok: true, movements, notes };
}
