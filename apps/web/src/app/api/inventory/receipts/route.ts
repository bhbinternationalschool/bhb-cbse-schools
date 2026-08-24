/** Goods receipts — the moment stock, cost and the payable all move. */

import {
  amendGoodsReceipt,
  listGoodsReceipts,
  postGoodsReceipt,
  voidGoodsReceipt,
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
    const body = await invBody<
      | Parameters<typeof postGoodsReceipt>[0]
      | { amend: Parameters<typeof amendGoodsReceipt>[0] }
    >(req);
    if (body && typeof body === "object" && "amend" in body) {
      return { amended: await amendGoodsReceipt(body.amend, actor) };
    }
    return {
      receipt: await postGoodsReceipt(
        body as Parameters<typeof postGoodsReceipt>[0],
        actor,
        academicYearCode,
      ),
    };
  });
}

/** Cancelling is its own verb, not an edit that happens to zero things out. */
export async function DELETE(req: Request) {
  return invRoute(req, "delete", async ({ actor }) => {
    const q = invQuery(req);
    return {
      voided: await voidGoodsReceipt(
        q.get("id") ?? "",
        q.get("reason") ?? "",
        actor,
      ),
    };
  });
}
