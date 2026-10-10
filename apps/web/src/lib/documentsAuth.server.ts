/**
 * Authorization for the Drive document upload/serve routes — covers all
 * four upload surfaces from docs/GOOGLE_DRIVE_DOCUMENTS_PLAN.md Phase 4:
 * staff editing a student's docs, staff editing another staff member's
 * docs (HR/office), a parent uploading/viewing their own child's docs,
 * and a staff member uploading/viewing their own HR docs.
 *
 * "Own record" access is independent of RBAC module permission — a parent
 * or a regular teacher isn't granted "students"/"staff" edit, but must
 * still be able to reach their own linked record.
 */

import { NextResponse } from "next/server";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { hasMirrorSyncSecret } from "@/lib/apiRouteAuth.server";
import { hasPermission, type RbacAction } from "@/lib/rbac";
import { ApiError } from "@/lib/api/v1/errors";
import { subjectRbacModule, type DocumentSubject } from "@/lib/documentsRouting";

export type DocumentAuthResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

/**
 * `recordHouseholdId` is the target student's actual household_id (from
 * fetchSisStudentDocsById) — pass "" / undefined when the record wasn't
 * found; a missing record can never match a parent's householdId anyway.
 */
export async function authorizeDocumentAction(
  request: Request,
  subject: DocumentSubject,
  subjectId: string,
  action: RbacAction,
  recordHouseholdId?: string,
): Promise<DocumentAuthResult> {
  if (hasMirrorSyncSecret(request)) return { ok: true };

  let session, masters, rbac;
  try {
    const ctx = await resolveApiAuth(request);
    session = ctx.session;
    masters = ctx.masters;
    rbac = ctx.rbac;
  } catch (e) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: e instanceof ApiError ? e.message : "Unauthorized" },
        { status: 401 },
      ),
    };
  }

  const forbidden = () =>
    ({
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });

  if (session.persona === "staff") {
    if (hasPermission(session, masters, subjectRbacModule(subject), action, rbac)) {
      return { ok: true };
    }
    if (subject === "staff" && session.staffId && session.staffId === subjectId) {
      return { ok: true };
    }
    return forbidden();
  }

  if (session.persona === "parent" && subject === "student") {
    if (
      session.householdId &&
      recordHouseholdId &&
      session.householdId === recordHouseholdId
    ) {
      return { ok: true };
    }
    return forbidden();
  }

  return forbidden();
}
