/** Categories, units of measurement and stock locations. */

import { removeMaster, saveMaster } from "@/lib/inventory/catalogue.server";
import { invBody, invQuery, invRoute } from "@/lib/inventory/route.server";
import { INV_MASTER_KINDS, type InvMasterKind } from "@/lib/inventory/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseKind(raw: unknown): InvMasterKind {
  const k = String(raw ?? "");
  return (INV_MASTER_KINDS as readonly string[]).includes(k)
    ? (k as InvMasterKind)
    : "category";
}

export async function POST(req: Request) {
  return invRoute(req, "edit", async () => {
    const body = await invBody<{ kind?: string } & Record<string, unknown>>(req);
    return { row: await saveMaster(parseKind(body.kind), body) };
  });
}

export async function DELETE(req: Request) {
  return invRoute(req, "delete", async () => {
    const q = invQuery(req);
    const id = q.get("id") ?? "";
    if (!id) return { deleted: false, reason: "No id given" };
    return removeMaster(parseKind(q.get("kind")), id);
  });
}
