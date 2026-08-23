/** Vendor bills and payments. */

import {
  listVendorBills,
  recordVendorPayment,
} from "@/lib/inventory/procurement.server";
import { invBody, invQuery, invRoute } from "@/lib/inventory/route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return invRoute(req, "view", async () => {
    const q = invQuery(req);
    return {
      bills: await listVendorBills({
        vendorId: q.get("vendorId") ?? "",
        status: q.get("status") ?? "all",
      }),
    };
  });
}

export async function POST(req: Request) {
  return invRoute(req, "edit", async ({ actor }) => {
    const body = await invBody<Parameters<typeof recordVendorPayment>[0]>(req);
    // The document number now comes from the bill's own academic year inside
    // the RPC, so the route no longer supplies one.
    return recordVendorPayment(body, actor);
  });
}
