/** Goods receipts — the moment stock, cost and the payable all move. */

import {
  listGoodsReceipts,
  postGoodsReceipt,
} from "@/lib/inventory/procurement.server";
import { invBody, invQuery, invRoute } from "@/lib/inventory/route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return invRoute(req, "view", async ({ academicYearCode }) => {
    const q = invQuery(req);
    return {
      receipts: await listGoodsReceipts({
        vendorId: q.get("vendorId") ?? "",
        poId: q.get("poId") ?? "",
        academicYearCode: q.get("academicYearCode") ?? academicYearCode,
      }),
    };
  });
}

export async function POST(req: Request) {
  return invRoute(req, "edit", async ({ actor, academicYearCode }) => {
    const body = await invBody<Parameters<typeof postGoodsReceipt>[0]>(req);
    return { receipt: await postGoodsReceipt(body, actor, academicYearCode) };
  });
}
