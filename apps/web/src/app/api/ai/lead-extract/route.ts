import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { generateLeadExtractJson, llmStatus } from "@/lib/aiLlm.server";

export const runtime = "nodejs";

/** Pasted enquiry text (email / WhatsApp / call note) → lead fields. Draft only — the counsellor ticks what to apply. */
export async function GET() {
  const s = llmStatus();
  return NextResponse.json({ service: "lead-extract", configured: s.tutorEngine !== "none", engine: s.tutorEngine, note: "POST { text }" });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  const masters = loadMasters();
  if (!hasPermission(session, masters, "admissions", "create") && !hasPermission(session, masters, "admissions", "edit")) {
    return NextResponse.json({ error: "Admissions access required" }, { status: 403 });
  }
  let body: { text?: string; classNames?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const text = String(body.text ?? "").trim();
  if (text.length < 15) return NextResponse.json({ error: "Paste the enquiry text first" }, { status: 400 });
  // Class names come from the client (the server's masters copy may be cold);
  // fall back to whatever the server has.
  const fromClient = Array.isArray(body.classNames) ? body.classNames.map((c) => String(c || "").trim().slice(0, 40)).filter(Boolean).slice(0, 40) : [];
  const classNames = fromClient.length ? fromClient : (masters.classes ?? []).filter((c) => c.isActive).sort((a, b) => a.sortOrder - b.sortOrder).map((c) => c.name);
  const r = await generateLeadExtractJson({ text: text.slice(0, 6000), classNames });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error, engine: r.engine }, { status: 502 });
  return NextResponse.json({ ok: true, extract: r.extract, engine: r.engine, generationId: r.generationId });
}
