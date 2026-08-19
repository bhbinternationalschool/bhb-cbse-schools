/**
 * Per-lead follow-up drafts — the words for the counsellor's next touch,
 * in the family's language, for the channel they will actually use.
 *
 * Facts in, drafts out. The prompt gets: child, class sought, stage, days
 * since enquiry, source, what the family said matters (concerns), the last
 * touchpoints, and — only when the KB has them — approved snippets that
 * answer those concerns. Anything not supplied is declared absent and the
 * model is told not to comment on it (no fees, dates or seats invented).
 *
 * Pure: no storage, no fetch. Server route builds facts + KB snippets;
 * this file owns the facts shape, the prompt and the parser.
 */

import { concernLabel } from "@/lib/admissionsEnquiryForm";
import { HOUSEHOLD_LANGUAGES, type HouseholdLanguage } from "@/lib/householdPrefs";

export type FollowupTone = "warm" | "formal" | "urgent";
export type FollowupChannel = "whatsapp" | "sms" | "email" | "call_script";

export const FOLLOWUP_TONES: { id: FollowupTone; label: string }[] = [
  { id: "warm", label: "Warm" },
  { id: "formal", label: "Formal" },
  { id: "urgent", label: "Gentle urgency (deadline / seats)" },
];

export const FOLLOWUP_CHANNELS: { id: FollowupChannel; label: string }[] = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "sms", label: "SMS" },
  { id: "email", label: "Email" },
  { id: "call_script", label: "Call script" },
];

export type LeadFollowupFacts = {
  schoolName: string;
  counsellorName: string;
  childName: string;
  guardianName: string;
  classSoughtLabel: string;
  stageLabel: string;
  sourceLabel: string;
  daysSinceEnquiry: number;
  /** Concern ids from LEAD_CONCERNS, already on the lead */
  concerns: string[];
  /** Last few touchpoints, newest last: "WhatsApp: Interested (asked about bus)" */
  recentTouchpoints: string[];
  /** Office-approved KB snippets that answer the concerns (title + text) — may be empty */
  kbSnippets: { title: string; text: string }[];
  /** Counsellor's free note for this draft ("invite to open house on 24th") */
  counsellorNote: string;
  /** Registration link to offer, "" = none */
  registerUrl: string;
  /** A specific hook the rules chose (stalled-lead re-engagement): "" = none */
  hook: string;
};

export type LeadFollowupDraft = {
  whatsapp: string;
  sms: string;
  email: { subject: string; body: string };
  callScript: string[];
};

const MAX_WA = 700;
const MAX_SMS = 320;
const MAX_EMAIL = 2500;
const MAX_SUBJECT = 120;

export function cleanFollowupFacts(raw: Partial<LeadFollowupFacts>): LeadFollowupFacts {
  const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const list = (v: unknown, max: number, each: number) =>
    Array.isArray(v) ? v.map((x) => str(x, each)).filter(Boolean).slice(0, max) : [];
  return {
    schoolName: str(raw.schoolName, 120),
    counsellorName: str(raw.counsellorName, 80),
    childName: str(raw.childName, 80),
    guardianName: str(raw.guardianName, 80),
    classSoughtLabel: str(raw.classSoughtLabel, 40),
    stageLabel: str(raw.stageLabel, 40),
    sourceLabel: str(raw.sourceLabel, 40),
    daysSinceEnquiry: Math.max(0, Math.min(3650, Math.round(Number(raw.daysSinceEnquiry) || 0))),
    concerns: list(raw.concerns, 8, 40),
    recentTouchpoints: list(raw.recentTouchpoints, 5, 200),
    kbSnippets: Array.isArray(raw.kbSnippets)
      ? raw.kbSnippets
          .map((s) => ({ title: str((s as { title?: unknown })?.title, 160), text: str((s as { text?: unknown })?.text, 900) }))
          .filter((s) => s.text)
          .slice(0, 4)
      : [],
    counsellorNote: str(raw.counsellorNote, 400),
    registerUrl: str(raw.registerUrl, 200),
    hook: str(raw.hook, 200),
  };
}

export function followupLanguageLabel(code: string): string {
  const l = HOUSEHOLD_LANGUAGES.find((x) => x.id === code);
  return l ? l.label : "English";
}

/** Languages the model writes directly; others are written in Hindi and translated by Sarvam. */
export function followupDraftLanguage(code: string): { draftIn: "en" | "hi"; translateTo: HouseholdLanguage | null } {
  if (code === "hi" || code === "bho") return { draftIn: "hi", translateTo: null };
  if (code === "bn" || code === "ur" || code === "mai") return { draftIn: "hi", translateTo: code };
  return { draftIn: "en", translateTo: null };
}

