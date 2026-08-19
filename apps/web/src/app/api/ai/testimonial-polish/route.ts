import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { generateTestimonialPolishJson, llmStatus } from "@/lib/aiLlm.server";
import { testimonialPolishProblems } from "@/lib/referrals";

export const runtime = "nodejs";

/** Polish a parent's testimonial — grammar/flow only. Returns the guard's
 * problems alongside so the UI can refuse to save a polish that added content. */
export async function GET() {
  const s = llmStatus();
  return NextResponse.json({ service: "testimonial-polish", configured: s.tutorEngine !== "none", engine: s.tutorEngine, note: "POST { rawText, language? }" });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  if (!hasPermission(session, loadMasters(), "admissions", "edit")) return NextResponse.json({ error: "Admissions edit access required" }, { status: 403 });
  let body: { rawText?: string; language?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const rawText = String(body.rawText ?? "").trim().slice(0, 2000);
  if (rawText.length < 10) return NextResponse.json({ error: "Paste the parent's words first" }, { status: 400 });
  const language = body.language === "hi" || /[ऀ-ॿ]/.test(rawText) ? "hi" : "en";
  const r = await generateTestimonialPolishJson({ rawText, language, maxChars: Math.min(2000, Math.round(rawText.length * 1.2 + 40)) });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error, engine: r.engine }, { status: 502 });
  const problems = testimonialPolishProblems(rawText, r.polished);
  return NextResponse.json({ ok: true, polished: r.polished, problems, engine: r.engine, generationId: r.generationId });
}
