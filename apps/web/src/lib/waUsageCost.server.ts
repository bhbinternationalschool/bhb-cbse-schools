/**
 * The WhatsApp bill, assembled from what the school actually sent.
 *
 * Three sources, joined:
 *   household_message_log — every send the ERP made, with its template name
 *   wa_message_delivery   — Meta's sent/delivered/read/failed reports
 *   ai_generations        — the model calls behind study help
 *
 * The delivery log is also the honest denominator: it carries a row for
 * every outbound message the number sent, including the bot's own replies
 * inside an open conversation, which never touch household_message_log.
 * Those replies are free service messages today, so they change the volume
 * figure and not the money one — but a dashboard that showed 22 messages
 * when the number sent 214 would be quietly wrong about what this school
 * uses WhatsApp for.
 */

import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";
import { deliveryLaddersFor, ladderStage } from "@/lib/waDeliveryStatus.server";
import { loadWaCostRates } from "@/lib/waCostRates.server";
import { loadWaTemplatesServer } from "@/lib/waTemplatesRead.server";
import {
  summariseAiUsage,
  summariseWaUsage,
  type WaAiCall,
  type WaBillCategory,
  type WaCostRates,
  type WaUsageMessage,
  type WaUsageSummary,
} from "@/lib/waUsageCost";

const MAX_ROWS = 5000;
const DEFAULT_WINDOW_DAYS = 30;

export type WaUsageReport = {
  ok: boolean;
  error?: string;
  sinceIso: string;
  windowDays: number;
  rates: WaCostRates;
  summary: WaUsageSummary;
  /** Distinct outbound messages Meta reported on — bot replies included. */
  metaOutboundMessages: number;
  /** Template sends whose template is not in the ERP's catalogue. */
  uncategorised: number;
  /**
   * false = the template catalogue could not be read, so every template
   * fell into "unknown" and is priced at the dearest rate. The screen says
   * so rather than presenting an inflated number as fact.
   */
  catalogueOk: boolean;
  /** true = the log hit the row cap, so the window is partial. */
  truncated: boolean;
};

function normalizeCategory(raw: string): WaBillCategory {
  switch ((raw || "").toUpperCase()) {
    case "MARKETING":
      return "marketing";
    case "UTILITY":
      return "utility";
    case "AUTHENTICATION":
      return "authentication";
    default:
      return "unknown";
  }
}

/**
 * Meta template name → category.
 *
 * Keyed on every name a log row might carry — the Meta name, the display
 * name and the family key — because dispatch has written all three over the
 * life of the log, and an unmatched row gets priced at the marketing rate.
 */
async function templateCategoryMap(): Promise<{
  map: Map<string, WaBillCategory>;
  ok: boolean;
}> {
  const map = new Map<string, WaBillCategory>();
  try {
    const state = await loadWaTemplatesServer();
    for (const t of state.templates) {
      const cat = normalizeCategory(t.category);
      for (const key of [t.metaName, t.name, t.familyKey]) {
        const k = String(key || "").trim().toLowerCase();
        if (k) map.set(k, cat);
      }
    }
    return { map, ok: true };
  } catch (e) {
    console.warn(
      "[waUsage] template catalogue unreadable",
      e instanceof Error ? e.message : e,
    );
    return { map, ok: false };
  }
}

async function loadAiCalls(sinceIso: string): Promise<WaAiCall[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data, error } = await ctx.sb
    .from("ai_generations")
    .select("created_at, model, prompt_tokens, completion_tokens")
    .eq("tenant_id", ctx.tenantId)
    .eq("route", "tutor")
    .eq("status", "ok")
    .gte("created_at", sinceIso)
    .limit(MAX_ROWS);
  if (error) {
    console.warn("[waUsage] ai_generations read failed", error.message);
    return [];
  }
  return (data || []).map((r) => ({
    at: String(r.created_at || ""),
    model: String(r.model || "unknown"),
    promptTokens: Number(r.prompt_tokens || 0),
    completionTokens: Number(r.completion_tokens || 0),
  }));
}

async function countMetaOutbound(sinceIso: string): Promise<number> {
  const ctx = await getServerTenantContext();
  if (!ctx) return 0;
  const { data, error } = await ctx.sb
    .from("wa_message_delivery")
    .select("wa_message_id")
    .eq("tenant_id", ctx.tenantId)
    .gte("event_at", sinceIso)
    .limit(20_000);
  if (error) {
    console.warn("[waUsage] delivery count failed", error.message);
    return 0;
  }
  return new Set((data || []).map((r) => String(r.wa_message_id || ""))).size;
}

export async function waUsageReport(
  opts: { sinceIso?: string; ratesOverride?: WaCostRates } = {},
): Promise<WaUsageReport> {
  const sinceIso =
    opts.sinceIso ||
    new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000).toISOString();
  const windowDays = Math.max(
    1,
    Math.round((Date.now() - new Date(sinceIso).getTime()) / 86_400_000),
  );
  const rates = opts.ratesOverride ?? (await loadWaCostRates());

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return {
      ok: false,
      error: "Tenant not configured",
      sinceIso,
      windowDays,
      rates,
      summary: summariseWaUsage([], rates),
      metaOutboundMessages: 0,
      uncategorised: 0,
      catalogueOk: false,
      truncated: false,
    };
  }

  const { data, error } = await ctx.sb
    .from("household_message_log")
    .select("created_at, purpose, via, template_name, status, wa_message_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("channel", "wa")
    .eq("direction", "out")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    // A failed read is not a ₹0 bill. Showing zero would tell the director
    // WhatsApp is free this month.
    return {
      ok: false,
      error: error.message,
      sinceIso,
      windowDays,
      rates,
      summary: summariseWaUsage([], rates),
      metaOutboundMessages: 0,
      uncategorised: 0,
      catalogueOk: false,
      truncated: false,
    };
  }

  const rows = data || [];
  const [{ map, ok: catalogueOk }, ladders, aiCalls, metaOutboundMessages] =
    await Promise.all([
      templateCategoryMap(),
      deliveryLaddersFor(rows.map((r) => String(r.wa_message_id || ""))),
      loadAiCalls(sinceIso),
      countMetaOutbound(sinceIso),
    ]);

  let uncategorised = 0;
  const messages: WaUsageMessage[] = rows.map((r) => {
    const templateName = String(r.template_name || "").trim();
    const isTemplate = String(r.via || "") === "template" || !!templateName;
    let category: WaBillCategory = "service";
    if (isTemplate) {
      category = map.get(templateName.toLowerCase()) ?? "unknown";
      if (category === "unknown") uncategorised++;
    }

    const handoffFailed = String(r.status || "") === "failed";
    const stage = ladderStage(ladders.get(String(r.wa_message_id || "")));
    const outcome: WaUsageMessage["outcome"] = handoffFailed
      ? "failed"
      : stage === "failed"
        ? "failed"
        : stage === "delivered" || stage === "read"
          ? "delivered"
          : "pending";

    return {
      at: String(r.created_at || ""),
      category,
      templateName,
      purpose: String(r.purpose || ""),
      outcome,
    };
  });

  const ai = summariseAiUsage(aiCalls, rates);

  return {
    ok: true,
    sinceIso,
    windowDays,
    rates,
    summary: summariseWaUsage(messages, rates, ai),
    metaOutboundMessages,
    uncategorised,
    catalogueOk,
    truncated: rows.length >= MAX_ROWS,
  };
}
