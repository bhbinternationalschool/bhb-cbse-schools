import "server-only";

/**
 * Canva Connect API — the school's one connection (public.canva_connection).
 *
 * OAuth 2.0 authorization code + PKCE (S256). The client id/secret are the
 * school's own integration from the Canva Developer Portal, entered in the
 * ERP by an admin; the grant is made once by whoever owns the school's Canva
 * for Education account.
 *
 * Two Canva facts shape this file:
 *  - access tokens last 4 hours, and refresh tokens are SINGLE-USE. Two
 *    processes refreshing with the same refresh token: one wins, the other
 *    gets invalid_grant. So a refresh compare-and-swaps the stored refresh
 *    token, and a loser re-reads the row instead of declaring the connection
 *    dead.
 *  - everything that makes something (asset upload, autofill, export) is an
 *    async job you poll.
 */

import { createHash, randomBytes } from "node:crypto";
import { getServerTenantContext } from "@/lib/serverTenant";
import { CANVA_SCOPES, type CanvaDataset } from "@/lib/canvaBirthday";

const API = "https://api.canva.com/rest/v1";
const AUTHORIZE = "https://www.canva.com/api/oauth/authorize";

export function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://bhbinternational.school").replace(/\/$/, "");
}

export function canvaRedirectUri(): string {
  return `${appBase()}/api/integrations/canva/callback`;
}

type Row = {
  client_id: string;
  client_secret: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scopes: string;
  connected_by: string;
  connected_at: string | null;
};

async function ctx() {
  const c = await getServerTenantContext();
  if (!c) throw new Error("Tenant not configured");
  return c;
}

async function readRow(): Promise<Row | null> {
  const { sb, tenantId } = await ctx();
  const { data, error } = await sb.from("canva_connection").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new Error(`Canva connection read failed: ${error.message}`);
  return (data as Row | null) ?? null;
}

export type CanvaStatus = {
  configured: boolean;
  connected: boolean;
  connectedBy: string;
  connectedAt: string;
  scopes: string[];
  missingScopes: string[];
  redirectUri: string;
};

export async function canvaStatus(): Promise<CanvaStatus> {
  const row = await readRow();
  const scopes = (row?.scopes || "").split(/\s+/).filter(Boolean);
  return {
    configured: !!(row?.client_id && row?.client_secret),
    connected: !!row?.refresh_token,
    connectedBy: row?.connected_by || "",
    connectedAt: row?.connected_at || "",
    scopes,
    missingScopes: row?.refresh_token ? CANVA_SCOPES.filter((s) => !scopes.includes(s)) : [],
    redirectUri: canvaRedirectUri(),
  };
}

