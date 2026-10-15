/**
 * GET /api/data/views/staff-requests — Staff → Requests: a manager's whole
 * queue, anyone else's own requests (handler and rules:
 * lib/staffRequests.server.ts; the writes are POST /api/staff/requests).
 *
 * A static segment beside /api/data/[collection]: Next.js prefers it.
 */
import { staffRequestsViewGet } from "@/lib/staffRequests.server";
import { staffRequestsDeps } from "@/lib/staffRequestsDeps.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return staffRequestsViewGet(req, staffRequestsDeps);
}
