import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { PayrollState } from "@/lib/payroll";
import { payrollDualWriteDbEnabled } from "@/lib/payrollDbConfig";
import {
  fetchPayrollDeskFromDb,
  pushPayrollDeskToDb,
} from "@/lib/payrollNormalized.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["payroll-desk"], "GET");
  if (!auth.ok) return auth.response
  const { bundle, meta, ok } = await fetchPayrollDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Failed to fetch payroll desk" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    ...bundle,
    runCount: bundle.runs.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["payroll-desk"], "POST");
  if (!auth.ok) return auth.response
  if (!payrollDualWriteDbEnabled()) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  let body: Pick<PayrollState, "runs" | "audit">;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushPayrollDeskToDb({
    version: 2,
    runs: body.runs ?? [],
    audit: body.audit ?? [],
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    runCount: body.runs?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
