/** Stock — balances, item stock card, opening entry, adjustment, transfer. */

import {
  adjustToCount,
  balances,
  setOpeningStock,
  stockCard,
  transferStock,
  valuation,
} from "@/lib/inventory/stock.server";
import { invBody, invQuery, invRoute } from "@/lib/inventory/route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return invRoute(req, "view", async () => {
    const q = invQuery(req);
    const view = q.get("view") ?? "balances";
    const locationId = q.get("locationId") ?? "";

    if (view === "card") {
      return stockCard(q.get("itemId") ?? "", { locationId });
    }
    if (view === "valuation") {
      return valuation({ locationId });
    }
    const ids = (q.get("itemIds") ?? "").split(",").filter(Boolean);
    return { balances: await balances({ itemIds: ids, locationId }) };
  });
}

type StockBody =
  | { action: "opening"; itemId: string; locationId: string; qty: number; unitCostPaise?: number; at?: string; note?: string }
  | { action: "adjust"; itemId: string; locationId: string; countedQty: number; reason: string; at?: string }
  | { action: "transfer"; itemId: string; fromLocationId: string; toLocationId: string; qty: number; note?: string; at?: string };

export async function POST(req: Request) {
  return invRoute(req, "edit", async ({ actor }) => {
    const body = await invBody<StockBody>(req);
    if (body.action === "adjust") return adjustToCount(body, actor);
    if (body.action === "transfer") return transferStock(body, actor);
    return setOpeningStock(body, actor);
  });
}
