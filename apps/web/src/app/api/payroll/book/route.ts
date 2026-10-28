/**
 * Payroll's door into the server book (14 Oct 2026). See lib/payrollBook.server.
 *
 * POST {action:"recall", runId}  reverse the run's live payroll vouchers and
 *                                record the recall — before the run goes back
 *                                to draft; refused = the recall is refused
 *      {action:"post", runId}    (re)run payroll_ledger_post: accrual and the
 *                                per-day payment vouchers; idempotent
 *
 * PERMISSION. Payroll · change — the same grant that publishes a run, recalls
 * it and marks staff paid on the Payroll screen.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { postPayrollBook, recallPayrollBook } from "@/lib/payrollBook.server";

export const runtime = "nodejs";

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid JSON");
  }
  const auth = await requireStaffPermission(req, "payroll", "edit");
  if (!auth.ok) return auth.response;
  const actor = auth.viaMirrorSecret
    ? "service"
    : (auth.ctx.session.fullName || auth.ctx.session.email || "").trim() || "staff";
  const runId = String(b.runId || "").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(runId)) return bad("Pick a payroll run");

  switch (String(b.action || "")) {
    case "recall": {
      const r = await recallPayrollBook(runId, actor);
      return r.ok ? NextResponse.json(r) : bad(r.error, 409);
    }
    case "post": {
      const r = await postPayrollBook(runId, actor);
      return r.ok ? NextResponse.json(r) : bad(r.error || "the book refused this run", 409);
    }
    default:
      return bad("Unknown action");
  }
}
