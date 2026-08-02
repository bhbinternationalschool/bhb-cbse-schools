import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { TransportState } from "@/lib/transport";
import { transportDualWriteDbEnabled } from "@/lib/transportDbConfig";
import {
  fetchTransportDeskFromDb,
  pushTransportDeskToDb,
} from "@/lib/transportNormalized.server";

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
  const { bundle, meta } = await fetchTransportDeskFromDb();
  return NextResponse.json({
    ok: true,
    ...bundle,
    routeCount: bundle.routes.length,
    vehicleCount: bundle.vehicles.length,
    assignmentCount: bundle.assignments.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!transportDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "TRANSPORT_DUAL_WRITE_DB disabled",
    });
  }

  let body: TransportState;
  try {
    body = (await req.json()) as TransportState;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushTransportDeskToDb({
    version: 2,
    feePolicy: body.feePolicy,
    routes: body.routes ?? [],
    assignments: body.assignments ?? [],
    vehicles: body.vehicles ?? [],
    dealers: body.dealers ?? [],
    fuelStockLocations: body.fuelStockLocations ?? [],
    fuelPurchases: body.fuelPurchases ?? [],
    fuelRefillLogs: body.fuelRefillLogs ?? [],
    payables: body.payables ?? [],
    vehicleLoans: body.vehicleLoans ?? [],
    emiSchedule: body.emiSchedule ?? [],
    insurancePolicies: body.insurancePolicies ?? [],
    certificateRenewals: body.certificateRenewals ?? [],
    serviceJobCards: body.serviceJobCards ?? [],
    repairRequests: body.repairRequests ?? [],
    boardingEvents: body.boardingEvents ?? [],
    gpsPings: body.gpsPings ?? [],
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    routeCount: body.routes?.length ?? 0,
    vehicleCount: body.vehicles?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
