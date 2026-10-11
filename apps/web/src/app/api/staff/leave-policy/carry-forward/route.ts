/**
 * Year-end leave carry-forward — preview first, then commit.
 *
 * GET  ?from=2026-27&to=2027-28  what would carry (per person and type:
 *                                closing balance, cap, days), and who was
 *                                already carried
 * POST {from, to}                commit — recomputed on the server, insert
 *                                only, one row per person/type per year, so a
 *                                second press carries nothing twice
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { writeAudit } from "@/lib/audit.server";
import { readStaffHrServer } from "@/lib/api/v1/staffLeave";
import { commitCarryForward, previewCarryForward } from "@/lib/staffLeaveRules.server";

export const runtime = "nodejs";

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "view");
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const hr = await readStaffHrServer();
  if (!hr.ok) return bad("Could not read the leave desk — try again", 503);
  const plan = await previewCarryForward({
    fromAy: url.searchParams.get("from") || "",
    toAy: url.searchParams.get("to") || "",
    masters: auth.ctx.masters,
    state: hr.state,
  });
  if (!plan.ok) return bad(plan.error);
  return NextResponse.json({ ok: true, ...plan.value });
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "edit");
  if (!auth.ok) return auth.response;
  if (auth.viaMirrorSecret) return bad("The carry-forward is committed by a person", 403);
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid JSON");
  }
  const hr = await readStaffHrServer();
  if (!hr.ok) return bad("Could not read the leave desk — nothing was carried", 503);
  const fromAy = String(b.from || "");
  const toAy = String(b.to || "");
  const by = auth.ctx.session.fullName || auth.ctx.session.email || "staff";
  const r = await commitCarryForward({ fromAy, toAy, masters: auth.ctx.masters, state: hr.state, by });
  if (!r.ok) return bad(r.error);
  await writeAudit({
    session: auth.ctx.session,
    module: "staff",
    action: "edit",
    entityType: "staff_leave_carry_forward",
    entityId: `${fromAy}->${toAy}`,
    summary: `Leave carried forward ${fromAy} → ${toAy}: ${r.days} day(s) for ${r.inserted} row(s)`,
    after: r,
  });
  return NextResponse.json(r);
}
