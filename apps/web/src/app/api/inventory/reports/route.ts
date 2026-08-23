/** Reports and the module dashboard. */

import {
  dashboard,
  daybookReport,
  marginReport,
  purchaseReport,
  stockReport,
} from "@/lib/inventory/reports.server";
import { invQuery, invRoute } from "@/lib/inventory/route.server";

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
    return { dashboard: await dashboard() };
  });
}
