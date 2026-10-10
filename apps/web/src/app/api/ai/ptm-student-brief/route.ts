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
  type SarvamLang,
} from "@/lib/sarvam.server";
import { translateMany, translationConfigured } from "@/lib/translate.server";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import { assertSectionScope, staffSectionScope } from "@/lib/api/v1/staffScope";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";

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

/** 403 (as a response) unless the session is school-wide or teaches the
 * section of the student named in the facts; null when allowed. */
async function refuseOutsideSection(
  req: Request,
  rawFacts: unknown,
): Promise<NextResponse | null> {
  try {
    const ctx = await resolveApiAuth(req);
    const scope = await staffSectionScope(ctx);
    if (scope.unrestricted) return null;
    const studentId =
      rawFacts && typeof rawFacts === "object"
        ? String((rawFacts as Record<string, unknown>).studentId ?? "").trim()
        : "";
    if (!studentId) {
      return NextResponse.json({ error: "Which student? studentId is missing" }, { status: 400 });
    }
    await ensureSisHydratedServer();
    const st = loadSis().students.find((s) => s.id === studentId);
    if (!st) {
      return NextResponse.json({ error: "Student not found in the register" }, { status: 404 });
    }
    await assertSectionScope(ctx, st.classId, st.sectionId);
    return null;
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
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

  // The brief carries a child's marks, attendance and conduct into an AI
  // call; ptm.edit alone let any teacher ask for any child. A teacher may
  // brief on children in their own sections only (2026-09-29). The class
  // comes from the register, never from the client's facts.
  const scopeErr = await refuseOutsideSection(req, body.facts);
  if (scopeErr) return scopeErr;

  const facts = cleanPtmBriefFacts(body.facts);
  if (!facts) {
    return NextResponse.json(
      { error: "Nothing to brief on yet — no marks, attendance, homework, conduct or earlier notes for this student" },
      { status: 400 },
    );
  }

  const preferred = normalizeHouseholdLanguage(body.language);
  const prefs = { preferredLanguage: preferred };
  const draftLanguage = waTemplateLanguageFor(prefs);
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
    if (translationConfigured()) {
      const t = await translateMany({
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
      warnings.push(`Family prefers ${preferred}; no translation engine configured — brief in ${draftLanguage}`);
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
