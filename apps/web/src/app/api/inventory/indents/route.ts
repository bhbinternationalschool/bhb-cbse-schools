/** Indents — a department asking for something. */

import { decideIndent, listIndents, saveIndent } from "@/lib/inventory/procurement.server";
import { invBody, invQuery, invRoute } from "@/lib/inventory/route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return invRoute(req, "view", async ({ academicYearCode }) => {
    const q = invQuery(req);
    return {
      indents: await listIndents({
        status: q.get("status") ?? "all",
        academicYearCode: q.get("academicYearCode") ?? academicYearCode,
      }),
    };
  });
}

type Body =
  | ({ action?: "save" } & Parameters<typeof saveIndent>[0])
  | { action: "decide"; id: string; decision: "submit" | "approve" | "reject" | "cancel"; note?: string };

export async function POST(req: Request) {
  const body = await invBody<Body>(req);
  const isDecision = body && "action" in body && body.action === "decide";

  // Approving is a distinct permission from raising a request.
  const needs =
    isDecision && ["approve", "reject"].includes((body as { decision: string }).decision)
      ? "approve"
      : "edit";

  return invRoute(req, needs, async ({ actor, academicYearCode }) => {
    if (isDecision) {
      const d = body as { id: string; decision: "submit" | "approve" | "reject" | "cancel"; note?: string };
      return decideIndent({ id: d.id, action: d.decision, note: d.note }, actor);
    }
    return {
      indent: await saveIndent(
        body as Parameters<typeof saveIndent>[0],
        actor,
        academicYearCode,
      ),
    };
  });
}
