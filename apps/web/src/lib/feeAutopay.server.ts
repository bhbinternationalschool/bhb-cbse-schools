/**
 * Fee auto-pay — Cashfree Subscriptions (on-demand mandates) wired into the
 * fee book.
 *
 * THE SHAPE. A family approves one mandate (UPI Autopay or e-NACH) on the
 * school's own page. On the charge day each month the tick works out what the
 * family owes right then, raises ONE debit for it (every child, oldest dues
 * first, up to the limit the family approved), and tells the family the day
 * before it lands. When Cashfree confirms the money, each child's share is
 * booked through the SAME settle path a pay-link uses — so the receipt, the
 * ledger entry and the WhatsApp receipt are the ones the school already
 * trusts, not a second implementation.
 *
 * THE GUARDS, in the order they matter:
 *  - Nothing is debited while the school setting is off (it ships off).
 *  - Only an ACTIVE mandate, read from Cashfree, is debited.
 *  - One debit per family per month: the payment id is derived from the
 *    month, the table's partial unique index refuses a second live one, and
 *    Cashfree refuses a reused id. A tick that runs twice is harmless.
 *  - A receipt is written only after re-reading the payment FROM Cashfree as
 *    SUCCESS for exactly the amount asked — never on a webhook payload alone.
 *  - Booking is idempotent and retried: a debit that succeeded but could not
 *    be booked stays visible (settled_at null, last_error set) and the next
 *    tick tries again.
 *
 * Env: CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_ENV (the PG keys —
 * Subscriptions is a PG product on the same account).
 */

import "server-only";

import {
  autopayPlanId,
  chargeIdFor,
  chargeOutcome,
  childNamesLabel,
  clampMaxPaise,
  composeAutopayInviteText,
  cycleKeyFor,
  debitDateFor,
  debitDateLabel,
  debitScheduleIso,
  isOnOrAfterChargeDay,
  isTerminalMandate,
  istDateIso,
  mandateIdFor,
  mandateIsChargeable,
  mandateIsLive,
  parseAutopaySettings,
  planCharge,
  rupeesLabel,
  type AutopaySettings,
  type ChargeableDue,
} from "@/lib/feeAutopay";
import { cashfreeAuthHeaders, cashfreeBaseUrl, cashfreeKeysPresent } from "@/lib/cashfree.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { TENANT } from "@/lib/types";

/* ── rows ────────────────────────────────────────────────────────────────── */

export type AutopayMandate = {
  subscriptionId: string;
  householdId: string;
  guardianName: string;
  customerPhone: string;
  planId: string;
  maxPaise: number;
  status: string;
  paymentGroup: string;
  sessionId: string;
  createdBy: string;
  inviteSentAt: string | null;
  activatedAt: string | null;
  endedAt: string | null;
  lastError: string;
  createdAt: string;
  updatedAt: string;
};

export type AutopayCharge = {
  paymentId: string;
  subscriptionId: string;
  householdId: string;
  cycle: string;
  amountPaise: number;
  linkIds: string[];
  debitDate: string | null;
  status: string;
  cfPaymentId: string;
  receiptNos: string[];
  settledAt: string | null;
  parentNotifiedAt: string | null;
  lastError: string;
  createdAt: string;
};

