/**
 * Admissions → AI WhatsApp follow-up campaign.
 *
 * WHAT META ALLOWS, WHICH SHAPES THE WHOLE DESIGN
 * Free-form WhatsApp text may only be sent inside the 24-hour window that
 * opens when the contact messages you. Outside it, the only legal message is
 * an approved template, whose body is fixed by Meta review — an LLM cannot
 * write it. `sendWhatsAppText` already enforces this and refuses.
 *
 * So an "AI campaign" that generates 919 personal messages and blasts them is
 * not a thing that can exist. This splits the audience instead:
 *
 *   · inside the window  → AI drafts a genuinely personal reply, sent as text;
 *   · outside the window → an approved template, whose NAME comes from env
 *     rather than being guessed, because a template that is not registered in
 *     the school's Meta account fails per-recipient at send time.
 *
 * Every send is recorded as a touchpoint, which is how the engagement signal
 * the lead score needs starts existing at all — as of today it is 0 of 919.
 *
 * Nothing sends without an explicit confirm. `preview` is the default and
 * returns the audience, the split and sample drafts having sent nothing.
 */

import { createServiceSupabase } from "@/lib/supabase/server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { sendWhatsAppTemplate, sendWhatsAppText } from "@/lib/waSend";
import { isOptedOut, isWithin24HourWindow } from "@/lib/waContactState.server";
import { generateLeadNextActionJson } from "@/lib/aiLlm.server";
import { TENANT } from "@/lib/types";
import type { LeadStatus } from "@/lib/leadScore";

const LOG = "[waFollowUp]";

/** One press must not be able to message the whole district. */
export const MAX_CAMPAIGN_RECIPIENTS = 200;
/** Free-form drafts are one LLM call each; cap what one run will spend. */
const MAX_AI_DRAFTS = 40;

export class CampaignError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "CampaignError";
    this.status = status;
  }
}

export type CampaignInput = {
  /** Restrict to villages in these blocks. Empty means every block. */
  blocks: string[];
  /** Restrict to one village. */
  villageId?: string;
  /** Only these temperatures; empty means cold + warm + hot (not enrolled). */
  statuses: LeadStatus[];
  language: string;
  /** Nothing sends unless this is true. */
  confirm: boolean;
  limit?: number;
};

export type CampaignRecipient = {
  leadId: string;
  childName: string;
  villageName: string;
  leadScore: number;
  leadStatus: LeadStatus;
  /** How this recipient would be reached, given Meta's rules. */
  route: "freeform" | "template" | "skipped";
  reason: string;
  /** The AI draft, for preview. Only produced for free-form recipients. */
  draft?: string;
};

export type CampaignResult = {
  ok: true;
  campaignId: string;
  previewOnly: boolean;
  audience: number;
  counts: {
    freeform: number;
    template: number;
    skippedOptedOut: number;
    skippedNoMobile: number;
    sent: number;
    failed: number;
  };
  templateName: string;
  recipients: CampaignRecipient[];
  warnings: string[];
};

type Sb = NonNullable<ReturnType<typeof createServiceSupabase>>;

/**
 * The approved template used outside the 24h window.
 *
 * Env-driven and never defaulted to a guess: a template name that is not
 * registered and approved in this school's WhatsApp Business account fails at
 * send time, per recipient, after the campaign has already reported success.
 */
function followUpTemplateName(): string {
  return process.env.WA_ADMISSIONS_FOLLOWUP_TEMPLATE?.trim() || "";
}

type LeadRow = {
  id: string;
  mobile: string;
  child_name: string;
  stage: string;
  lead_json: { whatsapp?: string; childName?: string; classSoughtId?: string; source?: string } | null;
  created_at: string;
};

