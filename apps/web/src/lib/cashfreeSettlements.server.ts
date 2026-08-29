/**
 * Cashfree settlements — server-only reader for what the gateway actually paid.
 *
 * Two endpoints, two jobs:
 *
 *   POST /pg/settlements       one row per bank credit — the UTR, the gross,
 *                              the fees, the net. This is what reconciles
 *                              against the bank statement.
 *   POST /pg/settlement/recon  one row per event inside a settlement — which
 *                              payment, refund or chargeback made it up. This
 *                              is what traces a settlement back to families.
 *
 * Both paginate by cursor and both are read-only, so this module never writes
 * anything; `ledger/pgSettlement.server.ts` decides what to keep.
 *
 * Two rules that this file exists to hold in one place:
 *
 *   1. Money arrives as decimal rupees and is converted to integer paise here,
 *      once, via the decimal string rather than float arithmetic. Everywhere
 *      downstream is integers. The "amount_settled is 100× what we expected"
 *      failure is a conversion done twice; doing it exactly here makes that
 *      impossible to repeat by accident.
 *   2. The recon rows carry the payer's bank account number, IFSC and phone.
 *      A school reconciling its own settlements has no use for any of it, so
 *      it is dropped before the row leaves this module — not masked at the
 *      point of display, where the next reader forgets.
 */

import {
  cashfreeAuthHeaders,
  cashfreeBaseUrl,
  cashfreeKeysPresent,
} from "@/lib/cashfree.server";

/* ─── Money ─────────────────────────────────────────────────── */

/**
 * Decimal rupees → integer paise, without float rounding.
 *
 * `97.94 * 100` is 9793.999999999998 in IEEE-754. Math.round saves that one,
 * but the same trick on a lakh-scale figure with three decimal places does
 * not, and a settlement that is one paisa out fails reconciliation exactly as
 * loudly as one that is a lakh out. Working on the digits avoids the question.
 */
export function rupeesToPaise(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const s = String(value).trim();
  if (!/^-?\d*\.?\d*$/.test(s) || s === "" || s === "-" || s === ".") {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }
  const neg = s.startsWith("-");
  const [whole = "0", frac = ""] = s.replace("-", "").split(".");
  // Two decimal places is all the API sends; a third would be a rounding
  // decision, and truncating it is the only choice that cannot invent money.
  const paise =
    Number(whole || "0") * 100 + Number((frac + "00").slice(0, 2) || "0");
  if (!Number.isSafeInteger(paise)) return 0;
  return neg ? -paise : paise;
}

/* ─── Normalised shapes ─────────────────────────────────────── */

export type PgSettlement = {
  cfSettlementId: string;
  utr: string;
  status: string;
  settlementType: string;
  paymentAmountPaise: number;
  amountSettledPaise: number;
  serviceChargePaise: number;
  serviceTaxPaise: number;
  settlementChargePaise: number;
  settlementTaxPaise: number;
  adjustmentPaise: number;
  settledOn: string | null;
  initiatedAt: string | null;
  settledAt: string | null;
  /** Last four of the school's own settlement account, for bank mapping. */
  bankAccountLast4: string;
  raw: Record<string, unknown>;
};

export type PgSettlementEvent = {
  cfSettlementId: string;
  eventId: string;
  eventType: string;
  saleType: string;
  eventStatus: string;
  /** The event's gross — what the family paid, what the refund returned. */
  eventAmountPaise: number;
  /**
   * What the event contributed to the settlement, net of its own fees. These
   * are the amounts that sum to `amount_settled`; the gross ones do not, and
   * reconciling on the gross makes every settlement look short by the fee.
   */
  eventSettlementPaise: number;
  /** Both in book convention: positive is money into the settlement. */
  signedPaise: number;
  signedSettlementPaise: number;
  orderId: string;
  cfPaymentId: string;
  refundId: string;
  utr: string;
  eventTime: string | null;
  raw: Record<string, unknown>;
};

function str(v: unknown): string {
  // ids and UTRs come back as JSON numbers often enough that String() is not
  // optional — an unquoted UTR silently becomes a float above 2^53.
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : String(v);
}

