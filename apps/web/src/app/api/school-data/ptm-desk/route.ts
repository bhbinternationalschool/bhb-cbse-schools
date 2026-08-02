import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { PtmState } from "@/lib/ptm";
import { ptmDualWriteDbEnabled } from "@/lib/ptmDbConfig";
import {
  fetchPtmDeskFromDb,
  pushPtmDeskToDb,
} from "@/lib/ptmNormalized.server";

export const runtime = "nodejs";

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  const session = await getDemoSession();
  return !!session;
}

/** GET — pull PTM desk from normalized tables */
export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { bundle, meta } = await fetchPtmDeskFromDb();
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
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
