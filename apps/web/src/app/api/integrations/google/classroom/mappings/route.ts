import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import {
  listCourseMappings,
  removeCourseMapping,
  upsertCourseMapping,
} from "@/lib/googleClassroom.store.server";

export const runtime = "nodejs";

/** List all course → class mappings */
export async function GET() {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }
  const mappings = await listCourseMappings();
  return NextResponse.json({ ok: true, mappings });
}

/** Save or update a course mapping */
export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }

  let body: {
    courseId?: string;
    courseName?: string;
    classId?: string;
    sectionId?: string;
    subjectId?: string;
    enabled?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.courseId?.trim()) {
    return NextResponse.json({ error: "courseId required" }, { status: 400 });
  }

  const mapping = await upsertCourseMapping({
    courseId: body.courseId.trim(),
    courseName: (body.courseName || "").trim() || body.courseId,
    classId: (body.classId || "").trim(),
    sectionId: (body.sectionId || "").trim(),
    subjectId: (body.subjectId || "").trim(),
    enabled: body.enabled !== false,
  });

  return NextResponse.json({ ok: true, mapping });
}

/** Remove mapping */
export async function DELETE(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }

  let courseId = "";
  try {
    const body = (await req.json()) as { courseId?: string };
    courseId = (body.courseId || "").trim();
  } catch {
    /* query fallback */
  }
  if (!courseId) {
    const url = new URL(req.url);
    courseId = (url.searchParams.get("courseId") || "").trim();
  }
  if (!courseId) {
    return NextResponse.json({ error: "courseId required" }, { status: 400 });
  }

  await removeCourseMapping(courseId);
  return NextResponse.json({ ok: true });
}
