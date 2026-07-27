/**
 * WhatsApp Business API webhook — routes by registered mobile:
 *   Class/subject teacher → class channel bot (HW/notice → ERP)
 *   SIS household → enrolled parent bot
 *   Assigned survey team → field survey agent bot
 *   else → CRM admissions bot
 */

import { NextResponse } from "next/server";
import {
  handleWaCrmBotInbound,
  parseGenericBspInbound,
  parseMetaWebhookInbound,
} from "@/lib/waCrmBotServer";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  handleWaSisBotInbound,
  isSisRegisteredMobile,
} from "@/lib/waSisBotServer";
import {
  handleWaSurveyBotInbound,
  isSurveyAgentMobile,
} from "@/lib/waSurveyBotServer";
import {
  handleWaClassChannelInbound,
  isClassChannelTeacherMobile,
} from "@/lib/waClassChannelServer";
import { waOutboundConfigured } from "@/lib/waSend";
import {
  appendTemplateStatusEvents,
  parseMetaTemplateStatusUpdates,
} from "@/lib/waTemplatesMeta.server";
import { ensureWabaWebhookSubscription } from "@/lib/waMeta.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const verify =
    process.env.WA_WEBHOOK_VERIFY_TOKEN ||
    process.env.WHATSAPP_VERIFY_TOKEN ||
    "";

  if (mode === "subscribe" && verify && token === verify && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return NextResponse.json({
    service: "wa-parent-bots",
    routes: {
      class_channel:
        "Class / subject teacher mobiles — HW, NOTICE, HOLIDAY, EXAM, TIMING → ERP draft + YES to broadcast",
      sis_parent: "Registered SIS household / guardian mobiles",
      survey_agent: "Assigned field survey team mobiles",
      crm_admission_parent: "Enquiry / registration (fallback)",
    },
    note: "Point Meta webhook here. Teachers: HW 8A Maths: … then YES. Survey agents: STATUS · CAPTURE · … Parents: KIDS · DUES · PAY.",
    outboundConfigured: waOutboundConfigured(),
    verifyConfigured: !!verify,
  });
}

export async function POST(req: Request) {
  await ensureSchoolMirrorHydrated();
  // Self-heal: Meta requires app subscribed to WABA or inbound webhooks are dropped.
  void ensureWabaWebhookSubscription();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const templateStatusEvents = parseMetaTemplateStatusUpdates(body);
  if (templateStatusEvents.length > 0) {
    await appendTemplateStatusEvents(templateStatusEvents);
  }

  let inbound = parseMetaWebhookInbound(body);
  if (inbound.length === 0) {
    inbound = parseGenericBspInbound(body);
  }

  if (inbound.length === 0) {
    return NextResponse.json({
      ok: true,
      handled: 0,
      templateStatusUpdates: templateStatusEvents.length,
    });
  }

  const results = [];
  for (const msg of inbound) {
    if (isClassChannelTeacherMobile(msg.fromWaId)) {
      const r = await handleWaClassChannelInbound({
        fromWaId: msg.fromWaId,
        text: msg.text,
        waMessageId: msg.waMessageId,
        profileName: msg.profileName,
        mediaNote: (msg as { mediaNote?: string }).mediaNote,
      });
      results.push({
        audience: "class_channel_teacher",
        from: msg.fromWaId,
        escalate: r.escalate,
        replied: r.replied,
        stub: r.stub,
        error: r.error,
      });
    } else if (isSisRegisteredMobile(msg.fromWaId)) {
      const r = await handleWaSisBotInbound(msg);
      results.push({
        audience: "sis_parent",
        from: msg.fromWaId,
        escalate: r.escalate,
        replied: r.replied,
        stub: r.stub,
        error: r.error,
      });
    } else if (isSurveyAgentMobile(msg.fromWaId)) {
      const r = await handleWaSurveyBotInbound(msg);
      results.push({
        audience: "survey_agent",
        from: msg.fromWaId,
        escalate: r.escalate,
        replied: r.replied,
        stub: r.stub,
        error: r.error,
      });
    } else {
      const r = await handleWaCrmBotInbound(msg);
      results.push({
        audience: "crm_admission_parent",
        from: msg.fromWaId,
        escalate: r.escalate,
        replied: r.replied,
        stub: r.stub,
        error: r.error,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    handled: results.length,
    outboundConfigured: waOutboundConfigured(),
    results,
  });
}
