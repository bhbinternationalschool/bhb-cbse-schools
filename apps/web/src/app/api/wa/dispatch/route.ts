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
  requireStaffPermission,
  timingSafeStringEqual,
} from "@/lib/apiRouteAuth.server";
import type { RbacModule } from "@/lib/rbac";
import {
  buildWaTemplateBodyComponent,
  buildWaTemplateMediaHeader,
  sendWaWithFailover,
  waOutboundConfigured,
  type WaTemplateComponent,
} from "@/lib/waSend";
import { logHouseholdWaSend } from "@/lib/householdMessageLog.server";
import { resolveHouseholdByMobileServer } from "@/lib/parentHousehold.server";
import { isInQuietHours, quietHoursLabel } from "@/lib/householdPrefs";

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
  /** Retried automatically if the primary `mobile` send fails synchronously
   * (invalid, opted out, outside 24h window, Meta rejection) — e.g. a
   * household's altMobile. Not retried when the provider isn't configured
   * at all, since a different number can't fix that. */
  fallbackMobile?: string;
  body?: string;
  template?: DispatchTemplate;
  /**
   * Skip the household's quiet-hours window? Attendance, transport, health
   * and safety messages are urgent by module; anything else can set this
   * explicitly (e.g. an OTP). Default false → fee reminders, campaigns and
   * notices are deferred inside the family's quiet hours.
   */
  urgent?: boolean;
};

/** Modules whose messages are time-critical for the family — never held. */
const URGENT_MODULES = new Set<string>([
  "attendance",
  "transport",
  "fleet",
  "health",
  "visitors",
  "discipline",
  "student_leave",
  "student-leave",
  "auth",
]);

export async function GET() {
  return NextResponse.json({
    service: "wa-dispatch",
    outboundConfigured: waOutboundConfigured(),
    note: waOutboundConfigured()
      ? "POST messages (text and/or approved templates) via Meta/BSP"
      : "Set WA_META_ACCESS_TOKEN + WA_PHONE_NUMBER_ID (or WA_BSP_URL + WA_BSP_TOKEN). Client CRM uses local queue + stub until then.",
  });
}

type DispatchBody = {
  messages?: DispatchItem[];
  dryRun?: boolean;
  module?: RbacModule;
};

export async function POST(req: Request) {
  let body: DispatchBody | null = null;
  try {
    body = (await req.json()) as DispatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Two independent valid callers: a job/cron dispatcher presenting the
  // shared secret, or a signed-in staff browser session with RBAC on
  // `module`. A configured secret used to act as a mode switch that shut
  // out every non-secret caller outright — including legitimate staff
  // sessions from campaigns, fee/payment WA notify, and substitution
  // notify — the moment WA_DISPATCH_SECRET was set, in dev or prod alike.
  // Treat a present-but-mismatched/missing header as "not this path" and
  // fall through to RBAC instead of hard-rejecting.
  const secret = process.env.WA_DISPATCH_SECRET?.trim();
  const hdr = req.headers.get("x-wa-dispatch-secret")?.trim() || "";
  const viaSecret = !!(secret && hdr && timingSafeStringEqual(hdr, secret));

  if (!viaSecret && (isProductionEnv() || secret)) {
    // Historically hardcoded to "admissions" (this route's first caller was
    // campaign dispatch) — callers outside Admissions (e.g. substitution
    // WA notify from Timetable) can pass `module` to be checked against
    // their own RBAC grant instead of needing Admissions access too.
    const auth = await requireStaffPermission(
      req,
      body?.module || "admissions",
      "edit",
    );
    if (!auth.ok) return auth.response;
  }

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages" }, { status: 400 });
  }
  if (messages.length > 100) {
    return NextResponse.json(
      { error: "Max 100 messages per request" },
      { status: 400 },
    );
  }

  if (body?.dryRun || !waOutboundConfigured()) {
    return NextResponse.json({
      ok: true,
      mode: body?.dryRun ? "dry_run" : "stub",
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
    status: "sent" | "failed" | "deferred";
    error?: string;
    providerId?: string;
    mode?: string;
    via?: string;
    usedFallback?: boolean;
  }[] = [];

  const purpose = body?.module || "admissions";
  const purposeUrgent = URGENT_MODULES.has(String(purpose));

  for (const item of messages) {
    const mobile = (item.mobile || "").replace(/\D/g, "");
    const fallbackMobile = (item.fallbackMobile || "").replace(/\D/g, "") || undefined;
    if (mobile.length < 10) {
      results.push({
        messageId: item.messageId,
        mobile,
        status: "failed",
        error: "Invalid mobile",
      });
      continue;
    }

    // Household quiet hours (Students → Family). Non-urgent sends inside the
    // family's window are returned as "deferred" — the caller (campaign
    // queue, automation tick) retries later; nothing is dropped silently.
    if (!item.urgent && !purposeUrgent) {
      const hh = await resolveHouseholdByMobileServer(mobile).catch(() => null);
      if (hh && isInQuietHours(hh.household)) {
        results.push({
          messageId: item.messageId,
          mobile,
          status: "deferred",
          error: `Family quiet hours ${quietHoursLabel(hh.household)} — retry after the window`,
        });
        continue;
      }
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
      const r = await sendWaWithFailover({
        primaryMobile: mobile,
        fallbackMobile,
        template: {
          name: item.template.name,
          language: item.template.language || "en",
          components,
        },
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
        usedFallback: r.usedFallback,
      });
      await logHouseholdWaSend({
        mobile,
        purpose,
        via: "template",
        templateName: item.template.name,
        preview: `Template: ${item.template.name}`,
        status: r.ok ? "sent" : "failed",
        error: r.error,
        waMessageId: r.providerId,
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
    const r = await sendWaWithFailover({
      primaryMobile: mobile,
      fallbackMobile,
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
      usedFallback: r.usedFallback,
    });
    await logHouseholdWaSend({
      mobile,
      purpose,
      via: "text",
      preview: text,
      status: r.ok ? "sent" : "failed",
      error: r.error,
      waMessageId: r.providerId,
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
