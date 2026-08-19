/**
 * One communication timeline per lead, merged from the stores that each
 * hold a piece of it: counsellor follow-ups (admissions), campaign
 * messages (wa_campaigns), chat-widget threads (crm_parent_chat) and the
 * WhatsApp bot threads (server). Read-only merge — nothing is written back.
 * Also the "last touchpoints" summary the follow-up draft prompt uses, so
 * the draft knows about a campaign or bot exchange the counsellor never
 * logged by hand.
 */

import {
  followUpChannelLabel,
  followUpOutcomeLabel,
  type AdmissionLead,
} from "@/lib/admissions";
import type { CampaignMessage, WaCampaign } from "@/lib/waCampaigns";

export type TimelineDirection = "in" | "out" | "system";

export type LeadTimelineEvent = {
  id: string;
  at: string;
  /** follow_up | campaign | chat | wa_bot | milestone */
  kind: "follow_up" | "campaign" | "chat" | "wa_bot" | "milestone";
  channel: string;
  direction: TimelineDirection;
  title: string;
  detail: string;
  by: string;
};

export type ChatThreadLike = { mobile: string; messages: { id?: string; role: string; text: string; at: string; by?: string }[] };

const m10 = (m: string) => (m || "").replace(/\D/g, "").slice(-10);

export function buildLeadTimeline(input: {
  lead: AdmissionLead;
  campaigns?: WaCampaign[];
  campaignMessages?: CampaignMessage[];
  chatThreads?: ChatThreadLike[];
  waBotThreads?: ChatThreadLike[];
}): LeadTimelineEvent[] {
  const { lead } = input;
  const mobile = m10(lead.mobile || lead.parentGroupKey);
  const out: LeadTimelineEvent[] = [];

  // Milestones from the lead itself.
  if (lead.leadDate || lead.createdAt) {
    out.push({ id: `ms_created_${lead.id}`, at: lead.createdAt || `${lead.leadDate}T09:00:00.000Z`, kind: "milestone", channel: "system", direction: "system", title: "Enquiry created", detail: `${lead.source}${lead.campaignId ? ` · campaign ${lead.campaignId}` : ""}${lead.referralCode ? ` · ref ${lead.referralCode}` : ""}`, by: lead.createdBy || "" });
  }
  if (lead.parentConsentAt) out.push({ id: `ms_consent_${lead.id}`, at: lead.parentConsentAt, kind: "milestone", channel: "system", direction: "system", title: "Consent recorded", detail: lead.parentConsentBy || "", by: "" });
  if (lead.registrationDate) out.push({ id: `ms_reg_${lead.id}`, at: `${lead.registrationDate}T12:00:00.000Z`, kind: "milestone", channel: "system", direction: "system", title: "Registration", detail: lead.registrationPaymentStatus === "paid" ? "fee paid" : lead.registrationPaymentStatus || "", by: "" });
  if (lead.admissionDate) out.push({ id: `ms_adm_${lead.id}`, at: `${lead.admissionDate}T12:00:00.000Z`, kind: "milestone", channel: "system", direction: "system", title: "Admitted", detail: lead.admissionNo || "", by: "" });

  // Counsellor follow-ups.
  for (const f of lead.followUps || []) {
    out.push({
      id: `fu_${f.id}`,
      at: f.at,
      kind: "follow_up",
      channel: f.channel,
      direction: f.outcome === "message_sent" ? "out" : "out",
      title: `${followUpChannelLabel(f.channel)} · ${followUpOutcomeLabel(f.outcome)}`,
      detail: f.note || "",
      by: f.by || "",
    });
  }

  // Campaign sends.
  const campName = new Map((input.campaigns || []).map((c) => [c.id, c.name]));
  for (const m of input.campaignMessages || []) {
    if (m.leadId !== lead.id && !(mobile && m10(m.mobile) === mobile)) continue;
    if (m.status === "queued") continue;
    out.push({
      id: `cm_${m.id}`,
      at: m.sentAt || "",
      kind: "campaign",
      channel: "whatsapp",
      direction: "out",
      title: `Campaign ${m.status}${campName.get(m.campaignId) ? ` · ${campName.get(m.campaignId)}` : ""}`,
      detail: m.status === "sent" ? m.body.slice(0, 160) : m.error || "",
      by: "campaign",
    });
  }

  // Chat widget + WA bot threads by mobile.
  const pushThread = (t: ChatThreadLike, kind: "chat" | "wa_bot", channel: string) => {
    for (const msg of t.messages) {
      out.push({
        id: `${kind}_${msg.id || `${t.mobile}_${msg.at}`}`,
        at: msg.at,
        kind,
        channel,
        direction: msg.role === "parent" ? "in" : "out",
        title: msg.role === "parent" ? "Parent wrote" : msg.role === "staff" ? "Staff replied" : "Bot replied",
        detail: msg.text.slice(0, 200),
        by: msg.by || msg.role,
      });
    }
  };
  if (mobile) {
    for (const t of input.chatThreads || []) if (m10(t.mobile) === mobile) pushThread(t, "chat", "web chat");
    for (const t of input.waBotThreads || []) if (m10(t.mobile) === mobile) pushThread(t, "wa_bot", "whatsapp bot");
  }

  return out.filter((e) => e.at).sort((a, b) => b.at.localeCompare(a.at));
}

/** Newest-last one-liners for the follow-up draft prompt ("last 5 touchpoints"). */
export function timelineTouchpoints(events: LeadTimelineEvent[], n = 5): string[] {
  return [...events]
    .filter((e) => e.kind !== "milestone")
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-n)
    .map((e) => `${e.at.slice(0, 10)} ${e.direction === "in" ? "← " : e.direction === "out" ? "→ " : ""}${e.title}${e.detail ? ` (${e.detail.slice(0, 80)})` : ""}`);
}

/** Counts the dashboard / lead header can show. */
export function timelineCounts(events: LeadTimelineEvent[]): { inbound: number; outbound: number; lastInboundAt: string; lastOutboundAt: string } {
  let inbound = 0;
  let outbound = 0;
  let lastInboundAt = "";
  let lastOutboundAt = "";
  for (const e of events) {
    if (e.direction === "in") {
      inbound += 1;
      if (e.at > lastInboundAt) lastInboundAt = e.at;
    } else if (e.direction === "out") {
      outbound += 1;
      if (e.at > lastOutboundAt) lastOutboundAt = e.at;
    }
  }
  return { inbound, outbound, lastInboundAt, lastOutboundAt };
}
