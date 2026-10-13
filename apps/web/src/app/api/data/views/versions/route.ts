/**
 * GET /api/data/views/versions — the one change signal (data-layer 1.3).
 *
 * A static segment beside /api/data/[collection]: Next.js prefers it, so this
 * path never reaches the collection handler (which would answer 404
 * "Unknown collection"). Gate: resolveApiAuth — a staff or parent session
 * (or an API key), the guard every /api/v1 GET uses. The handler is
 * lib/data/server/versionsRoute.ts.
 */
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { readErpVersions } from "@/lib/data/server/versions";
import { versionsGet } from "@/lib/data/server/versionsRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return versionsGet(req, { auth: (r) => resolveApiAuth(r), read: readErpVersions });
}
