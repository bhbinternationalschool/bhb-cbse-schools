/**
 * WhatsApp Business API webhook — unified school bot entry.
 * Identifies sender by mobile (staff / parent / survey / admission / visitor)
 * then routes to the right flow with a common school greeting.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse, after } from "next/server";
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
      let household: ReturnType<typeof findHouseholdByWaMobile> = null;
      try {
        household = findHouseholdByWaMobile(
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
      // A photo or PDF from a KNOWN family is a document for the child's
      // record — an Aadhaar card, a birth certificate, an address proof —
      // and is read, filed and acted on here. It used to fall through to
      // the parent bot, which answered every photo with the keyword menu.
      // Reading takes a few seconds, so like voice notes it runs after the
      // response (see the after() note below); Meta re-delivers anything it
      // does not get a prompt 200 for.
      if (
        household &&
        (msg.media.mediaType === "image" || msg.media.mediaType === "document")
      ) {
        const media = msg.media;
        const hh = household;
        after(async () => {
          try {
            const { captureUdiseDocumentFromWhatsApp } = await import(
              "@/lib/udiseDocIntake.server"
            );
            const r = await captureUdiseDocumentFromWhatsApp({
              mediaId: media.mediaId,
              mimeType: media.mimeType,
              fileName: media.filename,
              caption: msg.text || "",
              mobile10: waNormalizeLocal10(msg.fromWaId),
              household: hh,
              waMessageId: msg.waMessageId,
            });
            if (!r.handled) {
              // Not something the intake reads (a video, no vision model):
              // the ordinary bot still gets its turn.
              await handleWaUnifiedInbound({
                fromWaId: msg.fromWaId,
                text: msg.text,
                waMessageId: msg.waMessageId,
                profileName: msg.profileName,
                location: msg.location,
                audio: null,
                document: { mediaId: media.mediaId, mimeType: media.mimeType, fileName: media.filename },
              });
            }
          } catch (e) {
            console.error("[wa/webhook] document intake failed", msg.waMessageId, e);
          }
        });
        results.push({
          audience: "document_intake_deferred",
          from: msg.fromWaId,
          escalate: false,
          replied: false,
          stub: false,
        });
        continue;
      }
    }
    // A family we asked "where does your child wait?" answering that question.
    //
    // Before the ordinary bot, and gated on an OPEN request for this
    // household — see transportPinIntake.server.ts. Without that gate an
    // inbound location keeps the meaning it already has: the transport bot
    // invites one when a family reports a problem, and re-reading that as a
    // boarding point would move a child's stop because their parent reported
    // a breakdown. Anything that is not an answer returns handled:false and
    // falls through untouched.
    if (msg.location || (msg.text || "").trim()) {
      try {
        const { tryTransportPinIntake } = await import(
          "@/lib/transportPinIntake.server"
        );
        const household = findHouseholdByWaMobile(waNormalizeLocal10(msg.fromWaId));
        const pin = await tryTransportPinIntake({
          fromWaId: msg.fromWaId,
          text: msg.text,
          location: msg.location,
          household: household
            ? { id: household.id, preferredLanguage: household.preferredLanguage }
            : null,
        });
        if (pin.handled) {
          results.push({
            audience: `transport_pin_${pin.outcome ?? "handled"}`,
            from: msg.fromWaId,
            escalate: false,
            replied: true,
            stub: false,
            error: pin.error,
          });
          continue;
        }
      } catch (e) {
        // Never swallow the message: if the intake throws, the ordinary bot
        // still gets its turn and the family gets an answer.
        console.error("[wa/webhook] transport pin intake failed", msg.waMessageId, e);
      }
    }

    // A voice note takes about six seconds to transcribe, and Meta re-delivers
    // a webhook it did not get a prompt answer for. So it is answered now and
    // done afterwards: after() runs once the response has been sent, which
    // Cloud Run only keeps CPU for because cloudbuild.yaml sets
    // --no-cpu-throttling. Read that comment before removing this.
    //
    // Only voice notes. Every other message is fast and stays synchronous, so
    // its result is still reported in this response and nothing that works
    // today changes shape.
    const isVoiceNote =
      msg.media?.mediaType === "audio" && !(msg.text || "").trim();
    const dispatch = {
      fromWaId: msg.fromWaId,
      text: msg.text,
      mediaNote: msg.mediaNote ?? null,
      waMessageId: msg.waMessageId,
      profileName: msg.profileName,
      location: msg.location,
      audio:
        msg.media?.mediaType === "audio"
          ? { mediaId: msg.media.mediaId, mimeType: msg.media.mimeType }
          : null,
      // A document or photo, for the flows that can use one — today the
      // job enquiry, where the attachment IS the application.
      document:
        msg.media && (msg.media.mediaType === "document" || msg.media.mediaType === "image")
          ? {
              mediaId: msg.media.mediaId,
              mimeType: msg.media.mimeType,
              fileName: msg.media.filename,
            }
          : null,
    };

    if (isVoiceNote) {
      after(async () => {
        try {
          await handleWaUnifiedInbound(dispatch);
        } catch (e) {
          // Nothing is waiting on this any more, so a throw here would be
          // invisible. The parent is left with no reply at all, which is the
          // one outcome this whole path exists to prevent — say so loudly in
          // the logs.
          console.error("[wa/webhook] voice note processing failed", msg.waMessageId, e);
        }
      });
      results.push({
        audience: "voice_note_deferred",
        from: msg.fromWaId,
        escalate: false,
        replied: false,
        stub: false,
      });
      continue;
    }

    const r = await handleWaUnifiedInbound(dispatch);
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
