import { NextResponse } from "next/server";
import { requireWaStaffApi } from "@/lib/apiRouteAuth.server";
import {
  listWaSisBotThreads,
  staffReplyWaSisBot,
} from "@/lib/waSisBotServer";
import { waOutboundConfigured } from "@/lib/waSend";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireWaStaffApi(req);
  if (!auth.ok) return auth.response;
  await ensureSchoolMirrorHydrated();
  const threads = await listWaSisBotThreads();
  return NextResponse.json({
    audience: "sis_parent",
    channel: "whatsapp",
    outboundConfigured: waOutboundConfigured(),
    threads,
  });
}

export async function POST(req: Request) {
  const auth = await requireWaStaffApi(req);
  if (!auth.ok) return auth.response;
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
  const r = await staffReplyWaSisBot({
    threadId: body.threadId,
    text: body.text,
    by: body.by || "School office",
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
