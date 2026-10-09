import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import { deskReadGate, visibleSlices } from "@/lib/deskFeatureGate.server";
import type { PayrollState } from "@/lib/payroll";
import { payrollDualWriteDbEnabled } from "@/lib/payrollDbConfig";
import { readNamedDeletes } from "@/lib/deskNamedDeletes.server";
import {
  PAYROLL_DELETABLE_TABLES,
  fetchPayrollDeskFromDb,
  pushPayrollDeskToDb,
} from "@/lib/payrollNormalized.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  // The Payroll grant, or the read-only "Payroll runs & payslips" function,
  // which owns both desk keys — its reader gets the whole desk, never a
  // cut-down copy. Writing payslips stays module-level (POST below).
  const gate = await deskReadGate(req, SCHOOL_DATA_DESK_RBAC["payroll-desk"]);
  if (gate.mode === "deny") return gate.response;
  if (gate.mode === "feature") {
    const seen = visibleSlices("payroll", gate);
    if (!seen.has("runs") || !seen.has("audit")) {
      return NextResponse.json(
        {
          ok: false,
          error: "Reading payroll runs needs the Payroll grant or the payslips function.",
          reason: "feature_forbidden",
        },
        { status: 403 },
      );
    }
  }
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

  let body: Pick<PayrollState, "runs" | "audit"> & { deletes?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushPayrollDeskToDb({
    version: 2,
    runs: body.runs ?? [],
    audit: body.audit ?? [],
  }, readNamedDeletes(body.deletes, PAYROLL_DELETABLE_TABLES));
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    runCount: body.runs?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
