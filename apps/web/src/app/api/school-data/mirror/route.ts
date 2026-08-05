import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  hasMirrorSyncSecret,
  requireStaffApi,
  requireStaffPermission,
} from "@/lib/apiRouteAuth.server";
import {
  ensureSchoolMirrorHydrated,
  ensureSchoolMirrorLoaded,
  writeSchoolMirror,
} from "@/lib/schoolDataMirror.server";
import { getSchoolMirrorSync } from "@/lib/schoolDataMirror";

export const runtime = "nodejs";

type MirrorSlice = "sis" | "fees" | "payments" | "masters" | "admissions";

const SLICE_RBAC: Record<
  MirrorSlice,
  "students" | "fees" | "masters" | "admissions"
> = {
  sis: "students",
  fees: "fees",
  payments: "fees",
  masters: "masters",
  admissions: "admissions",
};

export async function GET(req: Request) {
  const auth = hasMirrorSyncSecret(req)
    ? await requireStaffApi(req)
    : await requireStaffPermission(req, "masters", "view");
  if (!auth.ok) return auth.response;

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
  const slices = Object.keys(body).filter(
    (k) => body[k as keyof typeof body] !== undefined,
  ) as MirrorSlice[];
  if (slices.length === 0) {
    return NextResponse.json({ error: "No slices" }, { status: 400 });
  }

  if (hasMirrorSyncSecret(req)) {
    const auth = await requireStaffApi(req);
    if (!auth.ok) return auth.response;
  } else {
    for (const slice of slices) {
      const auth = await authorizeSchoolDataDesk(
        req,
        SLICE_RBAC[slice],
        "POST",
      );
      if (!auth.ok) return auth.response;
    }
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
