import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { runLoanTick } from "@/lib/loans.server";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Once a day (Cloud Scheduler bhb-loan-emi-tick, 09:00 IST): every loan EMI
 * whose due date has come and is not in the books, and every open
 * prepayment / top-up request, is pushed to the people who can approve it —
 * once per loan-month. It POSTS NOTHING: an EMI enters the books only when a
 * person approves it in Accounts → Loans. `?dryRun=1` lists without sending.
 */
export async function GET() {
  return NextResponse.json({ service: "loan-emi-tick", note: "POST with x-cron-secret daily; ?dryRun=1 to list without sending" });
}

export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const r = await runLoanTick({ dryRun });
  return NextResponse.json(r, { status: r.ok ? 200 : 207 });
}
