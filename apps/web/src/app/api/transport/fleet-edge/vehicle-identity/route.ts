/**
 * Vehicle identity (model + year) keyed by VIN — see the migration's header
 * comment for why this is a small standalone table rather than a migration
 * of the existing FleetVehicle desk slice. Staff record model/year here so
 * the Fleet Dashboard can tell apart same-model vehicles that differ only
 * by year, since neither Fleet Edge push API ever sends that.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Server tenant context unavailable" }, { status: 503 });
  }
  const { sb, tenantId } = ctx;

  const { data, error } = await sb
    .from("fleet_edge_vehicle_identity")
    .select("vin, registration_number, model, year, name, fuel_type")
    .eq("tenant_id", tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, vehicles: data || [] });
}

type UpsertBody = {
  vin?: unknown;
  registrationNumber?: unknown;
  model?: unknown;
  year?: unknown;
  name?: unknown;
  /** diesel | petrol | cng | petrol_cng | diesel_cng | electric — Fleet Edge never sends this. */
  fuelType?: unknown;
};

const FUEL_TYPES = new Set(["diesel", "petrol", "cng", "petrol_cng", "diesel_cng", "electric"]);

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "edit");
  if (!auth.ok) return auth.response;

  let body: UpsertBody;
  try {
    body = (await req.json()) as UpsertBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.vin !== "string" || !body.vin.trim()) {
    return NextResponse.json({ error: "vin is required" }, { status: 400 });
  }

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Server tenant context unavailable" }, { status: 503 });
  }
  const { sb, tenantId } = ctx;

  const year = typeof body.year === "number" && Number.isFinite(body.year) ? body.year : null;
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
  const fuelType =
    typeof body.fuelType === "string" && FUEL_TYPES.has(body.fuelType.trim().toLowerCase())
      ? body.fuelType.trim().toLowerCase()
      : null;
  const registrationNumber =
    typeof body.registrationNumber === "string" && body.registrationNumber.trim()
      ? body.registrationNumber.trim()
      : null;

  const { error } = await sb.from("fleet_edge_vehicle_identity").upsert(
    {
      tenant_id: tenantId,
      vin: body.vin.trim(),
      registration_number: registrationNumber,
      model,
      year,
      name,
      fuel_type: fuelType,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,vin" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