export function buildFollowupSystemPrompt(opts: { tone: FollowupTone; draftIn: "en" | "hi" }): string {
  const toneLine =
    opts.tone === "formal"
      ? "Tone: formal, courteous, brief."
      : opts.tone === "urgent"
        ? "Tone: warm with gentle urgency — mention a time-bound next step ONLY if the facts give one (deadline, event date, hook); never invent scarcity."
        : "Tone: warm, personal, unhurried.";
  return `You draft follow-up messages for a school admissions counsellor to send to ONE prospective family. Write as the counsellor (first person), to the parent.
Rules:
- Use ONLY the facts given. If the family's concerns are listed but no KB snippet answers one, acknowledge the concern and say the counsellor will share details on the call/visit — never state a fee, date, route, seat count or policy that is not in the facts.
- Reference what THIS family said matters (concerns) and the last touchpoint, so it does not read like a broadcast.
- Every message ends with one clear, easy next step (reply, call time, visit, registration link if given).
- ${toneLine}
- Language: ${opts.draftIn === "hi" ? "simple Hindi in Devanagari (Hindi numerals not needed; keep school/class names as given)" : "simple Indian English"}.
- WhatsApp: under ${MAX_WA} characters, *bold* with single asterisks allowed, no markdown headers. SMS: under ${MAX_SMS} characters, plain text, no emoji. Email: subject under ${MAX_SUBJECT} characters and a short body under ${MAX_EMAIL} characters, plain text paragraphs. Call script: 4–7 short bullet lines the counsellor can glance at (greeting · why calling · the family's concern · what we offer from facts · next step · close).
Respond with JSON only: {"whatsapp":"…","sms":"…","email":{"subject":"…","body":"…"},"callScript":["…","…"]}`;
}

export function buildFollowupUserPrompt(f: LeadFollowupFacts): string {
  const L: string[] = [];
  L.push(`School: ${f.schoolName}`);
  L.push(`Counsellor: ${f.counsellorName || "Admissions office"}`);
  L.push(`Parent: ${f.guardianName || "(name not on record)"}`);
  L.push(`Child: ${f.childName || "(name not on record)"} · Class sought: ${f.classSoughtLabel || "not recorded"}`);
  L.push(`Stage: ${f.stageLabel} · Source: ${f.sourceLabel} · Days since enquiry: ${f.daysSinceEnquiry}`);
  L.push(
    `What the family said matters: ${f.concerns.length ? f.concerns.map(concernLabel).join(", ") : "not asked / not recorded — do not guess"}`,
  );
  L.push(`Recent touchpoints (oldest → newest): ${f.recentTouchpoints.length ? f.recentTouchpoints.join(" | ") : "none logged yet"}`);
  if (f.kbSnippets.length) {
    L.push("Approved school facts you MAY use:");
    for (const s of f.kbSnippets) L.push(`- ${s.title}: ${s.text}`);
  } else {
    L.push("Approved school facts: none supplied — do not state fees, dates, routes, seats or policies.");
  }
  if (f.hook) L.push(`Specific hook to use: ${f.hook}`);
  if (f.registerUrl) L.push(`Registration link (may include once): ${f.registerUrl}`);
  if (f.counsellorNote) L.push(`Counsellor's note for this draft: ${f.counsellorNote}`);
  return L.join("\n");
}

export function parseFollowupDraft(text: string): LeadFollowupDraft | null {
  try {
    const j = JSON.parse(text) as {
      whatsapp?: unknown;
      sms?: unknown;
      email?: { subject?: unknown; body?: unknown } | null;
      callScript?: unknown;
    };
    const whatsapp = String(j.whatsapp ?? "").trim().slice(0, MAX_WA);
    const sms = String(j.sms ?? "").trim().slice(0, MAX_SMS);
    const subject = String(j.email?.subject ?? "").trim().slice(0, MAX_SUBJECT);
    const body = String(j.email?.body ?? "").trim().slice(0, MAX_EMAIL);
    const callScript = Array.isArray(j.callScript)
      ? j.callScript.map((x) => String(x ?? "").trim().slice(0, 220)).filter(Boolean).slice(0, 8)
      : [];
    if (!whatsapp && !sms && !body && callScript.length === 0) return null;
    return { whatsapp, sms, email: { subject, body }, callScript };
  } catch {
    return null;
  }
}

/**
 * Grounding check: every ₹ amount / 4-digit year-like number / date in the
 * draft must appear in the facts (KB snippets, note, hook). Returns the
 * offending tokens so the UI can flag them — the draft is still shown,
 * marked "check numbers".
 */
export function followupUngroundedNumbers(draft: LeadFollowupDraft, facts: LeadFollowupFacts): string[] {
  const factText = [
    ...facts.kbSnippets.map((s) => `${s.title} ${s.text}`),
    facts.counsellorNote,
    facts.hook,
    facts.registerUrl,
    facts.classSoughtLabel,
    facts.schoolName,
    String(facts.daysSinceEnquiry),
  ]
    .join(" ")
    .replace(/[, ]/g, "");
  const out = new Set<string>();
  const scan = (s: string) => {
    for (const m of s.replace(/[, ]/g, "").matchAll(/(?:₹\s*\d+(?:\.\d+)?|\b\d{3,}\b|\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b)/g)) {
      const tok = m[0].replace(/^₹\s*/, "");
      if (!factText.includes(tok)) out.add(m[0]);
    }
  };
  scan(draft.whatsapp);
  scan(draft.sms);
  scan(draft.email.subject);
  scan(draft.email.body);
  draft.callScript.forEach(scan);
  return [...out];
}
