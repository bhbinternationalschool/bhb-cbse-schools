import { NextResponse } from "next/server";
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
  const { bundle, meta } = await fetchStudentLeaveDeskFromDb();
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
