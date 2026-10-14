/**
 * Transport gaps — what the records and the road disagree on.
 *
 * Two sources. Stored gaps (transport_desk_gaps) are findings from the fleet
 * audit that need a person: where children really board, whether a billed
 * distance is fair. Live gaps are read straight off the desk every time, so
 * they disappear by themselves the moment the record is completed: a vehicle
 * with no seat count, no driver, a stop with riders and no map location.
 *
 * Nothing here changes a fee. The director's rule (14 Oct 2026) is that the
 * audit may correct records but never a student's transport fee — a fee gap
 * is shown, with both numbers, and the office decides.
 */

import type { TransportState } from "@/lib/transport";

export type TransportGapKind =
  | "fee_distance"
  | "stop_not_reached"
  | "rider_stop"
  | "rider_bus"
  | "fleet_record"
  | "driving"
  | "decision"
  | "new_gps_stop";

export type TransportGapStatus = "open" | "settled" | "dismissed";

export type TransportGap = {
  id: string;
  kind: TransportGapKind;
  vehicle: string;
  routeId: string;
  stopId: string;
  studentId: string;
  title: string;
  detail: string;
  billedKm: number | null;
  straightKm: number | null;
  roadKm: number | null;
  billedFeePaise: number | null;
  policyFeePaise: number | null;
  policyFeeNote: string;
  source: string;
  foundAt: string;
  status: TransportGapStatus;
  settledAt: string | null;
  settledBy: string;
  settleNote: string;
  /** true for gaps derived from the desk on this request (not stored, cannot be settled). */
  live?: boolean;
};

export const TRANSPORT_GAP_KIND_LABEL: Record<TransportGapKind, string> = {
  fee_distance: "Fee distance",
  stop_not_reached: "Stop not reached",
  rider_stop: "Child's stop",
  rider_bus: "Child's bus",
  fleet_record: "Vehicle record",
  driving: "Driving",
  decision: "Decision",
  new_gps_stop: "New GPS stop",
};

/** Order the office should work through them: money and children first. */
const KIND_ORDER: TransportGapKind[] = [
  "new_gps_stop",
  "fee_distance",
  "stop_not_reached",
  "rider_bus",
  "rider_stop",
  "fleet_record",
  "driving",
  "decision",
];

const KINDS = new Set<string>(KIND_ORDER);
const STATUSES = new Set<string>(["open", "settled", "dismissed"]);

export function isGapKind(v: unknown): v is TransportGapKind {
  return typeof v === "string" && KINDS.has(v);
}

export function isGapStatus(v: unknown): v is TransportGapStatus {
  return typeof v === "string" && STATUSES.has(v);
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A database row → TransportGap. Unknown kinds/statuses are dropped, never guessed. */
export function gapFromRow(r: Record<string, unknown>): TransportGap | null {
  if (!isGapKind(r.kind) || !isGapStatus(r.status) || !str(r.id) || !str(r.title)) return null;
  return {
    id: str(r.id),
    kind: r.kind,
    vehicle: str(r.vehicle),
    routeId: str(r.route_id),
    stopId: str(r.stop_id),
    studentId: str(r.student_id),
    title: str(r.title),
    detail: str(r.detail),
    billedKm: num(r.billed_km),
    straightKm: num(r.straight_km),
    roadKm: num(r.road_km),
    billedFeePaise: num(r.billed_fee_paise),
    policyFeePaise: num(r.policy_fee_paise),
    policyFeeNote: str(r.policy_fee_note),
    source: str(r.source),
    foundAt: str(r.found_at),
    status: r.status,
    settledAt: str(r.settled_at) || null,
    settledBy: str(r.settled_by),
    settleNote: str(r.settle_note),
  };
}

function liveGap(id: string, kind: TransportGapKind, vehicle: string, title: string, detail: string, extra: Partial<TransportGap> = {}): TransportGap {
  return {
    id: `live:${id}`,
    kind,
    vehicle,
    routeId: "",
    stopId: "",
    studentId: "",
    title,
    detail,
    billedKm: null,
    straightKm: null,
    roadKm: null,
    billedFeePaise: null,
    policyFeePaise: null,
    policyFeeNote: "",
    source: "transport desk",
    foundAt: "",
    status: "open",
    settledAt: null,
    settledBy: "",
    settleNote: "",
    live: true,
    ...extra,
  };
}

/**
 * Gaps the desk itself shows, recomputed on every read. Only active vehicles
 * and routes count, and only open assignments make a stop "used".
 */
export function liveTransportGaps(state: Pick<TransportState, "vehicles" | "routes" | "assignments">): TransportGap[] {
  const out: TransportGap[] = [];
  for (const v of state.vehicles) {
    if (v.isActive === false) continue;
    if (!(Number(v.seatCapacity) > 0)) {
      out.push(
        liveGap(`seats:${v.id}`, "fleet_record", v.name, `${v.name} — seats not recorded`,
          "Enter the seating capacity from the vehicle's RC in Fleet. Until then no screen can say whether the vehicle is full, and a second trip cannot be planned away."),
      );
    }
    if (!String(v.driverName ?? "").trim()) {
      out.push(liveGap(`driver:${v.id}`, "fleet_record", v.name, `${v.name} — no driver on record`, "Add the driver's name and mobile in Fleet."));
    }
  }
  const open = state.assignments.filter((a) => a.effectiveTo == null);
  const vehicleName = new Map(state.vehicles.map((v) => [v.id, v.name]));
  for (const r of state.routes) {
    if (r.isActive === false) continue;
    for (const s of r.stops) {
      const riders = open.filter((a) => a.routeId === r.id && a.stopId === s.id).length;
      const hasGeo = Number.isFinite(s.geoLat) && Number.isFinite(s.geoLng) && (s.geoLat !== 0 || s.geoLng !== 0);
      if (riders > 0 && !hasGeo) {
        out.push(
          liveGap(`stopgeo:${s.id}`, "stop_not_reached", vehicleName.get(r.vehicleId ?? "") ?? r.name,
            `${s.name} (${r.name}) — no map location`,
            `${riders} rider${riders === 1 ? "" : "s"} board here, but the stop has no map pin, so the tracker cannot confirm the bus reaches it.`,
            { routeId: r.id, stopId: s.id }),
        );
      }
    }
  }
  return out;
}

/** Open first, then by kind order, then vehicle, then title. */
export function sortGaps(gaps: TransportGap[]): TransportGap[] {
  const rank = (g: TransportGap) => (g.status === "open" ? 0 : 1);
  return [...gaps].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      a.vehicle.localeCompare(b.vehicle) ||
      a.title.localeCompare(b.title),
  );
}

/** Monthly fee difference, + when the policy would charge more. null when either side is unknown. */
export function feeGapPaise(g: Pick<TransportGap, "billedFeePaise" | "policyFeePaise">): number | null {
  if (g.billedFeePaise == null || g.policyFeePaise == null) return null;
  return g.policyFeePaise - g.billedFeePaise;
}

export function rupees(paise: number | null): string {
  if (paise == null) return "—";
  const sign = paise < 0 ? "−" : "";
  return `${sign}₹${Math.round(Math.abs(paise) / 100).toLocaleString("en-IN")}`;
}