function toMandate(r: Record<string, unknown>): AutopayMandate {
  return {
    subscriptionId: String(r.subscription_id),
    householdId: String(r.household_id ?? ""),
    guardianName: String(r.guardian_name ?? ""),
    customerPhone: String(r.customer_phone ?? ""),
    planId: String(r.plan_id ?? ""),
    maxPaise: Number(r.max_paise ?? 0),
    status: String(r.status ?? ""),
    paymentGroup: String(r.payment_group ?? ""),
    sessionId: String(r.session_id ?? ""),
    createdBy: String(r.created_by ?? ""),
    inviteSentAt: r.invite_sent_at ? String(r.invite_sent_at) : null,
    activatedAt: r.activated_at ? String(r.activated_at) : null,
    endedAt: r.ended_at ? String(r.ended_at) : null,
    lastError: String(r.last_error ?? ""),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

function toCharge(r: Record<string, unknown>): AutopayCharge {
  return {
    paymentId: String(r.payment_id),
    subscriptionId: String(r.subscription_id ?? ""),
    householdId: String(r.household_id ?? ""),
    cycle: String(r.cycle ?? ""),
    amountPaise: Number(r.amount_paise ?? 0),
    linkIds: Array.isArray(r.link_ids) ? r.link_ids.map(String) : [],
    debitDate: r.debit_date ? String(r.debit_date) : null,
    status: String(r.status ?? ""),
    cfPaymentId: String(r.cf_payment_id ?? ""),
    receiptNos: Array.isArray(r.receipt_nos) ? r.receipt_nos.map(String) : [],
    settledAt: r.settled_at ? String(r.settled_at) : null,
    parentNotifiedAt: r.parent_notified_at ? String(r.parent_notified_at) : null,
    lastError: String(r.last_error ?? ""),
    createdAt: String(r.created_at ?? ""),
  };
}

async function tenant() {
  const ctx = await getServerTenantContext();
  if (!ctx) throw new Error("Database not configured");
  return ctx;
}

/* ── settings ────────────────────────────────────────────────────────────── */

export async function loadAutopaySettings(): Promise<AutopaySettings> {
  const ctx = await getServerTenantContext();
  if (!ctx) return parseAutopaySettings(null);
  const { data, error } = await ctx.sb
    .from("accounts_desk_settings")
    .select("fee_autopay")
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  // Unreadable settings read as OFF — the safe direction for taking money.
  return error ? parseAutopaySettings(null) : parseAutopaySettings(data?.fee_autopay);
}

export async function saveAutopaySettings(
  next: Partial<AutopaySettings>,
): Promise<{ ok: true; settings: AutopaySettings } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Database not configured" };
  const merged = parseAutopaySettings({ ...(await loadAutopaySettings()), ...next });
  const { error } = await ctx.sb.from("accounts_desk_settings").upsert(
    { tenant_id: ctx.tenantId, fee_autopay: merged, updated_at: new Date().toISOString() },
    { onConflict: "tenant_id" },
  );
  return error ? { ok: false, error: error.message } : { ok: true, settings: merged };
}

/* ── Cashfree calls ──────────────────────────────────────────────────────── */

type CfResult = { ok: true; status: number; data: Record<string, unknown> } | { ok: false; status: number; error: string; data: Record<string, unknown> };

async function cf(path: string, init?: { method?: string; body?: unknown }): Promise<CfResult> {
  if (!cashfreeKeysPresent()) return { ok: false, status: 0, error: "Cashfree keys not configured", data: {} };
  try {
    const res = await fetch(`${cashfreeBaseUrl()}${path}`, {
      method: init?.method ?? "GET",
      headers: cashfreeAuthHeaders(),
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, status: res.status, data };
    return { ok: false, status: res.status, error: String(data.message || `Cashfree HTTP ${res.status}`), data };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "Cashfree unreachable", data: {} };
  }
}

/**
 * A create that collided with one already there (a retry after a lost
 * response). The status and the error code decide; the message is only a
 * last resort, and only ever makes us re-read rather than skip a check.
 */
const alreadyExists = (r: CfResult) =>
  !r.ok &&
  (r.status === 409 || /already_exists|duplicate/i.test(String(r.data.code ?? "")) || /already exist/i.test(r.error));

/** One on-demand plan per limit. Creating one that exists is fine. */
async function ensurePlan(maxPaise: number): Promise<{ ok: true; planId: string } | { ok: false; error: string }> {
  const planId = autopayPlanId(maxPaise);
  const r = await cf("/plans", {
    method: "POST",
    body: {
      plan_id: planId,
      plan_name: `School fee auto-pay up to ${rupeesLabel(clampMaxPaise(maxPaise))}`,
      plan_type: "ON_DEMAND",
      plan_currency: "INR",
      plan_max_amount: Math.round(clampMaxPaise(maxPaise) / 100),
      plan_note: "School fees, debited monthly for what is due",
    },
  });
  if (r.ok || alreadyExists(r)) return { ok: true, planId };
  return { ok: false, error: r.error };
}

type CfSubscription = { status: string; paymentGroup: string; sessionId: string; cfId: string };

function readSubscription(d: Record<string, unknown>): CfSubscription {
  const auth = (d.authorization_details ?? {}) as Record<string, unknown>;
  return {
    status: String(d.subscription_status ?? ""),
    paymentGroup: String(auth.payment_group ?? ""),
    sessionId: String(d.subscription_session_id ?? ""),
    cfId: String(d.cf_subscription_id ?? ""),
  };
}

async function fetchSubscription(subscriptionId: string): Promise<{ ok: true; sub: CfSubscription } | { ok: false; error: string }> {
  const r = await cf(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
  if (!r.ok) return { ok: false, error: r.error };
  const sub = readSubscription(r.data);
  return sub.status ? { ok: true, sub } : { ok: false, error: "Cashfree returned no subscription status" };
}

type CfPayment = { status: string; amountPaise: number; cfPaymentId: string; reason: string };

async function fetchPayment(subscriptionId: string, paymentId: string): Promise<{ ok: true; pay: CfPayment } | { ok: false; error: string }> {
  const r = await cf(`/subscriptions/${encodeURIComponent(subscriptionId)}/payments/${encodeURIComponent(paymentId)}`);
  if (!r.ok) return { ok: false, error: r.error };
  const d = r.data;
  const failure = (d.failure_details ?? {}) as Record<string, unknown>;
  const status = String(d.payment_status ?? "");
  if (!status) return { ok: false, error: "Cashfree returned no payment status" };
  return {
    ok: true,
    pay: {
      status,
      amountPaise: Math.round(Number(d.payment_amount ?? 0) * 100),
      cfPaymentId: String(d.cf_payment_id ?? ""),
      reason: String(failure.failure_reason ?? d.payment_message ?? ""),
    },
  };
}

/* ── mandates ────────────────────────────────────────────────────────────── */

export async function listMandates(): Promise<AutopayMandate[]> {
  const ctx = await tenant();
  const { data, error } = await ctx.sb
    .from("fee_autopay_mandates")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toMandate(r as Record<string, unknown>));
}

export async function getMandate(subscriptionId: string): Promise<AutopayMandate | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data } = await ctx.sb
    .from("fee_autopay_mandates")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("subscription_id", subscriptionId)
    .maybeSingle();
  return data ? toMandate(data as Record<string, unknown>) : null;
}

