/**
 * Library fines — the list still owed, collect (a Ledger v2 receipt) or
 * waive (with a reason). The amount always comes from the loan as the
 * server worked it out at return; the browser never sends one.
 */

import { invBody, invRoute } from "@/lib/inventory/route.server";
import { InvError } from "@/lib/inventory/db.server";
import { collectFine, pendingFines, waiveFine } from "@/lib/libraryCounter.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return invRoute(req, "view", async () => ({ fines: await pendingFines() }));
}

export async function POST(req: Request) {
  const body = await req
    .clone()
    .json()
    .catch(() => ({}) as Record<string, unknown>);
  const action = String((body as { action?: unknown }).action ?? "");
  // Forgiving money is an approval, not an edit.
  const rbac = action === "waive" ? "approve" : "edit";
  return invRoute(req, rbac, async ({ actor }) => {
    const b = await invBody<Record<string, unknown>>(req);
    const issueId = String(b.issueId ?? "");
    if (!issueId) throw new InvError("Choose a loan");
    if (action === "collect") {
      return collectFine({
        issueId,
        mode: String(b.mode ?? ""),
        ref: typeof b.ref === "string" ? b.ref : "",
        date: typeof b.date === "string" && b.date ? b.date : undefined,
        collectedBy: actor,
      });
    }
    if (action === "waive") {
      return waiveFine({ issueId, reason: String(b.reason ?? ""), waivedBy: actor });
    }
    throw new InvError("Unknown action");
  });
}