function iso(v: unknown): string | null {
  const s = str(v).trim();
  if (!s) return null;
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function last4(v: unknown): string {
  const digits = str(v).replace(/\D/g, "");
  return digits ? digits.slice(-4) : "";
}

/** The webhook envelope's `data.settlement` object. */
export function settlementFromWebhook(
  data: Record<string, unknown>,
): PgSettlement | null {
  const s = (data?.settlement ?? null) as Record<string, unknown> | null;
  if (!s) return null;
  const id = str(s.settlement_id ?? s.cf_settlement_id);
  if (!id) return null;
  return {
    cfSettlementId: id,
    utr: str(s.utr),
    status: str(s.status).toUpperCase(),
    settlementType: str(s.settlement_type ?? s.type).toUpperCase(),
    paymentAmountPaise: rupeesToPaise(s.payment_amount),
    amountSettledPaise: rupeesToPaise(s.amount_settled ?? s.settlement_amount),
    serviceChargePaise: rupeesToPaise(s.service_charge),
    serviceTaxPaise: rupeesToPaise(s.service_tax),
    settlementChargePaise: rupeesToPaise(s.settlement_charge),
    settlementTaxPaise: rupeesToPaise(s.settlement_tax),
    adjustmentPaise: rupeesToPaise(s.adjustment),
    settledOn: (iso(s.settled_on) ?? "").slice(0, 10) || null,
    initiatedAt: iso(s.settlement_initiated_on),
    settledAt: iso(s.settled_on),
    bankAccountLast4: "",
    raw: s,
  };
}

/** A row from POST /pg/settlements. */
function settlementFromList(s: Record<string, unknown>): PgSettlement | null {
  const id = str(s.cf_settlement_id ?? s.settlement_id);
  if (!id) return null;
  return {
    cfSettlementId: id,
    utr: str(s.utr),
    status: str(s.status).toUpperCase(),
    settlementType: str(s.type ?? s.settlement_type).toUpperCase(),
    paymentAmountPaise: rupeesToPaise(s.amount ?? s.payment_amount),
    amountSettledPaise: rupeesToPaise(s.amount_settled),
    serviceChargePaise: rupeesToPaise(s.service_charge),
    serviceTaxPaise: rupeesToPaise(s.service_tax),
    settlementChargePaise: rupeesToPaise(s.settlement_charge),
    settlementTaxPaise: rupeesToPaise(s.settlement_tax),
    adjustmentPaise: rupeesToPaise(s.adjustment),
    settledOn: (iso(s.settlement_time) ?? "").slice(0, 10) || null,
    initiatedAt: iso(s.payment_time),
    settledAt: iso(s.settlement_time),
    bankAccountLast4: last4(s.settlement_bank_account_number),
    raw: redactSettlement(s),
  };
}

/* ─── PII ───────────────────────────────────────────────────── */

const PII_KEYS = new Set([
  "customer_bank_account_number",
  "customer_bank_ifsc",
  "customer_bank_code",
  "customer_phone",
  "customer_email",
  "settlement_bank_account_number",
]);

/**
 * Drop the payer's banking details and contact before anything is stored.
 *
 * Recursive, because the recon row nests them a level down and a shallow
 * delete would have looked like it worked.
 */
function redact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redact) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PII_KEYS.has(k)) continue;
      out[k] = redact(v);
    }
    return out as unknown as T;
  }
  return value;
}

function redactSettlement(s: Record<string, unknown>): Record<string, unknown> {
  return redact(s);
}

/* ─── HTTP ──────────────────────────────────────────────────── */

type PagedResponse = {
  cursor?: string | null;
  data?: unknown[];
  message?: string;
  code?: string;
};

async function postPaged(
  path: string,
  filters: Record<string, unknown>,
  limit = 500,
): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; error: string }> {
  if (!cashfreeKeysPresent()) {
    return { ok: false, error: "Cashfree keys not configured" };
  }

  const rows: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  // A settlement window is bounded, but a cursor that never nulls would spin
  // forever against a live API. Cap the walk and report the truncation rather
  // than returning a silently partial set that would read as a recon break.
  for (let page = 0; page < 200; page += 1) {
    const res: Response = await fetch(`${cashfreeBaseUrl()}${path}`, {
      method: "POST",
      headers: cashfreeAuthHeaders(),
      body: JSON.stringify({ pagination: { limit, cursor }, filters }),
    });
    const body = (await res.json().catch(() => ({}))) as PagedResponse;
    if (!res.ok) {
      return {
        ok: false,
        error: `${path} ${res.status}: ${body.message || body.code || "request failed"}`,
      };
    }
    for (const r of body.data ?? []) {
      if (r && typeof r === "object") rows.push(r as Record<string, unknown>);
    }
    cursor = body.cursor ?? null;
    if (!cursor) return { ok: true, rows };
  }
  return { ok: false, error: `${path}: pagination did not terminate` };
}

