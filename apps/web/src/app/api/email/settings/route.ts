import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { EMAIL_PURPOSES, normalizeEmailSettings, type EmailSettings } from "@/lib/email";
import { emailStatus, readEmailLog, readEmailSettings, writeEmailSettings } from "@/lib/email.server";

export const runtime = "nodejs";

/** GET: settings + status + recent log (staff). PUT: settings (masters edit). */
export async function GET() {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  const [settings, status, log] = await Promise.all([readEmailSettings(), emailStatus(), readEmailLog(100)]);
  return NextResponse.json({ ok: true, settings, status, log, purposes: EMAIL_PURPOSES });
}

export async function PUT(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  if (!hasPermission(session, loadMasters(), "masters", "edit")) return NextResponse.json({ error: "Masters edit access required" }, { status: 403 });
  let body: Partial<EmailSettings>;
  try {
    body = (await req.json()) as Partial<EmailSettings>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const next = normalizeEmailSettings({ ...body, updatedBy: session.fullName });
  const r = await writeEmailSettings(next);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
  return NextResponse.json({ ok: true, settings: next });
}
