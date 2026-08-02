import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { StaffAttendanceState } from "@/lib/staffAttendance";
import type { StaffAttendanceDeskAncillary } from "@/lib/staffAttendanceDeskAncillary.server";
import {
  fetchStaffAttendanceDeskFromDb,
  pushStaffAttendanceDeskToDb,
  staffAttendanceDualWriteDbEnabled,
} from "@/lib/staffAttendanceNormalized.server";

export const runtime = "nodejs";

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  const session = await getDemoSession();
  return !!session;
}

/** GET — pull full staff attendance desk from normalized tables */
export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const desk = await fetchStaffAttendanceDeskFromDb();
  return NextResponse.json({
    ok: true,
    registers: desk.registers,
    ancillary: desk.ancillary,
    settings: desk.ancillary.settings,
    count: desk.registers.length,
    updatedAt: desk.meta?.updatedAt || new Date().toISOString(),
    meta: desk.meta,
  });
}

type DeskPostBody = Pick<StaffAttendanceState, "registers" | "settings"> &
  Partial<StaffAttendanceDeskAncillary>;

/** POST — push staff attendance desk snapshot */
export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!staffAttendanceDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "STAFF_ATTENDANCE_DUAL_WRITE_DB disabled",
    });
  }

  let body: DeskPostBody;
  try {
    body = (await req.json()) as DeskPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushStaffAttendanceDeskToDb({
    registers: Array.isArray(body.registers) ? body.registers : [],
    settings: body.settings,
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
