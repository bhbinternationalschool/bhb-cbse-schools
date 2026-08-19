import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { EMAIL_PURPOSES, type EmailAttachment, type EmailPurpose } from "@/lib/email";
import { emailConfigured, sendEmail } from "@/lib/email.server";

export const runtime = "nodejs";

/** POST { purpose, to, cc?, subject, text, html?, attachments?, ref? } — staff with edit on the purpose's module. */
export async function GET() {
  return NextResponse.json({ service: "email-send", configured: emailConfigured(), purposes: EMAIL_PURPOSES.map((p) => p.id) });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  let body: { purpose?: string; to?: string | string[]; cc?: string[]; subject?: string; text?: string; html?: string; attachments?: EmailAttachment[]; ref?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const purpose = EMAIL_PURPOSES.find((p) => p.id === body.purpose);
  if (!purpose) return NextResponse.json({ error: "purpose required" }, { status: 400 });
  if (!hasPermission(session, loadMasters(), purpose.rbac, "edit")) return NextResponse.json({ error: `${purpose.label} edit access required` }, { status: 403 });
  const attachments = Array.isArray(body.attachments)
    ? body.attachments
        .filter((a) => a && a.filename && a.contentBase64 && a.contentBase64.length < 8_000_000)
        .slice(0, 5)
        .map((a) => ({ filename: String(a.filename).slice(0, 120), contentType: String(a.contentType || "application/octet-stream").slice(0, 80), contentBase64: String(a.contentBase64) }))
    : undefined;
  const r = await sendEmail({
    purpose: purpose.id as EmailPurpose,
    to: body.to || "",
    cc: Array.isArray(body.cc) ? body.cc.slice(0, 10) : undefined,
    subject: String(body.subject || "").slice(0, 200),
    text: String(body.text || "").slice(0, 20000),
    html: body.html ? String(body.html).slice(0, 60000) : undefined,
    attachments,
    by: session.fullName,
    ref: body.ref,
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error, from: r.from }, { status: 502 });
  return NextResponse.json({ ok: true, id: r.id, from: r.from });
}
