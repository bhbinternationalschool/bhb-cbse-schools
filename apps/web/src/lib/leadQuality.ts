/**
 * Lead quality (hot / warm / cold) and stalled-lead rules — deterministic,
 * no model. Quality = conversion-likelihood heuristic (admissionsAi) plus
 * engagement the family initiated: WhatsApp contact with the school bot,
 * chat-widget messages, replies logged as follow-up outcomes, registration
 * payment started. Stalled rules flag leads that went quiet at a stage
 * where a nudge converts, and choose the *hook* for the re-engagement
 * draft — the model writes the words, the rule decides the reason.
 *
 * Nothing here guesses: a lead with no signals is "warm" (unknown), not
 * "cold"; a source with no data never counts for or against.
 */

import {
  leadFollowUpBucket,
  sourceLabel,
  type AdmissionLead,
} from "@/lib/admissions";
import { leadConversionScore } from "@/lib/admissionsAi";

export type LeadQuality = "hot" | "warm" | "cold";

export const LEAD_QUALITY_LABEL: Record<LeadQuality, string> = {
  hot: "Hot",
  warm: "Warm",
  cold: "Cold",
};

/** Engagement the client can see locally (chat widget threads by mobile). */
export type LeadEngagementCtx = {
  /** mobile (10 digits) → parent-authored chat-widget messages + last at */
  chatByMobile: Map<string, { parentMessages: number; lastParentAt: string }>;
  /** today as YYYY-MM-DD (injectable for tests) */
  today?: string;
};

export type LeadEngagementSignal = { id: string; label: string; at: string; weight: number };

const dayOf = (iso: string) => (iso || "").slice(0, 10);
function daysBetween(a: string, b: string): number {
  const t1 = new Date(`${dayOf(a)}T00:00:00`).getTime();
  const t2 = new Date(`${dayOf(b)}T00:00:00`).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return 0;
  return Math.max(0, Math.round((t2 - t1) / 86_400_000));
}
export function todayYmd(ctx?: { today?: string }): string {
  return ctx?.today || new Date().toISOString().slice(0, 10);
}

export function leadEngagementSignals(lead: AdmissionLead, ctx: LeadEngagementCtx): LeadEngagementSignal[] {
  const out: LeadEngagementSignal[] = [];
  const today = todayYmd(ctx);
  // Family messaged the school on WhatsApp (bot stamped their wa id / name).
  if (lead.whatsappWaId) out.push({ id: "wa_contact", label: "Messaged the school on WhatsApp", at: "", weight: 8 });
  const chat = ctx.chatByMobile.get((lead.mobile || "").replace(/\D/g, "").slice(-10));
  if (chat && chat.parentMessages > 0) {
    const recent = chat.lastParentAt && daysBetween(chat.lastParentAt, today) <= 14;
    out.push({
      id: "chat_widget",
      label: `${chat.parentMessages} chat message${chat.parentMessages === 1 ? "" : "s"} on the website`,
      at: chat.lastParentAt,
      weight: recent ? 10 : 4,
    });
  }
  // Replies the counsellor logged.
  const replies = (lead.followUps || []).filter((f) =>
    f.outcome === "interested" || f.outcome === "visit_scheduled" || f.outcome === "callback" || f.outcome === "connected",
  );
  if (replies.length) {
    const last = replies[replies.length - 1];
    const recent = daysBetween(last.at, today) <= 7;
    out.push({
      id: "replied",
      label: `Spoke ${replies.length} time${replies.length === 1 ? "" : "s"}; last: ${last.outcome.replace("_", " ")}`,
      at: last.at,
      weight: recent ? 8 : 3,
    });
  }
  if (lead.registrationPaymentStatus === "partial") out.push({ id: "payment_started", label: "Registration payment started", at: "", weight: 12 });
  if (lead.registrationPaymentStatus === "paid" || lead.registrationFeePaid) out.push({ id: "paid", label: "Registration fee paid", at: "", weight: 15 });
  if (lead.concerns.length) out.push({ id: "told_concerns", label: "Told us what matters to them", at: "", weight: 3 });
  if (lead.preferredLanguage) out.push({ id: "told_language", label: "Told us their language", at: "", weight: 1 });
  return out;
}

export type LeadQualityResult = {
  quality: LeadQuality;
  /** conversion heuristic + engagement, 5–95 */
  score: number;
  signals: LeadEngagementSignal[];
  /** Days since the family last engaged (signal with a date) or since enquiry; null when unknown */
  quietDays: number | null;
};

export function leadQuality(lead: AdmissionLead, ctx: LeadEngagementCtx): LeadQualityResult {
  const today = todayYmd(ctx);
  const signals = leadEngagementSignals(lead, ctx);
  const base = leadConversionScore(lead);
  const bump = signals.reduce((a, s) => a + s.weight, 0);
  const score = Math.round(Math.max(5, Math.min(95, base + Math.min(30, bump))));
  const dated = signals.filter((s) => s.at).map((s) => s.at).sort();
  const lastAt = dated[dated.length - 1] || (lead.followUps || []).map((f) => f.at).sort().slice(-1)[0] || "";
  const quietDays = lastAt ? daysBetween(lastAt, today) : lead.leadDate ? daysBetween(lead.leadDate, today) : null;
  if (lead.stage === "lost" || lead.stage === "enrolled") return { quality: "cold", score, signals, quietDays };
  const lastOutcome = (lead.followUps || []).slice(-1)[0]?.outcome;
  if (lastOutcome === "not_interested" || lastOutcome === "wrong_number") return { quality: "cold", score, signals, quietDays };
  if (score >= 65 || signals.some((s) => s.id === "payment_started" || s.id === "paid")) return { quality: "hot", score, signals, quietDays };
  if (score < 35 || (quietDays != null && quietDays > 30 && signals.length === 0)) return { quality: "cold", score, signals, quietDays };
  return { quality: "warm", score, signals, quietDays };
}

