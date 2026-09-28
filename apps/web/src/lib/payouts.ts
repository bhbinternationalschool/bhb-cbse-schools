/**
 * The pure half of Cashfree Payouts: transfer ids, request bodies, and what a
 * status actually means. No network, no env, no clock — testable.
 *
 * WHAT THIS REPLACES. bankFileExport.ts writes a NEFT/bulk file that somebody
 * uploads into net banking by hand. The ERP then has no idea what happened: the
 * run is marked published and every staff member is assumed paid. A transfer
 * that bounced is invisible until the person says they were not paid.
 *
 * THREE THINGS THIS FILE REFUSES TO GET WRONG.
 *
 * A DUPLICATE TRANSFER. Paying somebody twice is the one mistake here that
 * cannot be undone by us — the money is in their account and getting it back is
 * a conversation, not an API call. So transfer ids are deterministic and derived
 * from what is being paid, and Cashfree's rejection of a duplicate id is the
 * outermost guard.
 *
 * RETRYING ON A 5XX. Cashfree's own documentation is explicit: on a 5XX, do NOT
 * initiate another transaction — check the status instead. A 5XX does not mean
 * the transfer did not happen. shouldRetryTransfer() exists to say no, in code,
 * so nobody re-reads the docs to find out.
 *
 * TREATING "NOT SUCCESS" AS ONE THING. A transfer can be in flight, rejected,
 * or REVERSED — sent, then returned days later by the beneficiary bank. Reversed
 * is the subtle one: the salary looked paid, and the money is back. Collapsing
 * these into "not paid yet" would leave a reversed salary silently unpaid.
 */

/** Cashfree's transfer statuses, plus the one we hold before it answers. */
export type PayoutStatus =
  | "RECEIVED"
  | "APPROVAL_PENDING"
  | "PENDING"
  | "SUCCESS"
  | "FAILED"
  | "REJECTED"
  | "REVERSED"
  | "UNKNOWN";

const IN_FLIGHT: readonly PayoutStatus[] = ["RECEIVED", "APPROVAL_PENDING", "PENDING"];

export function readPayoutStatus(raw: unknown): PayoutStatus {
  const s = String(raw ?? "").trim().toUpperCase();
  switch (s) {
    case "RECEIVED":
    case "APPROVAL_PENDING":
    case "PENDING":
    case "SUCCESS":
    case "FAILED":
    case "REJECTED":
    case "REVERSED":
      return s;
    default:
      // Never guessed into SUCCESS. An unrecognised status must not mark a
      // salary paid.
      return "UNKNOWN";
  }
}

/** The money reached the beneficiary. The ONLY status that clears a payable. */
export function payoutIsPaid(status: PayoutStatus): boolean {
  return status === "SUCCESS";
}

/** Still moving. Not paid, and not a failure to act on either. */
export function payoutIsInFlight(status: PayoutStatus): boolean {
  return IN_FLIGHT.includes(status);
}

/**
 * The money is not going to arrive, or came back.
 *
 * REVERSED is included deliberately: the transfer succeeded and was then
 * returned by the beneficiary's bank, so the salary is unpaid again and the
 * payable must reopen. Anything that treats reversed as "done" loses a salary.
 */
export function payoutNeedsAttention(status: PayoutStatus): boolean {
  return status === "FAILED" || status === "REJECTED" || status === "REVERSED";
}

/**
 * Cashfree's documented rule, in code: never re-send on a 5XX, check the status.
 *
 * A 5XX is not evidence that nothing happened. Re-sending is how one salary
 * becomes two, and the second one is not coming back on request.
 */
export function shouldRetryTransfer(_httpStatus: number): false {
  return false;
}

export const PAYOUT_TRANSFER_ID_RE = /^[A-Za-z0-9_-]{3,40}$/;

/**
 * Our id for a transfer, derived from what is being paid.
 *
 * Deterministic, for the same reason refund ids are: Cashfree rejects a
 * duplicate, and that rejection is the last line of defence against paying
 * somebody twice because a button was double-clicked or a request retried after
 * a lost response. A random id would make every retry a NEW payment.
 *
 * The amount is part of it so a corrected payment (a different amount for the
 * same person and month) is a different transfer, which it is.
 */
