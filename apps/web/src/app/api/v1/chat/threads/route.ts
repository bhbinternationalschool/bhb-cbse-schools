import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { loadSis } from "@/lib/sis";

export const runtime = "nodejs";

/**
 * GET /api/v1/chat/threads — a class teacher's inbox: one row per student in
 * their primary class-teacher section(s), with the last message and unread
 * count. Empty (not an error) for staff who aren't a class teacher — that's
 * a real, honest state, not a bug.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    const staffId = ctx.session.staffId || "";
    const ay = ctx.session.academicYearCode;

    const sections = new Set<string>();
    if (staffId) {
      for (const s of ctx.masters.staff ?? []) {
        if (s.id !== staffId) continue;
        for (const link of s.classTeacherLinks ?? []) {
          if (!link.isPrimary) continue;
          if (link.academicYearCode && link.academicYearCode !== ay) continue;
          sections.add(`${link.classId}|${link.sectionId}`);
        }
      }
    }

    await ensureSchoolMirrorHydrated();
    const sis = loadSis();
    const students = sis.students.filter(
      (s) =>
        s.status === "active" &&
        s.academicYearCode === ay &&
        sections.has(`${s.classId}|${s.sectionId}`),
    );

    if (students.length === 0) {
      return apiOk({ isClassTeacher: sections.size > 0, threads: [] });
    }

    const tenant = await getServerTenantContext();
    if (!tenant) throw new ApiError("server_error", "Tenant unavailable", 503);

    const studentIds = students.map((s) => s.id);
    const { data, error } = await tenant.sb
      .from("chat_messages")
      .select("student_id, sender_persona, body, created_at, read_by_staff_at")
      .eq("tenant_id", tenant.tenantId)
      .in("student_id", studentIds)
      .order("created_at", { ascending: true });
    if (error) throw new ApiError("server_error", error.message, 500);

    type Row = {
      student_id: string;
      sender_persona: string;
      body: string;
      created_at: string;
      read_by_staff_at: string | null;
    };
    const byStudent = new Map<
      string,
      { lastMessage: string; lastMessageAt: string; unread: number }
    >();
    for (const row of (data || []) as Row[]) {
      const entry = byStudent.get(row.student_id) || {
        lastMessage: "",
        lastMessageAt: "",
        unread: 0,
      };
      entry.lastMessage = row.body;
      entry.lastMessageAt = row.created_at;
      if (row.sender_persona === "parent" && !row.read_by_staff_at) {
        entry.unread += 1;
      }
      byStudent.set(row.student_id, entry);
    }

    const threads = students
      .map((s) => {
        const meta = byStudent.get(s.id);
        return {
          studentId: s.id,
          studentName: s.fullName,
          lastMessage: meta?.lastMessage || null,
          lastMessageAt: meta?.lastMessageAt || null,
          unreadCount: meta?.unread || 0,
        };
      })
      .sort((a, b) => (b.lastMessageAt || "").localeCompare(a.lastMessageAt || ""));

    return apiOk({ isClassTeacher: true, threads });
  } catch (e) {
    return apiErr(e);
  }
}
