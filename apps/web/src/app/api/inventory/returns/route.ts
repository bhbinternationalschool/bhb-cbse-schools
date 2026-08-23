/** Purchase returns — goods going back to the vendor, with a debit note. */

import {
  listPurchaseReturns,
  postPurchaseReturn,
} from "@/lib/inventory/procurement.server";
import { invBody, invQuery, invRoute } from "@/lib/inventory/route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return invRoute(req, "view", async () => ({
    returns: await listPurchaseReturns({
      vendorId: invQuery(req).get("vendorId") ?? "",
    }),
  }));
}

export async function POST(req: Request) {
  return invRoute(req, "edit", async ({ actor, academicYearCode }) => {
    const body = await invBody<Parameters<typeof postPurchaseReturn>[0]>(req);
    return { return: await postPurchaseReturn(body, actor, academicYearCode) };
  });
}
