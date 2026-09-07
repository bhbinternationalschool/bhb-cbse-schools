import { createServiceSupabase } from "@/lib/supabase/server";
import { sendWhatsAppText } from "@/lib/waSend";

/**
 * Watch for money that has lost its breakdown, and tell somebody.
 *
 * A live fee receipt with an amount and no lines has a guardian and a total
 * and no student, no fee head and no month. Dues clear FROM the lines, so
 * every month those families paid reads unpaid again, and the counter starts
 * collecting money it already has.
 *
 * This has now happened twice — 134 receipts on 2026-09-01, every one of the
 * 502 on 2026-09-06. Both times the Accounts controls page raised it
 * correctly and both times nobody was looking at the Accounts controls page.
 * The second time it ran for about fourteen hours before the director noticed
 * on his own screen. A finding nobody is shown is not detection.
 *
 * So this reads the fee desk directly and pushes. It cannot come from the
 * ledger: the ledger voucher for such a receipt is perfectly balanced and
 * never records which due was paid, so double-entry cannot see this at all.
 */

export type FeeIntegrityReport = {
  checkedAt: string;
  liveReceipts: number;
  /** Live, un-voided receipts with money and no lines at all. */
  blankReceipts: { receiptNo: string; paise: number }[];
  /** Live receipts whose lines exist but do not sum to the receipt total. */
  mismatchedReceipts: { receiptNo: string; paise: number; linePaise: number }[];
  blankPaise: number;
  /**
   * Receipts exist for the running session, but the dues cache says almost
   * nothing has been paid against it — the signature of a dues table that was
   * never rebuilt after the receipts changed.
   */
  staleDues: null | {
    academicYearCode: string;
    receiptsPaise: number;
    impliedPaidPaise: number;
  };
  alerted: boolean;
  alertError?: string;
};

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

/** Comma-separated mobiles. Falls back to the SOS list so it is never silent. */
function alertMobiles(): string[] {
  const raw =
    process.env.FEE_INTEGRITY_NOTIFY_MOBILE ||
    process.env.FLEET_EDGE_SOS_NOTIFY_MOBILE ||
    "";
  return raw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

/**
 * The whole judgement, separated from the database so it can be tested.
 *
 * A receipt with NO entry in the line totals is blank — that is the incident
 * shape, money with no student, head or month. A receipt whose lines exist but
 * do not sum to the total is a different, older problem (partial loss), worth
 * reporting but not worth waking anyone for.
 *
 * `0` is a real sum, not a missing one. A receipt whose lines all net to zero
 * must read as mismatched rather than blank, which is why this keys on
 * `has()` and never on falsiness.
 */
/**
 * Has the dues cache fallen behind the receipts for the RUNNING session?
 *
 * `billed - concession - balance` is what the cache believes has been paid.
 * When receipts exist for the same year and that figure is near zero, the
 * cache was built from a state the receipts have since left behind — and
 * every family reads as owing their whole year while their money sits in the
 * book. Rebuild with POST /api/fees/rebuild-open-dues.
 *
 * The threshold is deliberately blunt: this catches "the derivation never
 * ran", not "the derivation is slightly out". A cache that is merely a few
 * receipts behind corrects itself on the next push; one that says nothing has
 * been paid never will.
 */
async function detectStaleDues(
  sb: NonNullable<ReturnType<typeof createServiceSupabase>>,
): Promise<FeeIntegrityReport["staleDues"]> {
  const { data: ayRows } = await sb
    .from("fee_desk_open_dues")
    .select("academic_year_code")
    .order("academic_year_code", { ascending: false })
    .limit(1);
  const ay = String(ayRows?.[0]?.academic_year_code ?? "");
  if (!ay) return null;

  let billed = 0;
  let concession = 0;
  let balance = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("fee_desk_open_dues")
      .select("billed_paise, concession_paise, balance_paise")
      .eq("academic_year_code", ay)
      .order("due_key", { ascending: true })
      .range(from, from + 999);
    if (error) return null;
    for (const r of data ?? []) {
      billed += Number((r as { billed_paise: number }).billed_paise) || 0;
      concession += Number((r as { concession_paise: number }).concession_paise) || 0;
      balance += Number((r as { balance_paise: number }).balance_paise) || 0;
    }
    if (!data || data.length < 1000) break;
  }
  const impliedPaid = billed - concession - balance;

  let receipts = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("fee_desk_vouchers")
      .select("total_paise")
      .eq("academic_year_code", ay)
      .is("voided_at", null)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) return null;
    for (const r of data ?? []) {
      receipts += Number((r as { total_paise: number }).total_paise) || 0;
    }
    if (!data || data.length < 1000) break;
  }

  // Receipts worth something, and the cache crediting under a hundredth of it.
  if (receipts > 100_000 && impliedPaid < receipts / 100) {
    return {
      academicYearCode: ay,
      receiptsPaise: receipts,
      impliedPaidPaise: impliedPaid,
    };
  }
  return null;
}

