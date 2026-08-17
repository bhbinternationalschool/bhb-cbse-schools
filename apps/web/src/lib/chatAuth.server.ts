import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSis, type SisStudent } from "@/lib/sis";
import { resolveClassTeachers } from "@/lib/staffResolve";

export type ChatAuthorization = {
  student: SisStudent;
  teacherName: string;
  /** Roster ids of the student's class teachers — the staff-side push subjects. */
  teacherStaffIds: string[];
  senderId: string;
  senderName: string;
};

/**
 * A chat thread is keyed by studentId, scoped to that child's parent
 * household and their current primary class teacher — the same "direct
 * chat with the class teacher" the app has always promised, nothing wider.
 */
export async function authorizeChatThread(
  ctx: ApiAuthContext,
  studentId: string,
): Promise<ChatAuthorization> {
  if (!studentId) throw new ApiError("bad_request", "studentId required", 400);

  await ensureSchoolMirrorHydrated();
  const sis = loadSis();
  const student = sis.students.find((s) => s.id === studentId && s.status === "active");
  if (!student) throw new ApiError("not_found", "Student not found", 404);

  const teachers = resolveClassTeachers(
    ctx.masters,
    student.classId,
    student.sectionId,
    student.academicYearCode,
  );
  const teacherName = teachers[0]?.fullName || "";

  if (ctx.session.persona === "parent") {
    if (student.householdId !== ctx.session.householdId) {
      throw new ApiError("forbidden", "Not your child", 403);
    }
    const household = sis.households.find((h) => h.id === student.householdId);
    return {
      student,
      teacherName,
      teacherStaffIds: teachers.map((t) => t.id),
      senderId: ctx.session.householdId || "",
      senderName: household?.guardianName || "Parent",
    };
  }

  if (ctx.session.persona === "staff") {
    const staffId = ctx.session.staffId || "";
    const isClassTeacher = teachers.some((t) => t.id === staffId);
    if (!staffId || !isClassTeacher) {
      throw new ApiError(
        "forbidden",
        "You are not the class teacher for this student",
        403,
      );
    }
    return {
      student,
      teacherName,
      teacherStaffIds: teachers.map((t) => t.id),
      senderId: staffId,
      senderName: ctx.session.fullName,
    };
  }

  throw new ApiError("forbidden", "Sign in required", 403);
}
