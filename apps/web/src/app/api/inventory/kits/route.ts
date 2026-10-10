/** Kits — bundles of items assigned to class groups. */

import { listKits, removeKit, saveKit } from "@/lib/inventory/pricing.server";
import { invBody, invQuery, invRoute } from "@/lib/inventory/route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return invRoute(req, "view", async ({ academicYearCode }) => {
    const q = invQuery(req);
    return {
      kits: await listKits({
        academicYearCode: q.get("academicYearCode") ?? academicYearCode,
        classId: q.get("classId") ?? "",
        status: q.get("status") === "all" ? "all" : "active",
      }),
    };
  });
}

export async function POST(req: Request) {
  return invRoute(req, "edit", async ({ academicYearCode }) => {
    const body = await invBody<Parameters<typeof saveKit>[0]>(req);
    return {
      kit: await saveKit({
        ...body,
        academicYearCode: body.academicYearCode || academicYearCode,
      }),
    };
  });
}

export async function DELETE(req: Request) {
  return invRoute(req, "delete", async () => {
    const id = invQuery(req).get("id") ?? "";
    if (!id) return { deleted: false };
    await removeKit(id);
    return { deleted: true };
  });
}
