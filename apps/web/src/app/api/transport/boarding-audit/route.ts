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
 * Three sources, best first: a per-student pin from
 * sis_student_transport_point, then the household's own Google geocode, then
 * the village centroid. Each row says which it used, and the audit's noise
 * floor moves with it — a 400 metre gap is meaningless against a centroid and
 * worth asking about against a doorstep.
 *
 * Household geocodes were computed in the browser and discarded on every save
 * until 11 Sep 2026, which is why the centroid was the only option and why
 * this will sharpen as families are re-geocoded rather than all at once.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchBoardingHomes } from "@/lib/boardingHomes.server";
import {
  auditBoardingPoints,
  clusterByAssignedStop,
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

  // Village centroid, the family's geocode, then a per-student pin — one
  // reader, shared with the AI boarding-point suggestion so the two screens
  // cannot disagree about where a child lives.
  const located = await fetchBoardingHomes(sb, tenantId);
  if (!located.ok) {
    return NextResponse.json({ error: located.error }, { status: 502 });
  }
  const { homes, pins: pinByStudent, names: nameById } = located;

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