/** Save the integration's credentials. A new client id drops any old grant — it belonged to the old integration. */
export async function saveCanvaClient(clientId: string, clientSecret: string): Promise<void> {
  const { sb, tenantId } = await ctx();
  const prev = await readRow();
  const sameClient = prev?.client_id === clientId;
  const { error } = await sb.from("canva_connection").upsert(
    {
      tenant_id: tenantId,
      client_id: clientId,
      client_secret: clientSecret,
      ...(sameClient ? {} : { access_token: "", refresh_token: "", scopes: "", connected_by: "", connected_at: null }),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) throw new Error(error.message);
}

export async function disconnectCanva(): Promise<void> {
  const { sb, tenantId } = await ctx();
  const { error } = await sb
    .from("canva_connection")
    .update({ access_token: "", refresh_token: "", scopes: "", connected_by: "", connected_at: null, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
}

/* ─── OAuth ─────────────────────────────────────────────────────────── */

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = b64url(randomBytes(48)); // 64 chars, within 43–128
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge, state: b64url(randomBytes(24)) };
}

export async function canvaAuthorizeUrl(challenge: string, state: string): Promise<string> {
  const row = await readRow();
  if (!row?.client_id) throw new Error("Save the Canva client ID and secret first");
  const p = new URLSearchParams({
    code_challenge: challenge,
    code_challenge_method: "s256",
    scope: CANVA_SCOPES.join(" "),
    response_type: "code",
    client_id: row.client_id,
    state,
    redirect_uri: canvaRedirectUri(),
  });
  return `${AUTHORIZE}?${p.toString()}`;
}

type TokenReply = { access_token: string; refresh_token: string; expires_in: number; scope?: string };

async function tokenRequest(row: Pick<Row, "client_id" | "client_secret">, body: Record<string, string>): Promise<TokenReply> {
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${row.client_id}:${row.client_secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<TokenReply> & { error?: string; error_description?: string; message?: string };
  if (!res.ok || !json.access_token || !json.refresh_token) {
    throw new Error(`Canva token ${body.grant_type} failed (${res.status}): ${json.error_description || json.error || json.message || "no token"}`);
  }
  return json as TokenReply;
}

export async function completeCanvaConnect(code: string, verifier: string, connectedBy: string): Promise<void> {
  const row = await readRow();
  if (!row?.client_id || !row.client_secret) throw new Error("Canva client ID and secret are not saved");
  const t = await tokenRequest(row, {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: canvaRedirectUri(),
  });
  const { sb, tenantId } = await ctx();
  const now = new Date();
  const { error } = await sb
    .from("canva_connection")
    .update({
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: new Date(now.getTime() + (t.expires_in || 14400) * 1000).toISOString(),
      scopes: t.scope || CANVA_SCOPES.join(" "),
      connected_by: connectedBy,
      connected_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
}

/** A live access token, refreshing (compare-and-swap) when it is within a minute of expiry. */
async function accessToken(force = false): Promise<string> {
  const row = await readRow();
  if (!row?.refresh_token) throw new Error("Canva is not connected");
  if (!force && row.access_token && new Date(row.expires_at).getTime() - Date.now() > 60_000) return row.access_token;

  let t: TokenReply;
  try {
    t = await tokenRequest(row, { grant_type: "refresh_token", refresh_token: row.refresh_token });
  } catch (e) {
    // Lost a race: another process already spent this refresh token.
    const again = await readRow();
    if (again?.refresh_token && again.refresh_token !== row.refresh_token) return again.access_token;
    throw e;
  }
  const { sb, tenantId } = await ctx();
  const { data, error } = await sb
    .from("canva_connection")
    .update({
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: new Date(Date.now() + (t.expires_in || 14400) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("refresh_token", row.refresh_token)
    .select("tenant_id");
  if (error) throw new Error(`Canva token save failed: ${error.message}`);
  if (!data?.length) {
    const again = await readRow();
    if (again?.access_token) return again.access_token;
  }
  return t.access_token;
}

async function canvaFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let token = await accessToken();
  const go = (tok: string) => fetch(`${API}${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } });
  let res = await go(token);
  if (res.status === 401) {
    token = await accessToken(true);
    res = await go(token);
  }
  return res;
}

async function canvaJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await canvaFetch(path, init);
  const json = (await res.json().catch(() => ({}))) as T & { message?: string; code?: string };
  if (!res.ok) throw new Error(`Canva ${init.method || "GET"} ${path.split("?")[0]} → ${res.status}: ${json.message || json.code || "error"}`);
  return json;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll an async Canva job until success/failure; ~90 s ceiling. */
async function pollJob<J extends { status: string; error?: { message?: string; code?: string } }>(
  path: string,
  pick: (body: Record<string, unknown>) => J,
): Promise<J> {
  for (let i = 0, wait = 800; i < 40; i += 1, wait = Math.min(wait * 1.4, 4000)) {
    const job = pick(await canvaJson<Record<string, unknown>>(path));
    if (job.status === "success") return job;
    if (job.status === "failed") throw new Error(`Canva job failed: ${job.error?.message || job.error?.code || "unknown"}`);
    await sleep(wait);
  }
  throw new Error("Canva job timed out");
}

/* ─── API calls ─────────────────────────────────────────────────────── */

export async function getCanvaDesign(designId: string): Promise<{ id: string; title: string; editUrl: string }> {
  const j = await canvaJson<{ design: { id: string; title?: string; urls?: { edit_url?: string } } }>(`/designs/${encodeURIComponent(designId)}`);
  return { id: j.design.id, title: j.design.title || "", editUrl: j.design.urls?.edit_url || "" };
}

export async function getCanvaDesignDataset(designId: string): Promise<CanvaDataset> {
  const j = await canvaJson<{ dataset?: CanvaDataset }>(`/designs/${encodeURIComponent(designId)}/dataset`);
  return j.dataset || {};
}

export async function uploadCanvaAsset(bytes: Uint8Array, name: string): Promise<string> {
  const meta = JSON.stringify({ name_base64: Buffer.from(name.slice(0, 50)).toString("base64") });
  const created = await canvaJson<{ job: { id: string } }>("/asset-uploads", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "Asset-Upload-Metadata": meta },
    body: Buffer.from(bytes),
  });
  const job = await pollJob(`/asset-uploads/${created.job.id}`, (b) => (b as { job: { status: string; asset?: { id: string }; error?: { message?: string } } }).job);
  const id = (job as { asset?: { id: string } }).asset?.id;
  if (!id) throw new Error("Canva asset upload returned no asset");
  return id;
}

export type CanvaAutofillData = Record<string, { type: "text"; text: string } | { type: "image"; asset_id: string }>;

/**
 * Fill a copy of the source design. `usesRemaining` is Canva's
 * trial_information — present when the account's plan meters autofill —
 * so the office hears about a limit before the morning it runs out.
 */
export async function autofillCanvaDesign(
  sourceDesignId: string,
  title: string,
  data: CanvaAutofillData,
): Promise<{ designId: string; usesRemaining: number | null }> {
  const created = await canvaJson<{ job: { id: string } }>("/autofills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "create_from_design", design_id: sourceDesignId, title: title.slice(0, 255), data }),
  });
  type AutofillJob = {
    status: string;
    result?: { design?: { id: string }; trial_information?: { uses_remaining?: number } };
    error?: { message?: string };
  };
  const job = await pollJob(`/autofills/${created.job.id}`, (b) => (b as { job: AutofillJob }).job);
  const id = (job as AutofillJob).result?.design?.id;
  if (!id) throw new Error("Canva autofill returned no design");
  const left = (job as AutofillJob).result?.trial_information?.uses_remaining;
  return { designId: id, usesRemaining: typeof left === "number" ? left : null };
}

export async function exportCanvaPng(designId: string): Promise<Uint8Array> {
  const created = await canvaJson<{ job: { id: string } }>("/exports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ design_id: designId, format: { type: "png", pages: [1] } }),
  });
  const job = await pollJob(`/exports/${created.job.id}`, (b) => (b as { job: { status: string; urls?: string[]; error?: { message?: string } } }).job);
  const url = (job as { urls?: string[] }).urls?.[0];
  if (!url) throw new Error("Canva export returned no file");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Canva export download failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}
