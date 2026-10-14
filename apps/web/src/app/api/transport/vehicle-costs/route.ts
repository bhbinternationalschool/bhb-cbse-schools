/**
 * GET /api/transport/vehicle-costs — what the Vehicle 360 card and the fleet
 * reports read (lib/transportVehicleCosts): every fuel-register fill with its
 * accounts status, every vehicle paper, and — for someone who may see loan
 * balances — the ledger's vehicle loans with every EMI posted.
 *
 * transport · view (or the Vehicles / Reports function). Loan figures are a
 * position figure, so they follow /api/transport/vehicle-loans: Accounts ·
 * view AND Accounts position · view; without both, `loans.known` is false and
 * the screens say "unknown" rather than ₹0.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { hasPermission } from "@/lib/rbac";
import { readVehicleCosts } from "@/lib/transportVehicleCosts.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;
  const mayReadLoans =
    auth.viaMirrorSecret ||
    (hasPermission(auth.ctx.session, auth.ctx.masters, "accounts", "view", auth.ctx.rbac) &&
      hasPermission(auth.ctx.session, auth.ctx.masters, "accounts_position", "view", auth.ctx.rbac));
  const costs = await readVehicleCosts({ mayReadLoans });
  return NextResponse.json({ ok: true, ...costs }, { headers: { "cache-control": "no-store" } });
}
