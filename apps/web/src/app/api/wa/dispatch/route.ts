/**
 * WhatsApp dispatch API — campaign / automation outbound.
 * POST body: {
 *   messages: {
 *     mobile, body?, messageId?,
 *     template?: { name, language, variables?, variableKeys?, components?, mediaHeader? }
 *   }[],
 *   dryRun?: boolean
 * }
 */

import { NextResponse } from "next/server";
import {
  isProductionEnv,
  requireJobSecret,
  requireStaffPermission,
} from "@/lib/apiRouteAuth.server";
import {
  buildWaTemplateBodyComponent,
  buildWaTemplateMediaHeader,
  sendWhatsAppTemplate,
  sendWhatsAppText,
  waOutboundConfigured,
  type WaTemplateComponent,
} from "@/lib/waSend";

export const runtime = "nodejs";

type DispatchTemplate = {
  name: string;
  language: string;
  variables?: Record<string, string>;
  variableKeys?: string[];
  components?: WaTemplateComponent[];
  mediaHeader?: {
    format: "IMAGE" | "VIDEO" | "DOCUMENT";
    link: string;
    filename?: string;
  };
};

type DispatchItem = {
  messageId?: string;
  mobile: string;
  body?: string;
  template?: DispatchTemplate;
};

export async function GET() {
  return NextResponse.json({
    service: "wa-dispatch",
    outboundConfigured: waOutboundConfigured(),
    note: waOutboundConfigured()
      ? "POST messages (text and/or approved templates) via Meta/BSP"
      : "Set WA_META_ACCESS_TOKEN + WA_PHONE_NUMBER_ID (or WA_BSP_URL + WA_BSP_TOKEN). Client CRM uses local queue + stub until then.",
  });
}

export async function POST(req: Request) {
  const secret = process.env.WA_DISPATCH_SECRET?.trim();
  if (secret) {
    const hdr = req.headers.get("x-wa-dispatch-secret") || "";
    if (hdr !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (isProductionEnv()) {
    const auth = await requireStaffPermission(req, "admissions", "edit");
    if (!auth.ok) return auth.response;
  }

  let body: { messages?: DispatchItem[]; dryRun?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages" }, { status: 400 });
  }
  if (messages.length > 100) {
    return NextResponse.json(
      { error: "Max 100 messages per request" },
      { status: 400 },
    );
  }

  if (body.dryRun || !waOutboundConfigured()) {
    return NextResponse.json({
      ok: true,
      mode: body.dryRun ? "dry_run" : "stub",
      accepted: messages.length,
      outboundConfigured: waOutboundConfigured(),
      results: messages.map((m) => ({
        messageId: m.messageId,
        mobile: m.mobile,
        status: "queued_stub",
        via: m.template?.name ? "template" : "text",
      })),
      hint: waOutboundConfigured()
        ? "Pass dryRun:false to send"
        : "Configure Meta or BSP env for live WhatsApp Business delivery",
    });
  }

  const results: {
    messageId?: string;
    mobile: string;
    status: "sent" | "failed";
    error?: string;
    providerId?: string;
    mode?: string;
    via?: string;
  }[] = [];

  for (const item of messages) {
    const mobile = (item.mobile || "").replace(/\D/g, "");
    if (mobile.length < 10) {
      results.push({
        messageId: item.messageId,
        mobile,
        status: "failed",
        error: "Invalid mobile",
      });
      continue;
    }

    if (item.template?.name) {
      const components: WaTemplateComponent[] = [
        ...(item.template.components || []),
      ];
      if (item.template.mediaHeader?.link) {
        components.unshift(
          buildWaTemplateMediaHeader(
            item.template.mediaHeader.format,
            item.template.mediaHeader.link,
            item.template.mediaHeader.filename,
          ),
        );
      }
      const keys =
        item.template.variableKeys ||
        Object.keys(item.template.variables || {});
      if (keys.length && item.template.variables) {
        components.push(
          buildWaTemplateBodyComponent(keys, item.template.variables),
        );
      }
      const r = await sendWhatsAppTemplate({
        toMobile: mobile,
        name: item.template.name,
        language: item.template.language || "en",
        components,
        clientMessageId: item.messageId,
      });
      results.push({
        messageId: item.messageId,
        mobile,
        status: r.ok ? "sent" : "failed",
        error: r.error,
        providerId: r.providerId,
        mode: r.mode,
        via: "template",
      });
      continue;
    }

    const text = item.body || "";
    if (!text) {
      results.push({
        messageId: item.messageId,
        mobile,
        status: "failed",
        error: "Empty body (and no template)",
      });
      continue;
    }
    const r = await sendWhatsAppText({
      toMobile: mobile,
      body: text,
      clientMessageId: item.messageId,
    });
    results.push({
      messageId: item.messageId,
      mobile,
      status: r.ok ? "sent" : "failed",
      error: r.error,
      providerId: r.providerId,
      mode: r.mode,
      via: "text",
    });
  }

  return NextResponse.json({
    ok: true,
    mode: "live",
    sent: results.filter((r) => r.status === "sent").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  });
}
