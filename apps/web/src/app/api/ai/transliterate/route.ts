import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { generateTransliterationJson } from "@/lib/aiLlm.server";

export const runtime = "nodejs";

/**
 * POST { texts: string[], target: "hi" | "sa" } → { texts: string[], generationId }
 *
 * Hinglish → Hindi / Sanskrit for the question-paper editor. One output per
 * input, same order; the client replaces the fields it sent and reports the
 * outcome. Nothing is saved here.
 */
export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }
  await ensureSchoolMirrorHydrated();
  if (!hasPermission(session, loadMasters(), "exams", "edit")) {
    return NextResponse.json({ error: "Exams edit permission required" }, { status: 403 });
  }
  let body: { texts?: unknown; target?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const texts = (Array.isArray(body.texts) ? body.texts : []).map((t) => String(t ?? ""));
  if (texts.length === 0 || texts.every((t) => !t.trim())) {
    return NextResponse.json({ error: "Nothing to convert" }, { status: 400 });
  }
  // Refused, never silently trimmed. This used to `.slice(0, 60)`, which
  // returned fewer lines than the caller sent — and the caller pairs the
  // answers to its fields BY POSITION, so a trimmed reply would have put
  // option (b)'s text into option (a). A question with parts, each with
  // their own options and key, passes 60 lines easily.
  if (texts.length > 200) {
    return NextResponse.json(
      { error: "Too many lines in one question — convert it in two halves" },
      { status: 400 },
    );
  }
  if (texts.join("").length > 12000) {
    return NextResponse.json({ error: "Too much text at once — convert one question at a time" }, { status: 400 });
  }
  const target = body.target === "sa" ? "sa" : "hi";
  const r = await generateTransliterationJson({ texts, target });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  let out: string[];
  try {
    const parsed = JSON.parse(r.text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as { texts?: unknown };
    out = Array.isArray(parsed.texts) ? parsed.texts.map((t) => String(t ?? "")) : [];
  } catch {
    return NextResponse.json({ error: "The model did not return the converted text" }, { status: 502 });
  }
  if (out.length !== texts.length) {
    return NextResponse.json({ error: "The model returned a different number of lines — try again" }, { status: 502 });
  }
  // Empty inputs stay empty whatever the model said.
  const texts2 = out.map((t, i) => (texts[i]!.trim() ? t : texts[i]!));
  return NextResponse.json({ texts: texts2, generationId: r.generationId, engine: r.engine });
}
