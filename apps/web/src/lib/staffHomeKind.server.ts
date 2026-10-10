import { inferRoleCodes } from "@/lib/rbac";
import type { MastersState } from "@/lib/masters";
import { staffHomeKind, type StaffHomeKind } from "@/lib/staffHomeKind";

type SessionLike = {
  roleCode: string;
  email?: string;
  fullName: string;
  persona?: string;
  staffId?: string;
};

/**
 * The home kind for a signed-in staff member, from the roster record the
 * session points at. `teachesClasses` may be passed by callers that have
 * already looked at the timetable; class-teacher links are read here.
 */
export function resolveStaffHomeKind(
  session: SessionLike,
  masters: MastersState,
  opts: { teachesClasses?: boolean } = {},
): StaffHomeKind {
  const staff = session.staffId
    ? (masters.staff ?? []).find((s) => s.id === session.staffId) || null
    : null;
  const des = staff
    ? (masters.designations ?? []).find((d) => d.id === staff.designationId)
    : null;

  let roleCode = session.roleCode || "";
  try {
    const codes = inferRoleCodes(
      { ...session, persona: (session.persona || "staff") as "staff" },
      masters,
    );
    if (codes.some((c) => c === "owner" || c === "principal" || c === "admin")) {
      roleCode = "principal";
    }
  } catch {
    /* keep the session's role code */
  }

  return staffHomeKind({
    roleCode,
    designation: `${des?.code || ""} ${des?.name || ""}`,
    stream: staff?.stream || "",
    teachesClasses:
      !!opts.teachesClasses || (staff?.classTeacherLinks?.length ?? 0) > 0,
  });
}

/** Active roster ids whose designation makes them leadership — the
 * approvers a leave request or complaint should wake up. */
export function leadershipStaffIds(masters: MastersState): string[] {
  const out: string[] = [];
  for (const s of masters.staff ?? []) {
    if (s.status !== "active") continue;
    const des = (masters.designations ?? []).find((d) => d.id === s.designationId);
    const kind = staffHomeKind({
      roleCode: "",
      designation: `${des?.code || ""} ${des?.name || ""}`,
      stream: s.stream || "",
      teachesClasses: false,
    });
    if (kind === "leadership") out.push(s.id);
  }
  return out;
}
