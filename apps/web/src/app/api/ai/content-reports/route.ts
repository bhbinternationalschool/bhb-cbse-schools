/**
 * The school's side of AI content reports: read the queue, close an item.
 *
 * Staff only, and scoped to this tenant by the server helpers. Reports are
 * written by parents, so their text is untrusted input — it is rendered as
 * data in the desk and never interpreted as an instruction.
 */

import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import {
  listAiContentReports,
  setAiContentReportStatus,
} from "@/lib/aiContentReports.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }
  const status = new URL(req.url).searchParams.get("status") === "all" ? "all" : "open";
  const reports = await listAiContentReports({ status });
  return NextResponse.json({ ok: true, reports });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }
  let body: { id?: unknown; status?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = String(body.id ?? "").trim();
  const status = body.status;
  if (!/^air_[a-z0-9]{8,32}$/i.test(id)) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  if (status !== "reviewed" && status !== "dismissed") {
    return NextResponse.json(
      { error: "status must be reviewed | dismissed" },
      { status: 400 },
    );
  }
  const r = await setAiContentReportStatus({
    id,
    status,
    reviewedBy: session.fullName || "Staff",
    note: String(body.note ?? ""),
  });
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
