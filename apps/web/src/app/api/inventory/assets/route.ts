/** Asset register — tagged items and their history. */

import {
  assetHistory,
  assetSummary,
  bulkRegisterAssets,
  listAssets,
  removeAsset,
  saveAsset,
} from "@/lib/inventory/assets.server";
import { invBody, invQuery, invRoute } from "@/lib/inventory/route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return invRoute(req, "view", async () => {
    const q = invQuery(req);
    const view = q.get("view") ?? "list";
    if (view === "summary") return { summary: await assetSummary() };
    if (view === "history") {
      return { events: await assetHistory(q.get("assetId") ?? "") };
    }
    return {
      assets: await listAssets({
        search: q.get("search") ?? "",
        itemId: q.get("itemId") ?? "",
        locationId: q.get("locationId") ?? "",
        status: q.get("status") ?? "all",
      }),
    };
  });
}

type Body =
  | ({ action?: "save" } & Parameters<typeof saveAsset>[0])
  | ({ action: "bulk" } & Parameters<typeof bulkRegisterAssets>[0]);

export async function POST(req: Request) {
  return invRoute(req, "edit", async ({ actor }) => {
    const body = await invBody<Body>(req);
    if ("action" in body && body.action === "bulk") {
      return bulkRegisterAssets(
        body as Parameters<typeof bulkRegisterAssets>[0],
        actor,
      );
    }
    return { asset: await saveAsset(body as Parameters<typeof saveAsset>[0], actor) };
  });
}

export async function DELETE(req: Request) {
  return invRoute(req, "delete", async () => {
    const id = invQuery(req).get("id") ?? "";
    if (!id) return { deleted: false, reason: "No asset id given" };
    return removeAsset(id);
  });
}
