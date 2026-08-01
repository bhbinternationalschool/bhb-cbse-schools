import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { listClassroomCourses } from "@/lib/googleClassroom.server";
import {
  listCourseMappings,
  staffConnectionKey,
} from "@/lib/googleClassroom.store.server";

export const runtime = "nodejs";

/** List teacher's Classroom courses + saved mappings */
export async function GET() {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }

  const staffKey = staffConnectionKey({
    staffId: session.staffId,
    email: session.email,
    fullName: session.fullName,
  });

  const mappings = await listCourseMappings();
  const courses = await listClassroomCourses(staffKey);
  if (!courses.ok) {
    return NextResponse.json(
      { ok: false, error: courses.error, mappings },
      { status: courses.error.includes("not connected") ? 401 : 400 },
    );
  }

  const mappedByCourse = new Map(mappings.map((m) => [m.courseId, m]));

  return NextResponse.json({
    ok: true,
    courses: courses.courses.map((c) => ({
      id: c.id,
      name: c.name,
      section: c.section || "",
      alternateLink: c.alternateLink || "",
      mapping: mappedByCourse.get(c.id) || null,
    })),
    mappings,
  });
}
