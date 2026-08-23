import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { TransportState } from "@/lib/transport";
import { transportDualWriteDbEnabled } from "@/lib/transportDbConfig";
import {
  fetchTransportDeskFromDb,
  pushTransportDeskToDb,
} from "@/lib/transportNormalized.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["transport-desk"], "GET");
  if (!auth.ok) return auth.response
  const { bundle, meta, ok } = await fetchTransportDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Transport desk fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
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
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["transport-desk"], "POST");
  if (!auth.ok) return auth.response
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
    staffRiders: body.staffRiders ?? [],
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
