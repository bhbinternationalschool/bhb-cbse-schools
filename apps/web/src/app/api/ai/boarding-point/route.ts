/**
 * POST /api/ai/boarding-point — where should this child board?
 *
 * Builds the shortlist from the desk and asks the model to weigh it. Nothing
 * is saved: the clerk sees a recommendation and applies it, or does not.
 *
 * THE SHORTLIST IS BUILT HERE, NOT SENT BY THE CLIENT
 * Every number on it — the walking distance, the seats, the sibling, whether
 * the bus was actually seen halting there — comes from the server's own copy
 * of the desk and the roster. Household coordinates are not in the browser's
 * state at all, and a client that supplied its own candidates could put a stop
 * on the shortlist that exists only in one unsaved tab.
 *
 * WHAT IS DELIBERATELY LEFT UNKNOWN
 * Fleet Edge has three days of trail. `clusterHalts` can say a bus was seen
 * halting somewhere, but three mornings cannot separate a pickup from a red
 * light — so below the same MIN_DAYS the halt-analysis screen uses, every
 * candidate's halt evidence is reported as `null` ("not enough history"), not
 * as 0 ("the bus does not stop there"). The second would be read as a reason
 * to avoid a perfectly good stop.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import { TENANT } from "@/lib/types";
import { generateBoardingSuggestionJson, llmStatus } from "@/lib/aiLlm.server";
import {
  boardingSuggestionWorthAsking,
  type BoardingCandidateFact,
  type BoardingSuggestFacts,
} from "@/lib/boardingSuggestAi";
import { fetchBoardingHomes, homeForStudent } from "@/lib/boardingHomes.server";
import { NOISE_FLOOR_KM } from "@/lib/boardingPointAudit";
import { clusterHalts, findHalts, istDay, type KnownStop, type TrailPoint } from "@/lib/haltClustering";
import {
  deskBundleToTransportState,
  fetchTransportDeskFromDb,
} from "@/lib/transportNormalized.server";
import { fetchSisFromDb } from "@/lib/sisNormalized.server";
import {
  expectedMonthlyFeePaise,
  haversineKm,
  listActiveRoutes,
  seatsOnRoute,
  stopHasGeo,
} from "@/lib/transport";
import { walkingDistances, mapsConfigured } from "@/lib/walkDistance.server";
import type { SisState } from "@/lib/sis";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Mornings of trail needed before a halt count means anything. */
const MIN_HALT_DAYS = 3;
/** How many nearest stops go to the model. Google takes 25 per matrix call. */
const SHORTLIST = 8;
/** Trail window. The whole table would grow without bound behind this call. */
const TRAIL_DAYS = 21;

