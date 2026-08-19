import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { llmStatus } from "@/lib/aiLlm.server";
import {
  admissionsKbIndexedCount,
  answerAdmissionsQuestion,
  clearKbGap,
  listKbGaps,
} from "@/lib/admissionsKb.server";
import { TENANT } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST — answer a prospective parent's question from the admissions KB.
 * Public on purpose (the chat widget runs before any login), so: 10-digit
 * mobile required, per-IP window, and the answer is KB-grounded or a fixed
 * handoff — there is nothing here a script can extract that the school
 * did not approve for the public.
 * GET  — staff: indexed count + unanswered questions (KB gaps).
 * DELETE — staff: dismiss one gap.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
const hits = new Map<string, number[]>();
function limited(req: Request): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t > WINDOW_MS)) hits.delete(k);
  return false;
}

async function staffSession() {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") return null;
  const masters = loadMasters();
  if (!hasPermission(session, masters, "admissions", "view")) return null;
  return session;
}

export async function GET() {
  const session = await staffSession();
  if (!session) return NextResponse.json({ error: "Admissions access required" }, { status: 403 });
  const status = llmStatus();
  const [indexed, gaps] = await Promise.all([admissionsKbIndexedCount(), listKbGaps()]);
  return NextResponse.json({
    ok: true,
    service: "admissions-answer",
    configured: status.tutorEngine !== "none",
    engine: status.tutorEngine,
    indexed,
    gaps,
  });
}

export async function POST(req: Request) {
  if (limited(req)) return NextResponse.json({ error: "Too many questions — try again in a minute" }, { status: 429 });
  let body: { question?: string; mobile?: string; language?: string; staffTest?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const question = String(body.question ?? "").trim().slice(0, 600);
  if (question.length < 3) return NextResponse.json({ error: "Ask a question" }, { status: 400 });
  // Unset → detected from the question script (Hindi → Hindi reply).
  const language = body.language === "hi" ? "hi" : body.language === "en" ? "en" : undefined;

  let channel: "widget" | "staff_test" = "widget";
  if (body.staffTest) {
    const session = await staffSession();
    if (!session) return NextResponse.json({ error: "Admissions access required" }, { status: 403 });
    channel = "staff_test";
  } else {
    const mobile = String(body.mobile ?? "").replace(/\D/g, "");
    if (mobile.length !== 10) return NextResponse.json({ error: "10-digit mobile required" }, { status: 400 });
  }

  const a = await answerAdmissionsQuestion({
    question,
    channel,
    language,
    registerUrl: `https://${(TENANT.publicPortal || "bhbinternational.school").replace(/^https?:\/\//, "").replace(/\/$/, "")}/register?src=wa_crm_chat`,
  });
  return NextResponse.json({
    ok: true,
    grounded: a.grounded,
    reply: a.reply,
    sources: a.sources,
    engine: a.engine,
    generationId: a.generationId,
    matches: a.matches,
  });
}

export async function DELETE(req: Request) {
  const session = await staffSession();
  if (!session) return NextResponse.json({ error: "Admissions access required" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await clearKbGap(id);
  return NextResponse.json({ ok: true });
}
