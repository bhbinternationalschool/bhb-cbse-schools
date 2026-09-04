import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { childOfHousehold, requireParentHousehold } from "@/lib/api/v1/household";
import { loadMasters } from "@/lib/masters";
import { classLabelForStudent } from "@/lib/parentPortal";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { schoolWhatsAppContact } from "@/lib/schoolWhatsApp.server";
import { loadSis } from "@/lib/sis";
import { buildTeacherWaText, teacherHoursLabel, teacherHoursOpen, nextTeacherWindowOpen } from "@/lib/teacherContact";
import { teacherContactsFor } from "@/lib/teacherContact.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/teachers/contacts?studentId=&lang= — a child's class and
 * subject teachers, the school's contact hours, and for each teacher a
 * WhatsApp link to the SCHOOL's number with the message pre-addressed
 * (the bot relays it). Links are only issued while the window is open;
 * the in-app chat is always available.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    const url = new URL(request.url);
    const studentId = (url.searchParams.get("studentId") ?? "").trim();
    const hindi = url.searchParams.get("lang") === "hi";
    if (!studentId) throw new ApiError("bad_request", "studentId required", 400);
    await ensureSchoolMirrorHydrated();
    const student = childOfHousehold(loadSis(), studentId, householdId);
    const masters = loadMasters();
    const classLabel = classLabelForStudent(student, masters);
    const open = teacherHoursOpen();
    const school = await schoolWhatsAppContact();
    const teachers = teacherContactsFor(student, masters).map((t) => {
      const text = buildTeacherWaText({
        teacherName: t.name,
        role: t.role,
        childName: student.fullName,
        classLabel,
        studentId: student.id,
        staffId: t.staffId,
        hindi,
      });
      return {
        ...t,
        chatInApp: t.isClassTeacher,
        waUrl: open && school ? `https://wa.me/${school.number}?text=${encodeURIComponent(text)}` : "",
      };
    });
    return apiOk({
      student: { id: student.id, name: student.fullName, classLabel },
      hours: {
        label: teacherHoursLabel(),
        open,
        opensAt: open ? null : nextTeacherWindowOpen(),
        note: open
          ? `Teachers are available till 8 PM today.`
          : `Teachers are available ${teacherHoursLabel()}. A message sent now is saved and delivered at 8 AM.`,
      },
      whatsapp: school ? { number: school.number, display: school.display } : null,
      teachers,
    });
  } catch (e) {
    return apiErr(e);
  }
}
