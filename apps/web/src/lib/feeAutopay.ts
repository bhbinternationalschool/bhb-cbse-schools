/**
 * Fee auto-pay — the rules, with no I/O.
 *
 * A family approves ONE on-demand mandate with Cashfree (UPI Autopay or
 * e-NACH, activated on the school's account on 30 Sep 2026). On the school's
 * charge day each month the ERP debits what the family owes right then —
 * every child's open dues, oldest first, up to the limit the family approved.
 *
 * Why on-demand and not a fixed monthly plan: a family's fee is not the same
 * every month (transport starts, a term fee falls due, a sibling joins), and a
 * fixed plan would debit the wrong amount whenever it changed. On-demand
 * debits the real figure, and the limit is the parent's protection.
 *
 * Everything here is pure so the selftest can pin it. The server module
 * (feeAutopay.server.ts) does the Cashfree calls, the tables and the receipts.
 */

/** UPI Autopay's ceiling without extra authentication (NPCI). e-NACH goes higher. */
export const AUTOPAY_UPI_CAP_PAISE = 15_000_00;
/** Never a mandate bigger than this from the ERP — a typo should not authorise ₹10 lakh. */
export const AUTOPAY_MAX_PAISE = 1_00_000_00;
export const AUTOPAY_MIN_PAISE = 500_00;

export type AutopaySettings = {
  /**
   * Raise debits at all. OFF until the office turns it on: mandates can be
   * set up while it is off, and nothing is ever taken from a family until a
   * person has decided the school is ready.
   */
  enabled: boolean;
  /** Day of the month debits are raised (1–28). The debit itself lands the next day. */
  chargeDay: number;
  /** The limit offered to a family unless the office picks another. */
  defaultMaxPaise: number;
};

export function defaultAutopaySettings(): AutopaySettings {
  return { enabled: false, chargeDay: 5, defaultMaxPaise: AUTOPAY_UPI_CAP_PAISE };
}

export function clampMaxPaise(paise: unknown): number {
  const n = Math.round(Number(paise));
  if (!Number.isFinite(n) || n <= 0) return AUTOPAY_UPI_CAP_PAISE;
  // Whole rupees: the plan id is built from it, and a mandate for ₹14,999.50
  // is nobody's intention.
  const rupees = Math.round(Math.min(AUTOPAY_MAX_PAISE, Math.max(AUTOPAY_MIN_PAISE, n)) / 100);
  return rupees * 100;
}

export function parseAutopaySettings(raw: unknown): AutopaySettings {
  const d = defaultAutopaySettings();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const day = Math.round(Number(r.chargeDay));
  return {
    enabled: r.enabled === true,
    chargeDay: Number.isFinite(day) && day >= 1 && day <= 28 ? day : d.chargeDay,
    defaultMaxPaise: r.defaultMaxPaise === undefined ? d.defaultMaxPaise : clampMaxPaise(r.defaultMaxPaise),
  };
}

/* ── ids ─────────────────────────────────────────────────────────────────── */

/** What Cashfree accepts for subscription_id / payment_id / plan_id. */
export function isAutopayId(id: string): boolean {
  return /^[A-Za-z0-9_-]{3,50}$/.test(id);
}

/** One plan per limit, shared by every family on that limit. */
export function autopayPlanId(maxPaise: number): string {
  return `bhb_fee_od_${Math.round(clampMaxPaise(maxPaise) / 100)}`;
}

/** A new mandate for a family. Time-stamped: a family can set up again after cancelling. */
export function mandateIdFor(householdId: string, nowMs: number): string {
  const hh = householdId.replace(/[^A-Za-z0-9]/g, "").slice(-16) || "family";
  return `ap_${hh}_${Math.max(0, Math.floor(nowMs)).toString(36)}`;
}

/**
 * The debit for one month. Deterministic, so a tick that runs twice — or a
 * retried request after a lost response — asks Cashfree for the SAME payment
 * id, which Cashfree refuses: a family is never debited twice for a month by
 * accident. `attempt` > 1 only when the office deliberately retries.
 */
export function chargeIdFor(subscriptionId: string, cycle: string, attempt = 1): string {
  const base = `${subscriptionId}_${cycle.replace(/[^0-9]/g, "")}`;
  return attempt > 1 ? `${base}_r${attempt}` : base;
}

/* ── dates (all IST, all YYYY-MM-DD) ─────────────────────────────────────── */

