/**
 * Marketing content from ERP facts — social post, brochure paragraph,
 * press release, website banner, WhatsApp broadcast, referral invite,
 * event invite, festival greeting. One facts block, many formats and
 * languages; the model arranges, it does not supply.
 *
 * Guardrails (enforced by the route + UI, pinned by selftests):
 *  - every number must come from the facts (ungroundedNumbers)
 *  - competitor names never appear (forbiddenNameHits)
 *  - superlative / rank claims are flagged for a human (sensitiveClaims)
 *  - nothing publishes until a person accepts the draft
 */

import { forbiddenNameHits, sensitiveClaims, ungroundedNumbers } from "@/lib/aiGrounding";
import { HOUSEHOLD_LANGUAGES } from "@/lib/householdPrefs";

export type MarketingKind =
  | "social_post"
  | "brochure_para"
  | "press_release"
  | "website_banner"
  | "wa_broadcast"
  | "referral_invite"
  | "event_invite"
  | "greeting";

export const MARKETING_KINDS: { id: MarketingKind; label: string; hint: string; max: number }[] = [
  { id: "social_post", label: "Social post", hint: "Facebook / Instagram caption with 3–5 hashtags", max: 900 },
  { id: "brochure_para", label: "Brochure paragraph", hint: "One confident paragraph for the prospectus", max: 1200 },
  { id: "press_release", label: "Press release", hint: "Headline + 3 short paragraphs + boilerplate", max: 2200 },
  { id: "website_banner", label: "Website banner", hint: "Headline ≤ 60 chars + sub-line ≤ 120 chars", max: 220 },
  { id: "wa_broadcast", label: "WhatsApp broadcast", hint: "Parent-facing, under 600 chars, one CTA", max: 700 },
  { id: "referral_invite", label: "Referral invite", hint: "To existing parents: refer a family, with the referral code placeholder {{code}}", max: 700 },
  { id: "event_invite", label: "Event invite / reminder", hint: "Open house, tour, result-day: what, when, where, RSVP", max: 700 },
  { id: "greeting", label: "Festival / occasion greeting", hint: "Warm, culturally aware, one subtle brand line, no selling", max: 400 },
];

export type MarketingRegister = "warm" | "formal";

export type MarketingAudience = { language: string; register: MarketingRegister };

export type MarketingFacts = {
  schoolName: string;
  tagline: string;
  city: string;
  /** Prompt-ready achievement lines (achievementsToFactLines) */
  achievementLines: string[];
  /** USPs the office stands behind, one per item */
  usps: string[];
  /** Brand lines allowed verbatim */
  brandLines: string[];
  /** Differentiation mode: what nearby schools advertise (never named in output) */
  positioningOthers: string;
  /** Names that must not appear */
  competitorNames: string[];
  /** Occasion / event facts: "Open House · Sat 24 Aug 2026 · 10 am · school campus · RSVP 98xxxx" */
  occasion: string;
  /** Call to action link ("" = none) */
  ctaUrl: string;
  /** Free note from the office */
  note: string;
};

export type MarketingVariant = {
  language: string;
  register: MarketingRegister;
  /** For banner / press: first line is headline */
  text: string;
  subject: string;
};

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const lines = (v: unknown, max: number, each: number) =>
  Array.isArray(v) ? v.map((x) => str(x, each)).filter(Boolean).slice(0, max) : [];

export function cleanMarketingFacts(raw: Partial<MarketingFacts>): MarketingFacts {
  return {
    schoolName: str(raw.schoolName, 120),
    tagline: str(raw.tagline, 120),
    city: str(raw.city, 60),
    achievementLines: lines(raw.achievementLines, 12, 600),
    usps: lines(raw.usps, 12, 200),
    brandLines: lines(raw.brandLines, 6, 160),
    positioningOthers: str(raw.positioningOthers, 1200),
    competitorNames: lines(raw.competitorNames, 20, 80),
    occasion: str(raw.occasion, 400),
    ctaUrl: str(raw.ctaUrl, 200),
    note: str(raw.note, 400),
  };
}

export function normalizeAudiences(raw: unknown): MarketingAudience[] {
  const out: MarketingAudience[] = [];
  const seen = new Set<string>();
  for (const a of Array.isArray(raw) ? raw : []) {
    const x = (a ?? {}) as Partial<MarketingAudience>;
    const language = HOUSEHOLD_LANGUAGES.some((l) => l.id === x.language) ? String(x.language) : "";
    if (!language || seen.has(language)) continue;
    seen.add(language);
    out.push({ language, register: x.register === "formal" ? "formal" : "warm" });
  }
  return out.length ? out.slice(0, 4) : [{ language: "en", register: "warm" }];
}

