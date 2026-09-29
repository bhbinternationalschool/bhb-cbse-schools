import { NextResponse } from "next/server";
import {
  cancelClassChannelDraft,
  confirmClassChannelDraft,
  listClassChannelState,
  markClassChannelDraftApplied,
  officeCreateClassChannelDraft,
  syncClassChannels,
  syncClassChannelsIfStale,
} from "@/lib/waClassChannelServer";
import type { ClassChannelIntentKind } from "@/lib/waClassChannelEngine";
import { waOutboundConfigured } from "@/lib/waSend";
import { requireWaStaffApi } from "@/lib/apiRouteAuth.server";
import { scopeAllows, staffSectionScope } from "@/lib/api/v1/staffScope";

export const runtime = "nodejs";

/** School-wide, or the sections this teacher teaches. */
async function channelScope(auth: Extract<Awaited<ReturnType<typeof requireWaStaffApi>>, { ok: true }>) {
  if (auth.viaMirrorSecret) return { unrestricted: true, allows: () => true, staffId: "", name: "" };
  const scope = await staffSectionScope(auth.ctx);
  return {
    unrestricted: scope.unrestricted,
    allows: (classId: string, sectionId: string) => scopeAllows(scope, classId, sectionId),
    staffId: auth.ctx.session.staffId || "",
    name: auth.ctx.session.fullName,
  };
}

export async function GET(req: Request) {
  // Channels carry every parent's mobile per section — staff only, like
  // the WhatsApp hub next door. This route answered anyone before.
  const auth = await requireWaStaffApi(req, { allowTeachers: true });
  if (!auth.ok) return auth.response;
  const sc = await channelScope(auth);
  // Cheap by default: the roster walk + store write runs at most every 10
  // minutes; POST {action:"sync"} rebuilds on demand.
  await syncClassChannelsIfStale();
  const full = await listClassChannelState();
  // A teacher sees their own classes' channels only (each carries every
  // parent's mobile in that section).
  const mine = new Set(
    full.channels.filter((c) => sc.allows(c.classId, c.sectionId)).map((c) => c.id),
  );
  const state = sc.unrestricted
    ? full
    : {
        channels: full.channels.filter((c) => mine.has(c.id)),
        drafts: full.drafts.filter((d) => mine.has(d.channelId)),
        threads: full.threads.filter((t) => mine.has(t.channelId)),
      };
  return NextResponse.json({
    channel: "whatsapp_class",
    outboundConfigured: waOutboundConfigured(),
    help: "Teachers WhatsApp the school number with HW / NOTICE / HOLIDAY / EXAM / TIMING. Reply YES to publish.",
    ...state,
  });
}

export async function POST(req: Request) {
  const auth = await requireWaStaffApi(req, { allowTeachers: true });
  if (!auth.ok) return auth.response;
  const sc = await channelScope(auth);
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

  // Which channel does this request act on? A draft names its channel.
  if (!sc.unrestricted) {
    if (action === "sync") {
      return NextResponse.json({ error: "Only the office can rebuild class channels" }, { status: 403 });
    }
    const state = await listClassChannelState();
    const channelId =
      body.channelId ||
      state.drafts.find((d) => d.id === body.draftId)?.channelId ||
      "";
    const ch = state.channels.find((c) => c.id === channelId);
    if (!ch || !sc.allows(ch.classId, ch.sectionId)) {
      return NextResponse.json(
        { error: "You can post only to your own classes' channels" },
        { status: 403 },
      );
    }
    // Who posted comes from the session, not the request.
    body.by = sc.name;
    body.byStaffId = sc.staffId;
  }

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
      erp: r.erp,
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
