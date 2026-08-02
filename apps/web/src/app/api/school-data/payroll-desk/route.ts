import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { PayrollState } from "@/lib/payroll";
import { payrollDualWriteDbEnabled } from "@/lib/payrollDbConfig";
import {
  fetchPayrollDeskFromDb,
  pushPayrollDeskToDb,
} from "@/lib/payrollNormalized.server";

export const runtime = "nodejs";

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  return !!(await getDemoSession());
}

export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { bundle, meta } = await fetchPayrollDeskFromDb();
  return NextResponse.json({
    ok: true,
    ...bundle,
    runCount: bundle.runs.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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
