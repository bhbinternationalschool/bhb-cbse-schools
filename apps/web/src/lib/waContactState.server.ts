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
 * import from this module (opt-out/window checks) without a circular import.
 * Exported so callers needing to match numbers against listOptedOutSet's
 * keys can normalize identically. */
export function toE164India(mobile: string): string {
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

/**
 * How long a "not on WhatsApp" verdict holds before one send is allowed to
 * test it again. A phone that was off for a month, or a family who has only
 * just installed WhatsApp, is not written off for ever: after this, the next
 * message goes, and if it fails too the verdict is simply written again.
 */
export const UNREACHABLE_VERDICT_DAYS = 30;

/**
 * Pure — should a send to this number be skipped because we already know it
 * cannot receive WhatsApp?
 *
 * WHY (director, 21 Sep 2026): 27 numbers were marked `on_whatsapp = false`
 * by Meta's own "Message undeliverable" — 229 failures between them, not one
 * delivery ever — and every sender went on messaging them, because the only
 * thing any sender consulted was the opt-out column. The verdict was
 * detected, stored, shown on a desk panel, and read by nothing that sends.
 * Fourteen of them were messaged again the day this was found.
 *
 * Skipping them is not about the bill. It is that a template to a dead
 * number is ACCEPTED by Meta and only fails later, by webhook — so
 * `sendWaWithFailover` saw success and never tried the family's other
 * number. Seven children had a second parent on WhatsApp and heard nothing,
 * because the first number "worked".
 *
 * Three conditions, all needed:
 *  - the verdict says not on WhatsApp (null is "never checked", which is
 *    not the same thing and never blocks);
 *  - it is recent — see UNREACHABLE_VERDICT_DAYS;
 *  - the number has not written to us SINCE. A number that messages the
 *    school is on WhatsApp, whatever an older verdict said.
 */
export function unreachableVerdictApplies(
  state: {
    onWhatsApp: boolean | null | undefined;
    checkedAt: string | null | undefined;
    lastInboundAt: string | null | undefined;
  },
  nowIso: string,
): boolean {
  if (state.onWhatsApp !== false) return false;
  const checked = Date.parse(String(state.checkedAt ?? ""));
  const now = Date.parse(nowIso);
  // A verdict with no readable date is not a fact about today.
  if (!Number.isFinite(checked) || !Number.isFinite(now)) return false;
  if (now - checked > UNREACHABLE_VERDICT_DAYS * 24 * 60 * 60 * 1000) return false;
  const inbound = Date.parse(String(state.lastInboundAt ?? ""));
  if (Number.isFinite(inbound) && inbound > checked) return false;
  return true;
}

/**
 * Why a send to this number must not go, if it must not — one query for
 * both reasons, so the send path pays for one round trip, not two.
 *
 * Fails OPEN like every lookup in this file: an unreadable row is not
 * evidence of anything, and must not silence a family.
 */
export async function sendBlockFor(
  mobile: string,
): Promise<{ reason: "opted_out" | "not_on_whatsapp"; error: string } | null> {
  const e164 = toE164India(mobile);
  if (!e164) return null;
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) return null;
    const { data, error } = await ctx.sb
      .from("wa_contact_state")
      .select("opted_out_at, on_whatsapp, wa_checked_at, last_inbound_at")
      .eq("tenant_id", ctx.tenantId)
      .eq("mobile_e164", e164)
      .maybeSingle();
    if (error) {
      console.warn("[waContactState] sendBlockFor query failed", error.message);
      return null;
    }
    const row = data as {
      opted_out_at?: string | null;
      on_whatsapp?: boolean | null;
      wa_checked_at?: string | null;
      last_inbound_at?: string | null;
    } | null;
    if (!row) return null;
    if (row.opted_out_at) return { reason: "opted_out", error: "Contact has opted out (STOP)" };
    if (
      unreachableVerdictApplies(
        { onWhatsApp: row.on_whatsapp, checkedAt: row.wa_checked_at, lastInboundAt: row.last_inbound_at },
        new Date().toISOString(),
      )
    ) {
      return {
        reason: "not_on_whatsapp",
        // Worded for the office reading the sent-messages log: what it is,
        // and what to do. The number-health desk lists these families.
        error: "Not sent — this number is not on WhatsApp (Meta: undeliverable). Update the family's number.",
      };
    }
    return null;
  } catch (e) {
    console.warn("[waContactState] sendBlockFor lookup failed", e);
    return null;
  }
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

/** Batch form of isOptedOut — one query for many numbers instead of one
 * round trip per number (a broadcast to hundreds of households must not
 * serialize hundreds of sequential DB calls). Fails open: a query error
 * returns an empty set (nobody excluded) rather than blocking the caller. */
export async function listOptedOutSet(mobiles: string[]): Promise<Set<string>> {
  const e164s = Array.from(
    new Set(mobiles.map(toE164India).filter((m): m is string => !!m)),
  );
  if (e164s.length === 0) return new Set();
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) return new Set();
    const { sb, tenantId } = ctx;
    const { data, error } = await sb
      .from("wa_contact_state")
      .select("mobile_e164")
      .eq("tenant_id", tenantId)
      .not("opted_out_at", "is", null)
      .in("mobile_e164", e164s);
    if (error) {
      console.warn("[waContactState] listOptedOutSet query failed", error.message);
      return new Set();
    }
    return new Set(
      (data as { mobile_e164: string }[]).map((r) => r.mobile_e164),
    );
  } catch (e) {
    console.warn("[waContactState] listOptedOutSet lookup failed", e);
    return new Set();
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
