import { NextResponse } from "next/server";
import { requireWaStaffApi } from "@/lib/apiRouteAuth.server";
import { orCommsFunction } from "@/lib/commsFunctionGate.server";
import {
  listWaHubThreads,
  markWaHubThreadRead,
  staffReplyWaHubThread,
  staffSendWaHubTemplate,
} from "@/lib/waChatHub.server";
import type { WaChatCategory } from "@/lib/waChatCategories";
import { waOutboundConfigured } from "@/lib/waSend";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { SCHOOL_DEFAULT_WA_LANGUAGE } from "@/lib/householdPrefs";

export const runtime = "nodejs";

const CATEGORIES = new Set([
  "all",
  "parent",
  "staff",
  "admission_enquiry",
  "job_enquiry",
  "vendor_enquiry",
  "transport",
  "fee_enquiry",
  "meeting",
  "field_survey",
  "class_teacher",
  "general",
]);

/** GET ?category=parent — categorized WhatsApp threads + stats */
export async function GET(req: Request) {
  const auth = await orCommsFunction(req, await requireWaStaffApi(req), "notices.wa_chats", "view");
  if (!auth.ok) return auth.response;
  await ensureSchoolMirrorHydrated();
  const url = new URL(req.url);
  const raw = url.searchParams.get("category") || "all";
  const category = (
    CATEGORIES.has(raw) ? raw : "all"
  ) as WaChatCategory | "all";
  const { threads, stats } = await listWaHubThreads({ category });
  return NextResponse.json({
    category,
    outboundConfigured: waOutboundConfigured(),
    stats,
    threads,
  });
}

/** POST { action, mobile?, category?, threadId?, text?, by?, template? } */
export async function POST(req: Request) {
  const wa = await requireWaStaffApi(req);
  const auth = await orCommsFunction(req, wa, "notices.wa_chats", "view");
  if (!auth.ok) return auth.response;
  // Marking a thread read is part of reading it; replying is sending, which
  // a function holder needs "send" for.
  const maySend = async () => (await orCommsFunction(req, wa, "notices.wa_chats", "send")).ok;
  await ensureSchoolMirrorHydrated();
  let body: {
    action?: string;
    mobile?: string;
    category?: WaChatCategory;
    threadId?: string;
    text?: string;
    by?: string;
    template?: {
      name: string;
      language: string;
      variableKeys?: string[];
      variables?: Record<string, string>;
      previewText?: string;
    };
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action === "markRead" && body.mobile && body.category) {
    await markWaHubThreadRead(body.mobile, body.category);
    return NextResponse.json({ ok: true });
  }

  if ((body.action === "reply" || body.action === "sendTemplate") && !(await maySend())) {
    return NextResponse.json({ error: "Replying needs WhatsApp chats · send" }, { status: 403 });
  }

  if (body.action === "reply" && body.threadId && body.text) {
    const r = await staffReplyWaHubThread({
      threadId: body.threadId,
      text: body.text,
      by: body.by || "Desk",
    });
    if (!r.ok) {
      return NextResponse.json({ error: r.reason }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === "sendTemplate" && body.threadId && body.template?.name) {
    const r = await staffSendWaHubTemplate({
      threadId: body.threadId,
      templateName: body.template.name,
      language: body.template.language || SCHOOL_DEFAULT_WA_LANGUAGE,
      variableKeys: body.template.variableKeys,
      variables: body.template.variables,
      previewText: body.template.previewText,
      by: body.by || "Desk",
    });
    if (!r.ok) {
      return NextResponse.json({ error: r.reason }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
