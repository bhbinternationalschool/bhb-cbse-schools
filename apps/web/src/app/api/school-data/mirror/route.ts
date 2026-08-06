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

export async function GET() {
  return NextResponse.json({
    version: 2,
    updatedAt: new Date().toISOString(),
    hasSis: true,
    hasFees: true,
    hasPayments: true,
    hasMasters: true,
    hasAdmissions: true,
    leadCount: 0,
    skipped: true,
  });
}

export async function POST() {
  return NextResponse.json({
    ok: true,
    skipped: true,
    reason: "Direct DB cutover enabled",
  });
}
