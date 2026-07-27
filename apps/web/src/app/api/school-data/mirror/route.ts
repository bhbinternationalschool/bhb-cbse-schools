import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import {
  ensureSchoolMirrorHydrated,
  ensureSchoolMirrorLoaded,
  writeSchoolMirror,
} from "@/lib/schoolDataMirror.server";
import { getSchoolMirrorSync } from "@/lib/schoolDataMirror";

export const runtime = "nodejs";

async function authorizeMirrorRequest(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  const session = await getDemoSession();
  return !!session;
}

export async function GET(req: Request) {
  if (!(await authorizeMirrorRequest(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const mirror = await ensureSchoolMirrorHydrated();
  const leadCount = Array.isArray(
    (mirror.admissions as { leads?: unknown[] } | null)?.leads,
  )
    ? ((mirror.admissions as { leads: unknown[] }).leads.length ?? 0)
    : 0;
  return NextResponse.json({
    version: mirror.version,
    updatedAt: mirror.updatedAt,
    hasSis: !!mirror.sis,
    hasFees: !!mirror.fees,
    hasPayments: !!mirror.payments,
    hasMasters: !!mirror.masters,
    hasAdmissions: !!mirror.admissions,
    leadCount,
    sis: mirror.sis,
    fees: mirror.fees,
    payments: mirror.payments,
    masters: mirror.masters,
    admissions: mirror.admissions,
  });
}

export async function POST(req: Request) {
  if (!(await authorizeMirrorRequest(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: {
    sis?: unknown;
    fees?: unknown;
    payments?: unknown;
    masters?: unknown;
    admissions?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  await ensureSchoolMirrorLoaded();
  const patch: {
    sis?: unknown;
    fees?: unknown;
    payments?: unknown;
    masters?: unknown;
    admissions?: unknown;
  } = {};
  if (body.sis !== undefined) patch.sis = body.sis;
  if (body.fees !== undefined) patch.fees = body.fees;
  if (body.payments !== undefined) patch.payments = body.payments;
  if (body.masters !== undefined) patch.masters = body.masters;
  if (body.admissions !== undefined) patch.admissions = body.admissions;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No slices" }, { status: 400 });
  }
  const result = await writeSchoolMirror(patch);
  const status = result.supabaseSynced ? 200 : 502;
  return NextResponse.json(
    {
      ok: result.supabaseSynced,
      updatedAt: result.mirror.updatedAt,
      slices: Object.keys(patch),
      mirrorUpdatedAt: getSchoolMirrorSync().updatedAt,
      leadCount: result.leadCount,
      supabaseSynced: result.supabaseSynced,
      supabaseError: result.supabaseError ?? null,
    },
    { status },
  );
}
