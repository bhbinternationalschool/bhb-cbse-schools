/** Reports and the module dashboard. */

import {
  dashboard,
  postClosingStock,
  stockValueAsOf,
  daybookReport,
  marginReport,
  purchaseReport,
  stockReport,
} from "@/lib/inventory/reports.server";
import { invBody, invQuery, invRoute } from "@/lib/inventory/route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return invRoute(req, "view", async () => {
    const q = invQuery(req);
    const report = q.get("report") ?? "dashboard";
    const from = q.get("from") ?? "";
    const to = q.get("to") ?? "";

    if (report === "margin") return marginReport(from, to);
    if (report === "daybook") return daybookReport(from, to);
    if (report === "purchases") return purchaseReport(from, to);
    if (report === "stock") {
      return stockReport(q.get("locationId") ?? "", {
        lowOnly: q.get("lowOnly") === "true",
      });
    }
    if (report === "stock-value") {
      return { valuePaise: await stockValueAsOf(q.get("asOf") ?? "") };
    }
    return { dashboard: await dashboard() };
  });
}

/** Posting the closing-stock journal writes to the books — an edit, not a view. */
export async function POST(req: Request) {
  return invRoute(req, "edit", async ({ actor }) => {
    const body = await invBody<{ asOf?: string }>(req);
    return { closingStock: await postClosingStock(String(body.asOf ?? ""), actor) };
  });
}
