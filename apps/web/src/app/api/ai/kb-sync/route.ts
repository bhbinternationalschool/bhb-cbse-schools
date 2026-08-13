import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { indexPublishedNotices, schoolKbStats } from "@/lib/schoolKb.server";

export const runtime = "nodejs";

export async function GET() {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }
  const stats = await schoolKbStats();
  return NextResponse.json({ ok: true, ...stats });
}

export async function POST() {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }
  const masters = loadMasters();
  if (!hasPermission(session, masters, "notices", "edit")) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const r = await indexPublishedNotices();
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
  }
  return NextResponse.json(r);
}
