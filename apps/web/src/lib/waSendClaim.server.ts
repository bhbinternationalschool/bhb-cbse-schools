/**
 * Send-once claims.
 *
 * The fault this exists for: "Approve & send" on one automation card,
 * pressed seven times in seventy seconds, sent 146 families the same fee
 * reminder seven times. The route checked `status === "pending"`, then
 * dispatched for ten seconds, then wrote the new status — so all seven
 * requests passed the same check against the same stale read.
 *
 * A check that is not the write cannot exclude anybody. This turns the
 * check INTO a write: the first caller inserts (tenant, claim_key) and
 * every later caller gets a primary-key violation and is told no. The
 * database arbitrates, not the order the requests happened to arrive in.
 *
 * A claim is deliberately fail-CLOSED: if the lock table cannot be read
 * or written, nothing is sent. The cost of a false refusal is one visible
 * error and a retry; the cost of a false permit is 1,022 messages.
 */

import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";

/**
 * How long a claim may sit before another caller may take it over.
 *
 * A process that dies mid-dispatch leaves its claim behind, and a card
 * nobody can ever retry is its own kind of failure. Ten minutes is longer
 * than any dispatch this ERP performs (100 recipients per chunk, a few
 * seconds each) and shorter than a person's patience.
 */
export const SEND_CLAIM_STALE_MS = 10 * 60_000;

export type SendClaimVerdict =
  /** The claim is ours. Send. `stolen` = taken over from a dead caller. */
  | { ok: true; stolen: boolean }
  /** Somebody else is sending this right now. Do NOT send. */
  | {
      ok: false;
      reason: "held";
      claimedBy: string;
      claimedAt: string;
      message: string;
    }
  /** The lock itself is unavailable. Do NOT send. */
  | { ok: false; reason: "unavailable"; message: string };

function ageMs(claimedAt: string, now: Date): number {
  const t = Date.parse(claimedAt || "");
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return now.getTime() - t;
}

/** True when a claim is old enough that its owner is presumed gone. */
export function sendClaimIsStale(claimedAt: string, now = new Date()): boolean {
  return ageMs(claimedAt, now) >= SEND_CLAIM_STALE_MS;
}

function heldFor(claimedAt: string, now: Date): string {
  const secs = Math.max(0, Math.round(ageMs(claimedAt, now) / 1000));
  if (!Number.isFinite(secs)) return "just now";
  if (secs < 60) return `${secs}s ago`;
  return `${Math.round(secs / 60)} min ago`;
}

/**
 * Claim the right to send `key` exactly once.
 *
 * Call it BEFORE the first message leaves the building, and only send when
 * it answers `ok`.
 */
export async function claimSendOnce(
  key: string,
  by: string,
  note = "",
): Promise<SendClaimVerdict> {
  const claimKey = String(key || "").trim();
  if (!claimKey) {
    return { ok: false, reason: "unavailable", message: "Empty claim key" };
  }

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return {
      ok: false,
      reason: "unavailable",
      message: "Supabase tenant not configured — refusing to send unlocked",
    };
  }
  const { sb, tenantId } = ctx;
  const now = new Date();

  const insert = await sb.from("wa_send_claims").insert({
    tenant_id: tenantId,
    claim_key: claimKey,
    claimed_at: now.toISOString(),
    claimed_by: by || "",
    note: note.slice(0, 300),
  });
  if (!insert.error) return { ok: true, stolen: false };

  // 23505 = unique violation: somebody holds this claim.
  const code = String((insert.error as { code?: string }).code || "");
  if (code !== "23505") {
    return {
      ok: false,
      reason: "unavailable",
      message: `Send lock unavailable: ${insert.error.message}`,
    };
  }

  const existing = await sb
    .from("wa_send_claims")
    .select("claimed_at, claimed_by")
    .eq("tenant_id", tenantId)
    .eq("claim_key", claimKey)
    .maybeSingle();
  if (existing.error || !existing.data) {
    // The row vanished between the insert and this read (released by its
    // owner). Refusing is still the safe answer; the caller retries.
    return {
      ok: false,
      reason: "held",
      claimedBy: "",
      claimedAt: "",
      message: "Another send is already in progress for this item",
    };
  }

  const claimedAt = String(existing.data.claimed_at || "");
  const claimedBy = String(existing.data.claimed_by || "");
  if (!sendClaimIsStale(claimedAt, now)) {
    return {
      ok: false,
      reason: "held",
      claimedBy,
      claimedAt,
      message: `${claimedBy || "Someone"} started sending this ${heldFor(claimedAt, now)} — it is going out now, do not send it again`,
    };
  }

  // Stale: take it over, but only if nobody else does first. The `lt`
  // condition is re-checked under the row lock, so exactly one of two
  // simultaneous takeovers updates a row and the other updates none.
  const cutoff = new Date(now.getTime() - SEND_CLAIM_STALE_MS).toISOString();
  const steal = await sb
    .from("wa_send_claims")
    .update({
      claimed_at: now.toISOString(),
      claimed_by: by || "",
      note: `took over from ${claimedBy || "an interrupted send"}`,
    })
    .eq("tenant_id", tenantId)
    .eq("claim_key", claimKey)
    .lt("claimed_at", cutoff)
    .select("claim_key");
  if (steal.error) {
    return {
      ok: false,
      reason: "unavailable",
      message: `Send lock unavailable: ${steal.error.message}`,
    };
  }
  if ((steal.data?.length ?? 0) === 0) {
    return {
      ok: false,
      reason: "held",
      claimedBy,
      claimedAt,
      message: "Another send is already in progress for this item",
    };
  }
  return { ok: true, stolen: true };
}

/**
 * Give the claim back.
 *
 * Only for the cases where nothing was really sent — a dry run, or a
 * dispatch that never reached the provider — so the office can press the
 * button again. A claim behind a real send is NEVER released: that row is
 * what stops the same message going out twice.
 */
export async function releaseSendClaim(
  key: string,
): Promise<{ ok: boolean; error?: string }> {
  const claimKey = String(key || "").trim();
  if (!claimKey) return { ok: false, error: "Empty claim key" };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { error } = await ctx.sb
    .from("wa_send_claims")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("claim_key", claimKey);
  if (error) {
    console.warn("[wa-send-claim] release failed:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** The claim key for one automation approval card. */
export function automationApprovalClaimKey(approvalId: string): string {
  return `automation-approval:${approvalId}`;
}