/** IST day bounds, which is what the settlement APIs expect. */
export function istDayRange(fromIso: string, toIso: string) {
  return {
    start_date: `${fromIso}T00:00:00+05:30`,
    end_date: `${toIso}T23:59:59+05:30`,
  };
}

export async function fetchCashfreeSettlements(range: {
  from: string;
  to: string;
}): Promise<{ ok: true; settlements: PgSettlement[] } | { ok: false; error: string }> {
  const res = await postPaged("/settlements", istDayRange(range.from, range.to), 100);
  if (!res.ok) return res;
  const settlements: PgSettlement[] = [];
  for (const row of res.rows) {
    const s = settlementFromList(row);
    if (s) settlements.push(s);
  }
  return { ok: true, settlements };
}

/**
 * Every event inside the given settlements.
 *
 * `sale_type` is the sign. A refund or a chargeback is a DEBIT — money leaving
 * the settlement — and normalising it to a negative here is what lets the
 * caller reconcile with a plain SUM instead of re-deciding the sign per row.
 */
export async function fetchCashfreeSettlementRecon(
  cfSettlementIds: string[],
): Promise<{ ok: true; events: PgSettlementEvent[] } | { ok: false; error: string }> {
  if (cfSettlementIds.length === 0) return { ok: true, events: [] };

  const events: PgSettlementEvent[] = [];
  // The filter takes ids as numbers, and a long id list makes an unwieldy
  // request; walk in modest batches.
  for (let i = 0; i < cfSettlementIds.length; i += 20) {
    const batch = cfSettlementIds.slice(i, i + 20);
    const res = await postPaged("/settlement/recon", {
      cf_settlement_ids: batch.map((id) => (/^\d+$/.test(id) ? Number(id) : id)),
    });
    if (!res.ok) return res;

    for (const row of res.rows) {
      const ev = (row.event_details ?? {}) as Record<string, unknown>;
      const sd = (row.settlement_details ?? {}) as Record<string, unknown>;
      const od = (row.order_details ?? {}) as Record<string, unknown>;
      const pd = (row.payment_details ?? {}) as Record<string, unknown>;
      const rd = (row.refund_details ?? {}) as Record<string, unknown>;

      const eventId = str(ev.event_id);
      const settlementId = str(sd.cf_settlement_id);
      if (!eventId || !settlementId) continue;

      const amount = rupeesToPaise(ev.event_amount);
      // The net sits on settlement_details for the recon row, and falls back
      // to the event's own field where the response carries it there.
      const net = rupeesToPaise(
        sd.amount_settled ?? ev.event_settlement_amount ?? ev.event_amount,
      );
      const saleType = str(ev.sale_type).toUpperCase();
      const sign = saleType === "DEBIT" ? -1 : 1;
      events.push({
        cfSettlementId: settlementId,
        eventId,
        eventType: str(ev.event_type).toUpperCase(),
        saleType,
        eventStatus: str(ev.event_status).toUpperCase(),
        eventAmountPaise: amount,
        eventSettlementPaise: net,
        signedPaise: sign * amount,
        // A net that already carries its own sign is left alone: the API
        // reports a debit's contribution as negative in some responses and as
        // a positive magnitude in others, and doubling the negation would
        // turn a refund into income.
        signedSettlementPaise: net < 0 ? net : sign * net,
        orderId: str(od.order_id),
        cfPaymentId: str(pd.cf_payment_id),
        refundId: str(rd.refund_id),
        utr: str(sd.utr),
        eventTime: iso(ev.event_time),
        // customer_details is dropped wholesale: nothing downstream needs a
        // payer's bank account to reconcile a settlement.
        raw: redact({
          event_details: ev,
          settlement_details: sd,
          order_details: od,
          payment_details: pd,
          refund_details: rd,
        }),
      });
    }
  }
  return { ok: true, events };
}
