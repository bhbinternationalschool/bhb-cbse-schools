import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { StaffAttendanceState } from "@/lib/staffAttendance";
import type { StaffAttendanceDeskAncillary } from "@/lib/staffAttendanceDeskAncillary.server";
import {
  fetchStaffAttendanceDeskFromDb,
  pushStaffAttendanceDeskToDb,
  staffAttendanceDualWriteDbEnabled,
} from "@/lib/staffAttendanceNormalized.server";

export const runtime = "nodejs";

/** GET — pull full staff attendance desk from normalized tables */
export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["staff-attendance-registers"], "GET");
  if (!auth.ok) return auth.response
  const desk = await fetchStaffAttendanceDeskFromDb();
  if (!desk.ok) {
    return NextResponse.json(
      { ok: false, error: "Staff attendance desk fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  // A teacher (attendance.view) used to download every colleague's daily
  // attendance and outdoor duty. Outside the office/leadership: own rows only.
  let registers = desk.registers;
  let outdoorDuty = desk.ancillary.outdoorDuty;
  if (!auth.viaMirrorSecret) {
    const scope = await staffSectionScope(auth.ctx).catch(() => null);
    if (!scope?.unrestricted) {
      const me = auth.ctx.session.staffId || "";
      registers = desk.registers.map((r) => ({ ...r, marks: r.marks.filter((m) => !!me && m.staffId === me) }));
      outdoorDuty = (outdoorDuty ?? []).filter((o) => !!me && o.staffId === me);
    }
  }
  return NextResponse.json({
    ok: true,
    registers,
    ancillary: { ...desk.ancillary, outdoorDuty },
    settings: desk.ancillary.settings,
    outdoorDuty,
    count: desk.registers.length,
    updatedAt: desk.meta?.updatedAt || new Date().toISOString(),
    meta: desk.meta,
  });
}

type DeskPostBody = Pick<StaffAttendanceState, "registers" | "settings"> &
  Partial<StaffAttendanceDeskAncillary>;


/** POST — push staff attendance desk snapshot */
export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["staff-attendance-registers"], "POST");
  if (!auth.ok) return auth.response
  // This push carries the whole staff attendance register (every member of staff).
  // "attendance.edit" alone let a teacher's browser send it — a stale copy
  // could overwrite other classes' registers. Teachers save one register at
  // a time through /api/v1/attendance/mark and punch through
  // /api/v1/staff/attendance/punch; this route is the office's.
  if (!auth.viaMirrorSecret) {
    const scope = await staffSectionScope(auth.ctx).catch(() => null);
    if (!scope?.unrestricted) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Only the office or principal can save the full register. " +
            "Your own class and your own attendance are saved on their own.",
        },
        { status: 403 },
      );
    }
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
    outdoorDuty: Array.isArray(body.outdoorDuty) ? body.outdoorDuty : [],
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
    outdoorDutyCount: result.outdoorDutyCount ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
