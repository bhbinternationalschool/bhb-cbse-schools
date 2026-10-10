import "server-only";

/**
 * The school's tutor pricing and free windows, read and written.
 *
 * Rules are read on every parent message, so they are cached for a minute —
 * short enough that switching the tutor free during an exam week takes
 * effect while the office is still looking at the screen.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import {
  accessForChild,
  NO_ACCESS_RULES,
  priceAfterDiscount,
  type TutorAccessFor,
  type TutorAccessRule,
} from "@/lib/tutorAccess";
import { DEFAULT_TUTOR_PLANS, parseTutorPlans, type TutorPlan } from "@/lib/tutorPlans";

const CACHE_MS = 60_000;
let cache: { at: number; rules: TutorAccessRule[] } | null = null;

export function invalidateTutorAccessCache(): void {
  cache = null;
}

type RuleRow = {
  id: string;
  kind: string;
  scope: string;
  scope_id: string;
  free_until: string | null;
  discount_percent: number | null;
  note: string;
  is_active: boolean;
  created_by: string;
  created_at: string;
};

function toRule(r: RuleRow): TutorAccessRule {
  return {
    id: r.id,
    kind: r.kind === "discount" ? "discount" : "free",
    scope: r.scope === "class" || r.scope === "student" ? r.scope : "all",
    scopeId: r.scope_id || "",
    freeUntil: r.free_until,
    discountPercent: r.discount_percent,
    note: r.note || "",
    isActive: !!r.is_active,
    createdBy: r.created_by || "",
    createdAt: r.created_at,
  };
}

export async function loadTutorAccessRules(force = false): Promise<TutorAccessRule[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.rules;
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data, error } = await ctx.sb
    .from("tutor_access_rules")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) {
    // Unreadable is not "nobody has a grant": a read failure must not start
    // charging families the school told would not be charged. The last good
    // list is kept, and only an empty cache falls through to charging.
    console.warn("[tutorAccess] rules unreadable", error.message);
    return cache?.rules ?? [];
  }
  const rules = (data ?? []).map((r) => toRule(r as RuleRow));
  cache = { at: Date.now(), rules };
  return rules;
}

export function istToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** What this child gets today, from the live rules. */
export async function tutorAccessFor(child: {
  studentId: string;
  classId: string;
}): Promise<TutorAccessFor> {
  if (!child.studentId && !child.classId) return NO_ACCESS_RULES;
  const rules = await loadTutorAccessRules();
  if (!rules.length) return NO_ACCESS_RULES;
  return accessForChild(rules, child, istToday());
}

/**
 * The passes on sale, at the price this child's family would pay.
 *
 * The school's own price list wins over AI_TUTOR_PLANS_JSON; an empty table
 * keeps whatever the env said, so this is additive and reversible by
 * deleting a row.
 */
export async function tutorPlansFor(child?: { studentId: string; classId: string }): Promise<{
  plans: TutorPlan[];
  discountPercent: number;
}> {
  const base = await loadTutorPlans();
  const access = child ? await tutorAccessFor(child) : NO_ACCESS_RULES;
  if (!access.discountPercent) return { plans: base, discountPercent: 0 };
  return {
    plans: base.map((p) => ({ ...p, pricePaise: priceAfterDiscount(p.pricePaise, access.discountPercent) })),
    discountPercent: access.discountPercent,
  };
}

export async function loadTutorPlans(): Promise<TutorPlan[]> {
  const fromEnv = parseTutorPlans(process.env.AI_TUTOR_PLANS_JSON);
  const ctx = await getServerTenantContext();
  if (!ctx) return fromEnv;
  const { data, error } = await ctx.sb
    .from("tutor_plan_prices")
    .select("code, label, days, price_paise, sort_order, is_active")
    .eq("tenant_id", ctx.tenantId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.warn("[tutorAccess] price list unreadable", error.message);
    return fromEnv;
  }
  const rows = (data ?? []) as {
    code: string;
    label: string;
    days: number;
    price_paise: number;
    sort_order: number;
  }[];
  if (!rows.length) return fromEnv;
  return rows.map((r) => ({
    code: r.code,
    label: r.label || `${r.days} days`,
    days: Number(r.days),
    pricePaise: Number(r.price_paise),
  }));
}

export async function saveTutorPlanPrice(input: {
  code: string;
  label: string;
  days: number;
  pricePaise: number;
  sortOrder?: number;
  isActive?: boolean;
  by: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "no database" };
  if (!/^[a-z0-9_]{2,32}$/.test(input.code)) return { ok: false, error: "Bad plan code" };
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 366) {
    return { ok: false, error: "Days must be between 1 and 366" };
  }
  if (!Number.isInteger(input.pricePaise) || input.pricePaise < 0) {
    return { ok: false, error: "Price cannot be negative" };
  }
  const { error } = await ctx.sb.from("tutor_plan_prices").upsert({
    tenant_id: ctx.tenantId,
    code: input.code,
    label: input.label.slice(0, 60),
    days: input.days,
    price_paise: input.pricePaise,
    sort_order: input.sortOrder ?? 0,
    is_active: input.isActive ?? true,
    updated_by: input.by.slice(0, 120),
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Write a grant. `scopeIds` is how bulk works: one row per child, so any
 * single child's grant can be withdrawn later without touching the rest.
 */
export async function saveTutorAccessRule(input: {
  kind: "free" | "discount";
  scope: "all" | "class" | "student";
  scopeIds?: string[];
  freeUntil?: string | null;
  discountPercent?: number | null;
  note?: string;
  by: string;
}): Promise<{ ok: boolean; written: number; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, written: 0, error: "no database" };
  if (input.kind === "free" && !input.freeUntil) {
    return { ok: false, written: 0, error: "A free window needs a last date" };
  }
  if (input.kind === "discount") {
    const pct = Number(input.discountPercent);
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
      return { ok: false, written: 0, error: "A discount is between 1% and 100%" };
    }
  }
  const ids = input.scope === "all" ? [""] : (input.scopeIds ?? []).filter(Boolean);
  if (input.scope !== "all" && ids.length === 0) {
    return { ok: false, written: 0, error: "Pick at least one class or child" };
  }
  const rows = ids.map((scopeId) => ({
    tenant_id: ctx.tenantId,
    kind: input.kind,
    scope: input.scope,
    scope_id: scopeId,
    free_until: input.freeUntil ?? null,
    discount_percent: input.kind === "discount" ? Number(input.discountPercent) : null,
    note: (input.note || "").slice(0, 200),
    created_by: input.by.slice(0, 120),
  }));
  const { error } = await ctx.sb.from("tutor_access_rules").insert(rows);
  if (error) return { ok: false, written: 0, error: error.message };
  invalidateTutorAccessCache();
  return { ok: true, written: rows.length };
}

export async function setTutorAccessRuleActive(id: string, isActive: boolean): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "no database" };
  const { error } = await ctx.sb
    .from("tutor_access_rules")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  invalidateTutorAccessCache();
  return { ok: true };
}
