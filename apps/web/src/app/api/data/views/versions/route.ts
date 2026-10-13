/**
 * GET /api/data/views/versions — the one change signal (data-layer 1.3).
 *
 * A static segment beside /api/data/[collection]: Next.js prefers it, so this
 * path never reaches the collection handler (which would answer 404
 * "Unknown collection"). The handler is lib/data/server/versionsRoute.ts.
 */
import { versionsGet } from "@/lib/data/server/versionsRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return versionsGet(req);
}
