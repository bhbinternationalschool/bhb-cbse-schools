/**
 * Tutor passes per household — the ledger side of tutorPlans.ts.
 *
 * The pass in force is the paid order whose window contains now; today's
 * usage comes from tutor_usage. Activation on payment is idempotent: an
 * order already marked paid is left alone, so a redelivered webhook cannot
 * extend a pass twice.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { istDayStartIso } from "@/lib/aiBudget.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  DEFAULT_FREE_HINTS_PER_DAY,
  DEFAULT_PASS_MESSAGES_PER_DAY,
  parseCount,
  parseTutorPlans,
  passWindow,
  type TutorAllowance,
  type TutorMode,
  type TutorPass,
  type TutorPlan,
} from "@/lib/tutorPlans";

export function tutorPlans(): TutorPlan[] {
  return parseTutorPlans(process.env.AI_TUTOR_PLANS_JSON);
}

export function freeHintsPerDay(): number {
  return parseCount(process.env.AI_TUTOR_FREE_HINTS_PER_DAY, DEFAULT_FREE_HINTS_PER_DAY);
}

export function passMessagesPerDay(): number {
  return parseCount(process.env.AI_TUTOR_PASS_MESSAGES_PER_DAY, DEFAULT_PASS_MESSAGES_PER_DAY);
}

/** The requester stamped on ai_generations for a household's tutor calls. */
export function tutorRequesterKey(householdId: string): string {
  return `hh:${householdId}`;
}

export type TutorPassOrder = {
  id: string;
  householdId: string;
  planCode: string;
  days: number;
  amountPaise: number;
  status: "pending" | "paid" | "cancelled";
  checkoutUrl: string;
  createdAt: string;
  paidAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

function rowToOrder(r: Record<string, unknown>): TutorPassOrder {
  return {
    id: String(r.id),
    householdId: String(r.household_id),
    planCode: String(r.plan_code),
    days: Number(r.days),
    amountPaise: Number(r.amount_paise),
    status: String(r.status) as TutorPassOrder["status"],
    checkoutUrl: String(r.checkout_url ?? ""),
    createdAt: String(r.created_at),
    paidAt: r.paid_at ? String(r.paid_at) : null,
    startsAt: r.starts_at ? String(r.starts_at) : null,
    endsAt: r.ends_at ? String(r.ends_at) : null,
  };
}

function planLabelFor(code: string, days: number): string {
  return tutorPlans().find((p) => p.code === code)?.label ?? `${days} days`;
}

/** The paid pass with the latest end, if it has not run out. */
export async function currentTutorPass(householdId: string, now = new Date()): Promise<TutorPass | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data } = await ctx.sb
    .from("tutor_pass_orders")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("household_id", householdId)
    .eq("status", "paid")
    .gt("ends_at", now.toISOString())
    .order("ends_at", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const o = rowToOrder(row);
  return {
    planCode: o.planCode,
    planLabel: planLabelFor(o.planCode, o.days),
    startsAt: o.startsAt ?? o.paidAt ?? o.createdAt,
    endsAt: o.endsAt!,
  };
}

export async function tutorAllowance(householdId: string): Promise<TutorAllowance> {
  const ctx = await getServerTenantContext();
  const cap = freeHintsPerDay();
  const ceiling = passMessagesPerDay();
  if (!ctx) {
    return { freeHintsPerDay: cap, freeUsedToday: 0, pass: null, passMessagesPerDay: ceiling, passUsedToday: 0 };
  }
  const since = istDayStartIso();
  const [pass, usage] = await Promise.all([
    currentTutorPass(householdId),
    ctx.sb
      .from("tutor_usage")
      .select("kind")
      .eq("tenant_id", ctx.tenantId)
      .eq("household_id", householdId)
      .gte("created_at", since),
  ]);
  let freeUsedToday = 0;
  let passUsedToday = 0;
  if (usage.error) {
    // A usage read failure must not hand out unlimited tutoring: treat the
    // free allowance as spent (a pass, if any, still works).
    console.error("[tutor-passes] usage read failed:", usage.error.message);
    freeUsedToday = cap;
  } else {
    for (const r of (usage.data ?? []) as { kind: string }[]) {
      if (r.kind === "free") freeUsedToday += 1;
      else passUsedToday += 1;
    }
  }
  return { freeHintsPerDay: cap, freeUsedToday, pass, passMessagesPerDay: ceiling, passUsedToday };
}

