/**
 * GET /api/staff/leave-book?ay=2026-27 — the year's leave book under its
 * leave rules: per member of staff and paid type, opening (carried in),
 * allocated, taken (sandwich days shown apart), pending and balance, with
 * month-end balances April → March. Feeds Staff → Leave rules → Reports.
 *
 * { ok: true, policy: false } = the year has no policy (not "no leave").
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { readStaffHrServer } from "@/lib/api/v1/staffLeave";
import { buildLeaveBook } from "@/lib/staffLeaveRules.server";
import { ayMonths, monthEndBalances } from "@/lib/staffLeaveRules";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "view");
  if (!auth.ok) return auth.response;
  const ay = new URL(req.url).searchParams.get("ay") || auth.ctx.session.academicYearCode;
  if (!/^\d{4}-\d{2}$/.test(ay)) return NextResponse.json({ ok: false, error: "Unknown academic year" }, { status: 400 });
  const hr = await readStaffHrServer();
  if (!hr.ok) return NextResponse.json({ ok: false, error: "Could not read the leave desk — try again" }, { status: 503 });
  const res = await buildLeaveBook({ ay, masters: auth.ctx.masters, state: hr.state });
  if (!res.ok) return NextResponse.json({ ok: false, error: `Could not read the leave policy: ${res.error}` }, { status: 503 });
  if (!res.value) return NextResponse.json({ ok: true, ay, policy: false });
  const rows = res.value.book
    .filter((r) => r.governed)
    .map((r) => ({
      staffId: r.staffId,
      typeCode: r.typeCode,
      opening: r.opening,
      allocated: r.allocated,
      allocationSource: r.allocationSource,
      taken: r.taken,
      sandwichDays: r.sandwichDays,
      pending: r.pending,
      balance: r.balance,
      months: monthEndBalances(r, ay),
    }));
  // Unpaid leave taken (LWP) per person, for the summary.
  const unpaid = res.value.book
    .filter((r) => !r.paid && r.taken > 0)
    .map((r) => ({ staffId: r.staffId, typeCode: r.typeCode, taken: r.taken }));
  return NextResponse.json({
    ok: true,
    ay,
    policy: true,
    months: ayMonths(ay),
    types: res.value.policy.types.map((t) => t.typeCode).filter((c) => res.value!.deskTypes.find((d) => d.code === c)?.paid),
    rows,
    unpaid,
  });
}