export function classifyReceipts(
  vouchers: { id: string; receipt_no: string; total_paise: number }[],
  lineTotals: Map<string, number>,
): {
  blankReceipts: FeeIntegrityReport["blankReceipts"];
  mismatchedReceipts: FeeIntegrityReport["mismatchedReceipts"];
} {
  const blankReceipts: FeeIntegrityReport["blankReceipts"] = [];
  const mismatchedReceipts: FeeIntegrityReport["mismatchedReceipts"] = [];
  for (const v of vouchers) {
    if (!lineTotals.has(v.id)) {
      blankReceipts.push({ receiptNo: v.receipt_no, paise: v.total_paise });
      continue;
    }
    const summed = lineTotals.get(v.id) as number;
    if (summed !== v.total_paise) {
      mismatchedReceipts.push({
        receiptNo: v.receipt_no,
        paise: v.total_paise,
        linePaise: summed,
      });
    }
  }
  return { blankReceipts, mismatchedReceipts };
}

export async function checkFeeIntegrity(opts?: {
  dryRun?: boolean;
}): Promise<FeeIntegrityReport> {
  const checkedAt = new Date().toISOString();
  const sb = createServiceSupabase();
  if (!sb) {
    return {
      checkedAt,
      liveReceipts: 0,
      blankReceipts: [],
      mismatchedReceipts: [],
      blankPaise: 0,
      staleDues: null,
      alerted: false,
      alertError: "Supabase not configured",
    };
  }

  // Paged, not capped. An unbounded PostgREST select stops at 1000 rows and
  // returns the truncation as an ordinary success — which is the read bug
  // that started the 2026-09-01 incident in the first place.
  const vouchers: { id: string; receipt_no: string; total_paise: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("fee_desk_vouchers")
      .select("id, receipt_no, total_paise")
      .is("voided_at", null)
      .gt("total_paise", 0)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) {
      return {
        checkedAt,
        liveReceipts: 0,
        blankReceipts: [],
        mismatchedReceipts: [],
        blankPaise: 0,
        staleDues: null,
        alerted: false,
        alertError: `receipt read failed: ${error.message}`,
      };
    }
    vouchers.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const lineTotals = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("fee_desk_voucher_lines")
      .select("voucher_id, amount_paise")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) {
      return {
        checkedAt,
        liveReceipts: vouchers.length,
        blankReceipts: [],
        mismatchedReceipts: [],
        blankPaise: 0,
        staleDues: null,
        alerted: false,
        alertError: `line read failed: ${error.message}`,
      };
    }
    for (const r of data ?? []) {
      const id = String((r as { voucher_id: string }).voucher_id);
      const amt = Number((r as { amount_paise: number }).amount_paise) || 0;
      lineTotals.set(id, (lineTotals.get(id) ?? 0) + amt);
    }
    if (!data || data.length < 1000) break;
  }

  const { blankReceipts, mismatchedReceipts } = classifyReceipts(
    vouchers,
    lineTotals,
  );

  // A due is cleared BY the lines of the receipt that paid it, so the dues
  // cache is derived and can silently fall behind the receipts. On
  // 2026-09-06 the wipe left it rebuilt from emptiness, the lines were
  // restored the next day, and nothing recomputed the dues — so for two days
  // the school read ₹1 collected against a ₹36.7 lakh session while ₹21.2
  // lakh of receipts sat in the same database. Blank receipts were not the
  // symptom that time; a stale derivation was.
  const staleDues = await detectStaleDues(sb);

  const blankPaise = blankReceipts.reduce((s, r) => s + r.paise, 0);
  const report: FeeIntegrityReport = {
    checkedAt,
    liveReceipts: vouchers.length,
    blankReceipts,
    mismatchedReceipts,
    blankPaise,
    staleDues,
    alerted: false,
  };

  if (staleDues) {
    console.error(
      `[fee-integrity] dues for ${staleDues.academicYearCode} say ` +
        `${rupees(staleDues.impliedPaidPaise)} paid, but receipts total ` +
        `${rupees(staleDues.receiptsPaise)} — the dues cache needs rebuilding ` +
        `(POST /api/fees/rebuild-open-dues)`,
    );
  }

  if (blankReceipts.length === 0 && !staleDues) return report;

  console.error(
    `[fee-integrity] ${blankReceipts.length} live receipt(s) worth ${rupees(blankPaise)} have NO lines`,
  );
  if (opts?.dryRun) return report;

  const mobiles = alertMobiles();
  if (mobiles.length === 0) {
    return {
      ...report,
      alertError:
        "FEE_INTEGRITY_NOTIFY_MOBILE unset — nobody was told. Set it.",
    };
  }

  const sample = blankReceipts
    .slice(0, 5)
    .map((r) => `${r.receiptNo} (${rupees(r.paise)})`)
    .join(", ");
  const body =
    `⚠️ Fee receipts have lost their breakdown.\n\n` +
    `${blankReceipts.length} live receipt(s) worth ${rupees(blankPaise)} show an amount ` +
    `with no student, fee head or month. Every month those families paid will read UNPAID ` +
    `until this is fixed — do not let the counter re-collect.\n\n` +
    `First few: ${sample}\n\n` +
    `Open Fees → Receipts and use Re-attach, or restore from the BigQuery snapshot.`;

  let alerted = false;
  let alertError: string | undefined;
  for (const mobile of mobiles) {
    const res = await sendWhatsAppText({ toMobile: mobile, body }).catch(
      (e: unknown) => ({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    if ((res as { ok?: boolean }).ok) alerted = true;
    else alertError = String((res as { error?: string }).error ?? "send failed");
  }

  return { ...report, alerted, alertError };
}
