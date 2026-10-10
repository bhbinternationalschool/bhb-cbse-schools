/** Purchase orders — what we agreed to buy, at what price. */

import {
  decidePurchaseOrder,
  listPurchaseOrders,
  pendingPoLines,
  savePurchaseOrder,
} from "@/lib/inventory/procurement.server";
import { invBody, invQuery, invRoute } from "@/lib/inventory/route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return invRoute(req, "view", async ({ academicYearCode }) => {
    const q = invQuery(req);
    if (q.get("view") === "pending") {
      return {
        pendingLines: await pendingPoLines({
          vendorId: q.get("vendorId") ?? "",
          poId: q.get("poId") ?? "",
        }),
      };
    }
    return {
      orders: await listPurchaseOrders({
        status: q.get("status") ?? "all",
        vendorId: q.get("vendorId") ?? "",
        academicYearCode: q.get("academicYearCode") ?? academicYearCode,
      }),
    };
  });
}

type Body =
  | ({ action?: "save" } & Parameters<typeof savePurchaseOrder>[0])
  | { action: "decide"; id: string; decision: "submit" | "approve" | "reject" | "issue" | "cancel"; note?: string };

export async function POST(req: Request) {
  const body = await invBody<Body>(req);
  const isDecision = body && "action" in body && body.action === "decide";
  const needs =
    isDecision && ["approve", "reject"].includes((body as { decision: string }).decision)
      ? "approve"
      : "edit";

  return invRoute(req, needs, async ({ actor, academicYearCode }) => {
    if (isDecision) {
      const d = body as { id: string; decision: "submit" | "approve" | "reject" | "issue" | "cancel"; note?: string };
      return decidePurchaseOrder({ id: d.id, action: d.decision, note: d.note }, actor);
    }
    return {
      order: await savePurchaseOrder(
        body as Parameters<typeof savePurchaseOrder>[0],
        actor,
        academicYearCode,
      ),
    };
  });
}
