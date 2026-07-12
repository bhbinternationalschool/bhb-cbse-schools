/**
 * Transport — routes, stops, student assignments (demo localStorage).
 * Monthly dues are derived from active assignments for Fee Take.
 */

import {
  DEFAULT_AY,
  SESSION_MONTHS,
  dueOnForSessionMonth,
  sessionStartYear,
} from "@/lib/masters";
import { checkHold } from "@/lib/holds";

export type TransportStop = {
  id: string;
  name: string;
  sequence: number;
};

export type TransportRoute = {
  id: string;
  code: string;
  name: string;
  busNo: string;
  vehicleReg: string;
  monthlyFeePaise: number;
  isActive: boolean;
  stops: TransportStop[];
};

export type TransportAssignment = {
  id: string;
  studentId: string;
  householdId: string;
  routeId: string;
  stopId: string;
  academicYearCode: string;
  /** Inclusive start YYYY-MM-DD */
  effectiveFrom: string;
  /** Inclusive end YYYY-MM-DD; null = rest of session */
  effectiveTo: string | null;
  /** Override route fee when > 0; else use route.monthlyFeePaise */
  monthlyFeePaise: number;
  createdAt: string;
};

export type TransportState = {
  version: 1;
  routes: TransportRoute[];
  assignments: TransportAssignment[];
};

/** One month of transport due for a rider (computed, not stored). */
export type TransportPeriodDue = {
  dueKey: string;
  assignmentId: string;
  studentId: string;
  routeId: string;
  routeCode: string;
  routeName: string;
  busNo: string;
  vehicleReg: string;
  stopName: string;
  periodKey: string;
  periodLabel: string;
  dueOn: string;
  amountPaise: number;
};

const STORAGE_KEY = "bhb_transport_v1";

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultRoutes(): TransportRoute[] {
  return [
    {
      id: "tr_r12",
      code: "R-12",
      name: "Lanka – Cantonment",
      busNo: "Bus 3",
      vehicleReg: "UP32 BT 4512",
      monthlyFeePaise: 1200_00,
      isActive: true,
      stops: [
        { id: "st_r12_1", name: "Lanka Gate", sequence: 1 },
        { id: "st_r12_2", name: "BHU Gate", sequence: 2 },
        { id: "st_r12_3", name: "Sigra", sequence: 3 },
        { id: "st_r12_4", name: "Cantonment", sequence: 4 },
      ],
    },
    {
      id: "tr_r07",
      code: "R-07",
      name: "DLW – Orderly Bazar",
      busNo: "Bus 1",
      vehicleReg: "UP32 BT 2201",
      monthlyFeePaise: 900_00,
      isActive: true,
      stops: [
        { id: "st_r07_1", name: "DLW Colony", sequence: 1 },
        { id: "st_r07_2", name: "Pandeypur", sequence: 2 },
        { id: "st_r07_3", name: "Orderly Bazar", sequence: 3 },
      ],
    },
    {
      id: "tr_r03",
      code: "R-03",
      name: "Ramnagar – School",
      busNo: "Bus 5",
      vehicleReg: "UP65 AT 1188",
      monthlyFeePaise: 1500_00,
      isActive: true,
      stops: [
        { id: "st_r03_1", name: "Ramnagar Fort", sequence: 1 },
        { id: "st_r03_2", name: "Bridge", sequence: 2 },
        { id: "st_r03_3", name: "School Gate", sequence: 3 },
      ],
    },
  ];
}

function normalizeStop(s: Partial<TransportStop>, i: number): TransportStop {
  return {
    id: s.id ?? id("st"),
    name: s.name ?? `Stop ${i + 1}`,
    sequence: s.sequence ?? i + 1,
  };
}

function normalizeRoute(r: Partial<TransportRoute>): TransportRoute {
  const stops = Array.isArray(r.stops)
    ? r.stops.map((s, i) => normalizeStop(s, i))
    : [];
  return {
    id: r.id ?? id("tr"),
    code: (r.code ?? "").trim().toUpperCase() || "R-00",
    name: r.name ?? "Route",
    busNo: r.busNo ?? "",
    vehicleReg: r.vehicleReg ?? "",
    monthlyFeePaise: Math.max(0, r.monthlyFeePaise ?? 0),
    isActive: r.isActive !== false,
    stops,
  };
}

