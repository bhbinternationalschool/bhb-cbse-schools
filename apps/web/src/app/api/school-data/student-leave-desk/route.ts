import { NextResponse } from "next/server";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import {
  deskFeatureGateFor,
  deskReadGate,
  featurePushOutcome,
  featureSavedResponse,
  stripDeskForFeatures,
  type FeatureGate,
} from "@/lib/deskFeatureGate.server";
import type { StudentLeaveState } from "@/lib/studentLeave";
import { studentLeaveDualWriteDbEnabled } from "@/lib/studentLeaveDbConfig";
import {
  fetchStudentLeaveDeskFromDb,
  pushStudentLeaveDeskToDb,
  STUDENT_LEAVE_DELETABLE_TABLES,
  STUDENT_LEAVE_TABLE_SLICES,
} from "@/lib/studentLeaveNormalized.server";
import { readNamedDeletes } from "@/lib/deskNamedDeletes.server";
import { featureAuthorizedDeletes } from "@/lib/deskNamedDeletesFeature.server";

export const runtime = "nodejs";

/** GET — pull student leave desk from normalized tables */
export async function GET(req: Request) {
  // The whole desk, or — holding Student leave functions only — their slices.
  const gate = await deskReadGate(req, SCHOOL_DATA_DESK_RBAC["student-leave-desk"]);
  if (gate.mode === "deny") return gate.response;
  const { bundle: full, meta, ok } = await fetchStudentLeaveDeskFromDb();
  const bundle = gate.mode === "feature" ? stripDeskForFeatures("student_leave", full, gate) : full;
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Failed to fetch student leave desk" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    requests: bundle.requests,
    requestCount: bundle.requests.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

type StudentLeaveDeskPostBody = Pick<StudentLeaveState, "requests"> & { deletes?: unknown };

/** POST — push full student leave desk snapshot */
export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["student-leave-desk"], "POST");
  // Without the module: a function holder's save, or refused.
  let gate: FeatureGate | null = null;
  if (!auth.ok) {
    if (auth.response.status !== 403) return auth.response;
    gate = await deskFeatureGateFor(req, "student_leave", "write");
    if (!gate) return auth.response;
  }
  // This push replaces the whole school's leave desk (rows it does not
  // carry are pruned). "student_leave.edit" alone let a teacher's browser
  // send it — a stale copy could undo other classes' decisions. Teachers
  // decide one request at a time through /api/v1/staff/student-leave/decide
  // (2026-09-29); this route is the office's.
  // A function holder is held to it too: the function says what may change,
  // not that a class teacher's browser may push the school's desk.
  const scopeCtx = gate ? gate.ctx : auth.ok && !auth.viaMirrorSecret ? auth.ctx : null;
  if (scopeCtx) {
    const scope = await staffSectionScope(scopeCtx).catch(() => null);
    if (!scope?.unrestricted) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Only the office or principal can save the full student leave desk. " +
            "Approve or reject your own class's requests from the Pending list.",
        },
        { status: 403 },
      );
    }
  }
  if (!studentLeaveDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "STUDENT_LEAVE_DUAL_WRITE_DB disabled",
    });
  }

  let body: StudentLeaveDeskPostBody;
  try {
    body = (await req.json()) as StudentLeaveDeskPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Deletions are named by the desk, never inferred from what it lacks.
  let deletes = readNamedDeletes(body.deletes, STUDENT_LEAVE_DELETABLE_TABLES);

  // Function holders: merged onto the stored desk, request by request.
  if (gate) {
    const stored = await fetchStudentLeaveDeskFromDb();
    if (!stored.ok) {
      return NextResponse.json(
        { ok: false, error: "Could not read the saved leave desk — nothing was written. Try again." },
        { status: 503 },
      );
    }
    const merged = featurePushOutcome(gate, "student_leave", stored.bundle, body);
    if (!merged.ok) return merged.response;
    if (!merged.changed) return featureSavedResponse(false);
    deletes = featureAuthorizedDeletes(deletes, STUDENT_LEAVE_TABLE_SLICES, stored.bundle, merged.state);
    body = merged.state as unknown as StudentLeaveDeskPostBody;
  }

  const result = await pushStudentLeaveDeskToDb({
    version: 1,
    requests: Array.isArray(body.requests) ? body.requests : [],
  }, deletes);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  // Requests decided or withdrawn elsewhere are kept as stored; the browser
  // reloads them.
  const kept = result.kept ?? [];
  if (gate) {
    return kept.length
      ? NextResponse.json({ ok: true, functionOnly: true, changed: true, unchanged: false, kept })
      : featureSavedResponse(true);
  }
  return NextResponse.json({
    ok: true,
    kept,
    requestCount: body.requests?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
