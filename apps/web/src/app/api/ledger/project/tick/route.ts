import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { projectAll } from "@/lib/ledger/project.server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Hourly ledger projection during school hours.
 *
 * The server book (Ledger v2) is projected from the desks: a fee receipt
 * becomes a receipt voucher, a voided receipt becomes a reversal. Until
 * 2026-09-08 the projection ran only when someone opened Accounts → Server
 * book and pressed "Project", so a void's reversal waited for that press —
 * measured over 69 voided receipts: median 3.3 hours, longest 67. A receipt
 * voided on a Friday evening sat in the bank book until Monday.
 *
 * Point Cloud Scheduler at this with `x-cron-secret`, hourly, school hours
 * (setup-cloud-scheduler.sh: bhb-ledger-project-tick). projectAll is
 * idempotent by source id, so running it again posts nothing twice.
 *
 * The tick FAILS (207) while any projector refused a record, so the refusal
 * is visible in the job history rather than sitting in a report nobody opens.
 */
export async function GET() {
  return NextResponse.json({
    service: "ledger-project-tick",
    note: "POST hourly with x-cron-secret; projects fee receipts, expense vouchers, vendor bills and payroll into the server book",
  });
}

export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const before = Date.now();
  const res = await projectAll();
  const summary = res.outcomes.map((o) => ({
    source: o.source,
    scanned: o.scanned,
    posted: o.posted,
    reversed: o.reversed,
    alreadyPosted: o.alreadyPosted,
    skipped: o.skipped,
    refused: o.refused.length,
  }));
  const refused = res.outcomes.flatMap((o) => o.refused.map((r) => ({ source: o.source, ...r })));
  if (refused.length) {
    console.warn("[ledger/project/tick] refused", JSON.stringify(refused.slice(0, 10)));
  }
  return NextResponse.json(
    { ok: res.ok, ms: Date.now() - before, summary, refused: refused.slice(0, 20) },
    { status: res.ok ? 200 : 207 },
  );
}
