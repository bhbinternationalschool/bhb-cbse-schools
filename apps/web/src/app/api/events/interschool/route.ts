/** Inter-school events — staff API (events desk). */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  addOwnStudents,
  enterResult,
  EvtError,
  issueCertificates,
  listCertificates,
  listEvents,
  listParticipants,
  lockCategory,
  markFeePaid,
  recordPayout,
  saveEvent,
  setParticipantStatus,
  unlockCategory,
} from "@/lib/events/interschool.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(e: unknown): NextResponse {
  if (e instanceof EvtError) {
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
  }
  const message = e instanceof Error ? e.message : "Unexpected error";
  console.error("[events] route failed:", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "events", "view");
  if (!auth.ok) return auth.response;
  try {
    const q = new URL(req.url).searchParams;
    const eventId = q.get("eventId") ?? "";
    if (eventId) {
      const [participants, certificates] = await Promise.all([
        listParticipants(eventId),
        listCertificates(eventId),
      ]);
      return NextResponse.json({ ok: true, participants, certificates });
    }
    return NextResponse.json({ ok: true, events: await listEvents() });
  } catch (e) {
    return fail(e);
  }
}

type Body =
  | ({ action: "save" } & Omit<Parameters<typeof saveEvent>[0], "by">)
  | ({ action: "add-own" } & Parameters<typeof addOwnStudents>[0])
  | ({ action: "status" } & Parameters<typeof setParticipantStatus>[0])
  | ({ action: "fee-paid" } & Parameters<typeof markFeePaid>[0])
  | ({ action: "result" } & Omit<Parameters<typeof enterResult>[0], "by">)
  | { action: "lock"; categoryId: string }
  | { action: "unlock"; categoryId: string; reason: string }
  | ({ action: "payout" } & Omit<Parameters<typeof recordPayout>[0], "by">)
  | { action: "certificates"; eventId: string };

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "events", "edit");
  if (!auth.ok) return auth.response;
  const by = auth.viaMirrorSecret
    ? "system"
    : String(auth.ctx.session.fullName || "staff");

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "save":
        return NextResponse.json({ ok: true, event: await saveEvent({ ...body, by }) });
      case "add-own":
        return NextResponse.json({ ok: true, added: await addOwnStudents(body) });
      case "status":
        await setParticipantStatus(body);
        return NextResponse.json({ ok: true });
      case "fee-paid":
        await markFeePaid(body);
        return NextResponse.json({ ok: true });
      case "result":
        await enterResult({ ...body, by });
        return NextResponse.json({ ok: true });
      case "lock":
        await lockCategory({ categoryId: body.categoryId, by });
        return NextResponse.json({ ok: true });
      case "unlock":
        await unlockCategory({ categoryId: body.categoryId, reason: body.reason, by });
        return NextResponse.json({ ok: true });
      case "payout":
        await recordPayout({ ...body, by });
        return NextResponse.json({ ok: true });
      case "certificates":
        return NextResponse.json({
          ok: true,
          issued: await issueCertificates(body.eventId),
        });
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return fail(e);
  }
}
