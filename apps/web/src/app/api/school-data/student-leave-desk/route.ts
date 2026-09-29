import { NextResponse } from "next/server";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { StudentLeaveState } from "@/lib/studentLeave";
import { studentLeaveDualWriteDbEnabled } from "@/lib/studentLeaveDbConfig";
import {
  fetchStudentLeaveDeskFromDb,
  pushStudentLeaveDeskToDb,
} from "@/lib/studentLeaveNormalized.server";

export const runtime = "nodejs";

/** GET — pull student leave desk from normalized tables */
export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["student-leave-desk"], "GET");
  if (!auth.ok) return auth.response
  const { bundle, meta, ok } = await fetchStudentLeaveDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Failed to fetch student leave desk" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    requests: bundle.requests,
    requestCount: bundle.requests.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

type StudentLeaveDeskPostBody = Pick<StudentLeaveState, "requests">;

/** POST — push full student leave desk snapshot */
export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["student-leave-desk"], "POST");
  if (!auth.ok) return auth.response
  // This push replaces the whole school's leave desk (rows it does not
  // carry are pruned). "student_leave.edit" alone let a teacher's browser
  // send it — a stale copy could undo other classes' decisions. Teachers
  // decide one request at a time through /api/v1/staff/student-leave/decide
  // (2026-09-29); this route is the office's.
  if (!auth.viaMirrorSecret) {
    const scope = await staffSectionScope(auth.ctx).catch(() => null);
    if (!scope?.unrestricted) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Only the office or principal can save the full student leave desk. " +
            "Approve or reject your own class's requests from the Pending list.",
        },
        { status: 403 },
      );
    }
  }
  if (!studentLeaveDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "STUDENT_LEAVE_DUAL_WRITE_DB disabled",
    });
  }

  let body: StudentLeaveDeskPostBody;
  try {
    body = (await req.json()) as StudentLeaveDeskPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushStudentLeaveDeskToDb({
    version: 1,
    requests: Array.isArray(body.requests) ? body.requests : [],
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    requestCount: body.requests?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
