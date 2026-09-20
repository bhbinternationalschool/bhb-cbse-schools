import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import { indexPublishedNotices, schoolKbStats } from "@/lib/schoolKb.server";
import { indexAdmissionsKb } from "@/lib/admissionsKb.server";

export const runtime = "nodejs";

export async function GET() {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }
  const stats = await schoolKbStats();
  return NextResponse.json({ ok: true, ...stats });
}

/**
 * POST { source?: "notices" | "admissions_kb" } — default notices (original
 * behaviour).
 *
 * Also runs from Cloud Scheduler with `x-cron-secret` (21 Sep 2026). This
 * was staff-only and called by nothing, so it had never run: the parent
 * bot's shelf held zero chunks while two notices sat published, and the
 * model was correctly answering "I don't have that information" to
 * everything it was not handed. A knowledge base that only fills when
 * somebody remembers to press a button is a knowledge base that is empty.
 */
export async function POST(req: Request) {
  const byCron = requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"]);
  const session = byCron ? null : await getDemoSession();
  if (!byCron && (!session || session.persona !== "staff")) {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }
  let source = "notices";
  try {
    const body = (await req.json()) as { source?: string };
    if (body?.source === "admissions_kb") source = "admissions_kb";
  } catch {
    /* no body → notices */
  }
  const masters = loadMasters();
  if (source === "admissions_kb") {
    if (!byCron && !hasPermission(session!, masters, "admissions", "edit")) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
    const r = await indexAdmissionsKb();
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
    return NextResponse.json(r);
  }
  if (!byCron && !hasPermission(session!, masters, "notices", "edit")) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const r = await indexPublishedNotices();
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
  }
  return NextResponse.json(r);
}
