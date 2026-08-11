/**
 * Per-contact WhatsApp reliability/compliance state — 24h session window
 * (Meta only allows free-text within 24h of the contact's last inbound
 * message; outside it a sender must use an approved template) and
 * opt-out/STOP handling. Backed by wa_contact_state (see migration
 * wa_contact_state_and_delivery_log).
 *
 * Every lookup fails OPEN: a DB error must never silently block a send or
 * silently keep sending to someone who opted out — it degrades to "allow
 * the caller's default" rather than asserting an unknown state as fact.
 */
import { getServerTenantContext } from "@/lib/serverTenant";

/** Local copy of waSend.ts's normalizer — kept independent so waSend.ts can
 * import from this module (opt-out/window checks) without a circular import. */
function toE164India(mobile: string): string {
  const d = (mobile || "").replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.startsWith("91") && d.length === 12) return d;
  return d;
}

const STOP_KEYWORDS = [
  "stop",
  "unsubscribe",
  "opt out",
  "optout",
  "opt-out",
  "band karo",
  "band kardo",
  "remove me",
];

/** Pure — an inbound message body that should be read as an opt-out request. */
export function isStopKeyword(text: string): boolean {
  const t = (text || "").trim().toLowerCase();
  if (!t) return false;
  return STOP_KEYWORDS.some((kw) => t === kw || t.startsWith(kw + " ") || t.startsWith(kw + "."));
}

/** Pure — is `lastInboundAtIso` within Meta's 24h customer-service window as of `nowIso`? */
export function within24HourWindow(
  lastInboundAtIso: string | null | undefined,
  nowIso: string,
): boolean {
  if (!lastInboundAtIso) return false;
  const last = Date.parse(lastInboundAtIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(last) || !Number.isFinite(now)) return false;
  return now - last < 24 * 60 * 60 * 1000;
}

/** Record an inbound message's arrival — refreshes the 24h window and detects STOP. */
export async function recordInboundMessage(
  fromMobile: string,
  text: string,
): Promise<void> {
  const mobile = toE164India(fromMobile);
  if (!mobile) return;
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) {
      console.warn("[waContactState] no server tenant context — skipping");
      return;
    }
    const { sb, tenantId } = ctx;
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      tenant_id: tenantId,
      mobile_e164: mobile,
      last_inbound_at: now,
      updated_at: now,
    };
    if (isStopKeyword(text)) {
      patch.opted_out_at = now;
      patch.opted_out_reason = "stop_keyword";
    }
    const { error } = await sb
      .from("wa_contact_state")
      .upsert(patch, { onConflict: "tenant_id,mobile_e164" });
    if (error) console.warn("[waContactState] upsert failed", error.message);
  } catch (e) {
    console.warn("[waContactState] recordInboundMessage failed", e);
  }
}

/** Fail open: on lookup error, default to false (not opted out) — an error is not
 * proof of consent status either way, so it must not silently suppress messaging. */
export async function isOptedOut(mobile: string): Promise<boolean> {
  const e164 = toE164India(mobile);
  if (!e164) return false;
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) return false;
    const { sb, tenantId } = ctx;
    const { data, error } = await sb
      .from("wa_contact_state")
      .select("opted_out_at")
      .eq("tenant_id", tenantId)
      .eq("mobile_e164", e164)
      .maybeSingle();
    if (error) {
      console.warn("[waContactState] isOptedOut query failed", error.message);
      return false;
    }
    return !!(data as { opted_out_at?: string | null } | null)?.opted_out_at;
  } catch (e) {
    console.warn("[waContactState] isOptedOut lookup failed", e);
    return false;
  }
}

/** Fail open: on lookup error, assume within-window so a transient DB error
 * never blocks a legitimate free-text send (caller can still fall back to a
 * template if the send itself fails outside the real window). */
export async function isWithin24HourWindow(mobile: string): Promise<boolean> {
  const e164 = toE164India(mobile);
  if (!e164) return true;
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) return true;
    const { sb, tenantId } = ctx;
    const { data, error } = await sb
      .from("wa_contact_state")
      .select("last_inbound_at")
      .eq("tenant_id", tenantId)
      .eq("mobile_e164", e164)
      .maybeSingle();
    if (error) {
      console.warn("[waContactState] isWithin24HourWindow query failed", error.message);
      return true;
    }
    const lastInboundAt = (data as { last_inbound_at?: string | null } | null)
      ?.last_inbound_at;
    return within24HourWindow(lastInboundAt, new Date().toISOString());
  } catch (e) {
    console.warn("[waContactState] isWithin24HourWindow lookup failed", e);
    return true;
  }
}