async function patchMandate(subscriptionId: string, patch: Record<string, unknown>) {
  const ctx = await tenant();
  await ctx.sb
    .from("fee_autopay_mandates")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("subscription_id", subscriptionId);
}

/** The school's page where the parent approves — never Cashfree's raw link. */
export function autopayPageUrl(origin: string, subscriptionId: string): string {
  return `${origin.replace(/\/$/, "")}/pay/autopay/${encodeURIComponent(subscriptionId)}`;
}

type FamilyFacts = {
  guardianName: string;
  mobile: string;
  email: string;
  language: "en" | "hi";
  childNames: string;
};

async function familyFacts(householdId: string): Promise<FamilyFacts | null> {
  const { ensureSchoolMirrorHydrated } = await import("@/lib/schoolDataMirror.server");
  await ensureSchoolMirrorHydrated();
  const { loadSis, householdWhatsApp } = await import("@/lib/sis");
  const { waTemplateLanguageFor } = await import("@/lib/householdPrefs");
  const sis = loadSis();
  const hh = sis.households.find((h) => h.id === householdId);
  if (!hh) return null;
  const kids = sis.students
    .filter((s) => s.householdId === householdId && s.status === "active")
    .map((s) => s.fullName.split(/\s+/)[0] || s.fullName);
  return {
    guardianName: hh.guardianName || "Parent",
    mobile: householdWhatsApp(hh) || hh.mobile || "",
    email: (hh.email || "").trim(),
    language: waTemplateLanguageFor(hh),
    childNames: childNamesLabel(Array.from(new Set(kids))),
  };
}

export type CreateMandateResult =
  | { ok: true; mandate: AutopayMandate; link: string; reused: boolean }
  | { ok: false; error: string };

/**
 * A mandate for a family, ready for the parent to approve. A family that
 * already has a live one gets that one back — a second mandate would mean two
 * permissions to debit the same fees.
 */
export async function createMandate(input: {
  householdId: string;
  maxPaise?: number;
  createdBy: string;
  origin: string;
}): Promise<CreateMandateResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Database not configured" };
  if (!cashfreeKeysPresent()) return { ok: false, error: "Cashfree keys not configured" };

  const existing = (await listMandates()).find(
    (m) => m.householdId === input.householdId && mandateIsLive(m.status),
  );
  if (existing) {
    return { ok: true, mandate: existing, link: autopayPageUrl(input.origin, existing.subscriptionId), reused: true };
  }

  const family = await familyFacts(input.householdId);
  if (!family) return { ok: false, error: "Family not found" };
  const phone = family.mobile.replace(/\D/g, "").slice(-10);
  if (phone.length !== 10) return { ok: false, error: "No parent mobile number on record for this family" };

  const settings = await loadAutopaySettings();
  const maxPaise = clampMaxPaise(input.maxPaise ?? settings.defaultMaxPaise);
  const plan = await ensurePlan(maxPaise);
  if (!plan.ok) return { ok: false, error: `Could not set up the plan: ${plan.error}` };

  const subscriptionId = mandateIdFor(input.householdId, Date.now());
  const expiry = new Date();
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 5);
  const created = await cf("/subscriptions", {
    method: "POST",
    body: {
      subscription_id: subscriptionId,
      customer_details: {
        customer_name: family.guardianName.slice(0, 100),
        // Cashfree requires an email. A family without one gets the school
        // office's — Cashfree's own notices then reach the office, which is
        // honest, rather than an address invented for the parent.
        customer_email: family.email || TENANT.officeEmail,
        customer_phone: phone,
      },
      plan_details: { plan_id: plan.planId },
      authorization_details: { authorization_amount: 1, authorization_amount_refund: true },
      subscription_meta: { return_url: autopayPageUrl(input.origin, subscriptionId) },
      subscription_expiry_time: expiry.toISOString().replace(/\.\d{3}Z$/, "Z"),
      subscription_note: `${TENANT.nameDisplay} fees — ${family.childNames}`.slice(0, 200),
    },
  });
  if (!created.ok) return { ok: false, error: created.error };
  const sub = readSubscription(created.data);
  if (!sub.sessionId) return { ok: false, error: "Cashfree did not return an approval session" };

  const { error } = await ctx.sb.from("fee_autopay_mandates").insert({
    subscription_id: subscriptionId,
    tenant_id: ctx.tenantId,
    household_id: input.householdId,
    guardian_name: family.guardianName,
    customer_phone: phone,
    plan_id: plan.planId,
    max_paise: maxPaise,
    status: sub.status || "INITIALIZED",
    session_id: sub.sessionId,
    cf_subscription_id: sub.cfId,
    created_by: input.createdBy,
  });
  if (error) {
    // The mandate exists at Cashfree with no row of ours: cancel it rather
    // than leave a permission nobody in the school can see.
    await cf(`/subscriptions/${encodeURIComponent(subscriptionId)}/manage`, {
      method: "POST",
      body: { subscription_id: subscriptionId, action: "CANCEL" },
    });
    return { ok: false, error: `Could not save the mandate: ${error.message}` };
  }
  const mandate = await getMandate(subscriptionId);
  if (!mandate) return { ok: false, error: "Mandate saved but could not be read back" };
  return { ok: true, mandate, link: autopayPageUrl(input.origin, subscriptionId), reused: false };
}

