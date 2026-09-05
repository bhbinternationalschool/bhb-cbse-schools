/**
 * WhatsApp Business API webhook — unified school bot entry.
 * Identifies sender by mobile (staff / parent / survey / admission / visitor)
 * then routes to the right flow with a common school greeting.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import {
  parseGenericBspInbound,
  parseMetaWebhookInbound,
} from "@/lib/waCrmBotServer";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { waOutboundConfigured } from "@/lib/waSend";
import {
  appendTemplateStatusEvents,
  appendTemplateQualityEvents,
  parseMetaTemplateStatusUpdates,
  parseMetaTemplateQualityUpdates,
} from "@/lib/waTemplatesMeta.server";
import { ensureWabaWebhookSubscription } from "@/lib/waMeta.server";
import { handleWaUnifiedInbound } from "@/lib/waUnifiedBotServer";
import { isProductionEnv } from "@/lib/apiRouteAuth.server";
import { recordInboundMessage } from "@/lib/waContactState.server";
import {
  parseMetaStatusUpdates,
  recordDeliveryStatuses,
} from "@/lib/waDeliveryLog.server";
import { recordInboundMedia } from "@/lib/waInboundMedia.server";
import { findHouseholdByWaMobile } from "@/lib/waSisBotServer";
import { sendWhatsAppText, waNormalizeLocal10 } from "@/lib/waSend";
import {
  parseComplaintFlowResponse,
  parseComplaintFlowToken,
} from "@/lib/waComplaintsFlow";
import { appendServerComplaintTicket } from "@/lib/complaintsServer";
import { loadSis } from "@/lib/sis";

export const runtime = "nodejs";

function waAppSecret(): string {
  return (
    process.env.WA_APP_SECRET ||
    process.env.META_APP_SECRET ||
    process.env.FACEBOOK_APP_SECRET ||
    ""
  ).trim();
}

/** Verify Meta's X-Hub-Signature-256 (HMAC-SHA256 over the raw body). */
function verifyMetaSignature(rawBody: string, header: string | null): boolean {
  const secret = waAppSecret();
  if (!secret) return !isProductionEnv();
  const sig = (header || "").replace(/^sha256=/i, "").trim();
  if (!sig) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(sig, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

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
  const rawBody = await req.text();
  if (!verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  await ensureSchoolMirrorHydrated();
  void ensureWabaWebhookSubscription();

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const templateStatusEvents = parseMetaTemplateStatusUpdates(body);
  if (templateStatusEvents.length > 0) {
    await appendTemplateStatusEvents(templateStatusEvents);
  }

  const templateQualityEvents = parseMetaTemplateQualityUpdates(body);
  if (templateQualityEvents.length > 0) {
    await appendTemplateQualityEvents(templateQualityEvents);
  }

  const deliveryStatusEvents = parseMetaStatusUpdates(body);
  if (deliveryStatusEvents.length > 0) {
    await recordDeliveryStatuses(deliveryStatusEvents);
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
      templateQualityUpdates: templateQualityEvents.length,
      deliveryStatusUpdates: deliveryStatusEvents.length,
    });
  }

  const results = [];
  for (const msg of inbound) {
    await recordInboundMessage(msg.fromWaId, msg.text);

    if (msg.flowResponse) {
      const householdId = parseComplaintFlowToken(msg.flowResponse.flowToken);
      const parsed = parseComplaintFlowResponse(msg.flowResponse.responseJson);
      const mobile10 = waNormalizeLocal10(msg.fromWaId);
      let replyText: string;
      if (!householdId || !parsed) {
        replyText =
          "Sorry, that complaint form couldn't be read. Please try again or message HUMAN to reach the office.";
      } else {
        const sis = loadSis();
        const household = sis.households.find((h) => h.id === householdId);
        const ticket = await appendServerComplaintTicket({
          householdId,
          raisedByName: household?.guardianName || msg.profileName || "",
          raisedByMobile: mobile10,
          category: parsed.category,
          subject: parsed.subject,
          description: parsed.description,
        });
        replyText = ticket.ok
          ? `Complaint logged (ref: ${ticket.ticket.id.slice(-6).toUpperCase()}). The office will follow up soon.`
          : `Sorry, that couldn't be logged (${ticket.error}). Please message HUMAN to reach the office directly.`;
      }
      const send = await sendWhatsAppText({ toMobile: mobile10, body: replyText });
      results.push({
        audience: "complaint_flow",
        from: msg.fromWaId,
        escalate: false,
        replied: true,
        stub: !send.ok,
        error: send.ok ? undefined : send.error,
      });
      continue;
    }

    if (msg.media) {
      try {
        const household = findHouseholdByWaMobile(
          waNormalizeLocal10(msg.fromWaId),
        );
        await recordInboundMedia({
          fromMobile: msg.fromWaId,
          waMessageId: msg.waMessageId,
          contactName: msg.profileName,
          caption: msg.text,
          householdId: household?.id ?? null,
          media: msg.media,
        });
      } catch (e) {
        console.warn("[wa/webhook] recordInboundMedia failed", e);
      }
    }
    const r = await handleWaUnifiedInbound({
      fromWaId: msg.fromWaId,
      text: msg.text,
      waMessageId: msg.waMessageId,
      profileName: msg.profileName,
      location: msg.location,
      audio:
        msg.media?.mediaType === "audio"
          ? { mediaId: msg.media.mediaId, mimeType: msg.media.mimeType }
          : null,
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
    templateStatusUpdates: templateStatusEvents.length,
    templateQualityUpdates: templateQualityEvents.length,
    deliveryStatusUpdates: deliveryStatusEvents.length,
    results,
  });
}
