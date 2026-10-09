import { NextResponse } from "next/server";
import { readRevsParam } from "@/lib/sliceRevMerge";
import { SCHOOL_DATA_DESK_RBAC } from "@/lib/apiRouteAuth.server";
import {
  deskReadGate,
  deskWriteGate,
  featurePushOutcome,
  featureSavedResponse,
  stripDeskForFeatures,
} from "@/lib/deskFeatureGate.server";
import type { TransportState } from "@/lib/transport";
import { transportDualWriteDbEnabled } from "@/lib/transportDbConfig";
import {
  fetchTransportDeskFromDb,
  pushTransportDeskToDb,
  TRANSPORT_SLICE_KEYS,
} from "@/lib/transportNormalized.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  // The whole desk, or — holding Transport functions only — their slices.
  const gate = await deskReadGate(req, SCHOOL_DATA_DESK_RBAC["transport-desk"]);
  if (gate.mode === "deny") return gate.response;
  const { bundle: full, meta, ok } = await fetchTransportDeskFromDb();
  const bundle = gate.mode === "feature" ? stripDeskForFeatures("transport", full, gate) : full;
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
  const gate = await deskWriteGate(req, SCHOOL_DATA_DESK_RBAC["transport-desk"]);
  if (gate.mode === "deny") return gate.response;
  if (!transportDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "TRANSPORT_DUAL_WRITE_DB disabled",
    });
  }

  let body: TransportState & { revs?: unknown };
  try {
    body = (await req.json()) as TransportState & { revs?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  // Which rows this browser changed, and from which `_rev`. Absent = an older
  // browser: its rows win as before.
  const revs = readRevsParam(body.revs, TRANSPORT_SLICE_KEYS);

  // Function-only writers (e.g. Transport → Fuel log): merged onto the
  // stored desk, only their functions' slices — never the body as sent.
  if (gate.mode === "feature") {
    const stored = await fetchTransportDeskFromDb();
    if (!stored.ok) {
      return NextResponse.json(
        { ok: false, error: "Could not read the saved transport desk — nothing was written. Try again." },
        { status: 503 },
      );
    }
    const merged = featurePushOutcome(gate, "transport", stored.bundle, body);
    if (!merged.ok) return merged.response;
    if (!merged.changed) return featureSavedResponse(false);
    body = merged.state as unknown as TransportState;
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
  }, { revs });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  if (gate.mode === "feature") {
    if (result.conflicts && Object.keys(result.conflicts).length) {
      return NextResponse.json({ ok: true, functionOnly: true, changed: true, conflicts: result.conflicts });
    }
    return featureSavedResponse(true);
  }
  return NextResponse.json({
    ok: true,
    // New `_rev` of each row written, and rows refused because they changed
    // elsewhere first — the browser updates its versions / reloads.
    revs: result.revs ?? {},
    conflicts: result.conflicts ?? {},
    routeCount: body.routes?.length ?? 0,
    vehicleCount: body.vehicles?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
