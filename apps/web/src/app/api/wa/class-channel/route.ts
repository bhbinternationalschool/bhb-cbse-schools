import { NextResponse } from "next/server";
import {
  cancelClassChannelDraft,
  confirmClassChannelDraft,
  listClassChannelState,
  markClassChannelDraftApplied,
  officeCreateClassChannelDraft,
  syncClassChannels,
} from "@/lib/waClassChannelServer";
import type { ClassChannelIntentKind } from "@/lib/waClassChannelEngine";
import { waOutboundConfigured } from "@/lib/waSend";
import { ensureSchoolMirrorLoaded } from "@/lib/schoolDataMirror.server";

export const runtime = "nodejs";

export async function GET() {
  await ensureSchoolMirrorLoaded();
  await syncClassChannels();
  const state = await listClassChannelState();
  return NextResponse.json({
    channel: "whatsapp_class",
    outboundConfigured: waOutboundConfigured(),
    help: "Teachers WhatsApp the school number with HW / NOTICE / HOLIDAY / EXAM / TIMING. Reply YES to publish.",
    ...state,
  });
}

export async function POST(req: Request) {
  await ensureSchoolMirrorLoaded();
  let body: {
    action?: string;
    draftId?: string;
    channelId?: string;
    kind?: ClassChannelIntentKind;
    title?: string;
    body?: string;
    subjectId?: string;
    subjectName?: string;
    dueAt?: string;
    by?: string;
    byStaffId?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action || "";

  if (action === "sync") {
    const channels = await syncClassChannels();
    return NextResponse.json({ ok: true, channels });
  }

  if (action === "confirm") {
    if (!body.draftId) {
      return NextResponse.json({ error: "draftId required" }, { status: 400 });
    }
    const r = await confirmClassChannelDraft({
      draftId: body.draftId,
      by: body.by,
    });
    if (!r.ok) {
      return NextResponse.json({ error: r.error }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      draft: r.draft,
      broadcast: r.broadcast,
    });
  }

  if (action === "cancel") {
    if (!body.draftId) {
      return NextResponse.json({ error: "draftId required" }, { status: 400 });
    }
    const r = await cancelClassChannelDraft(body.draftId);
    if (!r.ok) {
      return NextResponse.json({ error: r.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "mark_applied") {
    if (!body.draftId) {
      return NextResponse.json({ error: "draftId required" }, { status: 400 });
    }
    await markClassChannelDraftApplied(body.draftId);
    return NextResponse.json({ ok: true });
  }

  if (action === "create_draft") {
    if (!body.channelId || !body.title || !body.kind) {
      return NextResponse.json(
        { error: "channelId, kind, title required" },
        { status: 400 },
      );
    }
    const r = await officeCreateClassChannelDraft({
      channelId: body.channelId,
      kind: body.kind,
      title: body.title,
      body: body.body || body.title,
      subjectId: body.subjectId,
      subjectName: body.subjectName,
      dueAt: body.dueAt,
      byName: body.by || "Office",
      byStaffId: body.byStaffId,
    });
    if (!r.ok) {
      return NextResponse.json({ error: r.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, draft: r.draft });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
