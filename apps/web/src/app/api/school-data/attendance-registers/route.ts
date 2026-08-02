import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { AttendanceState } from "@/lib/attendance";
import type { AttendanceDeskAncillary } from "@/lib/attendanceDeskAncillary.server";
import {
  attendanceDualWriteDbEnabled,
  fetchAttendanceDeskFromDb,
  pushAttendanceDeskToDb,
} from "@/lib/attendanceNormalized.server";

export const runtime = "nodejs";

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  const session = await getDemoSession();
  return !!session;
}

/** GET — pull full attendance desk from normalized tables */
export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const desk = await fetchAttendanceDeskFromDb();
  return NextResponse.json({
    ok: true,
    registers: desk.registers,
    ancillary: desk.ancillary,
    count: desk.registers.length,
    updatedAt: desk.meta?.updatedAt || new Date().toISOString(),
    meta: desk.meta,
  });
}

type DeskPostBody = Pick<AttendanceState, "registers"> &
  Partial<AttendanceDeskAncillary>;

/** POST — push attendance desk snapshot (registers + policy + nudges + exceptions) */
export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!attendanceDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "ATTENDANCE_DUAL_WRITE_DB disabled",
    });
  }

  let body: DeskPostBody;
  try {
    body = (await req.json()) as DeskPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushAttendanceDeskToDb({
    registers: Array.isArray(body.registers) ? body.registers : [],
    policy: body.policy,
    absentNudges: body.absentNudges ?? [],
    exceptions: body.exceptions ?? [],
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    count: result.registerCount,
    updatedAt: new Date().toISOString(),
  });
}
