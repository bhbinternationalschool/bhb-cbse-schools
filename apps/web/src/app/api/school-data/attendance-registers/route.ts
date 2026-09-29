import { sectionKey, staffSectionScope } from "@/lib/api/v1/staffScope";
import { NextResponse } from "next/server";
import { cachedDeskJson, deskJsonResponse } from "@/lib/deskProbeCache.server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { AttendanceRegister, AttendanceState } from "@/lib/attendance";
import type { AttendanceDeskAncillary } from "@/lib/attendanceDeskAncillary.server";
import {
  attendanceDualWriteDbEnabled,
  fetchAttendanceDeskFromDb,
  pushAttendanceDeskToDb,
} from "@/lib/attendanceNormalized.server";

export const runtime = "nodejs";

type DeskBody = {
  registers?: AttendanceRegister[];
  ancillary?: Partial<AttendanceDeskAncillary>;
  count?: number;
} & Record<string, unknown>;

/** The whole-desk body narrowed to a teacher's sections — same shape. */
function scopeDeskBody(body: string, sections: Set<string>): DeskBody {
  const desk = JSON.parse(body) as DeskBody;
  const registers = (desk.registers ?? []).filter((r) =>
    sections.has(sectionKey(r.classId, r.sectionId)),
  );
  // Nudge logs carry a section but no class. Masters sections belong to one
  // class each (Section.classId), so the section id alone is enough there.
  const sectionIds = new Set([...sections].map((k) => k.split("|")[1] ?? ""));
  const ancillary = desk.ancillary
    ? {
        ...desk.ancillary,
        absentNudges: (desk.ancillary.absentNudges ?? []).filter((n) =>
          sectionIds.has(n.sectionId),
        ),
        exceptions: (desk.ancillary.exceptions ?? []).filter((x) =>
          sections.has(sectionKey(x.classId, x.sectionId)),
        ),
      }
    : desk.ancillary;
  return { ...desk, registers, ancillary, count: registers.length };
}

/** GET — pull full attendance desk from normalized tables */
export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["attendance-registers"], "GET");
  if (!auth.ok) return auth.response
  // A teacher gets only their own sections' registers (2026-09-29). Every
  // register carries student ids and marks, and the nudges/exceptions carry
  // parents' numbers — "attendance.view" alone handed a teacher's browser
  // the whole school. Unknown scope (lookup failed) is treated as
  // restricted with no sections, never as school-wide.
  let sections: Set<string> | null = null;
  if (!auth.viaMirrorSecret) {
    const scope = await staffSectionScope(auth.ctx).catch(() => null);
    if (!scope?.unrestricted) sections = scope?.sections ?? new Set<string>();
  }
  try {
    const result = await cachedDeskJson({
      cacheKey: "attendance-registers",
      tables: ["attendance_desk_registers", "attendance_desk_marks"],
      // The shared cache and its ETag describe the WHOLE desk. A scoped
      // caller must never get a 304 against a whole-desk body its browser
      // may hold from an office login, so it always gets a fresh body.
      ifNoneMatch: sections ? null : req.headers.get("if-none-match"),
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
    if (!sections || result.kind === "not_modified") return deskJsonResponse(result);
    return NextResponse.json(scopeDeskBody(result.body, sections), {
      headers: { "Cache-Control": "private, no-store" },
    });
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
  // This push carries the whole student attendance desk (every class's registers, the policy and the parent nudges).
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
