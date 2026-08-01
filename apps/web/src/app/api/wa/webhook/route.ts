/**
 * WhatsApp Business API webhook — unified school bot entry.
 * Identifies sender by mobile (staff / parent / survey / admission / visitor)
 * then routes to the right flow with a common school greeting.
 */

import { NextResponse } from "next/server";
import {
  parseGenericBspInbound,
  parseMetaWebhookInbound,
} from "@/lib/waCrmBotServer";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { waOutboundConfigured } from "@/lib/waSend";
import {
  appendTemplateStatusEvents,
  parseMetaTemplateStatusUpdates,
} from "@/lib/waTemplatesMeta.server";
import { ensureWabaWebhookSubscription } from "@/lib/waMeta.server";
import { handleWaUnifiedInbound } from "@/lib/waUnifiedBotServer";

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
    service: "wa-unified-school-bot",
    note: "Common greeting → role / purpose routing (staff, parent, teacher, survey, admission, visitor).",
    outboundConfigured: waOutboundConfigured(),
    verifyConfigured: !!verify,
  });
}

export async function POST(req: Request) {
  await ensureSchoolMirrorHydrated();
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
    const r = await handleWaUnifiedInbound({
      fromWaId: msg.fromWaId,
      text: msg.text,
      waMessageId: msg.waMessageId,
      profileName: msg.profileName,
      location: msg.location,
    });
    results.push({
      audience: r.audience,
      from: msg.fromWaId,
      escalate: r.escalate,
      replied: r.replied,
      stub: r.stub,
      error: r.error,
    });
  }

  return NextResponse.json({
    ok: true,
    handled: results.length,
    outboundConfigured: waOutboundConfigured(),
    results,
  });
}
