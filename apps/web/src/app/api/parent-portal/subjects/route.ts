/**
 * The parent web portal's Subjects tab (/parent → Subjects).
 *
 *   GET  — the signed-in parent's children with their confirmed subjects, any
 *          pending change request, and the school structure the picker needs.
 *   POST — {studentId, proposedStreamId, proposedChosenSubjectIds, note}: a
 *          subject-change request for the office, validated on the server.
 *
 * The household is always the session's (lib/api/v1/household); a child of
 * another family is refused. Staff are refused: they use Students → Subjects.
 * See lib/parentSubjects.server.ts.
 */
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { ApiError, apiErr, apiOk } from "@/lib/api/v1/errors";
import { requireParentHousehold } from "@/lib/api/v1/household";
import {
  readParentSubjects,
  submitParentSubjectRequest,
} from "@/lib/parentSubjects.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function codeFor(status: number) {
  return status === 403
    ? "forbidden"
    : status === 404
      ? "not_found"
      : status === 409
        ? "conflict"
        : status === 400
          ? "bad_request"
          : "server_error";
}

export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    const read = await readParentSubjects(
      householdId,
      ctx.session.academicYearCode || "",
    );
    if (!read.ok)
      throw new ApiError(codeFor(read.status), read.error, read.status);
    return apiOk(read.view, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return apiErr(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    const body = (await request.json().catch(() => ({}))) as {
      studentId?: unknown;
      proposedStreamId?: unknown;
      proposedChosenSubjectIds?: unknown;
      note?: unknown;
    };
    const studentId =
      typeof body.studentId === "string" ? body.studentId.trim() : "";
    if (!studentId)
      throw new ApiError("bad_request", "studentId required", 400);
    const r = await submitParentSubjectRequest({
      householdId,
      studentId,
      proposedStreamId:
        typeof body.proposedStreamId === "string" && body.proposedStreamId
          ? body.proposedStreamId
          : null,
      proposedChosenSubjectIds: Array.isArray(body.proposedChosenSubjectIds)
        ? body.proposedChosenSubjectIds.filter(
            (x): x is string => typeof x === "string",
          )
        : [],
      note: typeof body.note === "string" ? body.note.trim() : "",
    });
    if (!r.ok) throw new ApiError(codeFor(r.status), r.error, r.status);
    return apiOk({ requestId: r.request.id, status: r.request.status });
  } catch (e) {
    return apiErr(e);
  }
}
