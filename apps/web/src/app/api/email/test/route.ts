import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { isEmailAddress, type EmailPurpose } from "@/lib/email";
import { sendEmail } from "@/lib/email.server";
import { TENANT } from "@/lib/types";

export const runtime = "nodejs";

/** POST { purpose, to? } — sends a test mail (to the caller's own address by default). Masters edit. */
export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  if (!hasPermission(session, loadMasters(), "masters", "edit")) return NextResponse.json({ error: "Masters edit access required" }, { status: 403 });
  let body: { purpose?: string; to?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const to = isEmailAddress(body.to || "") ? String(body.to) : session.email || "";
  if (!isEmailAddress(to)) return NextResponse.json({ error: "Give a recipient address" }, { status: 400 });
  const purpose = (["admissions", "fees", "reports", "general"].includes(String(body.purpose)) ? body.purpose : "general") as EmailPurpose;
  const r = await sendEmail({
    purpose,
    to,
    subject: `${TENANT.shortName} ERP — test email (${purpose})`,
    text: `This is a test from the ${TENANT.nameDisplay} ERP email channel (purpose: ${purpose}).\nIf you received it, sending through Google Workspace works for this mailbox.\n\nSent by ${session.fullName} at ${new Date().toISOString()}.`,
    by: session.fullName,
    ref: "test",
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error, from: r.from }, { status: 502 });
  return NextResponse.json({ ok: true, id: r.id, from: r.from, to });
}
