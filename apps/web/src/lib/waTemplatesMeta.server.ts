/**
 * Server-only Meta WABA message template list / status helpers.
 *
 * The pending-event store used to be two JSON files under
 * `process.cwd()/.data`. On Cloud Run that is a container-local disk, wiped
 * on every deploy, every new instance and every scale to zero — so Meta's
 * "your template was approved" webhook was written to a machine that would
 * not exist by the time anybody looked. `bhb_fee_receipt` sat APPROVED at
 * Meta for days while the ERP still called it pending, refused to use it,
 * fell back to plain text, and had every fee receipt rejected as outside the
 * 24-hour window.
 *
 * They live in `wa_template_events` now, which survives a deploy.
 */

import type { MetaTemplateSyncRow } from "@/lib/waTemplates";
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  metaWabaIdFromEnv,
  resolveWhatsAppWabaId,
} from "@/lib/waMeta.server";

export type MetaTemplateStatusEvent = {
  message_template_name?: string;
  message_template_language?: string;
  event?: string;
  reason?: string;
};

export type MetaTemplateQualityEvent = {
  message_template_id?: string;
  message_template_name?: string;
  message_template_language?: string;
  previous_quality_score?: string;
  new_quality_score?: string;
};

async function readEvents<T>(kind: "status" | "quality"): Promise<T[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data, error } = await ctx.sb
    .from("wa_template_events")
    .select("payload")
    .eq("tenant_id", ctx.tenantId)
    .eq("kind", kind)
    .is("applied_at", null)
    .order("received_at", { ascending: true })
    .limit(500);
  if (error || !data) {
    if (error) console.warn("[waTemplatesMeta] read events failed", error.message);
    return [];
  }
  return data.map((r) => r.payload as T);
}

async function appendEvents(
  kind: "status" | "quality",
  events: unknown[],
): Promise<void> {
  if (!events.length) return;
  const ctx = await getServerTenantContext();
  if (!ctx) return;
  const { error } = await ctx.sb.from("wa_template_events").insert(
    events.map((payload) => ({ tenant_id: ctx.tenantId, kind, payload })),
  );
  if (error) console.warn("[waTemplatesMeta] append events failed", error.message);
}

/**
 * Marked applied rather than deleted, so a template that flips status twice
 * leaves a trail somebody can read when the ERP and Meta disagree again.
 */
async function markApplied(kind: "status" | "quality"): Promise<void> {
  const ctx = await getServerTenantContext();
  if (!ctx) return;
  const { error } = await ctx.sb
    .from("wa_template_events")
    .update({ applied_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("kind", kind)
    .is("applied_at", null);
  if (error) console.warn("[waTemplatesMeta] mark applied failed", error.message);
}

export async function readPendingTemplateStatusEvents(): Promise<
  MetaTemplateStatusEvent[]
> {
  return readEvents<MetaTemplateStatusEvent>("status");
}

export async function appendTemplateStatusEvents(
  events: MetaTemplateStatusEvent[],
): Promise<void> {
  await appendEvents("status", events);
}

export async function clearPendingTemplateStatusEvents(): Promise<void> {
  await markApplied("status");
}

export async function readPendingTemplateQualityEvents(): Promise<
  MetaTemplateQualityEvent[]
> {
  return readEvents<MetaTemplateQualityEvent>("quality");
}

export async function appendTemplateQualityEvents(
  events: MetaTemplateQualityEvent[],
): Promise<void> {
  await appendEvents("quality", events);
}

export async function clearPendingTemplateQualityEvents(): Promise<void> {
  await markApplied("quality");
}

function metaAccessToken(): string {
  return (
    process.env.WA_META_ACCESS_TOKEN ||
    process.env.WHATSAPP_TOKEN ||
    ""
  );
}

function metaWabaId(): string {
  return (
    process.env.WA_BUSINESS_ACCOUNT_ID ||
    process.env.WHATSAPP_WABA_ID ||
    ""
  );
}

function metaGraphVersion(): string {
  return (
    process.env.WA_GRAPH_API_VERSION ||
    process.env.WHATSAPP_GRAPH_VERSION ||
    "v21.0"
  );
}

export function waTemplatesMetaConfigured(): boolean {
  return !!(metaAccessToken() && metaWabaId());
}

/** Create a message template on Meta WABA and submit for approval (no Meta UI). */
export async function submitWaTemplateToMeta(
  template: import("@/lib/waTemplates").WaTemplate,
): Promise<{
  ok: boolean;
  metaTemplateId?: string;
  status?: string;
  error?: string;
  warnings?: string[];
}> {
  const { buildMetaTemplateCreatePayload } = await import("@/lib/waTemplates");
  const payload = buildMetaTemplateCreatePayload(template);
  if (!payload.name) {
    return { ok: false, error: "Missing meta template name", warnings: payload.warnings };
  }
  if (!payload.components.some((c) => c.type === "BODY")) {
    return { ok: false, error: "Template body is required", warnings: payload.warnings };
  }

  const token = metaAccessToken();
  const waba = metaWabaIdFromEnv() || (await resolveWhatsAppWabaId());
  if (!token || !waba) {
    return {
      ok: false,
      error:
        "Set WHATSAPP_TOKEN + WHATSAPP_WABA_ID. Token needs whatsapp_business_management permission.",
      warnings: payload.warnings,
    };
  }

  const version = metaGraphVersion();
  const url = `https://graph.facebook.com/${version}/${waba}/message_templates`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: payload.name,
        language: payload.language,
        category: payload.category,
        components: payload.components,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
      error?: { message?: string; error_user_msg?: string };
    };
    if (!res.ok) {
      return {
        ok: false,
        error:
          json.error?.error_user_msg ||
          json.error?.message ||
          `Meta HTTP ${res.status}`,
        warnings: payload.warnings,
      };
    }
    return {
      ok: true,
      metaTemplateId: json.id,
      status: json.status || "PENDING",
      warnings: payload.warnings,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Meta template submit failed",
      warnings: payload.warnings,
    };
  }
}

