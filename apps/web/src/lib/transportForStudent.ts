/**
 * A student's current transport, resolved for display outside the transport
 * module — the SIS record, the fee counter, a report.
 *
 * Kept separate from `transportPlanner` because that module is about planning
 * across the whole fleet; this answers one question about one child, and the
 * places that ask it should not have to build every profile in the school to
 * find out.
 */

import {
  listAssignmentsForStudent,
  type StopDistanceSource,
  type TransportState,
} from "@/lib/transport";

export type StudentTransportSummary = {
  assigned: boolean;
  routeId: string;
  routeCode: string;
  routeName: string;
  busNo: string;
  vehicleReg: string;
  stopId: string;
  stopName: string;
  distanceKm: number;
  distanceSource: StopDistanceSource;
  monthlyFeePaise: number;
  feeOverrideReason: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  boardingSuspended: boolean;
  /** One line for a card or a table cell: "BUS 2 · Ayar Mod". */
  label: string;
};

const NONE: StudentTransportSummary = {
  assigned: false,
  routeId: "",
  routeCode: "",
  routeName: "",
  busNo: "",
  vehicleReg: "",
  stopId: "",
  stopName: "",
  distanceKm: 0,
  distanceSource: "",
  monthlyFeePaise: 0,
  feeOverrideReason: "",
  effectiveFrom: "",
  effectiveTo: null,
  boardingSuspended: false,
  label: "",
};

/**
 * The assignment in force on `asOf`, or none.
 *
 * Picks the latest-starting assignment that covers the date, so a mid-year
 * change reads as the new route rather than whichever happened to be stored
 * first. Returns `assigned: false` rather than a half-filled record when the
 * child does not ride — a caller must not be able to render a blank bus.
 */
export function studentTransportSummary(
  studentId: string,
  state: TransportState | null,
  opts: { academicYearCode: string; asOf?: string },
): StudentTransportSummary {
  // The session is required rather than defaulted: the caller always knows
  // which year it is showing, and a wrong year here would put another
  // session's bus on the child's record.
  if (!state || !studentId || !opts.academicYearCode) return NONE;
  const ay = opts.academicYearCode;
  const asOf = (opts?.asOf || new Date().toISOString()).slice(0, 10);

  const active = listAssignmentsForStudent(studentId, state)
    .filter(
      (a) =>
        a.academicYearCode === ay &&
        a.effectiveFrom <= asOf &&
        (!a.effectiveTo || a.effectiveTo >= asOf),
    )
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));

  const asg = active[0];
  if (!asg) return NONE;

  const route = state.routes.find((r) => r.id === asg.routeId);
  const stop = route?.stops.find((s) => s.id === asg.stopId);
  const busNo = route?.busNo || "";
  const stopName = stop?.name || "";

  return {
    assigned: true,
    routeId: asg.routeId,
    routeCode: route?.code || "",
    routeName: route?.name || "",
    busNo,
    vehicleReg: route?.vehicleReg || "",
    stopId: asg.stopId,
    stopName,
    distanceKm: stop?.distanceKm ?? 0,
    distanceSource: stop?.distanceSource ?? "",
    monthlyFeePaise: asg.monthlyFeePaise,
    feeOverrideReason: asg.feeOverrideReason || "",
    effectiveFrom: asg.effectiveFrom,
    effectiveTo: asg.effectiveTo,
    boardingSuspended: asg.boardingSuspended,
    label:
      [busNo || route?.code, stopName].filter(Boolean).join(" · ") ||
      "Transport",
  };
}
