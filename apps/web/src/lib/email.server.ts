import "server-only";

/**
 * Gmail API sender (Google Workspace) — service account + domain-wide
 * delegation, impersonating the per-purpose mailbox from email settings.
 * No extra npm dependency: the JWT is signed with node:crypto.
 *
 * Env: GMAIL_SA_KEY_JSON (Secret Manager `school-erp-gmail-sa-key`) — the
 * service-account JSON key; "{}" / missing = not configured (everything
 * degrades to "Copy" in the UI). Settings + log: module_local_state
 * "email_settings" / "email_log".
 */

import { createSign } from "node:crypto";
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  buildMimeMessage,
  defaultEmailSettings,
  isEmailAddress,
  normalizeEmailSettings,
  senderFor,
  textToHtml,
  type EmailAttachment,
  type EmailLogEntry,
  type EmailPurpose,
  type EmailSettings,
} from "@/lib/email";
import { TENANT } from "@/lib/types";

const SETTINGS_KEY = "email_settings";
const LOG_KEY = "email_log";
const LOG_MAX = 2000;
const SCOPE = "https://www.googleapis.com/auth/gmail.send";

type SaKey = { client_email: string; private_key: string; token_uri?: string };

function domain(): string {
  return (TENANT.publicPortal || "bhbinternational.school").replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
}

function saKey(): SaKey | null {
  const raw = (process.env.GMAIL_SA_KEY_JSON || "").trim();
  if (!raw || raw === "{}") return null;
  try {
    const j = JSON.parse(raw) as Partial<SaKey>;
    if (!j.client_email || !j.private_key) return null;
    return { client_email: j.client_email, private_key: j.private_key.replace(/\\n/g, "\n"), token_uri: j.token_uri };
  } catch {
    return null;
  }
}

export function emailConfigured(): boolean {
  return !!saKey();
}

/* ─── Settings ─────────────────────────────────────────────────────── */

export async function readEmailSettings(): Promise<EmailSettings> {
  const ctx = await getServerTenantContext();
  if (!ctx) return defaultEmailSettings(domain());
  const { data } = await ctx.sb.from("module_local_state").select("state").eq("tenant_id", ctx.tenantId).eq("module_key", SETTINGS_KEY).maybeSingle();
  return normalizeEmailSettings(data?.state, domain());
}

export async function writeEmailSettings(next: EmailSettings): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const state = normalizeEmailSettings({ ...next, updatedAt: new Date().toISOString() }, domain());
  const { error } = await ctx.sb.from("module_local_state").upsert(
    { tenant_id: ctx.tenantId, module_key: SETTINGS_KEY, state, updated_at: new Date().toISOString() },
    { onConflict: "tenant_id,module_key" },
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* ─── Log ──────────────────────────────────────────────────────────── */

export async function readEmailLog(limit = 200): Promise<EmailLogEntry[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data } = await ctx.sb.from("module_local_state").select("state").eq("tenant_id", ctx.tenantId).eq("module_key", LOG_KEY).maybeSingle();
  const entries = Array.isArray((data?.state as { entries?: unknown } | null)?.entries) ? ((data!.state as { entries: EmailLogEntry[] }).entries) : [];
  return entries.slice(-limit).reverse();
}

async function appendEmailLog(e: EmailLogEntry): Promise<void> {
  const ctx = await getServerTenantContext();
  if (!ctx) return;
  const cur = await readEmailLog(LOG_MAX);
  const entries = [...cur.reverse(), e].slice(-LOG_MAX);
  await ctx.sb.from("module_local_state").upsert(
    { tenant_id: ctx.tenantId, module_key: LOG_KEY, state: { version: 1, entries }, updated_at: new Date().toISOString() },
    { onConflict: "tenant_id,module_key" },
  );
}

/* ─── Google token (JWT bearer, impersonating the mailbox) ─────────── */

const tokenCache = new Map<string, { token: string; exp: number }>();

