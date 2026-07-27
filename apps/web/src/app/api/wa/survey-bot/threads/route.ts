import { NextResponse } from "next/server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  listWaSurveyBotThreads,
  staffReplyWaSurveyBot,
} from "@/lib/waSurveyBotServer";
import { waOutboundConfigured } from "@/lib/waSend";

export const runtime = "nodejs";

export async function GET() {
  await ensureSchoolMirrorHydrated();
  const threads = await listWaSurveyBotThreads();
  return NextResponse.json({
    audience: "survey_agent",
    channel: "whatsapp",
    outboundConfigured: waOutboundConfigured(),
    threads,
  });
}

export async function POST(req: Request) {
  let body: { threadId?: string; text?: string; by?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.threadId || !body.text) {
    return NextResponse.json(
      { error: "threadId and text required" },
      { status: 400 },
    );
  }
  const r = await staffReplyWaSurveyBot({
    threadId: body.threadId,
    text: body.text,
    by: body.by || "Survey office",
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
