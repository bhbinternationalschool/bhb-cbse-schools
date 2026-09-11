/**
 * GET /api/transport/boarding-audit
 *
 * Riders sitting further from their assigned stop than from another stop on
 * the same bus — the case findMisroutedRiders deliberately skips.
 *
 * Server-side rather than in the browser, because the home location is only
 * available here. Household coordinates live in the desk's client state and
 * are persisted nowhere: no table in this database has a household lat/lng.
 * What IS on the server is the village a household was matched to, and the
 * census centroid of that village — right village, not right corner, which is
 * enough to catch a rider assigned four kilometres away and nothing finer.
 *
 * A per-student pin from sis_student_transport_point is preferred whenever one
 * exists. That table is empty today, so every row currently reports village
 * precision — but the moment the office pins a child, this sharpens for that
 * child with no further change.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import {
  auditBoardingPoints,
  clusterByAssignedStop,
  type BoardingHome,
} from "@/lib/boardingPointAudit";
import {
  deskBundleToTransportState,
  fetchTransportDeskFromDb,
} from "@/lib/transportNormalized.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  // No DEFAULT_AY fallback. Every caller knows which year it is asking about,
  // and answering for an invented year would quietly audit the wrong roster —
  // the exact failure the default_ay ratchet exists to stop. Refuse instead.
  const ay = url.searchParams.get("ay")?.trim();
  if (!ay) {
    return NextResponse.json(
      { error: "academicYearCode (ay) is required" },
      { status: 400 },
    );
  }
  const minGapKm = Number(url.searchParams.get("minGapKm")) || 1;

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json(
      { error: "Server tenant context unavailable" },
      { status: 503 },
    );
  }
  const { sb, tenantId } = ctx;

  const desk = await fetchTransportDeskFromDb();
  if (!desk.ok) {
    // "No riders are misplaced" and "the desk could not be read" are opposite
    // answers to the question this endpoint exists for.
    return NextResponse.json({ error: "Could not read the transport desk" }, { status: 502 });
  }
  const state = deskBundleToTransportState(desk.bundle);

  // Village centroids, one per household. Two plain reads and a join in
  // TypeScript rather than a PostgREST embed — the embed returns the parent
  // as an array or an object depending on how the relationship is inferred,
  // and a silently-empty join here would read as "no household has a home".
  const villages = await fetchAllPages<{
    household_id: string;
    village_id: string | null;
    village_name: string | null;
  }>((from, to) =>
    sb
      .from("sis_household_village")
      .select("household_id, village_id, village_name")
      .eq("tenant_id", tenantId)
      .order("household_id", { ascending: true })
      .range(from, to),
  );
  if (villages.error) {
    return NextResponse.json({ error: villages.error }, { status: 502 });
  }

  const geo = await fetchAllPages<{
    id: string;
    latitude: number | null;
    longitude: number | null;
  }>((from, to) =>
    sb
      .from("village_demographics")
      .select("id, latitude, longitude")
      .eq("tenant_id", tenantId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (geo.error) {
    return NextResponse.json({ error: geo.error }, { status: 502 });
  }
  const geoById = new Map(geo.rows.map((v) => [v.id, v]));

  const homes = new Map<string, BoardingHome>();
  for (const row of villages.rows) {
    const v = row.village_id ? geoById.get(row.village_id) : null;
    if (!v || !Number.isFinite(v.latitude) || !Number.isFinite(v.longitude)) continue;
    homes.set(row.household_id, {
      lat: Number(v.latitude),
      lng: Number(v.longitude),
      label: row.village_name?.trim() || "village",
      precision: "village",
    });
  }

  // A pin beats a centroid. Per student, so it has to be applied against the
  // household each assignment names — see the loop below.
  const pins = await fetchAllPages<{
    student_id: string;
    latitude: number | null;
    longitude: number | null;
    point_name: string | null;
  }>((from, to) =>
    sb
      .from("sis_student_transport_point")
      .select("student_id, latitude, longitude, point_name")
      .eq("tenant_id", tenantId)
      .order("student_id", { ascending: true })
      .range(from, to),
  );
  const pinByStudent = new Map<string, BoardingHome>();
  for (const p of pins.rows) {
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
    pinByStudent.set(p.student_id, {
      lat: Number(p.latitude),
      lng: Number(p.longitude),
      label: p.point_name?.trim() || "pinned point",
      precision: "pin",
    });
  }
  const names = await fetchAllPages<{ id: string; full_name: string | null }>((from, to) =>
    sb
      .from("sis_students")
      .select("id, full_name")
      .eq("tenant_id", tenantId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const nameById = new Map(names.rows.map((r) => [r.id, r.full_name || r.id]));

  const result = auditBoardingPoints({
    state,
    homes,
    pins: pinByStudent,
    nameOf: (id) => nameById.get(id) || id,
    academicYearCode: ay,
    minGapKm,
  });

  return NextResponse.json({
    academicYearCode: ay,
    minGapKm,
    ...result,
    clusters: clusterByAssignedStop(result.flags),
  });
}
