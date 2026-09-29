import { NextResponse } from "next/server";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { PtmState } from "@/lib/ptm";
import { ptmDualWriteDbEnabled } from "@/lib/ptmDbConfig";
import {
  fetchPtmDeskFromDb,
  pushPtmDeskToDb,
} from "@/lib/ptmNormalized.server";

export const runtime = "nodejs";

/** GET — pull PTM desk from normalized tables */
export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["ptm-desk"], "GET");
  if (!auth.ok) return auth.response
  const { bundle, meta, ok } = await fetchPtmDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "PTM desk fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    events: bundle.events,
    slots: bundle.slots,
    bookings: bundle.bookings,
    feedback: bundle.feedback,
    eventCount: bundle.events.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

type PtmDeskPostBody = Pick<
  PtmState,
  "events" | "slots" | "bookings" | "feedback"
>;

/** POST — push full PTM desk snapshot */
export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["ptm-desk"], "POST");
  if (!auth.ok) return auth.response
  // This push replaces the whole school's PTM desk (every event, slot,
  // booking and feedback note). "ptm.edit" alone let a teacher's browser
  // send it — a stale copy could drop other classes' bookings. Teachers add
  // their own slots and record feedback through /api/v1/staff/ptm/slots and
  // /api/v1/staff/ptm/booking; this route is the office's (2026-09-29).
  if (!auth.viaMirrorSecret) {
    const scope = await staffSectionScope(auth.ctx).catch(() => null);
    if (!scope?.unrestricted) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Only the office or principal can save the whole PTM desk. " +
            "Your own slots and meeting feedback are saved on their own.",
        },
        { status: 403 },
      );
    }
  }
  if (!ptmDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "PTM_DUAL_WRITE_DB disabled",
    });
  }

  let body: PtmDeskPostBody;
  try {
    body = (await req.json()) as PtmDeskPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushPtmDeskToDb({
    version: 1,
    events: Array.isArray(body.events) ? body.events : [],
    slots: Array.isArray(body.slots) ? body.slots : [],
    bookings: Array.isArray(body.bookings) ? body.bookings : [],
    feedback: Array.isArray(body.feedback) ? body.feedback : [],
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    eventCount: body.events?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
