/**
 * Every boarding pin a family has sent on
 * WhatsApp, which children it was saved to, and whether it looks right.
 *
 * Read-only. A failed read is an error, never an empty list: "no pins" and
 * "could not read the pins" must not look the same to the office.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import { fetchBoardingHomes } from "@/lib/boardingHomes.server";
import {
  deskBundleToTransportState,
  fetchTransportDeskFromDb,
} from "@/lib/transportNormalized.server";
import { fetchSisFromDb } from "@/lib/sisNormalized.server";
import { householdWhatsApp, type SisState } from "@/lib/sis";
import { kmBetween, mapsLink, reviewPin, type PinReceivedRow } from "@/lib/pinReview";
import { TENANT } from "@/lib/types";



function maskMobile(m: string): string {
  const d = (m || "").replace(/\D/g, "");
  return d.length >= 4 ? `••••${d.slice(-4)}` : "••••";
}

export type PinsReceivedResult =
  | {
      ok: true;
      rows: PinReceivedRow[];
      pinnedNoPoint: { householdId: string; guardianName: string; respondedAt: string; note: string }[];
      counts: { families: number; children: number; toCheck: number };
    }
  | { ok: false; error: string; status: number };

export async function buildPinsReceived(): Promise<PinsReceivedResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Server tenant context unavailable", status: 503 };

  const [desk, sisRes, homes, points, requests] = await Promise.all([
    fetchTransportDeskFromDb(),
    fetchSisFromDb(),
    fetchBoardingHomes(ctx.sb, ctx.tenantId),
    fetchAllPages<{
      student_id: string;
      latitude: number | null;
      longitude: number | null;
      point_name: string | null;
      note: string | null;
      set_by: string | null;
      set_at: string | null;
    }>((from, to) =>
      ctx.sb
        .from("sis_student_transport_point")
        .select("student_id, latitude, longitude, point_name, note, set_by, set_at")
        .eq("tenant_id", ctx.tenantId)
        .ilike("set_by", "family%")
        .order("set_at", { ascending: false })
        .range(from, to),
    ),
    ctx.sb
      .from("sis_transport_pin_request")
      .select("household_id, status, responded_at, note")
      .eq("tenant_id", ctx.tenantId),
  ]);
  if (!desk.ok) return { ok: false, error: "Could not read the transport desk", status: 502 };
  if (!sisRes.ok) return { ok: false, error: "Could not read the student roster", status: 502 };
  if (!homes.ok) return { ok: false, error: homes.error, status: 502 };
  if (points.error) return { ok: false, error: points.error, status: 502 };
  if (requests.error) return { ok: false, error: requests.error.message, status: 502 };

  const state = deskBundleToTransportState(desk.bundle);
  const sis = sisRes.bundle as unknown as SisState;
  const school = { lat: TENANT.schoolLat, lng: TENANT.schoolLng };
  const live = state.assignments.filter((a) => a.effectiveTo == null);
  const ay = live.map((a) => a.academicYearCode).filter(Boolean).sort().pop() || "";
  const liveThisYear = live.filter((a) => a.academicYearCode === ay);

  const byHousehold = new Map<string, PinReceivedRow>();
  for (const p of points.rows) {
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
    const student = sis.students.find((s) => s.id === p.student_id);
    if (!student?.householdId) continue;
    const hh = sis.households.find((h) => h.id === student.householdId);
    const pin = { lat: Number(p.latitude), lng: Number(p.longitude) };

    const a = liveThisYear.find((x) => x.studentId === student.id);
    const route = a ? state.routes.find((r) => r.id === a.routeId) : undefined;
    const stop = a && route ? route.stops.find((s) => s.id === a.stopId) : undefined;
    const stopAt = stop && Number.isFinite(stop.geoLat) && Number.isFinite(stop.geoLng)
      ? { lat: Number(stop.geoLat), lng: Number(stop.geoLng) }
      : null;
    const home = homes.homes.get(student.householdId);
    const review = reviewPin({
      pin,
      assignedStop: stop ? { name: stop.name, at: stopAt } : null,
      stopLinkBroken: !!a && !!a.stopId && !stop,
      routeStops: (route?.stops ?? [])
        .filter((s) => Number.isFinite(s.geoLat) && Number.isFinite(s.geoLng))
        .map((s) => ({ name: s.name, at: { lat: Number(s.geoLat), lng: Number(s.geoLng) } })),
      home: home && home.precision !== "pin"
        ? { label: home.label, at: { lat: home.lat, lng: home.lng }, precision: home.precision === "household" ? "household" : "village" }
        : null,
    });

    const note = (p.note || "").replace(/^Sent by the family on WhatsApp\s*·?\s*/i, "").replace(/one pin for \d+ children\s*·?\s*/i, "");
    const row =
      byHousehold.get(student.householdId) ??
      ({
        householdId: student.householdId,
        guardianName: hh?.guardianName?.trim() || student.fatherName || "Parent",
        mobileMasked: maskMobile(hh ? householdWhatsApp(hh) || "" : ""),
        sentAt: p.set_at || "",
        pin,
        mapUrl: mapsLink(pin),
        placeName: p.point_name?.trim() || "",
        address: note.trim(),
        kmFromSchool: kmBetween(pin, school),
        children: [],
        ridersWithoutPin: [],
        verdict: "ok",
      } satisfies PinReceivedRow);
    row.children.push({
      studentId: student.id,
      name: student.fullName,
      busNo: route?.busNo || route?.code || "",
      routeName: route?.name || "",
      stopName: stop?.name || "",
      stopMapUrl: stopAt ? mapsLink(stopAt) : "",
      review,
    });
    if (review.verdict === "check") row.verdict = "check";
    byHousehold.set(student.householdId, row);
  }

  // Every riding child of each family, so a sibling the pin missed is visible.
  for (const row of byHousehold.values()) {
    const pinned = new Set(row.children.map((c) => c.studentId));
    const riders = liveThisYear
      .filter((a) => sis.students.find((s) => s.id === a.studentId)?.householdId === row.householdId)
      .map((a) => a.studentId);
    row.ridersWithoutPin = [...new Set(riders)]
      .filter((id) => !pinned.has(id))
      .map((id) => sis.students.find((s) => s.id === id)?.fullName || id);
    if (row.ridersWithoutPin.length) row.verdict = "check";
  }

  // Families recorded as "pinned" whose pin saved to nobody.
  const pinnedNoPoint = (requests.data ?? [])
    .filter((r) => r.status === "pinned" && !byHousehold.has(String(r.household_id)))
    .map((r) => {
      const hh = sis.households.find((h) => h.id === r.household_id);
      return {
        householdId: String(r.household_id),
        guardianName: hh?.guardianName || String(r.household_id),
        respondedAt: String(r.responded_at || ""),
        note: String(r.note || ""),
      };
    });

  const rows = [...byHousehold.values()].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  return {
    ok: true,
    rows,
    pinnedNoPoint,
    counts: {
      families: rows.length,
      children: rows.reduce((n, r) => n + r.children.length, 0),
      toCheck: rows.filter((r) => r.verdict === "check").length,
    },
  };
}
