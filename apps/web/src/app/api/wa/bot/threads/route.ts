/**
 * Staff CRM inbox helpers for WhatsApp admissions bot threads.
 * GET  — list threads
 * POST — { threadId, text, by } staff reply via WhatsApp API
 */

import { NextResponse } from "next/server";
import {
  listWaCrmBotThreads,
  markWaCrmBotThreadRead,
  staffReplyWaCrmBot,
} from "@/lib/waCrmBotServer";
import { waOutboundConfigured } from "@/lib/waSend";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";

export const runtime = "nodejs";

export async function GET() {
  await ensureSchoolMirrorHydrated();
  const threads = await listWaCrmBotThreads();
  return NextResponse.json({
    audience: "crm_admission_parent",
    channel: "whatsapp",
    outboundConfigured: waOutboundConfigured(),
    threads,
  });
}

export async function POST(req: Request) {
  let body: {
    action?: string;
    threadId?: string;
    text?: string;
    by?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.threadId) {
    return NextResponse.json({ error: "threadId required" }, { status: 400 });
  }

  if (body.action === "markRead") {
    const r = await markWaCrmBotThreadRead(body.threadId);
    if (!r.ok) {
      return NextResponse.json({ error: r.reason }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  if (!body.text) {
    return NextResponse.json(
      { error: "text required (or action: markRead)" },
      { status: 400 },
    );
  }
  const r = await staffReplyWaCrmBot({
    threadId: body.threadId,
    text: body.text,
    by: body.by || "Admissions",
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