export async function fetchMetaMessageTemplates(): Promise<{
  ok: boolean;
  rows: MetaTemplateSyncRow[];
  error?: string;
  mode: string;
}> {
  const token = metaAccessToken();
  const waba = metaWabaIdFromEnv() || (await resolveWhatsAppWabaId());
  if (!token || !waba) {
    return {
      ok: false,
      rows: [],
      mode: "stub",
      error:
        "Set WHATSAPP_TOKEN + WHATSAPP_WABA_ID (or WA_BUSINESS_ACCOUNT_ID) to sync Meta templates",
    };
  }

  const version = metaGraphVersion();
  const url = `https://graph.facebook.com/${version}/${waba}/message_templates?limit=100&fields=name,language,status,id,rejected_reason,category`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: MetaTemplateSyncRow[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        ok: false,
        rows: [],
        mode: "meta",
        error: json.error?.message || `Meta HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      mode: "meta",
      rows: Array.isArray(json.data) ? json.data : [],
    };
  } catch (e) {
    return {
      ok: false,
      rows: [],
      mode: "meta",
      error: e instanceof Error ? e.message : "Meta templates fetch failed",
    };
  }
}

/** Extract message_template_status_update events from a Meta webhook body. */
export function parseMetaTemplateStatusUpdates(body: unknown): {
  message_template_name?: string;
  message_template_language?: string;
  event?: string;
  reason?: string;
}[] {
  const out: {
    message_template_name?: string;
    message_template_language?: string;
    event?: string;
    reason?: string;
  }[] = [];
  if (!body || typeof body !== "object") return out;
  const root = body as {
    entry?: {
      changes?: {
        field?: string;
        value?: {
          message_template_name?: string;
          message_template_language?: string;
          event?: string;
          reason?: string;
        };
      }[];
    }[];
  };
  for (const entry of root.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "message_template_status_update") continue;
      const v = change.value || {};
      out.push({
        message_template_name: v.message_template_name,
        message_template_language: v.message_template_language,
        event: v.event,
        reason: v.reason,
      });
    }
  }
  return out;
}

export function parseMetaTemplateQualityUpdates(
  body: unknown,
): MetaTemplateQualityEvent[] {
  const out: MetaTemplateQualityEvent[] = [];
  if (!body || typeof body !== "object") return out;
  const root = body as {
    entry?: {
      changes?: {
        field?: string;
        value?: MetaTemplateQualityEvent;
      }[];
    }[];
  };
  for (const entry of root.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "message_template_quality_update") continue;
      const v = change.value || {};
      out.push({
        message_template_id: v.message_template_id,
        message_template_name: v.message_template_name,
        message_template_language: v.message_template_language,
        previous_quality_score: v.previous_quality_score,
        new_quality_score: v.new_quality_score,
      });
    }
  }
  return out;
}