function normalizeAssignment(
  a: Partial<TransportAssignment>,
): TransportAssignment {
  return {
    id: a.id ?? id("ta"),
    studentId: a.studentId ?? "",
    householdId: a.householdId ?? "",
    routeId: a.routeId ?? "",
    stopId: a.stopId ?? "",
    academicYearCode: a.academicYearCode ?? DEFAULT_AY,
    effectiveFrom:
      a.effectiveFrom ?? new Date().toISOString().slice(0, 10),
    effectiveTo: a.effectiveTo ?? null,
    monthlyFeePaise: Math.max(0, a.monthlyFeePaise ?? 0),
    createdAt: a.createdAt ?? new Date().toISOString(),
  };
}

function emptyTransport(): TransportState {
  return { version: 1, routes: defaultRoutes(), assignments: [] };
}

export function loadTransport(): TransportState {
  if (typeof window === "undefined") return emptyTransport();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyTransport();
    const parsed = JSON.parse(raw) as TransportState;
    const routes =
      Array.isArray(parsed.routes) && parsed.routes.length > 0
        ? parsed.routes.map(normalizeRoute)
        : defaultRoutes();
    const assignments = Array.isArray(parsed.assignments)
      ? parsed.assignments.map(normalizeAssignment)
      : [];
    return { version: 1, routes, assignments };
  } catch {
    return emptyTransport();
  }
}

