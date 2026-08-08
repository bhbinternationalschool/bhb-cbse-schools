/**
 * Lightweight per-IP rate limit for the Maps proxy routes.
 *
 * These routes are reachable by unauthenticated visitors on purpose — the
 * public admission enquiry form uses address autocomplete before anyone
 * has logged in — so they can't be gated behind staff auth. This limiter
 * is the mitigation for the paid-API quota-abuse risk instead.
 *
 * In-memory only: on Cloud Run with multiple instances this window isn't
 * shared, so the effective limit is per-instance, not global. Good enough
 * to blunt casual/scripted abuse; a real fix needs a shared store
 * (Redis/Memorystore) if this ever needs to be airtight.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

const hits = new Map<string, number[]>();

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function mapsRateLimited(req: Request): boolean {
  const key = clientIp(req);
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    // cheap cleanup so this map doesn't grow unbounded on a long-lived instance
    for (const [k, v] of hits) {
      if (v.every((t) => now - t > WINDOW_MS)) hits.delete(k);
    }
  }
  return false;
}
