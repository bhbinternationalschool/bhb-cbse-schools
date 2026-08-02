import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { StudentLeaveState } from "@/lib/studentLeave";
import { studentLeaveDualWriteDbEnabled } from "@/lib/studentLeaveDbConfig";
import {
  fetchStudentLeaveDeskFromDb,
  pushStudentLeaveDeskToDb,
} from "@/lib/studentLeaveNormalized.server";

export const runtime = "nodejs";

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  const session = await getDemoSession();
  return !!session;
}

/** GET — pull student leave desk from normalized tables */
export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