/* ─── Stalled-lead rules ───────────────────────────────────────────── */

export type StalledThresholds = {
  /** Digital enquiry (website / Google / social / WhatsApp) with no contact */
  noContactAfterFormDays: number;
  /** Any enquiry with no follow-up logged */
  noFollowupDays: number;
  /** Registration fee paid but not verified / enrolled */
  paidNotCompletedDays: number;
  /** Showed interest (interested / callback / visit) then silence */
  wentQuietDays: number;
};

export const DEFAULT_STALLED_THRESHOLDS: StalledThresholds = {
  noContactAfterFormDays: 3,
  noFollowupDays: 5,
  paidNotCompletedDays: 14,
  wentQuietDays: 10,
};

export type StalledFlag = {
  id: "no_contact_after_form" | "no_followup" | "paid_not_completed" | "went_quiet";
  label: string;
  /** Days the rule measured */
  days: number;
  /** Severity for ordering: higher first */
  severity: number;
  /** The reason the re-engagement draft should use — facts only */
  hook: string;
};

const DIGITAL = new Set(["website", "google", "social", "whatsapp"]);

export function stalledLeadFlags(
  lead: AdmissionLead,
  ctx: { today?: string },
  t: StalledThresholds = DEFAULT_STALLED_THRESHOLDS,
): StalledFlag[] {
  if (lead.stage === "lost" || lead.stage === "enrolled") return [];
  const today = todayYmd(ctx);
  const flags: StalledFlag[] = [];
  const fus = lead.followUps || [];
  const spoke = fus.some((f) => f.outcome === "connected" || f.outcome === "interested" || f.outcome === "visit_scheduled" || f.outcome === "callback");
  const sinceLead = lead.leadDate ? daysBetween(lead.leadDate, today) : 0;

  // Paid but not completed — the most valuable nudge.
  if ((lead.registrationPaymentStatus === "paid" || lead.registrationFeePaid) && lead.stage !== "verified") {
    const since = lead.registrationDate ? daysBetween(lead.registrationDate, today) : sinceLead;
    if (since >= t.paidNotCompletedDays) {
      flags.push({
        id: "paid_not_completed",
        label: "Registration fee paid, admission not completed",
        days: since,
        severity: 4,
        hook: `The family has already paid the registration fee${lead.registrationDate ? ` (on ${lead.registrationDate})` : ""}; invite them to complete the admission formalities and bring the remaining documents.`,
      });
    }
  }

  // Showed interest, then silence.
  const lastPositive = [...fus].reverse().find((f) => f.outcome === "interested" || f.outcome === "visit_scheduled" || f.outcome === "callback");
  if (lastPositive) {
    const lastAny = fus[fus.length - 1];
    const quiet = daysBetween(lastAny.at, today);
    if (lastAny.id === lastPositive.id && quiet >= t.wentQuietDays) {
      flags.push({
        id: "went_quiet",
        label: `Showed interest, no contact for ${quiet} days`,
        days: quiet,
        severity: 3,
        hook: `On ${dayOf(lastPositive.at)} the family ${lastPositive.outcome === "visit_scheduled" ? "agreed to a school visit" : lastPositive.outcome === "callback" ? "asked for a callback" : "said they were interested"}${lastPositive.note ? ` (${lastPositive.note.slice(0, 100)})` : ""}; pick that thread up and offer a concrete next step.`,
      });
    }
  }

  // Digital form submitted, nobody has reached them.
  if (lead.stage === "enquiry" && DIGITAL.has(lead.source) && !spoke && sinceLead >= t.noContactAfterFormDays) {
    flags.push({
      id: "no_contact_after_form",
      label: `${sourceLabel(lead.source)} enquiry, not reached in ${sinceLead} days`,
      days: sinceLead,
      severity: 2,
      hook: `They enquired online via ${sourceLabel(lead.source)} ${sinceLead} days ago and nobody has spoken to them yet; apologise for the wait and offer a call time or visit.`,
    });
  } else if (lead.stage === "enquiry" && fus.length === 0 && sinceLead >= t.noFollowupDays) {
    flags.push({
      id: "no_followup",
      label: `No follow-up logged in ${sinceLead} days`,
      days: sinceLead,
      severity: 1,
      hook: `First contact after their enquiry ${sinceLead} days ago; introduce yourself and ask what would help them decide.`,
    });
  }

  // Overdue next-follow-up is already surfaced by the bucket; don't double-flag.
  void leadFollowUpBucket;
  return flags.sort((a, b) => b.severity - a.severity);
}

/** Build the engagement context from the CRM chat threads (client-side). */
export function engagementCtxFromChat(
  threads: { mobile: string; messages: { role: string; at: string }[] }[],
  today?: string,
): LeadEngagementCtx {
  const chatByMobile = new Map<string, { parentMessages: number; lastParentAt: string }>();
  for (const t of threads) {
    const key = (t.mobile || "").replace(/\D/g, "").slice(-10);
    if (!key) continue;
    const parent = t.messages.filter((m) => m.role === "parent");
    if (!parent.length) continue;
    const cur = chatByMobile.get(key) ?? { parentMessages: 0, lastParentAt: "" };
    cur.parentMessages += parent.length;
    const last = parent.map((m) => m.at).sort().slice(-1)[0] || "";
    if (last > cur.lastParentAt) cur.lastParentAt = last;
    chatByMobile.set(key, cur);
  }
  return { chatByMobile, today };
}
