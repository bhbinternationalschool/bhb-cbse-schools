/** Price lists — what the school charges, per item, per year. */

import {
  clearPrice,
  copyPriceList,
  listPriceListItems,
  removePriceList,
  savePriceList,
  savePrices,
} from "@/lib/inventory/pricing.server";
import { invBody, invQuery, invRoute } from "@/lib/inventory/route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return invRoute(req, "view", async () => {
    const listId = invQuery(req).get("priceListId") ?? "";
    if (!listId) return { items: [] };
    return { items: await listPriceListItems(listId) };
  });
}

type PricesBody =
  | { action: "saveList"; list: Parameters<typeof savePriceList>[0] }
  | { action: "savePrices"; priceListId: string; rows: Parameters<typeof savePrices>[0]["rows"] }
  | { action: "copy"; fromId: string; toId: string; markupPct?: number; overwrite?: boolean };

export async function POST(req: Request) {
  return invRoute(req, "edit", async () => {
    const body = await invBody<PricesBody>(req);
    if (body.action === "saveList") {
      return { list: await savePriceList(body.list ?? {}) };
    }
    if (body.action === "copy") {
      return {
        copied: await copyPriceList({
          fromId: body.fromId,
          toId: body.toId,
          markupPct: body.markupPct,
          overwrite: body.overwrite,
        }),
      };
    }
    return {
      saved: await savePrices({
        priceListId: body.priceListId,
        rows: body.rows ?? [],
      }),
    };
  });
}

export async function DELETE(req: Request) {
  return invRoute(req, "delete", async () => {
    const q = invQuery(req);
    const listId = q.get("priceListId") ?? "";
    const itemId = q.get("itemId") ?? "";
    if (listId && itemId) {
      await clearPrice(listId, itemId);
      return { cleared: true };
    }
    if (listId) {
      await removePriceList(listId);
      return { deleted: true };
    }
    return { deleted: false };
  });
}
