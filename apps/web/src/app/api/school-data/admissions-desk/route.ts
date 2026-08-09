import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import {
  normalizeAdmissionsState,
  type AdmissionsState,
} from "@/lib/admissions";
import { admissionsDualWriteDbEnabled } from "@/lib/admissionsDbConfig";
import {
  fetchAdmissionDeskFromDb,
  pushAdmissionDeskToDb,
} from "@/lib/admissionsNormalized.server";

export const runtime = "nodejs";

/** GET — pull admissions desk from normalized tables */
export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["admissions-desk"], "GET");
  if (!auth.ok) return auth.response
  const { state, meta, ok } = await fetchAdmissionDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Admissions desk fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    state,
    leadCount: state.leads.length,
    householdCount: state.households.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

/** POST — push full admissions desk snapshot */
export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["admissions-desk"], "POST");
  if (!auth.ok) return auth.response
  if (!admissionsDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "ADMISSIONS_DUAL_WRITE_DB disabled",
    });
  }

  let body: { state?: Partial<AdmissionsState> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.state) {
    return NextResponse.json({ error: "Missing state" }, { status: 400 });
  }

  const normalized = normalizeAdmissionsState(body.state);
  const result = await pushAdmissionDeskToDb(normalized);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    leadCount: normalized.leads.length,
    householdCount: normalized.households.length,
    updatedAt: new Date().toISOString(),
  });
}
