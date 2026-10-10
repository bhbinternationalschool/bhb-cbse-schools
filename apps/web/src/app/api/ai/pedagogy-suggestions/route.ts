/**
 * Teaching moves from item-score roll-ups — draft only. The client sends
 * the weak / strong buckets it computed (lib/itemAnalytics.ts) with a
 * couple of sample question stems each; the model returns 3–6 concrete
 * classroom moves and a remedial focus. No student data leaves the browser.
 */

import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { TENANT } from "@/lib/types";
import { generatePedagogyJson, llmStatus } from "@/lib/aiLlm.server";
import { geminiModel } from "@/lib/erpAiGemini.server";
import { openAiModel } from "@/lib/openAi.server";
import { cleanPedagogyFacts } from "@/lib/itemAnalytics";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const status = llmStatus();
  return NextResponse.json({
    service: "pedagogy-suggestions",
    llmConfigured: status.primaryEngine !== "none",
    primaryEngine: status.primaryEngine,
    note: "POST { language?: en|hi, facts: PedagogyFacts } — staff with exams:edit; returns { suggestions[], remedialFocus }; saves nothing",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }
  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();
  if (!hasPermission(session, masters, "exams", "edit")) {
    return NextResponse.json({ error: "Exams edit permission required" }, { status: 403 });
  }
  let body: { language?: unknown; facts?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const facts = cleanPedagogyFacts(body.facts);
  if (!facts) {
    return NextResponse.json({ error: "No weak or strong areas to advise on yet" }, { status: 400 });
  }
  const language = body.language === "hi" ? "hi" : "en";
  const r = await generatePedagogyJson({ facts, language, schoolName: TENANT.nameDisplay });
  if (!r.ok) return NextResponse.json({ error: r.error, engine: r.engine }, { status: 502 });
  return NextResponse.json({
    ok: true,
    engine: r.engine,
    model: r.engine === "gemini" ? geminiModel() : r.engine === "openai" ? openAiModel() : "",
    language,
    generatedAt: new Date().toISOString(),
    generationId: r.generationId,
    draft: r.draft,
  });
}
