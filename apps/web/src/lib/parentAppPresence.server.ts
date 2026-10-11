import "server-only";

import { appBuildFromHeaders } from "@/lib/appMinBuild";
import { getServerTenantContext } from "@/lib/serverTenant";

/**
 * "This family opened the parent app" — one row per household in
 * parent_app_presence, for Comms → Parents on app.
 *
 * Called from the app's home-screen request (GET /api/v1/parent/summary).
 * At most one write per family per hour per server instance, so an app that
 * refreshes its home screen all day costs one small upsert an hour. Only the
 * time and the app build are kept — no device, IP or user agent.
 *
 * Never throws and never fails the parent's request: a missed stamp only
 * makes the report a little stale. It is awaited by the caller because
 * Cloud Run throttles CPU once the response has gone.
 */

const STAMP_EVERY_MS = 60 * 60_000;
const lastStamp = new Map<string, number>();

/** True when this household was stamped less than an hour ago (this instance). */
export function presenceStampedRecently(householdId: string, nowMs = Date.now()): boolean {
  const at = lastStamp.get(householdId);
  return at != null && nowMs - at < STAMP_EVERY_MS;
}

export async function stampParentAppPresence(householdId: string, request: Request): Promise<void> {
  if (!householdId || presenceStampedRecently(householdId)) return;
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) return;
    const { flavor, build } = appBuildFromHeaders(request.headers);
    // Parent sessions are minted only by the app's OTP login, so a parent
    // request is the parent app — older builds just do not say their flavor.
    if (flavor === "staff") return;
    // first_seen_at is left to its insert default; an upsert only updates the
    // columns it sends, so the first time a family opened the app is kept.
    const { error } = await ctx.sb.from("parent_app_presence").upsert(
      {
        tenant_id: ctx.tenantId,
        household_id: householdId,
        last_seen_at: new Date().toISOString(),
        // An unknown build never overwrites a known one.
        ...(build != null ? { app_build: build } : {}),
      },
      { onConflict: "tenant_id,household_id" },
    );
    // A failure waits for the next hour too: a missing table (migration not
    // applied yet) must not add a failed write to every home-screen load.
    lastStamp.set(householdId, Date.now());
    if (error) console.warn("[parent-app-presence] stamp failed:", error.message);
  } catch (e) {
    console.warn("[parent-app-presence] stamp failed:", e instanceof Error ? e.message : e);
  }
}
