import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
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

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  const session = await getDemoSession();
  return !!session;
}

/** GET — pull admissions desk from normalized tables */
export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { state, meta } = await fetchAdmissionDeskFromDb();
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
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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
