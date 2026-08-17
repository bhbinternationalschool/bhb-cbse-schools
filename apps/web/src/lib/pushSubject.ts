import type { DemoSession } from "@/lib/auth";

/**
 * The (subject_type, subject_id) pair a session's push devices are keyed by.
 * Parents → household; staff/field → staff roster id, falling back to the
 * login email for staff without a roster link (principal/owner demo logins).
 * Returns null when the session has nothing stable to key on.
 */
export function pushSubjectForSession(
  session: DemoSession,
): { subjectType: string; subjectId: string } | null {
  if (session.persona === "parent") {
    return session.householdId
      ? { subjectType: "parent", subjectId: session.householdId }
      : null;
  }
  if (session.persona === "staff" || session.persona === "field") {
    const id = session.staffId || session.email?.toLowerCase() || "";
    return id ? { subjectType: "staff", subjectId: id } : null;
  }
  return null;
}
