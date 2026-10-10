/**
 * Did a family's WhatsApp pin land in a believable place, and on whom?
 *
 * The office asked (14 Sep 2026): pins have come in, but how do we see
 * whether each one is in the right place and was attached to the right
 * family? Until now the only trace was a count on the planner.
 *
 * A pin is compared with the three things the school already believes about
 * that child — the stop they are assigned to, the nearest mapped stop on
 * their own route, and where the family is recorded as living — and the
 * finding is said in words. Nothing here changes a stop: this is for a
 * person to look at, with a map link beside every number.
 */

export type LatLng = { lat: number; lng: number };

export function kmBetween(a: LatLng, b: LatLng): number {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(r * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 100) / 100;
}

export function mapsLink(p: LatLng): string {
  return `https://www.google.com/maps?q=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

/** Within this, a pin and a stop are the same place for a child walking to the bus. */
export const NEAR_STOP_KM = 0.5;
/** Beyond this from their assigned stop, someone should look. */
export const FAR_FROM_STOP_KM = 1.5;
/** A village centroid is a kilometre out on its own; beyond this the pin was likely sent from elsewhere. */
export const FAR_FROM_VILLAGE_KM = 3;
/** A geocoded home address is much tighter than a village. */
export const FAR_FROM_HOME_KM = 1.5;

export type PinFinding =
  | "near_assigned_stop"
  | "closer_to_another_stop"
  | "far_from_assigned_stop"
  | "assigned_stop_not_mapped"
  | "no_stop_assigned"
  | "stop_link_broken"
  | "far_from_recorded_home";

export type PinReviewInput = {
  pin: LatLng;
  assignedStop: { name: string; at: LatLng | null } | null;
  /**
   * The child IS assigned a stop, but the id names no stop on the route — the
   * route's stops were re-created and the link orphaned (154 of 157 riders on
   * 14 Sep 2026). Not the same as "no stop": the office repairs it on the
   * planner's stop-link panel, and the nearest stop below is evidence for that.
   */
  stopLinkBroken?: boolean;
  /** Other mapped stops on the child's own route. */
  routeStops: { name: string; at: LatLng }[];
  /** Where the family is recorded as living, and how precisely. */
  home: { label: string; at: LatLng; precision: "village" | "household" } | null;
};

export type PinReview = {
  kmToAssignedStop: number | null;
  nearestStop: { name: string; km: number } | null;
  kmToHome: number | null;
  findings: PinFinding[];
  /** "ok" = nothing to look at; "check" = a person should open the map. */
  verdict: "ok" | "check";
  /** One sentence for the office. */
  summary: string;
};

export function reviewPin(input: PinReviewInput): PinReview {
  const findings: PinFinding[] = [];
  const stopAt = input.assignedStop?.at ?? null;
  const kmToAssignedStop = stopAt ? kmBetween(input.pin, stopAt) : null;

  let nearest: { name: string; km: number } | null = null;
  for (const s of input.routeStops) {
    const km = kmBetween(input.pin, s.at);
    if (!nearest || km < nearest.km) nearest = { name: s.name, km };
  }

  if (input.stopLinkBroken) findings.push("stop_link_broken");
  else if (!input.assignedStop) findings.push("no_stop_assigned");
  else if (kmToAssignedStop == null) findings.push("assigned_stop_not_mapped");
  else if (kmToAssignedStop <= NEAR_STOP_KM) findings.push("near_assigned_stop");
  else if (kmToAssignedStop > FAR_FROM_STOP_KM) findings.push("far_from_assigned_stop");

  if (
    nearest &&
    input.assignedStop &&
    nearest.name !== input.assignedStop.name &&
    (kmToAssignedStop == null || nearest.km + 0.3 < kmToAssignedStop)
  ) {
    findings.push("closer_to_another_stop");
  }

  const kmToHome = input.home ? kmBetween(input.pin, input.home.at) : null;
  const homeLimit = input.home?.precision === "household" ? FAR_FROM_HOME_KM : FAR_FROM_VILLAGE_KM;
  if (kmToHome != null && kmToHome > homeLimit) findings.push("far_from_recorded_home");

  const worrying: PinFinding[] = ["far_from_assigned_stop", "closer_to_another_stop", "far_from_recorded_home", "no_stop_assigned", "stop_link_broken"];
  const verdict = findings.some((f) => worrying.includes(f)) ? "check" : "ok";

  const parts: string[] = [];
  if (input.stopLinkBroken) {
    parts.push(
      `their stop link is broken (the route's stops were re-created)${nearest ? `; nearest stop on their route: "${nearest.name}", ${nearest.km} km` : ""}`,
    );
  } else if (kmToAssignedStop != null && input.assignedStop) {
    parts.push(`${kmToAssignedStop} km from their stop "${input.assignedStop.name}"`);
  } else if (input.assignedStop) {
    parts.push(`their stop "${input.assignedStop.name}" has no map position, so it cannot be compared`);
  } else {
    parts.push("no stop assigned");
  }
  if (findings.includes("closer_to_another_stop") && nearest) {
    parts.push(`nearer to "${nearest.name}" (${nearest.km} km) on the same route`);
  }
  if (kmToHome != null && input.home) {
    parts.push(
      `${kmToHome} km from the recorded ${input.home.precision === "household" ? "home address" : `village (${input.home.label})`}${
        findings.includes("far_from_recorded_home")
          ? nearest && nearest.km <= NEAR_STOP_KM
            ? " — but it sits beside a stop on their own route, so the recorded village is more likely wrong than the pin"
            : " — may have been sent from somewhere else"
          : ""
      }`,
    );
  }
  return { kmToAssignedStop, nearestStop: nearest, kmToHome, findings, verdict, summary: parts.join("; ") };
}

/** One family's pin as the office sees it (GET /api/transport/pins-received). */
export type PinReceivedRow = {
  householdId: string;
  guardianName: string;
  mobileMasked: string;
  sentAt: string;
  pin: LatLng;
  mapUrl: string;
  placeName: string;
  address: string;
  kmFromSchool: number;
  /** Children the pin was saved to. */
  children: {
    studentId: string;
    name: string;
    busNo: string;
    routeName: string;
    stopName: string;
    stopMapUrl: string;
    review: PinReview;
  }[];
  /** Riding children in the household the pin was NOT saved to. */
  ridersWithoutPin: string[];
  verdict: "ok" | "check";
};
