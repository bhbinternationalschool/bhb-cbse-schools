/**
 * PTM per-student brief — draft only, nothing persisted.
 *
 * The PTM Feedback tab sends the facts it already holds for the booked
 * student (last two exam terms, attendance %, homework submission ratio,
 * conduct counts, earlier PTM notes) plus the household's preferred
 * language. Returns observations / concerns / suggestions in en or hi;
 * regional preferences are rendered from the Hindi draft via Sarvam.
 */

import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { TENANT } from "@/lib/types";
import { generatePtmBriefJson, llmStatus } from "@/lib/aiLlm.server";
import { geminiModel } from "@/lib/erpAiGemini.server";
import { openAiModel } from "@/lib/openAi.server";
import { cleanPtmBriefFacts } from "@/lib/ptmBriefAi";
import {
  normalizeHouseholdLanguage,
  sarvamTargetFor,
  waTemplateLanguageFor,
} from "@/lib/householdPrefs";
import {
  sarvamConfigured,
  sarvamTranslateMany,
  type SarvamLang,
} from "@/lib/sarvam.server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const status = llmStatus();
  return NextResponse.json({
    service: "ptm-student-brief",
    llmConfigured: status.primaryEngine !== "none",
    primaryEngine: status.primaryEngine,
    note: "POST { language?: household code, facts: PtmBriefFacts } — staff with ptm:edit; returns { observations, concerns, suggestions }, saves nothing",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }
  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();
  if (!hasPermission(session, masters, "ptm", "edit")) {
    return NextResponse.json({ error: "PTM edit permission required" }, { status: 403 });
  }

  let body: { language?: unknown; facts?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const facts = cleanPtmBriefFacts(body.facts);
  if (!facts) {
    return NextResponse.json(
      { error: "Nothing to brief on yet — no marks, attendance, homework, conduct or earlier notes for this student" },
      { status: 400 },
    );
  }

  const preferred = normalizeHouseholdLanguage(body.language);
  const prefs = { preferredLanguage: preferred };
  const draftLanguage = waTemplateLanguageFor(prefs, "en");
  const sarvamTarget = sarvamTargetFor(prefs);

  const r = await generatePtmBriefJson({
    facts,
    language: draftLanguage,
    schoolName: TENANT.nameDisplay,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.error, engine: r.engine }, { status: 502 });
  }

  let draft = r.draft;
  let renderedLanguage: string = draftLanguage;
  const warnings: string[] = [];
  if (sarvamTarget) {
    if (sarvamConfigured()) {
      const t = await sarvamTranslateMany({
        texts: [draft.observations, draft.concerns, draft.suggestions],
        from: draftLanguage === "hi" ? "hi-IN" : "en-IN",
        to: sarvamTarget as SarvamLang,
        mode: "formal",
      });
      if (t.texts[0] && t.texts[2]) {
        draft = { observations: t.texts[0], concerns: t.texts[1] || draft.concerns, suggestions: t.texts[2] };
        renderedLanguage = preferred;
      } else {
        warnings.push(...t.errors.slice(0, 2));
      }
    } else {
      warnings.push(`Family prefers ${preferred}; SARVAM_API_KEY not set — brief in ${draftLanguage}`);
    }
  }

  return NextResponse.json({
    ok: true,
    engine: r.engine,
    model: r.engine === "gemini" ? geminiModel() : r.engine === "openai" ? openAiModel() : "",
    language: renderedLanguage,
    requestedLanguage: preferred,
    generatedAt: new Date().toISOString(),
    generationId: r.generationId,
    draft,
    warnings,
  });
}
