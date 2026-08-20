import { NextResponse } from "next/server";
import { cachedDeskJson, deskJsonResponse } from "@/lib/deskProbeCache.server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { AttendanceState } from "@/lib/attendance";
import type { AttendanceDeskAncillary } from "@/lib/attendanceDeskAncillary.server";
import {
  attendanceDualWriteDbEnabled,
  fetchAttendanceDeskFromDb,
  pushAttendanceDeskToDb,
} from "@/lib/attendanceNormalized.server";

export const runtime = "nodejs";

/** GET — pull full attendance desk from normalized tables */
export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["attendance-registers"], "GET");
  if (!auth.ok) return auth.response
  try {
    const result = await cachedDeskJson({
      cacheKey: "attendance-registers",
      tables: ["attendance_desk_registers", "attendance_desk_marks"],
      ifNoneMatch: req.headers.get("if-none-match"),
      build: async () => {
        const desk = await fetchAttendanceDeskFromDb();
        if (!desk.ok) throw new Error("Attendance desk fetch failed — tenant/db unavailable");
        return {
          ok: true,
          registers: desk.registers,
          ancillary: desk.ancillary,
          count: desk.registers.length,
          updatedAt: desk.meta?.updatedAt || new Date().toISOString(),
          meta: desk.meta,
        };
      },
    });
    return deskJsonResponse(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Attendance desk fetch failed" },
      { status: 503 },
    );
  }
}

type DeskPostBody = Pick<AttendanceState, "registers"> &
  Partial<AttendanceDeskAncillary>;

/** POST — push attendance desk snapshot (registers + policy + nudges + exceptions) */
export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["attendance-registers"], "POST");
  if (!auth.ok) return auth.response
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
