import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import type { SisState, SisStudent } from "@/lib/sis";

/**
 * Household scoping for the parent app's v1 routes.
 *
 * A parent session carries its householdId and may only ever read or write
 * its own household. Nothing here consults RBAC: parents have no roles, the
 * household IS the permission.
 */
export function requireParentHousehold(ctx: ApiAuthContext): string {
  if (ctx.session.persona !== "parent" || !ctx.session.householdId) {
    throw new ApiError("forbidden", "Parent session required", 403);
  }
  return ctx.session.householdId;
}

/** The student, provided it belongs to the household — else 404/403. */
export function childOfHousehold(
  sis: SisState,
  studentId: string,
  householdId: string,
): SisStudent {
  const student = sis.students.find((s) => s.id === studentId);
  if (!student) throw new ApiError("not_found", "Student not found", 404);
  if (student.householdId !== householdId) {
    throw new ApiError("forbidden", "Not your child", 403);
  }
  return student;
}

/**
 * A parent may only read or act for a child of the household on their
 * session. A parent session WITHOUT a household is refused outright — it
 * used to skip the check and so could read any child by id.
 */
export function assertParentOwnsChild(
  ctx: ApiAuthContext,
  student: Pick<SisStudent, "householdId">,
): void {
  const householdId = requireParentHousehold(ctx);
  if (!student.householdId || student.householdId !== householdId) {
    throw new ApiError("forbidden", "Not your child", 403);
  }
}
