/**
 * GET /api/data/views/masters — full Masters, or the teaching subset by permission (the masters-desk rule)
 * (data-layer 1.4, reference view; handler and rules: lib/data/server/views.ts).
 *
 * A static segment beside /api/data/[collection]: Next.js prefers it, so this
 * path never reaches the collection handler.
 */
import { mastersViewGet } from "@/lib/data/server/views";
import { viewDeps } from "@/lib/data/server/viewDeps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return mastersViewGet(req, viewDeps);
}
