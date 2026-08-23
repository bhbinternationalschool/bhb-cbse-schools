/** Counter sales — post, collect, return, cancel. */

import {
  collectOnSale,
  counterPrices,
  counterSummary,
  listSaleReturns,
  listSales,
  postSale,
  postSaleReturn,
  storeDuesForStudents,
  voidSale,
} from "@/lib/inventory/sales.server";
import { invBody, invQuery, invRoute } from "@/lib/inventory/route.server";
import type { InvBuyerKind, InvSaleQuery } from "@/lib/inventory/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return invRoute(req, "view", async () => {
    const q = invQuery(req);
    const view = q.get("view") ?? "list";

    if (view === "summary") return { summary: await counterSummary() };
    if (view === "returns") {
      return { returns: await listSaleReturns({ saleId: q.get("saleId") ?? "" }) };
    }
    if (view === "dues") {
      return {
        dues: await storeDuesForStudents(
          (q.get("studentIds") ?? "").split(",").filter(Boolean),
        ),
      };
    }
    if (view === "prices") {
      return {
        prices: await counterPrices(
          (q.get("itemIds") ?? "").split(",").filter(Boolean),
          q.get("priceListId") ?? "",
        ),
      };
    }

    const status = q.get("status");
    const query: InvSaleQuery = {
      search: q.get("search") ?? "",
      buyerKind: (q.get("buyerKind") as InvBuyerKind | null) ?? "",
      status: (status as InvSaleQuery["status"]) ?? "all",
      studentId: q.get("studentId") ?? "",
      fromDate: q.get("fromDate") ?? "",
      toDate: q.get("toDate") ?? "",
      page: Number(q.get("page")) || 1,
      pageSize: Number(q.get("pageSize")) || 50,
    };
    return listSales(query);
  });
}

type Body =
  | ({ action?: "sell" } & Parameters<typeof postSale>[0])
  | ({ action: "collect" } & Parameters<typeof collectOnSale>[0])
  | ({ action: "return" } & Parameters<typeof postSaleReturn>[0])
  | { action: "void"; saleId: string; reason: string };

export async function POST(req: Request) {
  const body = await invBody<Body>(req);
  const action = "action" in body && body.action ? body.action : "sell";

  // Cancelling a posted sale reverses stock and money — a heavier permission
  // than ringing one up.
  const needs = action === "void" ? "void" : "edit";

  return invRoute(req, needs, async ({ actor, academicYearCode }) => {
    if (action === "collect") {
      return collectOnSale(body as Parameters<typeof collectOnSale>[0], actor);
    }
    if (action === "return") {
      return {
        return: await postSaleReturn(
          body as Parameters<typeof postSaleReturn>[0],
          actor,
          academicYearCode,
        ),
      };
    }
    if (action === "void") {
      const v = body as { saleId: string; reason: string };
      return voidSale(v.saleId, v.reason, actor);
    }
    return {
      sale: await postSale(
        body as Parameters<typeof postSale>[0],
        actor,
        academicYearCode,
      ),
    };
  });
}
