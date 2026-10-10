/**
 * Inbound WhatsApp media (photos/PDFs parents send — Aadhaar, birth cert,
 * payment proof) — records a lightweight reference row (never the bytes
 * themselves; those stay on Meta's CDN and are fetched on demand) so staff
 * can review/OCR-verify them later. Backed by wa_inbound_media.
 *
 * Recording an inbound media reference must never block or fail the
 * webhook's existing bot-reply flow — every write here fails open (logs
 * a warning, never throws), same discipline as waContactState.server.ts.
 */
import { getServerTenantContext } from "@/lib/serverTenant";
import { toE164India } from "@/lib/waContactState.server";
import {
  metaAccessToken,
  metaGraphVersion,
} from "@/lib/waSend";
import type { WaInboundMediaRef } from "@/lib/waCrmBotServer";
import type { DocVerificationOcrResult } from "@/lib/docVerificationOcr";

export type WaInboundMediaRow = {
  id: string;
  waMessageId: string | null;
  mobileE164: string;
  contactName: string | null;
  mediaId: string;
  mediaType: "image" | "document" | "video" | "audio";
  mimeType: string | null;
  filename: string | null;
  caption: string | null;
  householdId: string | null;
  receivedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  ocrResult: DocVerificationOcrResult | null;
};

function mapRow(r: Record<string, unknown>): WaInboundMediaRow {
  return {
    id: String(r.id),
    waMessageId: (r.wa_message_id as string) ?? null,
    mobileE164: String(r.mobile_e164),
    contactName: (r.contact_name as string) ?? null,
    mediaId: String(r.media_id),
    mediaType: r.media_type as WaInboundMediaRow["mediaType"],
    mimeType: (r.mime_type as string) ?? null,
    filename: (r.filename as string) ?? null,
    caption: (r.caption as string) ?? null,
    householdId: (r.household_id as string) ?? null,
    receivedAt: String(r.received_at),
    reviewedAt: (r.reviewed_at as string) ?? null,
    reviewedBy: (r.reviewed_by as string) ?? null,
    ocrResult: (r.ocr_result as DocVerificationOcrResult) ?? null,
  };
}

/** Fail-open — a lookup/insert error here must never block the webhook's
 * bot-reply loop, so every path logs and returns rather than throwing. */
export async function recordInboundMedia(opts: {
  fromMobile: string;
  waMessageId?: string;
  contactName?: string;
  caption?: string;
  householdId?: string | null;
  media: WaInboundMediaRef;
}): Promise<void> {
  const mobile = toE164India(opts.fromMobile);
  if (!mobile || !opts.media.mediaId) return;
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) {
      console.warn("[waInboundMedia] no server tenant context — skipping");
      return;
    }
    const { sb, tenantId } = ctx;
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      tenant_id: tenantId,
      wa_message_id: opts.waMessageId || null,
      mobile_e164: mobile,
      contact_name: opts.contactName || null,
      media_id: opts.media.mediaId,
      media_type: opts.media.mediaType,
      mime_type: opts.media.mimeType || null,
      filename: opts.media.filename || null,
      caption: opts.caption || null,
      household_id: opts.householdId || null,
      received_at: now,
      updated_at: now,
    };
    const { error } = opts.waMessageId
      ? await sb
          .from("wa_inbound_media")
          .upsert(row, { onConflict: "tenant_id,wa_message_id" })
      : await sb.from("wa_inbound_media").insert(row);
    if (error) console.warn("[waInboundMedia] insert failed", error.message);
  } catch (e) {
    console.warn("[waInboundMedia] recordInboundMedia failed", e);
  }
}

export async function listInboundMedia(opts?: {
  onlyPending?: boolean;
  limit?: number;
}): Promise<WaInboundMediaRow[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { sb, tenantId } = ctx;
  let query = sb
    .from("wa_inbound_media")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("received_at", { ascending: false })
    .limit(opts?.limit ?? 100);
  if (opts?.onlyPending) query = query.is("reviewed_at", null);
  const { data, error } = await query;
  if (error) {
    console.warn("[waInboundMedia] list failed", error.message);
    return [];
  }
  return (data || []).map(mapRow);
}

export async function markInboundMediaReviewed(
  id: string,
  reviewedBy: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const { sb, tenantId } = ctx;
  const { error } = await sb
    .from("wa_inbound_media")
    .update({
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewedBy,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function saveInboundMediaOcrResult(
  id: string,
  result: DocVerificationOcrResult,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const { sb, tenantId } = ctx;
  const { error } = await sb
    .from("wa_inbound_media")
    .update({ ocr_result: result, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function getInboundMediaById(
  id: string,
): Promise<WaInboundMediaRow | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { sb, tenantId } = ctx;
  const { data, error } = await sb
    .from("wa_inbound_media")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return mapRow(data);
}

/** Downloads a WhatsApp media object from Meta's Graph API (2-step: resolve
 * the temporary CDN URL, then fetch the bytes with the same bearer token)
 * and returns it as a data: URL ready to hand to Vision OCR or an <img>. */
export async function fetchWaMediaAsDataUrl(
  mediaId: string,
): Promise<
  | { ok: true; dataUrl: string; mimeType: string }
  | { ok: false; error: string }
> {
  const token = metaAccessToken();
  if (!token) return { ok: false, error: "WhatsApp access token not configured" };
  const version = metaGraphVersion();
  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/${version}/${mediaId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const metaJson = (await metaRes.json().catch(() => ({}))) as {
      url?: string;
      mime_type?: string;
      error?: { message?: string };
    };
    if (!metaRes.ok || !metaJson.url) {
      return {
        ok: false,
        error: metaJson.error?.message || `Media lookup HTTP ${metaRes.status}`,
      };
    }
    const fileRes = await fetch(metaJson.url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!fileRes.ok) {
      return { ok: false, error: `Media download HTTP ${fileRes.status}` };
    }
    const buf = Buffer.from(await fileRes.arrayBuffer());
    const mimeType = metaJson.mime_type || "application/octet-stream";
    return {
      ok: true,
      dataUrl: `data:${mimeType};base64,${buf.toString("base64")}`,
      mimeType,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Media download failed",
    };
  }
}
