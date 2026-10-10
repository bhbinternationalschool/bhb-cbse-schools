/** Vendors — the single vendor record shared by purchase and accounts. */

import {
  listVendors,
  removeVendor,
  saveVendor,
} from "@/lib/inventory/catalogue.server";
import { vendorDues } from "@/lib/inventory/procurement.server";
import { invBody, invQuery, invRoute } from "@/lib/inventory/route.server";
import type { InvVendor } from "@/lib/inventory/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return invRoute(req, "view", async () => {
    const q = invQuery(req);
    // The Accounts screens ask for dues: vendor detail beside the balance the
    // ledger is authoritative for.
    if (q.get("view") === "dues") return { dues: await vendorDues() };
    const status = q.get("status");
    return {
      vendors: await listVendors({
        search: q.get("search") ?? "",
        status:
          status === "all" || status === "inactive" || status === "active"
            ? status
            : "active",
      }),
    };
  });
}

export async function POST(req: Request) {
  return invRoute(req, "edit", async ({ actor }) => {
    const body = await invBody<Partial<InvVendor>>(req);
    return { vendor: await saveVendor(body, actor) };
  });
}

export async function DELETE(req: Request) {
  return invRoute(req, "delete", async () => {
    const id = invQuery(req).get("id") ?? "";
    if (!id) return { deleted: false, reason: "No vendor id given" };
    return removeVendor(id);
  });
}
