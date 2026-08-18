import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { generateCollectionsDraftJson, llmStatus } from "@/lib/aiLlm.server";
import { TENANT } from "@/lib/types";
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

export async function GET() {
  const status = llmStatus();
  return NextResponse.json({
    service: "collections-draft",
    configured: status.tutorEngine !== "none",
    engine: status.tutorEngine,
    note: "POST { studentName, classLabel, amountLabel, overdueDaysLabel, stageLabel, language? } — language is the household's preferred code (en|hi|bn|ur|mai|bho); regional languages are drafted in Hindi and rendered via Sarvam when configured",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }

  let body: {
    studentName?: string;
    classLabel?: string;
    amountLabel?: string;
    overdueDaysLabel?: string;
    stageLabel?: string;
    language?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const studentName = (body.studentName || "").trim().slice(0, 120);
  const amountLabel = (body.amountLabel || "").trim().slice(0, 40);
  if (!studentName || !amountLabel) {
    return NextResponse.json(
      { error: "studentName and amountLabel required" },
      { status: 400 },
    );
  }

  // The household's preferred language (lib/householdPrefs.ts). The LLM
  // drafts in en/hi; a regional preference is rendered from the Hindi draft
  // through Sarvam so the family reads it in their own language.
  const preferred = normalizeHouseholdLanguage(body.language);
  const prefs = { preferredLanguage: preferred };
  const draftLanguage = waTemplateLanguageFor(prefs, "en");
  const sarvamTarget = sarvamTargetFor(prefs);

  const result = await generateCollectionsDraftJson({
    schoolName: TENANT.nameDisplay,
    studentName,
    classLabel: (body.classLabel || "").trim().slice(0, 40),
    amountLabel,
    overdueDaysLabel: (body.overdueDaysLabel || "").trim().slice(0, 40),
    stageLabel: (body.stageLabel || "").trim().slice(0, 40),
    language: draftLanguage,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, engine: result.engine },
      { status: 503 },
    );
  }

  let whatsappMessage = result.whatsappMessage;
  let callScript = result.callScript;
  let renderedLanguage: string = draftLanguage;
  const warnings: string[] = [];
  if (sarvamTarget) {
    if (sarvamConfigured()) {
      const t = await sarvamTranslateMany({
        texts: [whatsappMessage, callScript],
        from: draftLanguage === "hi" ? "hi-IN" : "en-IN",
        to: sarvamTarget as SarvamLang,
        mode: "formal",
      });
      if (t.texts[0] && t.texts[1]) {
        whatsappMessage = t.texts[0];
        callScript = t.texts[1];
        renderedLanguage = preferred;
      } else {
        warnings.push(...t.errors.slice(0, 2));
      }
    } else {
      warnings.push(
        `Family prefers ${preferred}; SARVAM_API_KEY not set — sent in ${draftLanguage}`,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    engine: result.engine,
    /** What the family will actually read: the preferred code when Sarvam rendered it, else en/hi */
    language: renderedLanguage,
    requestedLanguage: preferred,
    whatsappMessage,
    callScript,
    warnings,
  });
}
