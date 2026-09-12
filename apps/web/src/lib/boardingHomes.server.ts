/**
 * Where every child lives, as precisely as the school actually knows.
 *
 * Three tiers, worst first so the better one overwrites it: a village centroid,
 * then the family's own Google geocode, then a pin somebody dropped for this
 * particular child. `BoardingHome.precision` travels with each one, because
 * what counts as a real finding depends on it — a 600 m gap means nothing
 * against a centroid and is worth asking about against a doorstep.
 *
 * Extracted from the boarding-point audit when a second reader needed the same
 * thing. A third copy of a hundred lines of Supabase paging is how two screens
 * come to disagree about where a child lives.
 *
 * WHAT IT WILL NOT DO
 * Every read is checked, and a FAILED read returns an error rather than fewer
 * homes. A household silently missing from this map does not read as "we do
 * not know where they live" downstream — it reads as a child with no home to
 * compare stops against, who then vanishes from an audit or a suggestion
 * without anybody being told they were skipped.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import type { BoardingHome } from "@/lib/boardingPointAudit";

export type BoardingHomesResult =
  | {
      ok: true;
      /** Keyed by household id — village centroid or the family's geocode. */
      homes: Map<string, BoardingHome>;
      /** Keyed by student id. Beats the household's home for that child. */
      pins: Map<string, BoardingHome>;
      /** Student id → full name, for anything that has to name a child. */
      names: Map<string, string>;
    }
  | { ok: false; error: string };

export async function fetchBoardingHomes(
  sb: SupabaseClient,
  tenantId: string,
): Promise<BoardingHomesResult> {
  // Village centroids. Two plain reads and a join in TypeScript rather than a
  // PostgREST embed — the embed returns the parent as an array or an object
  // depending on how the relationship is inferred, and a silently-empty join
  // here would read as "no household has a home".
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
  if (villages.error) return { ok: false, error: villages.error };

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
  if (geo.error) return { ok: false, error: geo.error };
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

  // The family's own geocode beats their village's centroid. Only rows whose
  // address fingerprint still matched survived normalizeHousehold, so a pin
  // here describes the address the household has now, not one they moved from.
  const geocoded = await fetchAllPages<{
    id: string;
    geo_lat: number | null;
    geo_lng: number | null;
    geo_formatted_address: string | null;
    address: string | null;
  }>((from, to) =>
    sb
      .from("sis_households")
      .select("id, geo_lat, geo_lng, geo_formatted_address, address")
      .eq("tenant_id", tenantId)
      .not("geo_lat", "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (geocoded.error) return { ok: false, error: geocoded.error };
  for (const h of geocoded.rows) {
    if (!Number.isFinite(h.geo_lat) || !Number.isFinite(h.geo_lng)) continue;
    homes.set(h.id, {
      lat: Number(h.geo_lat),
      lng: Number(h.geo_lng),
      label: h.geo_formatted_address?.trim() || h.address?.trim() || "home address",
      precision: "household",
    });
  }

  // A pin beats a centroid, and is per STUDENT: siblings are not always
  // collected in the same place, an older child on the main road while the
  // younger is picked up nearer home.
  const pinRows = await fetchAllPages<{
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
  if (pinRows.error) return { ok: false, error: pinRows.error };
  const pins = new Map<string, BoardingHome>();
  for (const p of pinRows.rows) {
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
    pins.set(p.student_id, {
      lat: Number(p.latitude),
      lng: Number(p.longitude),
      label: p.point_name?.trim() || "pinned point",
      precision: "pin",
    });
  }

  const nameRows = await fetchAllPages<{ id: string; full_name: string | null }>(
    (from, to) =>
      sb
        .from("sis_students")
        .select("id, full_name")
        .eq("tenant_id", tenantId)
        .order("id", { ascending: true })
        .range(from, to),
  );
  if (nameRows.error) return { ok: false, error: nameRows.error };
  const names = new Map(nameRows.rows.map((r) => [r.id, r.full_name || r.id]));

  return { ok: true, homes, pins, names };
}

/**
 * The best home known for one child.
 *
 * null when nothing is known — NOT a fallback to the school, the village the
 * name sounds like, or the middle of Varanasi. A caller that cannot find a
 * home must say so; ranking stops around an invented point produces a
 * confident recommendation to put a child on the wrong bus.
 */
export function homeForStudent(
  result: Extract<BoardingHomesResult, { ok: true }>,
  studentId: string,
  householdId: string,
): BoardingHome | null {
  return result.pins.get(studentId) ?? result.homes.get(householdId) ?? null;
}