export function istDateIso(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "2026-10" — one debit per family per cycle. */
export function cycleKeyFor(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Is today the day to raise debits? A charge day the month does not have
 * cannot happen (1–28), but a missed run can: if the tick did not run on the
 * day, it catches up on the next run in the same month — the per-cycle id
 * keeps that from ever becoming a second debit.
 */
export function isOnOrAfterChargeDay(todayIso: string, chargeDay: number): boolean {
  return Number(todayIso.slice(8, 10)) >= chargeDay;
}

/**
 * When the debit lands. Raised before 9 PM for the next day is allowed for
 * every rail (Cashfree's cut-off table), and the day's gap is what lets the
 * bank send the parent the pre-debit notice it must send.
 */
export function debitDateFor(todayIso: string): string {
  return addDaysIso(todayIso, 1);
}

export function debitScheduleIso(debitDate: string): string {
  return `${debitDate}T10:00:00+05:30`;
}

/* ── what one month's debit covers ───────────────────────────────────────── */

export type ChargeableDue = {
  studentId: string;
  dueKey: string;
  dueOn: string;
  balancePaise: number;
};

export type ChargePlan = {
  totalPaise: number;
  /** Paise per child — one pay-link per child, so each child gets their own receipt. */
  perStudent: Record<string, number>;
  /** Owed but over the family's limit: left for the counter or next month. */
  leftoverPaise: number;
};

/**
 * Oldest due first, across all the family's children, up to the limit. The
 * last due that does not fit is taken in part — exactly how a part payment at
 * the counter is applied — so the limit is used, not wasted, and the receipt
 * reads the way a counter receipt would.
 */
export function planCharge(dues: ChargeableDue[], maxPaise: number): ChargePlan {
  const open = dues
    .filter((d) => d.balancePaise > 0)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.dueKey.localeCompare(b.dueKey));
  const owed = open.reduce((s, d) => s + d.balancePaise, 0);
  let remain = Math.max(0, Math.round(maxPaise));
  const perStudent: Record<string, number> = {};
  for (const d of open) {
    if (remain <= 0) break;
    const take = Math.min(d.balancePaise, remain);
    perStudent[d.studentId] = (perStudent[d.studentId] ?? 0) + take;
    remain -= take;
  }
  const totalPaise = Object.values(perStudent).reduce((s, n) => s + n, 0);
  return { totalPaise, perStudent, leftoverPaise: owed - totalPaise };
}

/* ── statuses ────────────────────────────────────────────────────────────── */

const TERMINAL = new Set([
  "COMPLETED",
  "CUSTOMER_CANCELLED",
  "EXPIRED",
  "LINK_EXPIRED",
  "CARD_EXPIRED",
  "CANCELLED",
]);

export function isTerminalMandate(status: string): boolean {
  return TERMINAL.has(status.toUpperCase());
}

/** Only an ACTIVE mandate is debited. ON_HOLD / paused ones wait. */
export function mandateIsChargeable(status: string): boolean {
  return status.toUpperCase() === "ACTIVE";
}

/** A family that already has a live (or about to be live) mandate does not get a second. */
export function mandateIsLive(status: string): boolean {
  return !isTerminalMandate(status);
}

export function mandateStatusLabel(status: string): string {
  switch (status.toUpperCase()) {
    case "INITIALIZED":
      return "Waiting for the parent to approve";
    case "BANK_APPROVAL_PENDING":
      return "Approved by parent — bank confirming (1–2 days)";
    case "ACTIVE":
      return "Active";
    case "ON_HOLD":
      return "On hold — a debit failed";
    case "PAUSED":
      return "Paused by school";
    case "CUSTOMER_PAUSED":
      return "Paused by parent";
    case "CUSTOMER_CANCELLED":
      return "Stopped by parent";
    case "CANCELLED":
      return "Stopped by school";
    case "LINK_EXPIRED":
      return "Set-up link expired";
    case "CARD_EXPIRED":
      return "Card expired";
    case "EXPIRED":
    case "COMPLETED":
      return "Ended";
    default:
      return status || "Unknown";
  }
}

export type ChargeOutcome = "pending" | "success" | "failed" | "cancelled";

export function chargeOutcome(paymentStatus: string): ChargeOutcome {
  switch (paymentStatus.toUpperCase()) {
    case "SUCCESS":
      return "success";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    default:
      return "pending";
  }
}

/* ── webhook events ──────────────────────────────────────────────────────── */

export type AutopayEvent = {
  type: string;
  subscriptionId: string;
  /** Empty for mandate events; set for debit events. */
  paymentId: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

/**
 * The ids out of a SUBSCRIPTION_* webhook. Only the ids: the status is
 * always re-read from Cashfree before anything is booked, so a forged or
 * stale payload can at most make us ask.
 */
export function readAutopayEvent(event: unknown): AutopayEvent | null {
  if (!event || typeof event !== "object") return null;
  const e = event as Record<string, unknown>;
  const type = str(e.type);
  if (!type.startsWith("SUBSCRIPTION_")) return null;
  const data = (e.data && typeof e.data === "object" ? e.data : {}) as Record<string, unknown>;
  const sub = (data.subscription_details ?? {}) as Record<string, unknown>;
  const pay = (data.payment_details ?? data.payment ?? {}) as Record<string, unknown>;
  const subscriptionId = str(sub.subscription_id) || str(data.subscription_id) || str(pay.subscription_id);
  const paymentId = str(data.payment_id) || str(pay.payment_id);
  if (!subscriptionId) return null;
  return { type, subscriptionId, paymentId };
}

/* ── words ───────────────────────────────────────────────────────────────── */

export function rupeesLabel(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

/** "Thu 1 Oct" */
export function debitDateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** "Aarav", "Aarav and Siya", "Aarav, Siya and Kabir" — one parameter line, no newline. */
export function childNamesLabel(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] || "your child";
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
}

/** The message the office sends by hand when the invite template is not approved yet. */
export function composeAutopayInviteText(input: {
  guardianName: string;
  childNames: string;
  maxPaise: number;
  link: string;
  schoolName: string;
}): string {
  return [
    `Namaste ${input.guardianName || "Parent"} ji 🙏`,
    "",
    `${input.schoolName} now offers fee auto-pay for ${input.childNames}. Approve it once and each month's fee is paid automatically from your bank or UPI, with the receipt on WhatsApp.`,
    "",
    `Limit you approve: up to ${rupeesLabel(input.maxPaise)} a month. You get a message before every debit, and you can stop it any time.`,
    "",
    `Set it up here (takes a minute): ${input.link}`,
  ].join("\n");
}
