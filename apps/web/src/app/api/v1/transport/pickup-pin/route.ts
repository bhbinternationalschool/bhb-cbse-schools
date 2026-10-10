/**
 * The parent app's "Set my pickup point" (director, 9 Oct 2026).
 *
 * The same pin the WhatsApp request collects (lib/transportPinIntake.server)
 * — one point for every riding child in the household, named back to the
 * parent — set on a map in the app instead: 98 of 117 families never
 * answered the WhatsApp request, and sharing a location there is fiddly.
 *
 * GET  → { riders, pin, stops, school, declined }
 * POST { action: "save", lat, lng, accuracyM? } → saved for every rider
 * POST { action: "decline" }                     → "Not now", not asked again
 *
 * Nothing here moves a child: a pin is where they stand. Their route, stop
 * and fee stay the office's decision.
 */

import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { getServerTenantContext } from "@/lib/serverTenant";
import { TENANT } from "@/lib/types";
import { checkPinPlausible, MAX_PIN_KM_FROM_SCHOOL } from "@/lib/transportPinIntake";
import { ridersOfHousehold } from "@/lib/transportPinIntake.server";
import { deskBundleToTransportState, fetchTransportDeskFromDb } from "@/lib/transportNormalized.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function pinRequestStatus(householdId: string): Promise<string> {
  const ctx = await getServerTenantContext();
  if (!ctx) return "";
  const { data } = await ctx.sb
    .from("sis_transport_pin_request")
    .select("status")
    .eq("tenant_id", ctx.tenantId)
    .eq("household_id", householdId)
    .maybeSingle();
  return data?.status ? String(data.status) : "";
}

/** Record the family's answer, whether or not they were ever asked on WhatsApp. */
async function setPinRequest(householdId: string, status: "pinned" | "declined", note: string): Promise<void> {
  const ctx = await getServerTenantContext();
  if (!ctx) return;
  const now = new Date().toISOString();
  const { error } = await ctx.sb.from("sis_transport_pin_request").upsert(
    {
      household_id: householdId,
      tenant_id: ctx.tenantId,
      status,
      responded_at: now,
      note: note.slice(0, 400),
      updated_at: now,
    },
    { onConflict: "household_id" },
  );
  if (error) console.error("[transport/pickup-pin] request row not updated", householdId, error.message);
}

export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    const riders = await ridersOfHousehold(householdId);
    const tenant = await getServerTenantContext();
    if (!tenant) throw new ApiError("server_error", "Tenant unavailable", 503);

    let pin: { lat: number; lng: number; updatedAt: string; setBy: string } | null = null;
    if (riders.length) {
      const { data, error } = await tenant.sb
        .from("sis_student_transport_point")
        .select("latitude, longitude, updated_at, set_by")
        .eq("tenant_id", tenant.tenantId)
        .in("student_id", riders.map((r) => r.studentId))
        .order("updated_at", { ascending: false })
        .limit(1);
      if (error) throw new ApiError("server_error", "Could not read the pickup point", 503);
      const row = data?.[0];
      if (row && Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude))) {
        pin = { lat: Number(row.latitude), lng: Number(row.longitude), updatedAt: String(row.updated_at || ""), setBy: String(row.set_by || "") };
      }
    }

    // The stops of the routes these children ride, so the parent sees where
    // the bus already halts.
    const stops: { name: string; lat: number; lng: number }[] = [];
    const desk = await fetchTransportDeskFromDb();
    if (desk.ok && riders.length) {
      const state = deskBundleToTransportState(desk.bundle);
      const riderIds = new Set(riders.map((r) => r.studentId));
      const routeIds = new Set(state.assignments.filter((a) => a.effectiveTo == null && riderIds.has(a.studentId)).map((a) => a.routeId));
      for (const r of state.routes) {
        if (!routeIds.has(r.id)) continue;
        for (const s of r.stops) {
          if (typeof s.geoLat === "number" && typeof s.geoLng === "number") stops.push({ name: s.name, lat: s.geoLat, lng: s.geoLng });
        }
      }
    }

    return apiOk({
      riders: riders.map((r) => ({ studentId: r.studentId, name: r.fullName })),
      pin,
      stops,
      school: { lat: TENANT.schoolLat, lng: TENANT.schoolLng },
      maxKm: MAX_PIN_KM_FROM_SCHOOL,
      declined: (await pinRequestStatus(householdId)) === "declined",
    });
  } catch (e) {
    return apiErr(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.action === "decline") {
      await setPinRequest(householdId, "declined", "Not now — in the parent app");
      return apiOk({ declined: true });
    }
    if (body.action !== "save") throw new ApiError("bad_request", "action must be save or decline", 400);

    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const plausible = checkPinPlausible({ lat, lng }, { lat: TENANT.schoolLat, lng: TENANT.schoolLng });
    if (!plausible.ok) {
      if (plausible.reason === "too-far") {
        throw new ApiError(
          "bad_request",
          `This point is ${plausible.kmFromSchool} km from school — please set it from home, or drag the pin to where your child boards.`,
          400,
        );
      }
      throw new ApiError("bad_request", "That is not a place on the map.", 400);
    }

    const riders = await ridersOfHousehold(householdId);
    if (!riders.length) throw new ApiError("bad_request", "None of your children rides a school bus yet.", 400);

    const tenant = await getServerTenantContext();
    if (!tenant) throw new ApiError("server_error", "Tenant unavailable", 503);
    const accuracy = Number(body.accuracyM);
    const now = new Date().toISOString();
    const { error } = await tenant.sb.from("sis_student_transport_point").upsert(
      riders.map((r) => ({
        student_id: r.studentId,
        tenant_id: tenant.tenantId,
        latitude: lat,
        longitude: lng,
        point_name: "",
        note: [
          "Set by the family in the parent app",
          Number.isFinite(accuracy) && accuracy > 0 ? `· phone GPS ±${Math.round(accuracy)} m` : "· placed on the map",
          riders.length > 1 ? `· one pin for ${riders.length} children` : "",
        ]
          .filter(Boolean)
          .join(" ")
          .slice(0, 400),
        set_by: "family (app)",
        updated_at: now,
      })),
      { onConflict: "student_id" },
    );
    // Never "saved" for a pin that was not stored — the family would not set it again.
    if (error) throw new ApiError("server_error", "Could not save the pickup point — please try again.", 503);
    await setPinRequest(householdId, "pinned", `app · ${riders.length} child(ren) · ${plausible.kmFromSchool} km from school`);
    return apiOk({ saved: true, children: riders.map((r) => r.fullName), kmFromSchool: plausible.kmFromSchool });
  } catch (e) {
    return apiErr(e);
  }
}