export function payoutTransferId(input: {
  /** e.g. "sal" for salary, "vnd" for a vendor bill, "ref" for a refund. */
  kind: string;
  /** Staff id, vendor id, whatever is being paid. */
  subjectId: string;
  /** Salary month, bill id — what distinguishes one payment from the next. */
  period: string;
  amountPaise: number;
}): string {
  const clean = (v: string) => String(v || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
  const id = [
    clean(input.kind) || "pay",
    clean(input.subjectId),
    clean(input.period),
    String(Math.max(0, Math.round(input.amountPaise))),
  ].join("_");
  return id.slice(0, 40);
}

export type PayoutMode = "imps" | "neft" | "rtgs" | "upi";

/**
 * NEFT above the IMPS ceiling, IMPS below it.
 *
 * IMPS is instant and caps at ₹5,00,000 per transaction; NEFT has no such cap
 * but settles in batches. Choosing IMPS for an amount over the cap gets the
 * transfer rejected, which for a salary run means one person unpaid and nobody
 * looking. RTGS is left to be asked for explicitly — it has a ₹2,00,000 floor
 * and is not what a school pays salaries with.
 */
export const IMPS_MAX_PAISE = 500_000_00;

export function payoutModeFor(amountPaise: number): PayoutMode {
  return amountPaise > IMPS_MAX_PAISE ? "neft" : "imps";
}

export type PayoutBeneficiaryBody = {
  beneficiary_id: string;
  beneficiary_name: string;
  beneficiary_instrument_details: {
    bank_account_number: string;
    bank_ifsc: string;
  };
  beneficiary_contact_details?: {
    beneficiary_phone?: string;
    beneficiary_email?: string;
  };
};

export function buildBeneficiaryBody(input: {
  beneficiaryId: string;
  name: string;
  accountNumber: string;
  ifsc: string;
  phone?: string;
  email?: string;
}): { ok: true; body: PayoutBeneficiaryBody } | { ok: false; error: string } {
  const beneficiary_id = String(input.beneficiaryId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 50);
  if (beneficiary_id.length < 3) {
    return { ok: false, error: "A beneficiary needs an id of at least 3 usable characters" };
  }
  const name = String(input.name || "").trim();
  if (!name) return { ok: false, error: "A beneficiary needs a name" };
  const bank_account_number = String(input.accountNumber || "").replace(/\s/g, "");
  const bank_ifsc = String(input.ifsc || "").trim().toUpperCase();
  if (bank_account_number.length < 6) return { ok: false, error: "Account number looks too short" };
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bank_ifsc)) {
    return { ok: false, error: `"${bank_ifsc}" is not a valid IFSC` };
  }

  const body: PayoutBeneficiaryBody = {
    beneficiary_id,
    beneficiary_name: name.slice(0, 100),
    beneficiary_instrument_details: { bank_account_number, bank_ifsc },
  };
  const phone = String(input.phone || "").replace(/\D/g, "").slice(-10);
  const email = String(input.email || "").trim();
  if (phone.length === 10 || email) {
    body.beneficiary_contact_details = {
      ...(phone.length === 10 ? { beneficiary_phone: phone } : {}),
      ...(email ? { beneficiary_email: email.slice(0, 200) } : {}),
    };
  }
  return { ok: true, body };
}

export type PayoutTransferBody = {
  transfer_id: string;
  transfer_amount: number;
  transfer_currency: "INR";
  transfer_mode: PayoutMode;
  beneficiary_details: { beneficiary_id: string };
  transfer_remarks?: string;
};

export function buildTransferBody(input: {
  transferId: string;
  beneficiaryId: string;
  amountPaise: number;
  remarks?: string;
  mode?: PayoutMode;
}): { ok: true; body: PayoutTransferBody } | { ok: false; error: string } {
  if (!PAYOUT_TRANSFER_ID_RE.test(input.transferId)) {
    return { ok: false, error: `Transfer id "${input.transferId}" is not valid for Cashfree` };
  }
  const amountPaise = Math.round(input.amountPaise);
  if (!Number.isFinite(amountPaise) || amountPaise < 100) {
    return { ok: false, error: "A transfer must be at least ₹1" };
  }
  const beneficiary_id = String(input.beneficiaryId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 50);
  if (beneficiary_id.length < 3) return { ok: false, error: "A transfer needs a beneficiary" };

  return {
    ok: true,
    body: {
      transfer_id: input.transferId,
      // Rupees to two places. Paise here would pay a hundred times the salary.
      transfer_amount: Number((amountPaise / 100).toFixed(2)),
      transfer_currency: "INR",
      transfer_mode: input.mode ?? payoutModeFor(amountPaise),
      beneficiary_details: { beneficiary_id },
      ...(input.remarks ? { transfer_remarks: input.remarks.slice(0, 70) } : {}),
    },
  };
}

export type PayoutTransferView = {
  transferId: string;
  cfTransferId: string;
  status: PayoutStatus;
  amountPaise: number;
  utr: string;
  statusDescription: string;
};

/**
 * Read a transfer reply or a transfer webhook.
 *
 * Null when the payload is not about a transfer, so a caller never reads an
 * error body as a successful payment.
 */
export function readPayoutTransfer(payload: unknown): PayoutTransferView | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  // Webhooks nest under data; the API reply is the object itself. Whichever
  // actually carries transfer_id is the one read.
  const src = [obj(p.data), p].find((c) => c.transfer_id != null) ?? {};
  const transferId = String(src.transfer_id ?? "");
  if (!transferId) return null;

  const amount = Number(src.transfer_amount ?? 0);
  return {
    transferId,
    cfTransferId: src.cf_transfer_id != null ? String(src.cf_transfer_id) : "",
    status: readPayoutStatus(src.status ?? src.transfer_status),
    amountPaise: Number.isFinite(amount) ? Math.round(amount * 100) : 0,
    utr: String(src.transfer_utr ?? src.utr ?? ""),
    statusDescription: String(src.status_description ?? src.status_code ?? "").trim(),
  };
}

/** One line for the desk, never optimistic about a status it does not have. */
export function payoutSentence(view: PayoutTransferView): string {
  const rupees = (view.amountPaise / 100).toFixed(2);
  switch (view.status) {
    case "SUCCESS":
      return `₹${rupees} paid${view.utr ? ` · UTR ${view.utr}` : ""}.`;
    case "REVERSED":
      return `₹${rupees} was sent and then returned by the bank. This is unpaid again.`;
    case "FAILED":
    case "REJECTED":
      return `₹${rupees} was not paid. ${view.statusDescription}`.trim();
    case "UNKNOWN":
      return `₹${rupees} — Cashfree returned a status we do not recognise. Check before re-sending.`;
    default:
      return `₹${rupees} is on its way (${view.status.toLowerCase().replace(/_/g, " ")}). Not paid yet.`;
  }
}
