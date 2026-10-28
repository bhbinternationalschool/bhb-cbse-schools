/**
 * When a send-once claim may be taken over (lib/waSendClaim.server). Pure.
 *
 * By default a claim older than SEND_CLAIM_STALE_MS belongs to a caller
 * presumed dead and may be taken over. A caller that keeps its claim as the
 * permanent record that something WAS sent (`neverStale`, e.g. the parent
 * app invite's once-a-day key) must never have it taken over — any existing
 * row is held, whatever its age.
 */

export const SEND_CLAIM_STALE_MS = 10 * 60_000;

export function claimMayBeTakenOver(claimedAt: string, now: Date, opts?: { neverStale?: boolean }): boolean {
  if (opts?.neverStale) return false;
  const t = Date.parse(claimedAt || "");
  const age = Number.isFinite(t) ? now.getTime() - t : Number.POSITIVE_INFINITY;
  return age >= SEND_CLAIM_STALE_MS;
}
