/**
 * Visiting staff month work sheets (director, 11 Oct 2026). See
 * lib/visitingPay.server.
 *
 * GET  ?month=YYYY-MM            visiting staff + that month's sheets
 *      ?id=                      one sheet with its lines and history
 *      ?from=YYYY-MM&to=YYYY-MM  the Visiting pay report
 * POST {action:"build", staffId, month}             build, or refresh a draft
 *      {action:"adjust", sheetId, lineId, qty, reason}
 *      {action:"remove", sheetId, lineId, reason}
 *      {action:"add", sheetId, date, qty, note, reason}
 *      {action:"approve", sheetId}
 *      {action:"reopen", sheetId, reason}
 *      {action:"pay_hand", sheetId, mode:"cash"|"bank", date, ref, bankLedgerCode?}
 *      {action:"pay_cashfree", sheetId, channel?:"transfer"|"link"}
 *      {action:"refresh_payout", sheetId}
 *
 * PERMISSION. Payroll — these people are paid instead of payroll: view to
 * read, edit to build and change sheets, approve to approve / reopen / pay
 * (the same grant that pays staff salary from the Cashfree wallet). The
 * person who built or changed a sheet does not approve it, unless they are
 * the owner.
 *
 * The tab lives on the Staff screen, so read / build / correct also take
 * Staff (view / change) — the module grant, or its function
 * staff.visiting_pay (lib/rbacFeatureCatalog/people.ts lists this route, so
 * requireStaffPermission accepts it). Payroll view / change holders keep
 * everything they had (PR #562). Approve, reopen and pay stay Payroll
 * (approve) only — the money rule.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission, type RouteAuthResult } from "@/lib/apiRouteAuth.server";
import { isSuperAdminSession } from "@/lib/superAdmin";
import {
  addLine,
  adjustLine,
  approveSheet,
  buildSheet,
  getSheet,
  listSheets,
  listVisitingStaff,
  payBanks,
  payByHand,
  removeLine,
  reopenSheet,
} from "@/lib/visitingPay.server";
import { actorKey, isMonthKey } from "@/lib/visitingPay";

export const runtime = "nodejs";

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

/** Staff (module or staff.visiting_pay) for `action`, else Payroll as before. */
async function staffOrPayroll(req: Request, action: "view" | "edit"): Promise<RouteAuthResult> {
  const staff = await requireStaffPermission(req, "staff", action);
  if (staff.ok) return staff;
  const payroll = await requireStaffPermission(req, "payroll", action);
  if (payroll.ok) return payroll;
  // Not a signed-in member of staff: pass that answer on; else name both doors.
  if (staff.response.status !== 403) return staff;
  return {
    ok: false,
    response: NextResponse.json(
      { error: `Forbidden — needs Staff (${action}) or Payroll (${action})` },
      { status: 403 },
    ),
  };
}

export async function GET(req: Request) {
  const auth = await staffOrPayroll(req, "view");
  if (!auth.ok) return auth.response;
  const q = new URL(req.url).searchParams;
  const id = (q.get("id") || "").trim();
  if (id) {
    const r = await getSheet(id);
    if (!r.ok) return bad(r.error, r.error === "No such sheet" ? 404 : 500);
    let payout = null;
    if (r.sheet.payoutRequestId) {
      const { getPayoutRequest } = await import("@/lib/payoutRequests.server");
      payout = await getPayoutRequest(r.sheet.payoutRequestId);
    }
    return NextResponse.json({ ok: true, sheet: r.sheet, lines: r.lines, audit: r.audit, payout });
  }
  const from = (q.get("from") || "").trim();
  const to = (q.get("to") || "").trim();
  if (from || to) {
    if (!isMonthKey(from) || !isMonthKey(to) || from > to) return bad("Pick a from and to month");
    const r = await listSheets({ fromMonth: from, toMonth: to });
    return r.ok ? NextResponse.json({ ok: true, sheets: r.sheets }) : bad(r.error, 500);
  }
  const month = (q.get("month") || "").trim();
  if (!isMonthKey(month)) return bad("Pick a month");
  const [staff, sheets, banks] = await Promise.all([listVisitingStaff(), listSheets({ month }), payBanks()]);
  if (!staff.ok) return bad(staff.error, 500);
  if (!sheets.ok) return bad(sheets.error, 500);
  const session = auth.viaMirrorSecret ? null : auth.ctx.session;
  return NextResponse.json({
    ok: true,
    staff: staff.staff,
    sheets: sheets.sheets,
    banks,
    me: session ? session.fullName || session.email || "" : "",
    isOwner: session ? isSuperAdminSession(session) : false,
  });
}

