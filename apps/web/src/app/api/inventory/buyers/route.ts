/** Buyer lookup for the counter — the student roster, read server-side. */

import { findStudents } from "@/lib/inventory/sales.server";
import { invQuery, invRoute } from "@/lib/inventory/route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return invRoute(req, "view", async ({ academicYearCode }) => {
    const q = invQuery(req);
    return {
      students: await findStudents(
        q.get("search") ?? "",
        q.get("academicYearCode") ?? academicYearCode,
      ),
    };
  });
}