export async function GET() {
  const status = llmStatus();
  return NextResponse.json({
    service: "boarding-point",
    llmConfigured: status.primaryEngine !== "none",
    primaryEngine: status.primaryEngine,
    mapsConfigured: mapsConfigured(),
    note: "POST { studentId, academicYearCode } — staff with transport:edit; returns a shortlist and a recommendation, saves nothing",
  });
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "edit");
  if (!auth.ok) return auth.response;

  let body: { studentId?: unknown; academicYearCode?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const studentId = String(body.studentId ?? "").trim();
  const ay = String(body.academicYearCode ?? "").trim();
  if (!studentId) {
    return NextResponse.json({ error: "studentId is required" }, { status: 400 });
  }
  // No DEFAULT_AY fallback — a shortlist built for an invented year would be
  // ranked against the wrong roster's seats and siblings.
  if (!ay) {
    return NextResponse.json(
      { error: "academicYearCode is required" },
      { status: 400 },
    );
  }

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Server tenant context unavailable" }, { status: 503 });
  }
  const { sb, tenantId } = ctx;

  const [desk, sisRes, located] = await Promise.all([
    fetchTransportDeskFromDb(),
    fetchSisFromDb(),
    fetchBoardingHomes(sb, tenantId),
  ]);
  // Each failure is reported as a failure. An empty desk or roster would
  // produce "no stops are suitable", which is the opposite of "we could not
  // look" and would be acted on.
  if (!desk.ok) {
    return NextResponse.json({ error: "Could not read the transport desk" }, { status: 502 });
  }
  if (!sisRes.ok) {
    return NextResponse.json({ error: "Could not read the student roster" }, { status: 502 });
  }
  if (!located.ok) {
    return NextResponse.json({ error: located.error }, { status: 502 });
  }

  const state = deskBundleToTransportState(desk.bundle);
  const sis = sisRes.bundle as unknown as SisState;

  const student = sis.students.find((s) => s.id === studentId);
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const home = homeForStudent(located, studentId, student.householdId || "");
  if (!home) {
    return NextResponse.json(
      {
        error:
          "This family has not been placed on the map — no pin for the child, no geocoded address, and no village matched. Pin their boarding point or geocode the address first; stops cannot be ranked around a place nobody has established.",
      },
      { status: 409 },
    );
  }

  const current = state.assignments.find(
    (a) => a.studentId === studentId && a.effectiveTo == null && a.academicYearCode === ay,
  );

  // Siblings already riding, by route, so "their brother is on this bus" is a
  // fact rather than a guess. Same household, different child, live this year.
  const siblingByRoute = new Map<string, string>();
  if (student.householdId) {
    const siblingIds = new Set(
      sis.students
        .filter((s) => s.householdId === student.householdId && s.id !== studentId)
        .map((s) => s.id),
    );
    for (const a of state.assignments) {
      if (a.effectiveTo != null || a.academicYearCode !== ay) continue;
      if (!siblingIds.has(a.studentId)) continue;
      if (siblingByRoute.has(a.routeId)) continue;
      const sib = sis.students.find((s) => s.id === a.studentId);
      if (sib) siblingByRoute.set(a.routeId, sib.fullName);
    }
  }

  // Every pinned stop, nearest first by straight line. The straight line only
  // picks WHICH stops are worth a paid walking lookup; it never reaches the
  // model as a distance when Google answers.
  const pinned: (KnownStop & { routeCode: string })[] = [];
  for (const route of listActiveRoutes(state)) {
    for (const s of route.stops) {
      if (!stopHasGeo(s)) continue;
      pinned.push({
        stopId: s.id,
        stopName: s.name,
        routeId: route.id,
        routeLabel: route.busNo || route.code,
        routeCode: route.code,
        lat: Number(s.geoLat),
        lng: Number(s.geoLng),
        riders: 0,
      });
    }
  }
  if (pinned.length === 0) {
    return NextResponse.json(
      { error: "No stop has been pinned on the map yet, so there is nothing to rank. Pin stops in Routes first." },
      { status: 409 },
    );
  }

  const nearest = pinned
    .map((p) => ({ p, km: haversineKm(home.lat, home.lng, p.lat, p.lng) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, SHORTLIST);

  const walks = await walkingDistances(
    { lat: home.lat, lng: home.lng },
    nearest.map((n) => ({ lat: n.p.lat, lng: n.p.lng })),
  );

  // Halt evidence, and the guard on it. Three days of trail cannot separate a
  // pickup from a traffic light, so below MIN_HALT_DAYS every candidate's
  // count is null rather than a number that would be believed.
  const since = new Date(Date.now() - TRAIL_DAYS * 86400000).toISOString();
  const trail = await fetchAllPages<{
    vehicle_ref: string;
    recorded_at: string;
    lat: number;
    lng: number;
    speed_kmh: number | null;
    ignition_on: boolean | null;
  }>((from, to) =>
    sb
      .from("fleet_vehicle_positions")
      .select("vehicle_ref, recorded_at, lat, lng, speed_kmh, ignition_on")
      .eq("tenant_id", tenantId)
      .gte("recorded_at", since)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const haltDaysByStop = new Map<string, number>();
  let daysObserved = 0;
  if (!trail.error) {
    const points: TrailPoint[] = trail.rows.map((r) => ({
      vehicleRef: r.vehicle_ref,
      at: r.recorded_at,
      lat: r.lat,
      lng: r.lng,
      speedKmh: r.speed_kmh,
      ignitionOn: r.ignition_on,
    }));
    daysObserved = new Set(points.map((p) => istDay(p.at)).filter(Boolean)).size;
    if (daysObserved >= MIN_HALT_DAYS) {
      const clusters = clusterHalts(
        findHalts(points, { lat: TENANT.schoolLat, lng: TENANT.schoolLng }),
        pinned,
      );
      for (const c of clusters) {
        if (!c.matchedStopId) continue;
        haltDaysByStop.set(
          c.matchedStopId,
          Math.max(haltDaysByStop.get(c.matchedStopId) ?? 0, c.daysSeen),
        );
      }
    }
  }
  const haltEvidenceUsable = daysObserved >= MIN_HALT_DAYS;

  const candidates: BoardingCandidateFact[] = nearest.map((n, i) => {
    const route = state.routes.find((r) => r.id === n.p.routeId);
    const stop = route?.stops.find((s) => s.id === n.p.stopId);
    const seats = seatsOnRoute(state, n.p.routeId, {
      exceptStudentId: studentId,
      academicYearCode: ay,
    });
    const fee = route && stop ? expectedMonthlyFeePaise(route, stop, state.feePolicy) : 0;
    return {
      stopId: n.p.stopId,
      stopName: n.p.stopName,
      routeLabel: n.p.routeLabel,
      walkKm: walks[i]?.km ?? Math.round(n.km * 100) / 100,
      walkMinutes: walks[i]?.minutes ?? null,
      walkSource: walks[i]?.source ?? "straight",
      // 0 km from school means never measured, not next door.
      schoolKm: stop && stop.distanceKm > 0 ? stop.distanceKm : null,
      monthlyFeePaise: fee > 0 ? fee : null,
      seatsLeft: seats.known ? seats.left : null,
      siblingOnRoute: siblingByRoute.get(n.p.routeId) ?? "",
      haltDays: haltEvidenceUsable ? (haltDaysByStop.get(n.p.stopId) ?? 0) : null,
      isCurrent: current?.stopId === n.p.stopId,
    };
  });

  const facts: BoardingSuggestFacts = {
    studentId,
    firstName: (student.fullName || "").split(/\s+/)[0] || student.fullName || "",
    classLabel: "",
    homeLabel: home.label,
    homePrecision: home.precision,
    noiseFloorKm: NOISE_FLOOR_KM[home.precision],
    candidates,
  };

  const context = {
    home: { label: home.label, precision: home.precision },
    noiseFloorKm: facts.noiseFloorKm,
    walkSource: candidates.every((c) => c.walkSource === "google")
      ? "google"
      : candidates.some((c) => c.walkSource === "google")
        ? "mixed"
        : "straight",
    haltEvidence: haltEvidenceUsable
      ? { daysObserved, usable: true as const }
      : {
          daysObserved,
          usable: false as const,
          note: `Fleet Edge has ${daysObserved} day(s) of trail; ${MIN_HALT_DAYS} are needed before a repeated halt means anything, so no stop is described as visited or unvisited.`,
        },
    currentStopId: current?.stopId ?? "",
  };

  // One candidate is not a choice. Answer from the facts rather than spending
  // a call to be told the only option is the only option.
  if (!boardingSuggestionWorthAsking(facts)) {
    const only = candidates[0];
    return NextResponse.json({
      ok: true,
      engine: "none",
      askedModel: false,
      candidates,
      context,
      draft: {
        stopId: only.stopId,
        recommendation: `${only.stopName} on ${only.routeLabel} is the only pinned stop near this family, ${only.walkKm} km ${only.walkSource === "google" ? "on foot" : "in a straight line"}.`,
        reasons: [],
        caution: "Pin more stops on the map to give this a real choice to weigh.",
      },
    });
  }

  const r = await generateBoardingSuggestionJson({
    facts,
    schoolName: TENANT.nameDisplay,
  });
  if (!r.ok) {
    // The shortlist is worth something on its own — it is measured, and the
    // clerk can read it. Returning it with the error beats a bare 502.
    return NextResponse.json(
      { ok: false, error: r.error, engine: r.engine, candidates, context },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    engine: r.engine,
    askedModel: true,
    generationId: r.generationId,
    generatedAt: new Date().toISOString(),
    candidates,
    context,
    draft: r.draft,
  });
}
