/**
 * Meta WhatsApp Flows management (Graph API) — create / publish / list.
 * One-time setup per flow, not a per-request path. Mirrors
 * waTemplatesMeta.server.ts's access-token/WABA resolution.
 */

import { metaWabaIdFromEnv, resolveWhatsAppWabaId } from "@/lib/waMeta.server";

function metaAccessToken(): string {
  return process.env.WA_META_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || "";
}

function metaGraphVersion(): string {
  return (
    process.env.WA_GRAPH_API_VERSION ||
    process.env.WHATSAPP_GRAPH_VERSION ||
    "v21.0"
  );
}

export function waFlowsMetaConfigured(): boolean {
  return !!(metaAccessToken() && (metaWabaIdFromEnv() || true));
}

async function wabaId(): Promise<string> {
  return metaWabaIdFromEnv() || (await resolveWhatsAppWabaId()) || "";
}

export type MetaFlowRow = {
  id: string;
  name: string;
  status: string;
  categories?: string[];
};

export async function listMetaFlows(): Promise<
  { ok: true; rows: MetaFlowRow[] } | { ok: false; error: string }
> {
  const token = metaAccessToken();
  const waba = await wabaId();
  if (!token || !waba) {
    return { ok: false, error: "Missing WHATSAPP_TOKEN or WHATSAPP_WABA_ID" };
  }
  const version = metaGraphVersion();
  const url = `https://graph.facebook.com/${version}/${waba}/flows?fields=id,name,status,categories`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: MetaFlowRow[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return { ok: false, error: json.error?.message || `Meta HTTP ${res.status}` };
    }
    return { ok: true, rows: json.data || [] };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Meta flows list failed",
    };
  }
}

/** Create a flow (draft) with its JSON in one call. */
export async function createMetaFlow(opts: {
  name: string;
  categories: string[];
  flowJson: string;
}): Promise<{ ok: true; flowId: string } | { ok: false; error: string }> {
  const token = metaAccessToken();
  const waba = await wabaId();
  if (!token || !waba) {
    return { ok: false, error: "Missing WHATSAPP_TOKEN or WHATSAPP_WABA_ID" };
  }
  const version = metaGraphVersion();
  const url = `https://graph.facebook.com/${version}/${waba}/flows`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: opts.name,
        categories: opts.categories,
        flow_json: opts.flowJson,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      id?: string;
      error?: { message?: string; error_user_msg?: string };
    };
    if (!res.ok || !json.id) {
      return {
        ok: false,
        error:
          json.error?.error_user_msg ||
          json.error?.message ||
          `Meta HTTP ${res.status}`,
      };
    }
    return { ok: true, flowId: json.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Meta flow create failed",
    };
  }
}

export async function updateMetaFlowJson(
  flowId: string,
  flowJson: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = metaAccessToken();
  if (!token) return { ok: false, error: "Missing WHATSAPP_TOKEN" };
  const version = metaGraphVersion();
  const form = new FormData();
  form.append("name", "flow.json");
  form.append("asset_type", "FLOW_JSON");
  form.append(
    "file",
    new Blob([flowJson], { type: "application/json" }),
    "flow.json",
  );
  try {
    const res = await fetch(
      `https://graph.facebook.com/${version}/${flowId}/assets`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      error?: { message?: string };
    };
    if (!res.ok) {
      return { ok: false, error: json.error?.message || `Meta HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Meta flow JSON update failed",
    };
  }
}

export async function publishMetaFlow(
  flowId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = metaAccessToken();
  if (!token) return { ok: false, error: "Missing WHATSAPP_TOKEN" };
  const version = metaGraphVersion();
  try {
    const res = await fetch(
      `https://graph.facebook.com/${version}/${flowId}/publish`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      error?: { message?: string; error_user_msg?: string };
    };
    if (!res.ok || json.success === false) {
      return {
        ok: false,
        error:
          json.error?.error_user_msg ||
          json.error?.message ||
          `Meta HTTP ${res.status}`,
      };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Meta flow publish failed",
    };
  }
}

/** Idempotent setup: find an existing flow by name, or create + upload +
 * publish a new one. Safe to call repeatedly (e.g. from a setup script). */
export async function ensureMetaFlowPublished(opts: {
  name: string;
  categories: string[];
  flowJson: string;
}): Promise<{ ok: true; flowId: string; created: boolean } | { ok: false; error: string }> {
  const existing = await listMetaFlows();
  if (existing.ok) {
    const hit = existing.rows.find((r) => r.name === opts.name);
    if (hit) {
      if (hit.status !== "PUBLISHED") {
        const upload = await updateMetaFlowJson(hit.id, opts.flowJson);
        if (!upload.ok) return upload;
        const pub = await publishMetaFlow(hit.id);
        if (!pub.ok) return pub;
      }
      return { ok: true, flowId: hit.id, created: false };
    }
  }
  const created = await createMetaFlow({
    name: opts.name,
    categories: opts.categories,
    flowJson: opts.flowJson,
  });
  if (!created.ok) return created;
  const pub = await publishMetaFlow(created.flowId);
  if (!pub.ok) return pub;
  return { ok: true, flowId: created.flowId, created: true };
}