/** Re-read a mandate FROM Cashfree and store what it says. */
export async function syncMandate(subscriptionId: string): Promise<AutopayMandate | null> {
  const before = await getMandate(subscriptionId);
  if (!before) return null;
  const live = await fetchSubscription(subscriptionId);
  if (!live.ok) {
    await patchMandate(subscriptionId, { last_error: live.error });
    return { ...before, lastError: live.error };
  }
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: live.sub.status,
    last_error: "",
    ...(live.sub.paymentGroup ? { payment_group: live.sub.paymentGroup } : {}),
    ...(live.sub.sessionId ? { session_id: live.sub.sessionId } : {}),
    ...(live.sub.cfId ? { cf_subscription_id: live.sub.cfId } : {}),
  };
  if (live.sub.status === "ACTIVE" && !before.activatedAt) patch.activated_at = now;
  if (isTerminalMandate(live.sub.status) && !before.endedAt) patch.ended_at = now;
  await patchMandate(subscriptionId, patch);
  return getMandate(subscriptionId);
}

/** The school stops a family's auto-pay. Cashfree first; our row follows what Cashfree says. */
export async function cancelMandate(subscriptionId: string): Promise<{ ok: true; mandate: AutopayMandate | null } | { ok: false; error: string }> {
  const m = await getMandate(subscriptionId);
  if (!m) return { ok: false, error: "No such auto-pay" };
  if (isTerminalMandate(m.status)) return { ok: true, mandate: m };
  const r = await cf(`/subscriptions/${encodeURIComponent(subscriptionId)}/manage`, {
    method: "POST",
    body: { subscription_id: subscriptionId, action: "CANCEL" },
  });
  if (!r.ok) {
    // A mandate the parent never approved may refuse CANCEL; it lapses on
    // its own. Re-read rather than guess.
    const synced = await syncMandate(subscriptionId);
    if (synced && isTerminalMandate(synced.status)) return { ok: true, mandate: synced };
    return { ok: false, error: r.error };
  }
  return { ok: true, mandate: await syncMandate(subscriptionId) };
}

/* ── WhatsApp ────────────────────────────────────────────────────────────── */

type SendOutcome = { sent: boolean; held: boolean; error?: string };

/**
 * One family message through the approved template in the family's language;
 * else plain text (reaches a family that wrote in within 24 hours); else held
 * for the template and sent the moment Meta approves it.
 */
async function sendFamilyTemplate(input: {
  familyKey: string;
  language: "en" | "hi";
  mobile: string;
  vars: Record<string, string>;
  fallbackText: string;
  clientMessageId: string;
  holdLabel: string;
  holdUntil: string;
}): Promise<SendOutcome> {
  const { approvedTemplatesServer } = await import("@/lib/waTemplatesRead.server");
  const { templatesByLanguage, templateForFamily } = await import("@/lib/erpCommands");
  const { buildWaTemplateBodyComponent, sendWaWithFailover, sendWhatsAppText } = await import("@/lib/waSend");
  const read = await approvedTemplatesServer("fees");
  const tpl = read.ok
    ? templateForFamily(templatesByLanguage(read.templates, [input.familyKey]).byLang, input.language, null)
    : null;
  if (tpl) {
    const r = await sendWaWithFailover({
      primaryMobile: input.mobile,
      template: {
        name: tpl.metaName,
        language: tpl.language,
        components: [buildWaTemplateBodyComponent(tpl.variables, input.vars)],
      },
      clientMessageId: input.clientMessageId,
    });
    return r.ok ? { sent: true, held: false } : { sent: false, held: false, error: r.error };
  }
  const text = await sendWhatsAppText({ toMobile: input.mobile, body: input.fallbackText });
  if (text.ok) return { sent: true, held: false };
  const { holdTemplateSend } = await import("@/lib/waTemplateAutopilot.server");
  const held = await holdTemplateSend({
    familyKey: input.familyKey,
    module: "fees",
    label: input.holdLabel,
    recipients: { [input.language]: [input.mobile] },
    vars: input.vars,
    requestedByName: "Fee auto-pay",
    requestedByMobile: "",
    expiresAt: input.holdUntil,
    ack: false,
  }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "hold failed" }));
  return held.ok ? { sent: false, held: true } : { sent: false, held: false, error: held.error };
}

/** The set-up link to the parent on WhatsApp. Also returns the text, for the office to forward by hand. */
export async function sendAutopayInvite(
  subscriptionId: string,
  origin: string,
): Promise<{ ok: true; outcome: SendOutcome; link: string; text: string } | { ok: false; error: string }> {
  const m = await getMandate(subscriptionId);
  if (!m) return { ok: false, error: "No such auto-pay" };
  if (isTerminalMandate(m.status)) return { ok: false, error: "This auto-pay has ended — set up a new one" };
  const family = await familyFacts(m.householdId);
  if (!family) return { ok: false, error: "Family not found" };
  const link = autopayPageUrl(origin, subscriptionId);
  const vars = {
    schoolName: TENANT.nameDisplay,
    guardianName: family.guardianName,
    childName: family.childNames,
    maxAmount: rupeesLabel(m.maxPaise),
    autopayLink: link,
  };
  const text = composeAutopayInviteText({
    guardianName: family.guardianName,
    childNames: family.childNames,
    maxPaise: m.maxPaise,
    link,
    schoolName: TENANT.nameDisplay,
  });
  const holdUntil = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const outcome = await sendFamilyTemplate({
    familyKey: "fees_autopay_invite",
    language: family.language,
    mobile: family.mobile,
    vars,
    fallbackText: text,
    clientMessageId: `autopay_invite_${subscriptionId}_${Date.now().toString(36)}`,
    holdLabel: `Auto-pay invite · ${family.guardianName}`,
    holdUntil,
  });
  if (outcome.sent || outcome.held) await patchMandate(subscriptionId, { invite_sent_at: new Date().toISOString() });
  return { ok: true, outcome, link, text };
}

