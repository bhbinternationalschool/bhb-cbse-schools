/**
 * A per-IP sliding window, as a factory.
 *
 * lib/mapsRateLimit.ts is the same idea hard-wired to one bucket at 30/min.
 * It is left alone deliberately: it guards the PAID Google proxies, it works,
 * and changing it to prove a point about duplication is not worth the risk to
 * a live path. New callers use this instead, and each gets its OWN bucket —
 * which is the substantive reason this exists rather than a re-export. The
 * public enquiry form geocodes an address AND looks up a PIN; sharing one
 * window would let the map calls spend the form's budget and leave a parent
 * staring at a field that silently stopped filling itself.
 *
 * In-memory, so on Cloud Run with several instances the window is per
 * instance rather than global — enough to blunt casual abuse, not enough to
 * be airtight. An airtight limit needs a shared store, and these endpoints
 * (free, public, keyless) are not worth one.
 */

export type RateLimiter = (req: Request) => boolean;

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function createRateLimiter(opts: {
  windowMs: number;
  max: number;
}): RateLimiter {
  const hits = new Map<string, number[]>();
  return function limited(req: Request): boolean {
    const key = clientIp(req);
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < opts.windowMs);
    if (recent.length >= opts.max) {
      hits.set(key, recent);
      return true;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) {
      // Cheap sweep so the map cannot grow without bound on a long-lived instance.
      for (const [k, v] of hits) {
        if (v.every((t) => now - t > opts.windowMs)) hits.delete(k);
      }
    }
    return false;
  };
}
