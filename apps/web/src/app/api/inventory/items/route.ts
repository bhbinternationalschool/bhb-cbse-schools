/** Item catalogue — paginated server-side search, upsert, bulk edit, remove. */

import {
  bulkUpdateItems,
  listItems,
  removeItem,
  saveItem,
} from "@/lib/inventory/catalogue.server";
import { invBody, invQuery, invRoute } from "@/lib/inventory/route.server";
import type { InvItem, InvItemKind, InvItemQuery } from "@/lib/inventory/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return invRoute(req, "view", async () => {
    const q = invQuery(req);
    const status = q.get("status");
    const sort = q.get("sort");
    const query: InvItemQuery = {
      search: q.get("search") ?? "",
      categoryId: q.get("categoryId") ?? "",
      vendorId: q.get("vendorId") ?? "",
      itemKind: (q.get("itemKind") as InvItemKind | null) ?? "",
      priceListId: q.get("priceListId") ?? "",
      locationId: q.get("locationId") ?? "",
      status:
        status === "all" || status === "inactive" || status === "active"
          ? status
          : "active",
      lowStockOnly: q.get("lowStockOnly") === "true",
      page: Number(q.get("page")) || 1,
      pageSize: Number(q.get("pageSize")) || 50,
      sort: (["name", "sku", "stock", "margin", "updated"] as const).includes(
        sort as never,
      )
        ? (sort as InvItemQuery["sort"])
        : "name",
      sortDir: q.get("sortDir") === "desc" ? "desc" : "asc",
    };
    return listItems(query);
  });
}

export async function POST(req: Request) {
  return invRoute(req, "edit", async ({ actor }) => {
    const body = await invBody<
      (Partial<InvItem> & { bulk?: never }) | { bulk: Parameters<typeof bulkUpdateItems>[0] }
    >(req);
    if (body && typeof body === "object" && "bulk" in body && body.bulk) {
      return { updated: await bulkUpdateItems(body.bulk) };
    }
    return { item: await saveItem(body as Partial<InvItem>, actor) };
  });
}

export async function DELETE(req: Request) {
  return invRoute(req, "delete", async () => {
    const id = invQuery(req).get("id") ?? "";
    if (!id) return { deleted: false, reason: "No item id given" };
    return removeItem(id);
  });
}