export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid JSON");
  }
  const action = String(b.action || "");
  const needsApprove = ["approve", "reopen", "pay_hand", "pay_cashfree", "refresh_payout"].includes(action);
  const auth = needsApprove
    ? await requireStaffPermission(req, "payroll", "approve")
    : await staffOrPayroll(req, "edit");
  if (!auth.ok) return auth.response;
  if (auth.viaMirrorSecret) return bad("Work sheets are changed by a person, not a service", 403);
  const session = auth.ctx.session;
  const who = (session.fullName || session.email || "").trim();
  if (!who) return bad("Your login has no name to record against this change", 403);
  // Maker ≠ checker compares this, never the display name.
  const byKey = actorKey({ staffId: session.staffId, email: session.email });
  if (!byKey) return bad("Your login is not linked to a staff record or an email — it cannot change work sheets", 403);
  const isOwner = isSuperAdminSession(session);
  const sheetId = String(b.sheetId || "").trim();
  const reply = (r: { ok: boolean; error?: string }) => NextResponse.json(r, { status: r.ok ? 200 : 400 });

  switch (action) {
    case "build":
      return reply(await buildSheet({ staffId: String(b.staffId || ""), month: String(b.month || ""), by: who, byKey }));
    case "adjust":
      return reply(await adjustLine({ sheetId, lineId: String(b.lineId || ""), qty: Number(b.qty), reason: String(b.reason || ""), by: who, byKey }));
    case "remove":
      return reply(await removeLine({ sheetId, lineId: String(b.lineId || ""), reason: String(b.reason || ""), by: who, byKey }));
    case "add":
      return reply(
        await addLine({ sheetId, date: String(b.date || ""), qty: Number(b.qty), note: String(b.note || ""), reason: String(b.reason || ""), by: who, byKey }),
      );
    case "approve":
      return reply(await approveSheet({ sheetId, by: who, byKey, byOwner: isOwner }));
    case "reopen":
      return reply(await reopenSheet({ sheetId, reason: String(b.reason || ""), by: who, byKey }));
    case "pay_hand": {
      const mode = b.mode === "bank" ? "bank" : b.mode === "cash" ? "cash" : null;
      if (!mode) return bad("Choose cash or bank");
      return reply(
        await payByHand({ sheetId, mode, date: String(b.date || ""), ref: String(b.ref || ""), bankLedgerCode: String(b.bankLedgerCode || ""), by: who }),
      );
    }
    case "pay_cashfree": {
      const { prepareVisitingFeePayment } = await import("@/lib/payoutRequests.server");
      const channel = b.channel === "link" ? "link" : b.channel === "transfer" ? "transfer" : "";
      return reply(await prepareVisitingFeePayment({ sheetId, channel, requestedBy: who, requestedByOwner: isOwner }));
    }
    case "refresh_payout": {
      const r = await getSheet(sheetId);
      if (!r.ok) return bad(r.error);
      if (!r.sheet.payoutRequestId) return bad("No Cashfree payment on this sheet");
      const { refreshPayoutRequest } = await import("@/lib/payoutRequests.server");
      const payout = await refreshPayoutRequest(r.sheet.payoutRequestId);
      return NextResponse.json({ ok: true, payout });
    }
    default:
      return bad("Unknown action");
  }
}