/* ── debits ──────────────────────────────────────────────────────────────── */

export async function listCharges(limit = 200): Promise<AutopayCharge[]> {
  const ctx = await tenant();
  const { data, error } = await ctx.sb
    .from("fee_autopay_charges")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toCharge(r as Record<string, unknown>));
}

async function getCharge(paymentId: string): Promise<AutopayCharge | null> {
  const ctx = await tenant();
  const { data } = await ctx.sb
    .from("fee_autopay_charges")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("payment_id", paymentId)
    .maybeSingle();
  return data ? toCharge(data as Record<string, unknown>) : null;
}

async function patchCharge(paymentId: string, patch: Record<string, unknown>) {
  const ctx = await tenant();
  await ctx.sb
    .from("fee_autopay_charges")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("payment_id", paymentId);
}

/** The family's open dues right now — fresh, and nothing that is not due yet. */
async function familyDues(householdId: string, todayIso: string): Promise<{
  dues: ChargeableDue[];
  byStudent: Map<string, { name: string; classLabel: string; lines: import("@/lib/fees").FeeDueLine[] }>;
}> {
  const { ensureSchoolMirrorHydrated } = await import("@/lib/schoolDataMirror.server");
  const { ensureFeesHydratedServer } = await import("@/lib/feesPersistence.server");
  const { ensureFeeDuesInputsHydrated } = await import("@/lib/feeDuesInputs.server");
  await ensureSchoolMirrorHydrated();
  await ensureFeesHydratedServer();
  // Forced: a stale transport memory drops a line and the debit would come to
  // less than the family owes — then the receipt would not match. See
  // paymentSettlement.server.ts for the day that happened.
  await ensureFeeDuesInputsHydrated({ force: true });
  const { loadSis } = await import("@/lib/sis");
  const { loadMasters, currentAcademicYearCode } = await import("@/lib/masters");
  const { computeHouseholdDues, openFeeDues, loadFees } = await import("@/lib/fees");
  const { flagFutureDues } = await import("@/lib/feeDueFuture");
  const { classLabel } = await import("@/lib/homework");
  const sis = loadSis();
  const masters = loadMasters();
  const rows = computeHouseholdDues(householdId, sis, masters, loadFees(), {
    includeFuture: true,
    academicYearCode: currentAcademicYearCode(masters),
  });
  const dues: ChargeableDue[] = [];
  const byStudent = new Map<string, { name: string; classLabel: string; lines: import("@/lib/fees").FeeDueLine[] }>();
  for (const row of rows) {
    const open = openFeeDues(row.dues);
    const future = new Set(flagFutureDues(open, todayIso).filter((d) => d.future).map((d) => d.dueKey));
    const lines = open.filter((d) => d.balancePaise > 0 && !future.has(d.dueKey));
    if (!lines.length) continue;
    byStudent.set(row.student.id, {
      name: row.student.fullName,
      classLabel: classLabel(masters, row.student.classId, row.student.sectionId).replace(" · ", " "),
      lines,
    });
    for (const d of lines) {
      dues.push({ studentId: row.student.id, dueKey: d.dueKey, dueOn: d.dueOn || "", balancePaise: d.balancePaise });
    }
  }
  return { dues, byStudent };
}

/** Cancel the pay-links a debit was raised against, so dues read open again. */
async function releaseLinks(linkIds: string[]) {
  if (!linkIds.length) return;
  // Written straight to the server mirror, not through cancelPaymentLink:
  // that saves through savePayments, which checks a STAFF permission — and the
  // tick and the webhook have no staff session, so the cancel would quietly
  // not happen and the link would sit open against dues it no longer covers.
  const { loadPayments, writePaymentsLocalRaw } = await import("@/lib/payments");
  const { pushPaymentLinkToDb } = await import("@/lib/paymentsNormalized.server");
  const ids = new Set(linkIds);
  const state = loadPayments();
  const cancelled = state.links
    .filter((l) => ids.has(l.id) && l.status === "open")
    .map((l) => ({ ...l, status: "cancelled" as const }));
  if (!cancelled.length) return;
  const byId = new Map(cancelled.map((l) => [l.id, l]));
  writePaymentsLocalRaw({ ...state, links: state.links.map((l) => byId.get(l.id) ?? l) });
  for (const link of cancelled) await pushPaymentLinkToDb(link).catch(() => {});
}

export type RaiseResult = {
  subscriptionId: string;
  householdId: string;
  outcome: "raised" | "nothing_due" | "already_raised" | "not_active" | "dry_run" | "error";
  amountPaise?: number;
  leftoverPaise?: number;
  paymentId?: string;
  error?: string;
};

/**
 * One family's debit for this month. Records the row BEFORE asking Cashfree,
 * so a second run for the same month hits the unique index and stops.
 */
