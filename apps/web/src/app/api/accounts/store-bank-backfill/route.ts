/**
 * The store's historical bank movements, for the desk bank book to mirror.
 *
 * GET only, and it writes nothing: the desk bank ledger is localStorage-first
 * and a push deletes rows whose ids it does not carry, so only the browser may
 * write these. This hands over the plan; the client applies it.
 *
 * `view` rights are enough — reading what the book already says is not data
 * entry, and the write that follows happens in the desk under the operator's
 * own session.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { buildStoreBankBackfillPlan } from "@/lib/accountsStoreBankBackfill.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "accounts", "view");
  if (!auth.ok) return auth.response;

  const plan = await buildStoreBankBackfillPlan();
  return NextResponse.json(plan, { status: plan.ok ? 200 : 502 });
}
