import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
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

/** POST { source?: "notices" | "admissions_kb" } — default notices (original behaviour). */
export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
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
    if (!hasPermission(session, masters, "admissions", "edit")) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
    const r = await indexAdmissionsKb();
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
    return NextResponse.json(r);
  }
  if (!hasPermission(session, masters, "notices", "edit")) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const r = await indexPublishedNotices();
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
  }
  return NextResponse.json(r);
}