async function raiseForMandate(m: AutopayMandate, todayIso: string, dryRun: boolean, attempt = 1): Promise<RaiseResult> {
  const base = { subscriptionId: m.subscriptionId, householdId: m.householdId };
  const cycle = cycleKeyFor(todayIso);
  const ctx = await tenant();

  const synced = (await syncMandate(m.subscriptionId)) ?? m;
  if (!mandateIsChargeable(synced.status)) return { ...base, outcome: "not_active" };

  const { data: prior } = await ctx.sb
    .from("fee_autopay_charges")
    .select("payment_id, status")
    .eq("tenant_id", ctx.tenantId)
    .eq("subscription_id", m.subscriptionId)
    .eq("cycle", cycle);
  if (attempt === 1 && (prior ?? []).length) return { ...base, outcome: "already_raised" };
  if ((prior ?? []).some((p) => p.status !== "FAILED" && p.status !== "CANCELLED")) {
    return { ...base, outcome: "already_raised" };
  }

  const { dues, byStudent } = await familyDues(m.householdId, todayIso);
  const plan = planCharge(dues, m.maxPaise);
  if (plan.totalPaise <= 0) return { ...base, outcome: "nothing_due" };
  if (dryRun) return { ...base, outcome: "dry_run", amountPaise: plan.totalPaise, leftoverPaise: plan.leftoverPaise };

  const paymentId = chargeIdFor(m.subscriptionId, cycle, attempt);
  const debitDate = debitDateFor(todayIso);

  // One pay-link per child, for the share of this debit that is theirs.
  const { createPaymentLink, loadPayments, writePaymentsLocalRaw } = await import("@/lib/payments");
  const { ensurePaymentsHydratedServer } = await import("@/lib/paymentsPersistence");
  const { pushPaymentLinkToDb } = await import("@/lib/paymentsNormalized.server");
  await ensurePaymentsHydratedServer();
  const linkIds: string[] = [];
  let linkPaise = 0;
  for (const [studentId, share] of Object.entries(plan.perStudent)) {
    const s = byStudent.get(studentId);
    if (!s || share <= 0) continue;
    const created = createPaymentLink({
      householdId: m.householdId,
      studentId,
      studentName: s.name,
      classLabel: s.classLabel,
      dues: s.lines,
      createdBy: "Fee auto-pay",
      // Long enough for an e-NACH debit to clear (T+1 raise, up to 3 bank days).
      expiresInDays: 10,
      note: `Auto-pay debit ${paymentId}`,
      targetPaise: share,
    });
    if (!created.ok) {
      await releaseLinks(linkIds);
      return { ...base, outcome: "error", error: created.error };
    }
    const state = loadPayments();
    if (!state.links.some((l) => l.id === created.link.id)) {
      writePaymentsLocalRaw({ ...state, links: [created.link, ...state.links] });
    }
    const pushed = await pushPaymentLinkToDb(created.link);
    linkIds.push(created.link.id);
    if (!pushed.ok) {
      await releaseLinks(linkIds);
      return { ...base, outcome: "error", error: pushed.error || "Could not save the pay-link" };
    }
    linkPaise += created.link.amountPaise;
  }
  if (!linkIds.length || linkPaise !== plan.totalPaise) {
    await releaseLinks(linkIds);
    return { ...base, outcome: "error", error: `Pay-links came to ${linkPaise} paise, debit planned ${plan.totalPaise}` };
  }

  const { error: insErr } = await ctx.sb.from("fee_autopay_charges").insert({
    payment_id: paymentId,
    tenant_id: ctx.tenantId,
    subscription_id: m.subscriptionId,
    household_id: m.householdId,
    cycle,
    amount_paise: plan.totalPaise,
    link_ids: linkIds,
    debit_date: debitDate,
    status: "INITIALIZED",
  });
  if (insErr) {
    await releaseLinks(linkIds);
    // A concurrent run got there first — that is the guard working.
    return /duplicate|unique/i.test(insErr.message)
      ? { ...base, outcome: "already_raised" }
      : { ...base, outcome: "error", error: insErr.message };
  }

  const r = await cf("/subscriptions/pay", {
    method: "POST",
    body: {
      subscription_id: m.subscriptionId,
      payment_id: paymentId,
      payment_type: "CHARGE",
      payment_amount: Number((plan.totalPaise / 100).toFixed(2)),
      payment_schedule_date: debitScheduleIso(debitDate),
      payment_remarks: `School fees ${cycle}`,
    },
  });
  if (!r.ok && !alreadyExists(r)) {
    await patchCharge(paymentId, { status: "FAILED", last_error: `Not raised: ${r.error}` });
    await releaseLinks(linkIds);
    return { ...base, outcome: "error", paymentId, error: r.error };
  }
  await patchCharge(paymentId, {
    status: String(r.data.payment_status || "PENDING"),
    cf_payment_id: String(r.data.cf_payment_id ?? ""),
  });

  // The day-before note. Banks send their own pre-debit notice; this one is
  // the school's, in the family's language, and says what it is for.
  const family = await familyFacts(m.householdId);
  if (family?.mobile) {
    const names = childNamesLabel(Object.keys(plan.perStudent).map((id) => (byStudent.get(id)?.name || "").split(/\s+/)[0] || ""));
    const vars = {
      schoolName: TENANT.nameDisplay,
      guardianName: family.guardianName,
      childName: names,
      amount: rupeesLabel(plan.totalPaise),
      debitDate: debitDateLabel(debitDate),
    };
    const sent = await sendFamilyTemplate({
      familyKey: "fees_autopay_debit",
      language: family.language,
      mobile: family.mobile,
      vars,
      fallbackText: `Namaste ${family.guardianName} ji 🙏\n\nThe fee for ${names} of ${vars.amount} will be auto-debited on ${vars.debitDate} through your auto-pay. Please do not pay this at the counter — the receipt comes to WhatsApp once it goes through.`,
      clientMessageId: `autopay_debit_${paymentId}`,
      holdLabel: `Auto-pay debit notice · ${family.guardianName}`,
      // Pointless after the debit has landed.
      holdUntil: `${debitDate}T09:00:00+05:30`,
    }).catch(() => ({ sent: false, held: false }));
    if (sent.sent || sent.held) await patchCharge(paymentId, { parent_notified_at: new Date().toISOString() });
  }
  return { ...base, outcome: "raised", paymentId, amountPaise: plan.totalPaise, leftoverPaise: plan.leftoverPaise };
}