export async function runFollowUpCampaign(
  input: CampaignInput,
  actor: string,
): Promise<CampaignResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) throw new CampaignError("Database is not reachable.", 503);
  const sb = ctx.sb as Sb;
  const tenantId = ctx.tenantId;

  const warnings: string[] = [];
  const limit = Math.min(MAX_CAMPAIGN_RECIPIENTS, Math.max(1, input.limit ?? MAX_CAMPAIGN_RECIPIENTS));
  const statuses: LeadStatus[] = input.statuses.length
    ? input.statuses
    : ["hot", "warm", "cold"];

  if (statuses.includes("enrolled")) {
    throw new CampaignError(
      "Enrolled families are not an admissions follow-up audience.",
      400,
    );
  }

  /* ── 1. Audience, from the scored state ─────────────────── */

  let stateQuery = sb
    .from("admission_lead_market_state")
    .select("lead_id, lead_score, lead_status, village_id")
    .eq("tenant_id", tenantId)
    .in("lead_status", statuses)
    .order("lead_score", { ascending: false })
    .limit(limit);

  if (input.villageId) {
    stateQuery = stateQuery.eq("village_id", input.villageId);
  } else if (input.blocks.length) {
    const { data: villages, error: vErr } = await sb
      .from("village_demographics")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("block_name", input.blocks);
    if (vErr) throw new CampaignError(`Could not read villages: ${vErr.message}`, 502);
    const ids = ((villages as { id: string }[] | null) ?? []).map((v) => v.id);
    if (!ids.length) throw new CampaignError("No villages in that block.", 404);
    stateQuery = stateQuery.in("village_id", ids);
  }

  const { data: stateRows, error: stateErr } = await stateQuery;
  if (stateErr) {
    throw new CampaignError(`Could not read lead scores: ${stateErr.message}`, 502);
  }
  const scored = (stateRows as {
    lead_id: string;
    lead_score: number;
    lead_status: LeadStatus;
    village_id: string | null;
  }[] | null) ?? [];

  if (!scored.length) {
    throw new CampaignError(
      "No scored leads match that selection. Run 'Re-score leads' first, or widen the filter.",
      404,
    );
  }

  const { data: leadRows, error: leadErr } = await sb
    .from("admission_desk_leads")
    .select("id, mobile, child_name, stage, lead_json, created_at")
    .eq("tenant_id", tenantId)
    .in("id", scored.map((s) => s.lead_id));
  if (leadErr) throw new CampaignError(`Could not read leads: ${leadErr.message}`, 502);

  const leads = new Map(
    ((leadRows as unknown as LeadRow[] | null) ?? []).map((l) => [l.id, l]),
  );

  const villageNames = new Map<string, string>();
  const villageIds = [...new Set(scored.map((s) => s.village_id).filter(Boolean))] as string[];
  if (villageIds.length) {
    const { data: vRows } = await sb
      .from("village_demographics")
      .select("id, village_name")
      .eq("tenant_id", tenantId)
      .in("id", villageIds);
    for (const v of ((vRows as { id: string; village_name: string }[] | null) ?? [])) {
      villageNames.set(v.id, v.village_name);
    }
  }

  /* ── 2. Route each recipient by what Meta permits ───────── */

  const templateName = followUpTemplateName();
  if (!templateName) {
    warnings.push(
      "WA_ADMISSIONS_FOLLOWUP_TEMPLATE is not set, so families outside the 24-hour window cannot be messaged at all. Register an approved template in the Meta account and set that variable.",
    );
  }

  const campaignId = `camp_${Date.now().toString(36)}`;
  const recipients: CampaignRecipient[] = [];
  const counts = {
    freeform: 0,
    template: 0,
    skippedOptedOut: 0,
    skippedNoMobile: 0,
    sent: 0,
    failed: 0,
  };

  let aiDrafts = 0;

  for (const s of scored) {
    const lead = leads.get(s.lead_id);
    if (!lead) continue;

    const childName = lead.child_name || lead.lead_json?.childName || "your child";
    const villageName = s.village_id ? (villageNames.get(s.village_id) ?? "") : "";
    const mobile = (lead.mobile || lead.lead_json?.whatsapp || "").trim();

    const base = {
      leadId: s.lead_id,
      childName,
      villageName,
      leadScore: s.lead_score,
      leadStatus: s.lead_status,
    };

    if (!mobile) {
      counts.skippedNoMobile += 1;
      recipients.push({ ...base, route: "skipped", reason: "no mobile number on the lead" });
      continue;
    }
    if (await isOptedOut(mobile)) {
      counts.skippedOptedOut += 1;
      recipients.push({ ...base, route: "skipped", reason: "opted out (sent STOP)" });
      continue;
    }

    const inWindow = await isWithin24HourWindow(mobile);

    if (inWindow) {
      counts.freeform += 1;
      let draft = "";
      if (aiDrafts < MAX_AI_DRAFTS) {
        aiDrafts += 1;
        const days = Math.max(
          0,
          Math.round(
            (Date.now() - new Date(lead.created_at).getTime()) / (24 * 60 * 60 * 1000),
          ),
        );
        const ai = await generateLeadNextActionJson({
          schoolName: TENANT.name,
          childName,
          classSoughtLabel: "",
          stageLabel: lead.stage,
          sourceLabel: lead.lead_json?.source || "field survey",
          daysSinceEnquiry: days,
          followUpSummary: "No follow-ups logged yet",
          language: input.language,
        });
        if (ai.ok) {
          draft = ai.outreachMessage;
        } else {
          warnings.push(`AI draft unavailable (${ai.error}); those recipients were skipped.`);
        }
      }
      if (!draft) {
        counts.freeform -= 1;
        recipients.push({
          ...base,
          route: "skipped",
          reason: "no AI draft available for this recipient",
        });
        continue;
      }
      recipients.push({
        ...base,
        route: "freeform",
        reason: "messaged us within 24 hours — a personal reply is allowed",
        draft,
      });
    } else {
      if (!templateName) {
        recipients.push({
          ...base,
          route: "skipped",
          reason: "outside the 24-hour window and no approved template configured",
        });
        continue;
      }
      counts.template += 1;
      recipients.push({
        ...base,
        route: "template",
        reason: "outside the 24-hour window — approved template only",
      });
    }
  }

  /* ── 3. Send, only on an explicit confirm ───────────────── */

  if (!input.confirm) {
    console.info(
      `${LOG} preview campaign=${campaignId} audience=${recipients.length} ` +
        `freeform=${counts.freeform} template=${counts.template}`,
    );
    return {
      ok: true,
      campaignId,
      previewOnly: true,
      audience: recipients.length,
      counts,
      templateName,
      recipients,
      warnings,
    };
  }

  const touchRows: Record<string, unknown>[] = [];

  for (const r of recipients) {
    if (r.route === "skipped") continue;
    const lead = leads.get(r.leadId);
    if (!lead) continue;
    const mobile = (lead.mobile || lead.lead_json?.whatsapp || "").trim();

    const sendResult =
      r.route === "freeform"
        ? await sendWhatsAppText({
            toMobile: mobile,
            body: r.draft ?? "",
            clientMessageId: `${campaignId}_${r.leadId}`,
          })
        : await sendWhatsAppTemplate({
            toMobile: mobile,
            name: templateName,
            language: input.language,
            clientMessageId: `${campaignId}_${r.leadId}`,
          });

    if (!sendResult.ok) {
      counts.failed += 1;
      r.reason = `send failed: ${sendResult.error ?? "unknown"}`;
      continue;
    }
    counts.sent += 1;

    // Recorded server-side, not appended to lead_json: the desk sync would
    // overwrite that with a client copy that never saw this message.
    touchRows.push({
      tenant_id: tenantId,
      lead_id: r.leadId,
      channel: "whatsapp",
      direction: "outbound",
      outcome: "message_sent",
      body: r.route === "freeform" ? (r.draft ?? "").slice(0, 1000) : `[template] ${templateName}`,
      campaign_id: campaignId,
      send_mode: r.route,
      provider_id: sendResult.providerId ?? "",
      by_actor: actor,
    });
  }

  if (touchRows.length) {
    const { error: touchErr } = await sb
      .from("admission_lead_touchpoints")
      .insert(touchRows);
    if (touchErr) {
      // The messages went out; failing to record them would leave the score
      // blind to contact that really happened, so this is loud.
      console.error(`${LOG} touchpoint write failed: ${touchErr.message}`);
      warnings.push(
        `${touchRows.length} message(s) were sent but could not be recorded as touchpoints (${touchErr.message}). The lead scores will understate engagement until this is fixed.`,
      );
    }
  }

  console.info(
    `${LOG} sent campaign=${campaignId} sent=${counts.sent} failed=${counts.failed} by=${actor}`,
  );

  return {
    ok: true,
    campaignId,
    previewOnly: false,
    audience: recipients.length,
    counts,
    templateName,
    recipients,
    warnings,
  };
}