/** Which languages the model writes directly vs translated after (Sarvam). */
export function marketingDraftPlan(audiences: MarketingAudience[]): {
  direct: MarketingAudience[];
  viaSarvam: MarketingAudience[];
} {
  const direct = audiences.filter((a) => a.language === "en" || a.language === "hi");
  const viaSarvam = audiences.filter((a) => a.language !== "en" && a.language !== "hi");
  // Regional variants are translated from the Hindi draft; make sure one exists.
  if (viaSarvam.length && !direct.some((a) => a.language === "hi")) direct.push({ language: "hi", register: viaSarvam[0].register });
  return { direct, viaSarvam };
}

export function kindMax(kind: MarketingKind): number {
  return MARKETING_KINDS.find((k) => k.id === kind)?.max ?? 900;
}

export function buildMarketingSystemPrompt(opts: { kind: MarketingKind; direct: MarketingAudience[]; positioning: boolean }): string {
  const k = MARKETING_KINDS.find((x) => x.id === opts.kind)!;
  const langs = opts.direct
    .map((a) => `${a.language === "hi" ? "Hindi (Devanagari)" : "Indian English"} · ${a.register}`)
    .join(", ");
  return `You write marketing copy for an Indian CBSE school from the facts supplied — nothing else.
Format: ${k.label} — ${k.hint}. Hard limit ${k.max} characters per variant.
Rules:
- Every number, name, date, result and claim must come from the facts block. If the facts do not contain a figure, do not write one. Never write "100% result", "No. 1", "best school", rank or guarantee claims unless that exact phrase is in the facts.
- Authentic over glossy: specific, human, no stock superlatives ("world-class", "state-of-the-art") unless in the facts.
- ${opts.positioning ? "Differentiate by emphasising OUR strengths where the 'what others advertise' notes show a gap. NEVER name, hint at or disparage any other school." : "Do not mention other schools."}
- Public-school compliance: no promises about admission, no fee discounts unless in the facts, nothing about individual students without the facts naming them.
- Write one variant per audience: ${langs}. Keep school/place names and the CTA link exactly as given. Hindi must be natural Hindi, not transliterated English.
Respond with JSON only: {"variants":[{"language":"en|hi","register":"warm|formal","subject":"(press headline / email subject or empty)","text":"…"}]}`;
}

export function buildMarketingUserPrompt(f: MarketingFacts): string {
  const L: string[] = [];
  L.push(`School: ${f.schoolName}${f.tagline ? ` — "${f.tagline}"` : ""}${f.city ? ` · ${f.city}` : ""}`);
  if (f.achievementLines.length) {
    L.push("Achievements (facts):");
    for (const a of f.achievementLines) L.push(`- ${a}`);
  } else L.push("Achievements: none selected — do not invent results.");
  if (f.usps.length) {
    L.push("Strengths the school stands behind:");
    for (const u of f.usps) L.push(`- ${u}`);
  }
  if (f.brandLines.length) L.push(`Brand lines you may reuse verbatim: ${f.brandLines.map((b) => `"${b}"`).join(", ")}`);
  if (f.positioningOthers) L.push(`What nearby schools advertise (for contrast only, never name them): ${f.positioningOthers}`);
  if (f.occasion) L.push(`Occasion / event facts: ${f.occasion}`);
  L.push(`Call to action link: ${f.ctaUrl || "none — end with 'contact the school office'"}`);
  if (f.note) L.push(`Office note: ${f.note}`);
  return L.join("\n");
}

export function parseMarketingVariants(text: string): MarketingVariant[] | null {
  try {
    const j = JSON.parse(text) as { variants?: unknown };
    if (!Array.isArray(j.variants)) return null;
    const out: MarketingVariant[] = [];
    for (const v of j.variants) {
      const x = (v ?? {}) as Partial<MarketingVariant>;
      const body = str(x.text, 4000);
      if (!body) continue;
      out.push({
        language: x.language === "hi" ? "hi" : "en",
        register: x.register === "formal" ? "formal" : "warm",
        subject: str(x.subject, 200),
        text: body,
      });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export type MarketingVariantFlags = {
  ungroundedNumbers: string[];
  forbiddenNames: string[];
  sensitiveClaims: string[];
  overLimit: boolean;
};

/** Everything the route/UI flags on one variant. */
export function flagMarketingVariant(v: MarketingVariant, f: MarketingFacts, kind: MarketingKind): MarketingVariantFlags {
  const factText = [
    f.schoolName,
    f.tagline,
    f.city,
    ...f.achievementLines,
    ...f.usps,
    ...f.brandLines,
    f.occasion,
    f.ctaUrl,
    f.note,
    // current + next year often appear legitimately in greetings/invites
    String(new Date().getFullYear()),
    String(new Date().getFullYear() + 1),
  ].join(" ");
  const full = `${v.subject}\n${v.text}`;
  return {
    ungroundedNumbers: ungroundedNumbers(full, factText),
    forbiddenNames: forbiddenNameHits(full, f.competitorNames),
    sensitiveClaims: sensitiveClaims(full).filter((c) => !factText.toLowerCase().includes(c.toLowerCase())),
    overLimit: v.text.length > kindMax(kind) * 1.15,
  };
}