export function saveTransport(state: TransportState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function listActiveRoutes(state?: TransportState): TransportRoute[] {
  const s = state ?? loadTransport();
  return s.routes.filter((r) => r.isActive);
}

export function getRoute(
  routeId: string,
  state?: TransportState,
): TransportRoute | undefined {
  const s = state ?? loadTransport();
  return s.routes.find((r) => r.id === routeId);
}

export function transportDueKey(
  studentId: string,
  assignmentId: string,
  periodKey: string,
): string {
  return `transport:${studentId}:${assignmentId}:${periodKey}`;
}

/** Session month keys YYYY-MM in Apr→Mar order for an AY. */
export function sessionPeriodKeys(ayCode: string): string[] {
  const start = sessionStartYear(ayCode);
  return SESSION_MONTHS.map((m) => {
    const year = m.month >= 4 ? start : start + 1;
    return `${year}-${String(m.month).padStart(2, "0")}`;
  });
}

function periodLabel(periodKey: string): string {
  const [ys, ms] = periodKey.split("-");
  const month = Number(ms);
  const year = Number(ys);
  const name =
    SESSION_MONTHS.find((m) => m.month === month)?.label ?? periodKey;
  return `${name} ${year}`;
}

function assignmentCoversPeriod(
  asg: TransportAssignment,
  periodKey: string,
  dueOn: string,
): boolean {
  if (asg.effectiveFrom > dueOn) return false;
  if (asg.effectiveTo && asg.effectiveTo < dueOn) return false;
  // Also require effectiveFrom month <= period (started sometime in/before period)
  const fromKey = asg.effectiveFrom.slice(0, 7);
  if (fromKey > periodKey) return false;
  if (asg.effectiveTo) {
    const toKey = asg.effectiveTo.slice(0, 7);
    if (toKey < periodKey) return false;
  }
  return true;
}

export function listAssignmentsForStudent(
  studentId: string,
  state?: TransportState,
): TransportAssignment[] {
  const s = state ?? loadTransport();
  return s.assignments.filter((a) => a.studentId === studentId);
}

/**
 * Monthly transport dues for one student from active route assignments.
 */
export function computeTransportPeriodDues(
  studentId: string,
  options?: {
    academicYearCode?: string;
    asOf?: string;
    includeFuture?: boolean;
    state?: TransportState;
  },
): TransportPeriodDue[] {
  const s = options?.state ?? loadTransport();
  const ay = options?.academicYearCode ?? DEFAULT_AY;
  const asOf = options?.asOf ?? new Date().toISOString().slice(0, 10);
  const includeFuture = options?.includeFuture ?? true;
  const asOfKey = asOf.slice(0, 7);
  const out: TransportPeriodDue[] = [];

  const assignments = s.assignments.filter(
    (a) => a.studentId === studentId && a.academicYearCode === ay,
  );

  for (const asg of assignments) {
    const route = s.routes.find((r) => r.id === asg.routeId);
    if (!route || !route.isActive) continue;
    const stop =
      route.stops.find((st) => st.id === asg.stopId) ?? route.stops[0];
    const fee =
      asg.monthlyFeePaise > 0 ? asg.monthlyFeePaise : route.monthlyFeePaise;
    if (fee <= 0) continue;

    for (const periodKey of sessionPeriodKeys(ay)) {
      const calMonth = Number(periodKey.slice(5, 7));
      const dueOn = dueOnForSessionMonth(ay, calMonth, 10);
      if (!assignmentCoversPeriod(asg, periodKey, dueOn)) continue;
      if (!includeFuture && periodKey > asOfKey) continue;

      out.push({
        dueKey: transportDueKey(studentId, asg.id, periodKey),
        assignmentId: asg.id,
        studentId,
        routeId: route.id,
        routeCode: route.code,
        routeName: route.name,
        busNo: route.busNo,
        vehicleReg: route.vehicleReg,
        stopName: stop?.name ?? "Stop",
        periodKey,
        periodLabel: periodLabel(periodKey),
        dueOn,
        amountPaise: fee,
      });
    }
  }

  return out.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

export function assignStudentToRoute(input: {
  studentId: string;
  householdId: string;
  routeId: string;
  stopId: string;
  effectiveFrom: string;
  academicYearCode?: string;
  monthlyFeePaise?: number;
}):
  | { ok: true; assignment: TransportAssignment }
  | { ok: false; error: string } {
  const state = loadTransport();
  const route = state.routes.find((r) => r.id === input.routeId && r.isActive);
  if (!route) return { ok: false, error: "Route not found or inactive" };
  const stop = route.stops.find((st) => st.id === input.stopId);
  if (!stop) return { ok: false, error: "Select a stop on this route" };
  if (!input.studentId || !input.householdId) {
    return { ok: false, error: "Student is required" };
  }
  if (!input.effectiveFrom) {
    return { ok: false, error: "Effective from date is required" };
  }

  const hold = checkHold(input.studentId, "HOLD_TRANSPORT");
  if (!hold.allowed) {
    return { ok: false, error: hold.message };
  }

  const ay = input.academicYearCode ?? DEFAULT_AY;
  // End any open assignment for same AY overlapping
  const nextAssignments = state.assignments.map((a) => {
    if (
      a.studentId === input.studentId &&
      a.academicYearCode === ay &&
      a.effectiveTo == null
    ) {
      const dayBefore = new Date(`${input.effectiveFrom}T12:00:00`);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const end = dayBefore.toISOString().slice(0, 10);
      if (end >= a.effectiveFrom) {
        return { ...a, effectiveTo: end };
      }
    }
    return a;
  });

  const assignment = normalizeAssignment({
    id: id("ta"),
    studentId: input.studentId,
    householdId: input.householdId,
    routeId: input.routeId,
    stopId: input.stopId,
    academicYearCode: ay,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: null,
    monthlyFeePaise: input.monthlyFeePaise ?? 0,
    createdAt: new Date().toISOString(),
  });

  saveTransport({
    ...state,
    assignments: [assignment, ...nextAssignments],
  });
  return { ok: true, assignment };
}

export function endTransportAssignment(
  assignmentId: string,
  effectiveTo: string,
): boolean {
  const state = loadTransport();
  const asg = state.assignments.find((a) => a.id === assignmentId);
  if (!asg) return false;
  if (effectiveTo < asg.effectiveFrom) return false;
  saveTransport({
    ...state,
    assignments: state.assignments.map((a) =>
      a.id === assignmentId ? { ...a, effectiveTo } : a,
    ),
  });
  return true;
}

export function listAllAssignments(
  state?: TransportState,
): (TransportAssignment & {
  route?: TransportRoute;
  stopName: string;
})[] {
  const s = state ?? loadTransport();
  return s.assignments
    .map((a) => {
      const route = s.routes.find((r) => r.id === a.routeId);
      const stop = route?.stops.find((st) => st.id === a.stopId);
      return {
        ...a,
        route,
        stopName: stop?.name ?? "—",
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
