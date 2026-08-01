import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { pullClassroomHomework } from "@/lib/googleClassroom.server";
import {
  listCourseMappings,
  staffConnectionKey,
  touchLastSync,
} from "@/lib/googleClassroom.store.server";

export const runtime = "nodejs";

/** Pull coursework from mapped Classroom courses (client imports into homework store) */
export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }

  let body: {
    sinceDays?: number;
    existingCourseWorkIds?: string[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const staffKey = staffConnectionKey({
    staffId: session.staffId,
    email: session.email,
    fullName: session.fullName,
  });

  const mappings = await listCourseMappings();
  const result = await pullClassroomHomework({
    staffKey,
    mappings,
    sinceDays: body.sinceDays ?? 30,
    existingCourseWorkIds: body.existingCourseWorkIds || [],
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  await touchLastSync();

  return NextResponse.json({
    ok: true,
    drafts: result.drafts,
    scanned: result.scanned,
    skippedExisting: result.skippedExisting,
    importedCount: result.drafts.length,
  });
}
