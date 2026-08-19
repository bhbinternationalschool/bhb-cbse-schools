import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { generateLeadFollowupJson, llmStatus } from "@/lib/aiLlm.server";
import {
  cleanFollowupFacts,
  followupDraftLanguage,
  followupUngroundedNumbers,
  type FollowupTone,
  type LeadFollowupDraft,
  type LeadFollowupFacts,
} from "@/lib/leadFollowupAi";
import { concernLabel } from "@/lib/admissionsEnquiryForm";
import { retrieveRelevantKb } from "@/lib/schoolKb.server";
import { PROSPECT_AUDIENCE } from "@/lib/admissionsKb.server";
import { sarvamConfigured, sarvamTranslate, type SarvamLang } from "@/lib/sarvam.server";
import { HOUSEHOLD_LANGUAGES } from "@/lib/householdPrefs";
import { TENANT } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Per-lead follow-up drafts. The client sends the lead facts it holds
 * (admissions state is localStorage-first); the server adds approved KB
 * snippets for the family's concerns, drafts in en/hi, and translates to
 * a regional language with Sarvam when the family asked for one. Drafts
 * only — nothing is sent or logged here.
 */
export async function GET() {
  const s = llmStatus();
  return NextResponse.json({
    service: "lead-followup-draft",
    configured: s.tutorEngine !== "none",
    engine: s.tutorEngine,
    sarvam: sarvamConfigured(),
    note: "POST { facts: LeadFollowupFacts (minus kbSnippets), tone?, language? }",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  const masters = loadMasters();
  if (!hasPermission(session, masters, "admissions", "view")) {
    return NextResponse.json({ error: "Admissions access required" }, { status: 403 });
  }
  let body: { facts?: Partial<LeadFollowupFacts>; tone?: string; language?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const tone: FollowupTone = body.tone === "formal" || body.tone === "urgent" ? body.tone : "warm";
  const language = HOUSEHOLD_LANGUAGES.some((l) => l.id === body.language) ? String(body.language) : "en";
  const { draftIn, translateTo } = followupDraftLanguage(language);

  const facts = cleanFollowupFacts({
    ...(body.facts || {}),
    schoolName: TENANT.nameDisplay,
    counsellorName: body.facts?.counsellorName || session.fullName,
    kbSnippets: [],
  });

  // KB snippets for the family's concerns (prospect audience only).
  if (facts.concerns.length) {
    const seen = new Set<string>();
    const query = facts.concerns.map(concernLabel).join("; ") + (facts.classSoughtLabel ? ` class ${facts.classSoughtLabel}` : "");
    const matches = await retrieveRelevantKb(query, { audiences: [PROSPECT_AUDIENCE], limit: 4 });
    for (const m of matches) {
      if (seen.has(m.sourceId)) continue;
      seen.add(m.sourceId);
      facts.kbSnippets.push({ title: m.title, text: m.content.slice(0, 900) });
    }
  }

  const r = await generateLeadFollowupJson({ facts, tone, draftIn });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error, engine: r.engine }, { status: 502 });

  let draft: LeadFollowupDraft = r.draft;
  let translated = false;
  if (translateTo && sarvamConfigured()) {
    const to = HOUSEHOLD_LANGUAGES.find((l) => l.id === translateTo)?.sarvam as SarvamLang | null | undefined;
    if (to) {
      const tr = async (t: string) => {
        if (!t.trim()) return t;
        const x = await sarvamTranslate({ text: t, from: "hi-IN", to, mode: "formal" });
        return x.ok && x.text.trim() ? x.text : t;
      };
      draft = {
        whatsapp: await tr(draft.whatsapp),
        sms: await tr(draft.sms),
        email: { subject: await tr(draft.email.subject), body: await tr(draft.email.body) },
        callScript: await Promise.all(draft.callScript.map(tr)),
      };
      translated = true;
    }
  }

  return NextResponse.json({
    ok: true,
    draft,
    language,
    draftedIn: draftIn,
    translated,
    ungroundedNumbers: followupUngroundedNumbers(draft, facts),
    kbUsed: facts.kbSnippets.map((s) => s.title),
    engine: r.engine,
    generationId: r.generationId,
  });
}