/** Record one answered message against the free allowance or the pass. */
export async function recordTutorUse(opts: {
  householdId: string;
  studentId?: string;
  mode: TutorMode;
  charge: "free" | "pass";
  generationId: string;
}): Promise<void> {
  const ctx = await getServerTenantContext();
  if (!ctx) return;
  const { error } = await ctx.sb.from("tutor_usage").insert({
    tenant_id: ctx.tenantId,
    household_id: opts.householdId,
    student_id: opts.studentId ?? "",
    kind: opts.charge,
    mode: opts.mode,
    ref: opts.generationId,
  });
  if (error) console.error("[tutor-passes] use not recorded:", error.message);
}

export function newTutorOrderId(): string {
  return `tutp_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/** A pending order row; the caller attaches the gateway link afterwards. */
export async function insertTutorPassOrder(opts: {
  id: string;
  householdId: string;
  plan: TutorPlan;
  createdBy: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const { error } = await ctx.sb.from("tutor_pass_orders").insert({
    id: opts.id,
    tenant_id: ctx.tenantId,
    household_id: opts.householdId,
    plan_code: opts.plan.code,
    days: opts.plan.days,
    amount_paise: opts.plan.pricePaise,
    created_by: opts.createdBy,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function setTutorOrderCheckoutUrl(id: string, url: string): Promise<void> {
  const ctx = await getServerTenantContext();
  if (!ctx) return;
  await ctx.sb
    .from("tutor_pass_orders")
    .update({ checkout_url: url })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
}

export async function getTutorPassOrder(id: string): Promise<TutorPassOrder | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data } = await ctx.sb
    .from("tutor_pass_orders")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();
  return data ? rowToOrder(data as Record<string, unknown>) : null;
}

export async function listTutorPassOrders(householdId: string, limit = 10): Promise<TutorPassOrder[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data } = await ctx.sb
    .from("tutor_pass_orders")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("household_id", householdId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Record<string, unknown>[]).map(rowToOrder);
}

/**
 * The gateway says the pass is paid (and the caller has re-verified that
 * with the gateway): mark the order paid and set its window — from now,
 * or after the pass already running. Calling it again for a paid order
 * changes nothing.
 */
export async function activateTutorPassOrder(opts: {
  id: string;
  paymentRef: string;
}): Promise<
  | { ok: true; alreadyPaid: boolean; endsAt: string }
  | { ok: false; error: string }
> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const order = await getTutorPassOrder(opts.id);
  if (!order) return { ok: false, error: "Tutor pass order not found" };
  if (order.status === "paid") {
    return { ok: true, alreadyPaid: true, endsAt: order.endsAt ?? "" };
  }
  const current = await currentTutorPass(order.householdId);
  const window = passWindow(order.days, current?.endsAt ?? null);
  // The status filter makes the flip atomic: two webhook deliveries racing
  // here can only have one of them see "pending".
  const { data, error } = await ctx.sb
    .from("tutor_pass_orders")
    .update({
      status: "paid",
      payment_ref: opts.paymentRef,
      paid_at: new Date().toISOString(),
      starts_at: window.startsAt,
      ends_at: window.endsAt,
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", order.id)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    const again = await getTutorPassOrder(order.id);
    return { ok: true, alreadyPaid: true, endsAt: again?.endsAt ?? "" };
  }
  return { ok: true, alreadyPaid: false, endsAt: window.endsAt };
}
