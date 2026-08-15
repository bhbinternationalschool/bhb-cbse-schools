/**
 * Server-only Meta WABA message template list / status helpers.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { MetaTemplateSyncRow } from "@/lib/waTemplates";
import {
  metaWabaIdFromEnv,
  resolveWhatsAppWabaId,
} from "@/lib/waMeta.server";

const STATUS_EVENTS_PATH = path.join(
  process.cwd(),
  ".data",
  "wa_template_status_events.json",
);

export type MetaTemplateStatusEvent = {
  message_template_name?: string;
  message_template_language?: string;
  event?: string;
  reason?: string;
};

export async function readPendingTemplateStatusEvents(): Promise<
  MetaTemplateStatusEvent[]
> {
  try {
    const raw = await readFile(STATUS_EVENTS_PATH, "utf8");
    const parsed = JSON.parse(raw) as { events?: MetaTemplateStatusEvent[] };
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    return [];
  }
}

export async function appendTemplateStatusEvents(
  events: MetaTemplateStatusEvent[],
): Promise<void> {
  if (!events.length) return;
  const existing = await readPendingTemplateStatusEvents();
  await mkdir(path.dirname(STATUS_EVENTS_PATH), { recursive: true });
  await writeFile(
    STATUS_EVENTS_PATH,
    JSON.stringify(
      { events: [...existing, ...events].slice(-500) },
      null,
      2,
    ),
    "utf8",
  );
}

export async function clearPendingTemplateStatusEvents(): Promise<void> {
  try {
    await mkdir(path.dirname(STATUS_EVENTS_PATH), { recursive: true });
    await writeFile(
      STATUS_EVENTS_PATH,
      JSON.stringify({ events: [] }, null, 2),
      "utf8",
    );
  } catch {
    /* ignore */
  }
}

const QUALITY_EVENTS_PATH = path.join(
  process.cwd(),
  ".data",
  "wa_template_quality_events.json",
);

export type MetaTemplateQualityEvent = {
  message_template_id?: string;
  message_template_name?: string;
  message_template_language?: string;
  previous_quality_score?: string;
  new_quality_score?: string;
};

export async function readPendingTemplateQualityEvents(): Promise<
  MetaTemplateQualityEvent[]
> {
  try {
    const raw = await readFile(QUALITY_EVENTS_PATH, "utf8");
    const parsed = JSON.parse(raw) as { events?: MetaTemplateQualityEvent[] };
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    return [];
  }
}

export async function appendTemplateQualityEvents(
  events: MetaTemplateQualityEvent[],
): Promise<void> {
  if (!events.length) return;
  const existing = await readPendingTemplateQualityEvents();
  await mkdir(path.dirname(QUALITY_EVENTS_PATH), { recursive: true });
  await writeFile(
    QUALITY_EVENTS_PATH,
    JSON.stringify(
      { events: [...existing, ...events].slice(-500) },
      null,
      2,
    ),
    "utf8",
  );
}

export async function clearPendingTemplateQualityEvents(): Promise<void> {
  try {
    await mkdir(path.dirname(QUALITY_EVENTS_PATH), { recursive: true });
    await writeFile(
      QUALITY_EVENTS_PATH,
      JSON.stringify({ events: [] }, null, 2),
      "utf8",
    );
  } catch {
    /* ignore */
  }
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