/** The office retries a failed month by hand. */
export async function retryCharge(subscriptionId: string): Promise<RaiseResult> {
  const m = await getMandate(subscriptionId);
  if (!m) return { subscriptionId, householdId: "", outcome: "error", error: "No such auto-pay" };
  const today = istDateIso(new Date());
  const ctx = await tenant();
  const { count } = await ctx.sb
    .from("fee_autopay_charges")
    .select("payment_id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenantId)
    .eq("subscription_id", subscriptionId)
    .eq("cycle", cycleKeyFor(today));
  return raiseForMandate(m, today, false, (count ?? 0) + 1);
}

/**
 * Re-read one debit from Cashfree and act on it. SUCCESS for exactly the
 * amount asked books each child's receipt; FAILED / CANCELLED releases the
 * pay-links so the dues read open again. Safe to call any number of times.
 */
export async function applyChargeOutcome(paymentId: string): Promise<{ ok: boolean; status: string; settled: boolean; error?: string }> {
  const charge = await getCharge(paymentId);
  if (!charge) return { ok: false, status: "", settled: false, error: "No such debit" };
  if (charge.settledAt) return { ok: true, status: charge.status, settled: true };

  const live = await fetchPayment(charge.subscriptionId, paymentId);
  if (!live.ok) {
    await patchCharge(paymentId, { last_error: live.error });
    return { ok: false, status: charge.status, settled: false, error: live.error };
  }
  const outcome = chargeOutcome(live.pay.status);
  const { recordPaymentGatewayEvent } = await import("@/lib/paymentsNormalized.server");

  if (outcome === "failed" || outcome === "cancelled") {
    if (charge.status !== live.pay.status) {
      await patchCharge(paymentId, { status: live.pay.status, last_error: live.pay.reason || live.pay.status });
      await releaseLinks(charge.linkIds);
      await recordPaymentGatewayEvent({
        provider: "cashfree",
        eventType: `autopay.${outcome}`,
        externalPaymentId: live.pay.cfPaymentId || paymentId,
        amountPaise: charge.amountPaise,
        settlementStatus: "failed",
        eventJson: { paymentId, subscriptionId: charge.subscriptionId, reason: live.pay.reason },
      }).catch(() => {});
      // A failed debit puts the mandate on hold for NACH; re-read it.
      await syncMandate(charge.subscriptionId);
    }
    return { ok: true, status: live.pay.status, settled: false };
  }
  if (outcome === "pending") {
    if (charge.status !== live.pay.status) await patchCharge(paymentId, { status: live.pay.status });
    return { ok: true, status: live.pay.status, settled: false };
  }

  // SUCCESS. The money must be exactly what was asked, or nothing is booked.
  if (live.pay.amountPaise !== charge.amountPaise) {
    const error = `Cashfree took ${live.pay.amountPaise} paise, debit was for ${charge.amountPaise} — nothing booked`;
    await patchCharge(paymentId, { status: live.pay.status, cf_payment_id: live.pay.cfPaymentId, last_error: error });
    return { ok: false, status: live.pay.status, settled: false, error };
  }

  const { settlePaymentLinkWithWhatsApp } = await import("@/lib/paymentSettlement.server");
  const { ensurePaymentLinkHydrated } = await import("@/lib/paymentsPersistence");
  const receipts: string[] = [];
  const errors: string[] = [];
  for (const linkId of charge.linkIds) {
    const link = await ensurePaymentLinkHydrated(linkId, { authoritative: true });
    if (link?.status === "paid") {
      // Booked on an earlier run.
      if (link.receiptNo) receipts.push(link.receiptNo);
      continue;
    }
    if (!link) {
      errors.push(`${linkId}: pay-link not found`);
      continue;
    }
    const res = await settlePaymentLinkWithWhatsApp({
      linkId,
      cashierName: "Fee auto-pay (Cashfree)",
      upiRef: live.pay.cfPaymentId || paymentId,
      expectedAmountPaise: link.amountPaise,
      sendWhatsApp: true,
    });
    if (res.ok) receipts.push(res.receiptNo);
    else errors.push(`${link.studentName}: ${res.error}`);
  }
  const settled = errors.length === 0;
  await patchCharge(paymentId, {
    status: live.pay.status,
    cf_payment_id: live.pay.cfPaymentId,
    receipt_nos: receipts,
    last_error: errors.join("; ").slice(0, 1000),
    ...(settled ? { settled_at: new Date().toISOString() } : {}),
  });
  await recordPaymentGatewayEvent({
    provider: "cashfree",
    eventType: settled ? "autopay.settled" : "autopay.settle_failed",
    externalPaymentId: live.pay.cfPaymentId || paymentId,
    amountPaise: charge.amountPaise,
    settlementStatus: settled ? "settled" : "failed",
    receiptNo: receipts.join(",") || null,
    eventJson: { paymentId, subscriptionId: charge.subscriptionId, errors },
  }).catch(() => {});
  return settled
    ? { ok: true, status: live.pay.status, settled: true }
    : { ok: false, status: live.pay.status, settled: false, error: errors.join("; ") };
}

/* ── the daily tick ──────────────────────────────────────────────────────── */

export type AutopayTickReport = {
  today: string;
  enabled: boolean;
  chargeDay: number;
  synced: number;
  raised: RaiseResult[];
  checked: { paymentId: string; status: string; settled: boolean; error?: string }[];
};

/**
 * Every day: first finish what is in flight (debits whose outcome or booking
 * is outstanding — the webhook may never have come), then, from the charge
 * day on, raise this month's debits. `dryRun` reports what would be debited
 * without raising anything; with the setting off the tick is always a dry run.
 */
export async function runAutopayTick(opts: { dryRun?: boolean; now?: Date } = {}): Promise<AutopayTickReport> {
  const now = opts.now ?? new Date();
  const today = istDateIso(now);
  const settings = await loadAutopaySettings();
  const report: AutopayTickReport = { today, enabled: settings.enabled, chargeDay: settings.chargeDay, synced: 0, raised: [], checked: [] };
  if (!cashfreeKeysPresent()) return report;
  const ctx = await tenant();

  const { data: open } = await ctx.sb
    .from("fee_autopay_charges")
    .select("payment_id")
    .eq("tenant_id", ctx.tenantId)
    .is("settled_at", null)
    .not("status", "in", "(FAILED,CANCELLED)")
    .limit(200);
  for (const row of open ?? []) {
    const r = await applyChargeOutcome(String(row.payment_id));
    report.checked.push({ paymentId: String(row.payment_id), status: r.status, settled: r.settled, error: r.error });
  }

  const mandates = await listMandates();
  // Keep set-up and held mandates current, so the office sees approvals
  // without waiting for a webhook.
  for (const m of mandates.filter((x) => mandateIsLive(x.status) && !mandateIsChargeable(x.status))) {
    await syncMandate(m.subscriptionId);
    report.synced += 1;
  }

  if (!isOnOrAfterChargeDay(today, settings.chargeDay)) return report;
  const dryRun = !!opts.dryRun || !settings.enabled;
  for (const m of mandates.filter((x) => mandateIsChargeable(x.status))) {
    try {
      report.raised.push(await raiseForMandate(m, today, dryRun));
    } catch (e) {
      report.raised.push({
        subscriptionId: m.subscriptionId,
        householdId: m.householdId,
        outcome: "error",
        error: e instanceof Error ? e.message : "failed",
      });
    }
  }
  return report;
}

/* ── webhook ─────────────────────────────────────────────────────────────── */

/** SUBSCRIPTION_* webhook: re-read the mandate and, for a debit, its outcome. */
export async function handleAutopayEvent(ev: { type: string; subscriptionId: string; paymentId: string }): Promise<{ ok: boolean; known: boolean; detail: string }> {
  const m = await getMandate(ev.subscriptionId);
  if (!m) return { ok: true, known: false, detail: "not a fee auto-pay" };
  if (ev.paymentId && ev.type.startsWith("SUBSCRIPTION_PAYMENT")) {
    const r = await applyChargeOutcome(ev.paymentId);
    return { ok: true, known: true, detail: r.settled ? "settled" : r.error || r.status };
  }
  const synced = await syncMandate(ev.subscriptionId);
  return { ok: true, known: true, detail: synced?.status || m.status };
}

/* ── what the office sees ────────────────────────────────────────────────── */

export type AutopayOverviewRow = AutopayMandate & {
  familyLabel: string;
  lastCharge: AutopayCharge | null;
};

export async function autopayOverview(): Promise<{
  settings: AutopaySettings;
  configured: boolean;
  mandates: AutopayOverviewRow[];
  charges: AutopayCharge[];
}> {
  const [settings, mandates, charges] = await Promise.all([loadAutopaySettings(), listMandates(), listCharges(300)]);
  const { ensureSchoolMirrorHydrated } = await import("@/lib/schoolDataMirror.server");
  await ensureSchoolMirrorHydrated();
  const { loadSis } = await import("@/lib/sis");
  const sis = loadSis();
  const rows = mandates.map((m) => {
    const kids = sis.students
      .filter((s) => s.householdId === m.householdId && s.status === "active")
      .map((s) => s.fullName);
    return {
      ...m,
      familyLabel: `${m.guardianName}${kids.length ? ` — ${kids.join(", ")}` : ""}`,
      lastCharge: charges.find((c) => c.subscriptionId === m.subscriptionId) ?? null,
    };
  });
  return { settings, configured: cashfreeKeysPresent(), mandates: rows, charges };
}
