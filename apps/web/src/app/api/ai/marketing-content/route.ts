import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { generateMarketingContentJson, llmStatus } from "@/lib/aiLlm.server";
import {
  cleanMarketingFacts,
  flagMarketingVariant,
  MARKETING_KINDS,
  marketingDraftPlan,
  normalizeAudiences,
  type MarketingFacts,
  type MarketingKind,
  type MarketingVariant,
} from "@/lib/marketingContentAi";
import { HOUSEHOLD_LANGUAGES } from "@/lib/householdPrefs";
import { sarvamConfigured, sarvamTranslate, type SarvamLang } from "@/lib/sarvam.server";
import { TENANT } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Marketing copy from the achievements / USPs the office selected. The
 * client sends the fact lines it holds; the server drafts en/hi variants,
 * translates regional ones with Sarvam, and returns per-variant flags
 * (ungrounded numbers, competitor names, sensitive claims). Nothing is
 * published here — cross-post / broadcast happen only after a human
 * accepts a variant in the UI.
 */
export async function GET() {
  const s = llmStatus();
  return NextResponse.json({
    service: "marketing-content",
    configured: s.tutorEngine !== "none",
    engine: s.tutorEngine,
    sarvam: sarvamConfigured(),
    kinds: MARKETING_KINDS.map((k) => k.id),
    note: "POST { kind, facts: MarketingFacts, audiences: [{language, register}], positioning?: boolean }",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  const masters = loadMasters();
  if (!hasPermission(session, masters, "admissions", "edit")) {
    return NextResponse.json({ error: "Admissions edit access required" }, { status: 403 });
  }
  let body: { kind?: string; facts?: Partial<MarketingFacts>; audiences?: unknown; positioning?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const kind = MARKETING_KINDS.some((k) => k.id === body.kind) ? (body.kind as MarketingKind) : null;
  if (!kind) return NextResponse.json({ error: "kind required" }, { status: 400 });
  const facts = cleanMarketingFacts({ ...(body.facts || {}), schoolName: TENANT.nameDisplay, tagline: TENANT.tagline, city: TENANT.city });
  if (kind !== "greeting" && facts.achievementLines.length === 0 && facts.usps.length === 0 && !facts.occasion) {
    return NextResponse.json({ error: "Select at least one achievement, USP or occasion — nothing is generated from thin air" }, { status: 400 });
  }
  const audiences = normalizeAudiences(body.audiences);
  const { direct, viaSarvam } = marketingDraftPlan(audiences);

  const r = await generateMarketingContentJson({ kind, facts, direct, positioning: body.positioning === true && !!facts.positioningOthers });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error, engine: r.engine }, { status: 502 });

  let variants: MarketingVariant[] = r.variants;
  // Regional variants: translate the Hindi draft with Sarvam (formal mode only).
  if (viaSarvam.length && sarvamConfigured()) {
    const hi = variants.find((v) => v.language === "hi");
    if (hi) {
      for (const a of viaSarvam) {
        const to = HOUSEHOLD_LANGUAGES.find((l) => l.id === a.language)?.sarvam as SarvamLang | null | undefined;
        if (!to) continue;
        const t = await sarvamTranslate({ text: hi.text, from: "hi-IN", to, mode: "formal" });
        const subj = hi.subject ? await sarvamTranslate({ text: hi.subject, from: "hi-IN", to, mode: "formal" }) : null;
        if (t.ok && t.text.trim()) {
          variants.push({ language: a.language, register: a.register, text: t.text, subject: subj && subj.ok ? subj.text : hi.subject });
        }
      }
    }
  }
  // Keep only requested languages (a Hindi base added only for translation is dropped).
  const wanted = new Set(audiences.map((a) => a.language));
  variants = variants.filter((v) => wanted.has(v.language));

  return NextResponse.json({
    ok: true,
    kind,
    variants: variants.map((v) => ({ ...v, flags: flagMarketingVariant(v, facts, kind) })),
    engine: r.engine,
    generationId: r.generationId,
  });
}
