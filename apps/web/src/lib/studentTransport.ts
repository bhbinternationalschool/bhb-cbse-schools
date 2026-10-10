/**
 * One child's bus record: which route, which stop, and whether they have
 * actually been getting on it.
 *
 * The transport desk answers "who is on route 3"; the profile has to answer
 * the opposite question — "does this child come by bus, from where, and has
 * anything gone wrong?" — which is what an office asks when a parent rings
 * about a missed pickup, or before a transfer certificate closes the seat.
 *
 * Two things it will not blur:
 *
 *   * A SUSPENDED seat is not a cancelled one. `boardingSuspended` means the
 *     child is still assigned but must not board — usually unpaid transport
 *     fees — and an attendant who reads "Route 3, Gandhi Chowk" without that
 *     line will let them on.
 *   * "Nobody marked the bus register" is not "the child did not board".
 *     Days with no event are simply not counted, and the boarded figure
 *     always carries the number of days it is out of.
 */

import type {
  BoardingEvent,
  TransportAssignment,
  TransportState,
} from "@/lib/transport";

export type StudentTransportSeat = {
  assignment: TransportAssignment;
  routeName: string;
  routeCode: string;
  busNo: string;
  stopName: string;
  /** "Both ways" / "Pickup only" / "Drop only". */
  serviceLabel: string;
  monthlyFeePaise: number;
  suspended: boolean;
  current: boolean;
};

export type StudentBoardingDay = {
  date: string;
  trip: "AM" | "PM";
  status: BoardingEvent["status"];
  note: string;
};

export type StudentTransportRecord = {
  /** The seat in force today, or the most recent one when none is. */
  seat: StudentTransportSeat | null;
  /** Earlier seats this session, newest first. */
  past: StudentTransportSeat[];
  /** Newest first. */
  events: StudentBoardingDay[];
  marked: number;
  boarded: number;
  absent: number;
  /** Got on a bus that was not theirs, or without a seat. A safety event. */
  unauthorized: number;
  /** boarded ÷ marked, or null when the register was never marked. */
  boardedRate: number | null;
  lastSeenOnBus: string;
};

const SERVICE_LABEL: Record<string, string> = {
  both: "Both ways",
  pickup: "Pickup only",
  drop: "Drop only",
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function seatOf(
  state: TransportState,
  a: TransportAssignment,
  today: string,
): StudentTransportSeat {
  const route = state.routes.find((r) => r.id === a.routeId);
  const stop = route?.stops.find((s) => s.id === a.stopId);
  const started = !a.effectiveFrom || a.effectiveFrom <= today;
  const ended = !!a.effectiveTo && a.effectiveTo < today;
  return {
    assignment: a,
    routeName: route?.name || "(route not found)",
    routeCode: route?.code || "",
    busNo: route?.busNo || route?.vehicleReg || "",
    // A stop that does not resolve is named as missing rather than guessed
    // at: the desk once fell back to the route's first stop and billed
    // riders for a stop they do not use.
    stopName: stop?.name || "(stop not on this route)",
    serviceLabel: SERVICE_LABEL[a.serviceMode || "both"] || "Both ways",
    monthlyFeePaise: a.monthlyFeePaise || stop?.monthlyFeePaise || 0,
    suspended: !!a.boardingSuspended,
    current: started && !ended,
  };
}

export function studentTransportRecord(
  state: TransportState,
  student: { id: string; academicYearCode?: string },
  opts?: { today?: string; eventLimit?: number },
): StudentTransportRecord {
  const today = opts?.today || new Date().toISOString().slice(0, 10);
  const ay = (student.academicYearCode || "").trim();

  const seats = (state.assignments || [])
    .filter((a) => a.studentId === student.id)
    .filter((a) => !ay || a.academicYearCode === ay)
    .map((a) => seatOf(state, a, today))
    .sort(
      (x, y) =>
        (y.assignment.effectiveFrom || "").localeCompare(
          x.assignment.effectiveFrom || "",
        ) || y.assignment.createdAt.localeCompare(x.assignment.createdAt),
    );

  // The seat in force today; if none is, the last one they held — a closed
  // seat is still the answer to "did this child come by bus?".
  const seat = seats.find((s) => s.current) || seats[0] || null;
  const past = seats.filter((s) => s !== seat);

  const events: StudentBoardingDay[] = (state.boardingEvents || [])
    .filter((e) => e.studentId === student.id)
    .map((e) => ({
      date: e.date,
      trip: e.trip,
      status: e.status,
      note: e.note || "",
    }))
    .sort(
      (a, b) => b.date.localeCompare(a.date) || b.trip.localeCompare(a.trip),
    );

  let boarded = 0;
  let absent = 0;
  let unauthorized = 0;
  for (const e of events) {
    if (e.status === "boarded") boarded += 1;
    else if (e.status === "absent") absent += 1;
    else if (e.status === "unauthorized") unauthorized += 1;
  }
  const marked = events.length;

  return {
    seat,
    past,
    events: opts?.eventLimit ? events.slice(0, opts.eventLimit) : events,
    marked,
    boarded,
    absent,
    unauthorized,
    boardedRate: marked > 0 ? round1((boarded / marked) * 100) : null,
    lastSeenOnBus: events.find((e) => e.status === "boarded")?.date || "",
  };
}

/** True when this child has nothing to do with the bus at all. */
export function transportRecordIsEmpty(r: StudentTransportRecord): boolean {
  return !r.seat && r.events.length === 0;
}
