import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import {
  normalizeAdmissionsState,
  type AdmissionsState,
} from "@/lib/admissions";
import { fetchServerBlob, pushServerBlob } from "@/lib/serverBlob";
import { pushAdmissionsRemoteServer } from "@/lib/admissionsPersistence";

export const runtime = "nodejs";

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  const session = await getDemoSession();
  return !!session;
}

export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const remote = await fetchServerBlob<AdmissionsState>("admissions_state");
  const state = remote.state
    ? normalizeAdmissionsState(remote.state as Partial<AdmissionsState>)
    : null;
  const leadCount = state?.leads?.length ?? 0;
  return NextResponse.json({
    state,
    leadCount,
    updatedAt: remote.updatedAt,
  });
}

export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  const pushed = await pushAdmissionsRemoteServer(normalized);
  if (!pushed.ok) {
    return NextResponse.json(
      { ok: false, error: pushed.error || "Supabase sync failed" },
      { status: 502 },
    );
  }

  // Keep WhatsApp mirror slice warm
  const { writeSchoolMirror } = await import("@/lib/schoolDataMirror.server");
  await writeSchoolMirror({ admissions: normalized });

  return NextResponse.json({
    ok: true,
    leadCount: normalized.leads.length,
    householdCount: normalized.households.length,
  });
}