function b64url(s: string | Buffer): string {
  return Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function accessTokenFor(impersonate: string): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const key = saKey();
  if (!key) return { ok: false, error: "Email not configured — GMAIL_SA_KEY_JSON missing" };
  const cached = tokenCache.get(impersonate);
  if (cached && cached.exp > Date.now() + 60_000) return { ok: true, token: cached.token };
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: key.client_email, sub: impersonate, scope: SCOPE, aud: key.token_uri || "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const sig = b64url(signer.sign(key.private_key));
  const assertion = `${header}.${claims}.${sig}`;
  try {
    const res = await fetch(key.token_uri || "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !j.access_token) {
      const hint = /unauthorized_client/.test(j.error || "")
        ? " — domain-wide delegation for this service account / gmail.send scope is not authorised in Workspace Admin, or the mailbox does not exist"
        : "";
      return { ok: false, error: `${j.error || `HTTP ${res.status}`}${j.error_description ? `: ${j.error_description}` : ""}${hint}` };
    }
    tokenCache.set(impersonate, { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 });
    return { ok: true, token: j.access_token };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "token request failed" };
  }
}

/* ─── Send ─────────────────────────────────────────────────────────── */

export type SendEmailInput = {
  purpose: EmailPurpose;
  to: string | string[];
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
  /** Who triggered it (session name) */
  by: string;
  /** Reference for the log, e.g. "lead:<id>" */
  ref?: string;
  /** Override the purpose mailbox (must still be a Workspace address) */
  fromOverride?: string;
};

export async function sendEmail(input: SendEmailInput): Promise<{ ok: true; id: string; from: string } | { ok: false; error: string; from: string }> {
  const settings = await readEmailSettings();
  const sender = senderFor(settings, input.purpose);
  const from = { address: input.fromOverride && isEmailAddress(input.fromOverride) ? input.fromOverride.toLowerCase() : sender.address, name: sender.name };
  const to = (Array.isArray(input.to) ? input.to : [input.to]).map((t) => t.trim().toLowerCase()).filter(isEmailAddress);
  const log = async (status: "sent" | "failed", detail: string) =>
    appendEmailLog({ id: `em_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), purpose: input.purpose, from: from.address, to: to.join(", "), subject: input.subject.slice(0, 160), status, detail: detail.slice(0, 300), by: input.by, ref: (input.ref || "").slice(0, 80) });
  if (!settings.enabled) return { ok: false, error: "Email channel is switched off in settings", from: from.address };
  if (!to.length) return { ok: false, error: "No valid recipient address", from: from.address };
  if (!input.subject.trim()) return { ok: false, error: "Subject required", from: from.address };
  const tok = await accessTokenFor(from.address);
  if (!tok.ok) {
    await log("failed", tok.error);
    return { ok: false, error: tok.error, from: from.address };
  }
  const text = settings.footer ? `${input.text.trimEnd()}\n\n-- \n${settings.footer}` : input.text;
  const html = input.html || textToHtml(text);
  const { raw } = buildMimeMessage({ from, to, cc: input.cc, replyTo: settings.replyTo || undefined, subject: input.subject, text, html, attachments: input.attachments });
  try {
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    const j = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!res.ok || !j.id) {
      const err = j.error?.message || `Gmail HTTP ${res.status}`;
      await log("failed", err);
      return { ok: false, error: err, from: from.address };
    }
    await log("sent", j.id);
    return { ok: true, id: j.id, from: from.address };
  } catch (e) {
    const err = e instanceof Error ? e.message : "send failed";
    await log("failed", err);
    return { ok: false, error: err, from: from.address };
  }
}

export async function emailStatus(): Promise<{ configured: boolean; enabled: boolean; senders: EmailSettings["senders"]; domain: string; serviceAccount: string }> {
  const s = await readEmailSettings();
  return { configured: emailConfigured(), enabled: s.enabled, senders: s.senders, domain: domain(), serviceAccount: saKey()?.client_email || "" };
}
