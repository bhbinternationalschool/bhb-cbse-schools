import "server-only";

import {
  writeFeeAdjustmentsLocalRaw,
  type FeeAdjustment,
} from "@/lib/feeAdjustments";
import { readModuleLocalState } from "@/lib/moduleLocalState.server";

/**
 * Pull the posted fee adjustments into the server's memory copy.
 *
 * The adjustments desk is a localStorage-first module that syncs to
 * `module_local_state`. Nothing server-side ever read it back, so waivers
 * posted from the adjustments screen, "stop future fees" decisions and
 * ad-hoc charges were invisible to every server-side dues calculation —
 * the reminders, the pay links, the parent app and the principal cockpit.
 *
 * A failed read is UNKNOWN, never "no adjustments": on failure the memory
 * copy is left exactly as it was, so a transient Supabase error cannot make
 * a family's waiver disappear and re-bill them.
 */

let lastPullMs = 0;
let inFlight: Promise<boolean> | null = null;
const TTL_MS = 60_000;

export async function ensureFeeAdjustmentsHydratedServer(opts?: {
  force?: boolean;
}): Promise<boolean> {
  if (typeof window !== "undefined") return false;
  if (!opts?.force && Date.now() - lastPullMs < TTL_MS) return false;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const remote = await readModuleLocalState<{ rows?: FeeAdjustment[] }>(
        "fee_adjustments",
      );
      // null = the read failed. Keep what we have.
      if (!remote) return false;
      const rows = Array.isArray(remote.state?.rows) ? remote.state.rows : [];
      writeFeeAdjustmentsLocalRaw({ rows });
      lastPullMs = Date.now();
      return true;
    } catch (e) {
      console.warn(
        "[feeAdjustments] server hydrate failed:",
        e instanceof Error ? e.message : e,
      );
      return false;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Tests and the rebuild button: forget the TTL so the next call pulls. */
export function resetFeeAdjustmentsServerCache(): void {
  lastPullMs = 0;
}
