/**
 * Bus register + driver's log book — the rules, with no I/O.
 *
 * Server rows live in transport_boarding_marks / transport_vehicle_day_logs /
 * transport_fuel_fills (migration 20261011170000); the reads and writes are in
 * transportBoardingLog.server.ts. Everything that decides something — who may
 * see which bus, who is on a run and in what order, what counts as an
 * exception, how many km a day was — is here so it can be self-tested.
 *
 * The rule under all of it: a child with no mark is NOT MARKED. Not absent,
 * not boarded. An attendant who has not reached a stop yet has not said
 * anything about the children waiting there, and a report that turned that
 * silence into "not boarded" would tell a parent the wrong thing.
 */

import {
  listRouteShifts,
  resolveRiderShift,
  shiftRunsOn,
  strictClassGroup,
} from "@/lib/transportShifts";
import type { TransportShift } from "@/lib/transport";

/* ─── vocabulary ───────────────────────────────────────────── */

/** AM = morning pick-up (home → school), PM = afternoon drop (school → home). */
export type RegisterTrip = "AM" | "PM";

/** What an attendant can tap. */
export type RegisterStatus = "boarded" | "not_boarded" | "dropped";

/** What a row can hold: a tap, or an undo of one. */
export type StoredRegisterStatus = RegisterStatus | "unmarked";

/**
 * The buttons per trip. In the morning the child gets on or does not; in the
 * afternoon the child gets on at school and is then dropped at the stop.
 */
export const TRIP_STATUSES: Record<RegisterTrip, RegisterStatus[]> = {
  AM: ["boarded", "not_boarded"],
  PM: ["boarded", "dropped", "not_boarded"],
};

export const STATUS_LABEL: Record<RegisterStatus, string> = {
  boarded: "Boarded",
  not_boarded: "Not boarded",
  dropped: "Dropped",
};

/** One letter per status for the month grid. */
export const STATUS_CODE: Record<RegisterStatus, string> = {
  boarded: "B",
  not_boarded: "N",
  dropped: "D",
};

export function isRegisterTrip(v: unknown): v is RegisterTrip {
  return v === "AM" || v === "PM";
}

export function isStoredStatus(v: unknown): v is StoredRegisterStatus {
  return v === "boarded" || v === "not_boarded" || v === "dropped" || v === "unmarked";
}

/** Is this status allowed on this trip? "unmarked" (undo) always is. */
export function statusAllowedOnTrip(status: StoredRegisterStatus, trip: RegisterTrip): boolean {
  return status === "unmarked" || TRIP_STATUSES[trip].includes(status);
}

/** A stored row as the rules see it; "unmarked" reads as no mark at all. */
export function effectiveStatus(
  stored: StoredRegisterStatus | null | undefined,
): RegisterStatus | null {
  if (!stored || stored === "unmarked") return null;
  return stored;
}

/** Rode the bus on that trip: got on, or was dropped (which implies got on). */
export function rode(status: RegisterStatus | null): boolean {
  return status === "boarded" || status === "dropped";
}

/* ─── dates (the school runs on IST) ───────────────────────── */

const IST_OFFSET_MS = 330 * 60_000;

/** Today's date in India. UTC's date is yesterday's until 05:30 IST. */
export function istDate(nowMs: number = Date.now()): string {
  return new Date(nowMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function isMonth(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** Every date of a "YYYY-MM" month. */
export function monthDates(month: string): string[] {
  if (!isMonth(month)) return [];
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD date. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** UTC instants bounding an IST calendar day — for telemetry reads. */
export function istDayBounds(date: string): { fromIso: string; toIso: string } {
  const start = new Date(`${date}T00:00:00Z`).getTime() - IST_OFFSET_MS;
  return {
    fromIso: new Date(start).toISOString(),
    toIso: new Date(start + 86_400_000).toISOString(),
  };
}

/**
 * The time a tap happened, by the phone's clock — that is what orders two
 * taps for the same child. A clock that is plainly wrong (in the future, or
 * days old) is replaced by the server's time rather than allowed to win or
 * lose every comparison forever.
 */
export function clampTappedAt(clientIso: unknown, nowMs: number = Date.now()): string {
  const t = typeof clientIso === "string" ? Date.parse(clientIso) : NaN;
  if (!Number.isFinite(t)) return new Date(nowMs).toISOString();
  if (t > nowMs + 5 * 60_000) return new Date(nowMs).toISOString();
  if (t < nowMs - 3 * 86_400_000) return new Date(nowMs).toISOString();
  return new Date(t).toISOString();
}

/* ─── who may see which bus ────────────────────────────────── */

export type CrewStaff = {
  id: string;
  status?: string;
  vehicleLinks?: {
    routeId: string;
    role: string;
    effectiveFrom?: string;
    effectiveTo?: string | null;
  }[];
};

export type ScopeRoute = { id: string; vehicleId?: string; isActive?: boolean };
export type ScopeVehicle = { id: string; driverStaffId?: string; isActive?: boolean };

export type CrewScope = { routeIds: string[]; vehicleIds: string[] };

/**
 * The buses one member of staff works on, on one date.
 *
 * Two records say it, and both count: Staff → Duties links a person to a
 * ROUTE as driver / attendant / conductor / helper (dated), and Fleet names a
 * vehicle's driver by staff id. A route brings its vehicle, a vehicle brings
 * every route it runs — the attendant on Magic-1 sees Magic-1's runs whichever
 * of the two the office filled in.
 */
export function crewScope(input: {
  staffId: string;
  staff: CrewStaff[];
  routes: ScopeRoute[];
  vehicles: ScopeVehicle[];
  date: string;
}): CrewScope {
  const staffId = input.staffId.trim();
  if (!staffId) return { routeIds: [], vehicleIds: [] };
  const me = input.staff.find((s) => s.id === staffId);
  const routeIds = new Set<string>();
  const vehicleIds = new Set<string>();

  if (me && (me.status ?? "active") === "active") {
    for (const link of me.vehicleLinks ?? []) {
      if (!link.routeId) continue;
      if (link.effectiveFrom && link.effectiveFrom > input.date) continue;
      if (link.effectiveTo && link.effectiveTo < input.date) continue;
      routeIds.add(link.routeId);
    }
  }
  for (const v of input.vehicles) {
    if ((v.driverStaffId ?? "").trim() === staffId) vehicleIds.add(v.id);
  }
  // A linked route brings its vehicle; then every vehicle brings all its routes.
  for (const r of input.routes) {
    if (routeIds.has(r.id) && r.vehicleId) vehicleIds.add(r.vehicleId);
  }
  for (const r of input.routes) {
    if (r.vehicleId && vehicleIds.has(r.vehicleId)) routeIds.add(r.id);
  }
  return { routeIds: [...routeIds].sort(), vehicleIds: [...vehicleIds].sort() };
}

/* ─── runs and riders ──────────────────────────────────────── */

export type RegisterRun = {
  routeId: string;
  trip: RegisterTrip;
  /** "" when the route has no timed runs — one journey each way. */
  shiftId: string;
  name: string;
  departTime: string;
};

/**
 * The runs a route makes on a date in one direction. A route with no runs set
 * up makes one implicit journey each way, exactly as before shifts existed.
 * A run that does not operate on that weekday is left out.
 */
export function runsForRoute(
  route: { id: string; shifts?: TransportShift[] },
  trip: RegisterTrip,
  date: string,
): RegisterRun[] {
  const direction = trip === "AM" ? "pickup" : "drop";
  const all = listRouteShifts({ shifts: route.shifts ?? [] }, direction);
  if (all.length === 0) {
    return [
      {
        routeId: route.id,
        trip,
        shiftId: "",
        name: trip === "AM" ? "Morning pick-up" : "Afternoon drop",
        departTime: "",
      },
    ];
  }
  const wd = weekdayOf(date);
  return all
    .filter((s) => shiftRunsOn(s, wd))
    .map((s) => ({ routeId: route.id, trip, shiftId: s.id, name: s.name, departTime: s.departTime }));
}

export type RiderAssignment = {
  id: string;
  studentId: string;
  routeId: string;
  stopId: string;
  academicYearCode?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  serviceMode?: "both" | "pickup" | "drop";
  boardingSuspended?: boolean;
  pickupShiftId?: string;
  dropShiftId?: string;
};

export type RiderStudent = {
  id: string;
  fullName: string;
  admissionNo?: string;
  classId?: string;
  sectionId?: string;
  status?: string;
};

export type RiderStop = { id: string; name: string; sequence: number };

export type RunRider = {
  studentId: string;
  assignmentId: string;
  fullName: string;
  admissionNo: string;
  classId: string;
  sectionId: string;
  className: string;
  stopId: string;
  /** "" when the stop id no longer resolves — the child is still listed. */
  stopName: string;
  stopSequence: number | null;
  /** The run this child resolved to, "" when the route has no runs. */
  shiftId: string;
  /** True when the run could not be worked out — shown on every list, flagged. */
  shiftUnresolved: boolean;
  shiftNote: string;
};

/** Was this assignment live on that date? */
export function assignmentActiveOn(a: RiderAssignment, date: string): boolean {
  if (a.effectiveFrom && a.effectiveFrom > date) return false;
  if (a.effectiveTo && a.effectiveTo < date) return false;
  return true;
}

/**
 * The children on one route on one date for one trip, deduplicated (the
 * latest assignment wins when the desk holds two for one child).
 */
export function liveRouteAssignments(
  assignments: RiderAssignment[],
  routeId: string,
  date: string,
  trip: RegisterTrip,
): RiderAssignment[] {
  const byStudent = new Map<string, RiderAssignment>();
  for (const a of assignments) {
    if (a.routeId !== routeId) continue;
    if (a.boardingSuspended) continue;
    if (!assignmentActiveOn(a, date)) continue;
    const mode = a.serviceMode ?? "both";
    if (trip === "AM" && mode === "drop") continue;
    if (trip === "PM" && mode === "pickup") continue;
    const prior = byStudent.get(a.studentId);
    const key = (x: RiderAssignment) => `${x.academicYearCode ?? ""}|${x.effectiveFrom ?? ""}`;
    if (!prior || key(a) > key(prior)) byStudent.set(a.studentId, a);
  }
  return [...byStudent.values()];
}

/**
 * The list an attendant works from: the riders of one run, in the order the
 * bus reaches them. Morning runs go stop 1 → school; afternoon runs come back
 * the other way, so the order reverses.
 *
 * Three things are never dropped from the list, because a child missing from
 * a driver's list is a child left at the gate:
 *  - a child whose run could not be worked out (shown on every run, flagged);
 *  - a child whose stop id no longer resolves (listed last, "stop not found");
 *  - a child whose class could not be read (classesKnown=false: the whole
 *    route is listed and runs are not filtered).
 */
export function ridersOnRun(input: {
  route: { id: string; stops: RiderStop[]; shifts?: TransportShift[] };
  assignments: RiderAssignment[];
  students: Map<string, RiderStudent>;
  classNameById: Map<string, string>;
  /** False when the class list could not be read. */
  classesKnown: boolean;
  date: string;
  trip: RegisterTrip;
  /** "" = every rider of the route on this trip. */
  shiftId: string;
}): RunRider[] {
  const direction = input.trip === "AM" ? "pickup" : "drop";
  const stopById = new Map(input.route.stops.map((s) => [s.id, s]));
  const hasRuns = listRouteShifts({ shifts: input.route.shifts ?? [] }, direction).length > 0;

  const out: RunRider[] = [];
  for (const a of liveRouteAssignments(input.assignments, input.route.id, input.date, input.trip)) {
    const st = input.students.get(a.studentId);
    const className = st?.classId ? (input.classNameById.get(st.classId) ?? "") : "";
    let shiftId = "";
    let unresolved = false;
    let note = "";
    if (hasRuns && input.classesKnown) {
      const res = resolveRiderShift({
        route: { shifts: input.route.shifts ?? [] },
        direction,
        overrideShiftId: input.trip === "AM" ? a.pickupShiftId : a.dropShiftId,
        groupCode: className ? strictClassGroup(className) : null,
      });
      shiftId = res.shift?.id ?? "";
      unresolved = res.needsAttention;
      note = res.needsAttention ? res.detail : "";
    }
    if (input.shiftId && hasRuns && input.classesKnown && !unresolved && shiftId !== input.shiftId) {
      continue;
    }
    const stop = stopById.get(a.stopId);
    out.push({
      studentId: a.studentId,
      assignmentId: a.id,
      fullName: st?.fullName ?? "",
      admissionNo: st?.admissionNo ?? "",
      classId: st?.classId ?? "",
      sectionId: st?.sectionId ?? "",
      className,
      stopId: a.stopId,
      stopName: stop?.name ?? "",
      stopSequence: stop ? stop.sequence : null,
      shiftId,
      shiftUnresolved: unresolved,
      shiftNote: note,
    });
  }

  const dir = input.trip === "AM" ? 1 : -1;
  return out.sort((x, y) => {
    if (x.stopSequence == null && y.stopSequence != null) return 1;
    if (y.stopSequence == null && x.stopSequence != null) return -1;
    if (x.stopSequence != null && y.stopSequence != null && x.stopSequence !== y.stopSequence) {
      return (x.stopSequence - y.stopSequence) * dir;
    }
    return x.fullName.localeCompare(y.fullName);
  });
}

export type RunCounts = {
  riders: number;
  boarded: number;
  dropped: number;
  notBoarded: number;
  unmarked: number;
};

export function runCounts(
  riders: { studentId: string }[],
  statusOf: (studentId: string) => RegisterStatus | null,
): RunCounts {
  const c: RunCounts = { riders: riders.length, boarded: 0, dropped: 0, notBoarded: 0, unmarked: 0 };
  for (const r of riders) {
    const s = statusOf(r.studentId);
    if (s === "boarded") c.boarded += 1;
    else if (s === "dropped") c.dropped += 1;
    else if (s === "not_boarded") c.notBoarded += 1;
    else c.unmarked += 1;
  }
  return c;
}

/* ─── exceptions: bus register against the class register ──── */

export type ClassMark = "P" | "A" | "L" | "HD" | "LE";

export type BoardingExceptionKind =
  /** In class, but the morning bus says not boarded. */
  | "present_not_boarded"
  /** Got on the morning bus, but the class register says absent / on leave. */
  | "boarded_absent"
  /** Got on in the morning, marked not boarded for the drop. */
  | "no_return";

export type BoardingException = {
  kind: BoardingExceptionKind;
  studentId: string;
  fullName: string;
  className: string;
  sectionId: string;
  routeId: string;
  stopName: string;
  amStatus: RegisterStatus | null;
  pmStatus: RegisterStatus | null;
  classMark: ClassMark | null;
};

export const EXCEPTION_LABEL: Record<BoardingExceptionKind, string> = {
  present_not_boarded: "Present in class, not on the morning bus",
  boarded_absent: "Boarded the morning bus, absent in class",
  no_return: "Came by bus, not on the drop",
};

const IN_CLASS: ClassMark[] = ["P", "L", "HD"];
const NOT_IN_CLASS: ClassMark[] = ["A", "LE"];

/**
 * Children whose bus register and class register disagree.
 *
 * Only definite marks are compared. A child not yet marked on the bus, or in a
 * section whose class register was not taken, is not an exception — it is
 * missing information, and is counted separately (`unchecked`) so the office
 * knows how much the list could not look at. Turning "no register" into
 * "absent" would fill this list with children who were sitting in class.
 */
export function boardingExceptions(input: {
  riders: (RunRider & { routeId: string })[];
  amStatus: (studentId: string, routeId: string) => RegisterStatus | null;
  pmStatus: (studentId: string, routeId: string) => RegisterStatus | null;
  /** The class mark, or null when the child has none. */
  classMark: (studentId: string) => ClassMark | null;
  /** Sections whose class register exists for the day. */
  sectionsWithRegister: Set<string>;
}): { exceptions: BoardingException[]; unchecked: number } {
  const exceptions: BoardingException[] = [];
  let unchecked = 0;
  const seen = new Set<string>();
  for (const r of input.riders) {
    const key = `${r.routeId}|${r.studentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const am = input.amStatus(r.studentId, r.routeId);
    const pm = input.pmStatus(r.studentId, r.routeId);
    const registerTaken = !!r.sectionId && input.sectionsWithRegister.has(r.sectionId);
    const mark = registerTaken ? input.classMark(r.studentId) : null;
    const base = {
      studentId: r.studentId,
      fullName: r.fullName,
      className: r.className,
      sectionId: r.sectionId,
      routeId: r.routeId,
      stopName: r.stopName,
      amStatus: am,
      pmStatus: pm,
      classMark: mark,
    };
    if (am && rode(am) && pm === "not_boarded") exceptions.push({ ...base, kind: "no_return" });
    if (!am || !mark) {
      if (am && !mark) unchecked += 1;
      continue;
    }
    if (am === "not_boarded" && IN_CLASS.includes(mark)) {
      exceptions.push({ ...base, kind: "present_not_boarded" });
    } else if (rode(am) && NOT_IN_CLASS.includes(mark)) {
      exceptions.push({ ...base, kind: "boarded_absent" });
    }
  }
  const order: BoardingExceptionKind[] = ["boarded_absent", "present_not_boarded", "no_return"];
  exceptions.sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.fullName.localeCompare(b.fullName),
  );
  return { exceptions, unchecked };
}

/* ─── log book ─────────────────────────────────────────────── */

export type OdoSource = "gps" | "typed" | "";

export type DayLogKm = {
  startKm: number | null;
  endKm: number | null;
};

export type DayKm =
  | { ok: true; km: number }
  | { ok: false; reason: "incomplete" | "end_before_start" };

/**
 * Kilometres run in a day: end − start, only when both are recorded. A dial
 * that reads lower at night than in the morning is a typo, not negative km —
 * it is reported, never counted.
 */
export function dayKm(log: DayLogKm): DayKm {
  if (log.startKm == null || log.endKm == null) return { ok: false, reason: "incomplete" };
  if (log.endKm < log.startKm) return { ok: false, reason: "end_before_start" };
  return { ok: true, km: Math.round((log.endKm - log.startKm) * 10) / 10 };
}

export type GpsOdometerDay = {
  /** First and last odometer reading of the IST day. */
  firstKm: number;
  lastKm: number;
  firstAt: string;
  lastAt: string;
};

export type OdoField = { value: number | null; source: OdoSource; saved: boolean };

/**
 * What the log-book form shows in one odometer box. A saved value always wins
 * — the person who saved it may have corrected the GPS. With nothing saved,
 * the GPS reading is offered, labelled as GPS and as not yet saved.
 */
export function odometerField(
  saved: { value: number | null; source: OdoSource } | null,
  gpsKm: number | null,
): OdoField {
  if (saved && saved.value != null) return { value: saved.value, source: saved.source || "typed", saved: true };
  if (gpsKm != null) return { value: gpsKm, source: "gps", saved: false };
  return { value: null, source: "", saved: false };
}

/**
 * The source to store for a box: "gps" only while the value is still exactly
 * the GPS reading it was filled from; any edit makes it "typed".
 */
export function sourceForSave(value: number | null, gpsKm: number | null, wasSource: OdoSource): OdoSource {
  if (value == null) return "";
  if (wasSource === "gps" && gpsKm != null && value === gpsKm) return "gps";
  return "typed";
}

/** Parse a km box: blank → null (not recorded), never 0. */
export function parseKm(raw: unknown): number | null | "invalid" {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 9_999_999) return "invalid";
  return Math.round(n * 10) / 10;
}

/** Rupees typed into a box → paise. Blank / bad → null. */
export function rupeesToPaise(raw: unknown): number | null {
  const s = String(raw ?? "").replace(/[,₹\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function fuelUnitFor(vehicleFuelUnit: string | undefined): "litre" | "kg" {
  return String(vehicleFuelUnit ?? "").toLowerCase().startsWith("kg") ? "kg" : "litre";
}

/* ─── reports ──────────────────────────────────────────────── */

export type VehicleMonthInput = {
  vehicles: { id: string; name: string; registrationNo: string }[];
  logs: { vehicleId: string; logDate: string; startKm: number | null; endKm: number | null; startSource: OdoSource; endSource: OdoSource }[];
  fills: { vehicleId: string; fillDate: string; quantity: number; unit: "litre" | "kg"; amountPaise: number; voided: boolean }[];
};

export type VehicleMonthRow = {
  vehicleId: string;
  name: string;
  registrationNo: string;
  daysLogged: number;
  /** Days whose km counted (both readings, end ≥ start). */
  daysWithKm: number;
  km: number;
  /** Days whose both readings came from GPS untouched. */
  gpsDays: number;
  /** Days with a reading that was typed. */
  typedDays: number;
  /** Days with one reading missing, or end below start — not counted. */
  problemDays: number;
  fills: number;
  litres: number;
  kg: number;
  amountPaise: number;
  /** Rupees per km; null when no km counted (never divided by zero). */
  rupeesPerKm: number | null;
};

export function vehicleMonthReport(input: VehicleMonthInput): VehicleMonthRow[] {
  return input.vehicles.map((v) => {
    const logs = input.logs.filter((l) => l.vehicleId === v.id);
    const fills = input.fills.filter((f) => f.vehicleId === v.id && !f.voided);
    let km = 0;
    let daysWithKm = 0;
    let gpsDays = 0;
    let typedDays = 0;
    let problemDays = 0;
    for (const l of logs) {
      const d = dayKm({ startKm: l.startKm, endKm: l.endKm });
      if (d.ok) {
        km += d.km;
        daysWithKm += 1;
        if (l.startSource === "gps" && l.endSource === "gps") gpsDays += 1;
      } else {
        problemDays += 1;
      }
      if (l.startSource === "typed" || l.endSource === "typed") typedDays += 1;
    }
    km = Math.round(km * 10) / 10;
    const amountPaise = fills.reduce((s, f) => s + f.amountPaise, 0);
    const litres = fills.filter((f) => f.unit === "litre").reduce((s, f) => s + f.quantity, 0);
    const kg = fills.filter((f) => f.unit === "kg").reduce((s, f) => s + f.quantity, 0);
    return {
      vehicleId: v.id,
      name: v.name,
      registrationNo: v.registrationNo,
      daysLogged: logs.length,
      daysWithKm,
      km,
      gpsDays,
      typedDays,
      problemDays,
      fills: fills.length,
      litres: Math.round(litres * 100) / 100,
      kg: Math.round(kg * 100) / 100,
      amountPaise,
      rupeesPerKm: km > 0 ? Math.round((amountPaise / 100 / km) * 100) / 100 : null,
    };
  });
}

export type BoardingMonthRow = {
  studentId: string;
  fullName: string;
  admissionNo: string;
  className: string;
  routeName: string;
  /** date → "B/D" style cell: AM code, PM code ("" when unmarked). */
  days: Record<string, { am: RegisterStatus | null; pm: RegisterStatus | null }>;
  /** Mornings ridden (boarded). */
  amRidden: number;
  /** Afternoons ridden (boarded or dropped). */
  pmRidden: number;
  /** Trips marked not boarded. */
  notBoarded: number;
  /** Days with any trip ridden. */
  daysRidden: number;
};

/** "B/D", "N/–", "–/D"… — the month grid's cell. Empty when nothing is marked. */
export function monthCell(c: { am: RegisterStatus | null; pm: RegisterStatus | null } | undefined): string {
  if (!c || (!c.am && !c.pm)) return "";
  const code = (s: RegisterStatus | null) => (s ? STATUS_CODE[s] : "–");
  return `${code(c.am)}/${code(c.pm)}`;
}

/**
 * Month-wise boarding per child. Rows are the children who rode a route at
 * any point in the month (from assignments) plus anyone marked; a child with
 * no marks shows an empty row — present on the list, unmarked, not absent.
 * Two marks for one child on one trip (two routes) — a ride on either counts.
 */
export function boardingMonthReport(input: {
  month: string;
  riders: { studentId: string; fullName: string; admissionNo: string; className: string; routeName: string }[];
  marks: { studentId: string; runDate: string; trip: RegisterTrip; status: StoredRegisterStatus }[];
}): BoardingMonthRow[] {
  const dates = new Set(monthDates(input.month));
  const rows = new Map<string, BoardingMonthRow>();
  for (const r of input.riders) {
    if (rows.has(r.studentId)) continue;
    rows.set(r.studentId, {
      ...r,
      days: {},
      amRidden: 0,
      pmRidden: 0,
      notBoarded: 0,
      daysRidden: 0,
    });
  }
  const better = (a: RegisterStatus | null, b: RegisterStatus | null): RegisterStatus | null => {
    if (rode(a)) return a;
    if (rode(b)) return b;
    return a ?? b;
  };
  for (const m of input.marks) {
    if (!dates.has(m.runDate)) continue;
    const s = effectiveStatus(m.status);
    if (!s) continue;
    let row = rows.get(m.studentId);
    if (!row) {
      row = {
        studentId: m.studentId,
        fullName: "",
        admissionNo: "",
        className: "",
        routeName: "",
        days: {},
        amRidden: 0,
        pmRidden: 0,
        notBoarded: 0,
        daysRidden: 0,
      };
      rows.set(m.studentId, row);
    }
    const cell = row.days[m.runDate] ?? { am: null, pm: null };
    if (m.trip === "AM") cell.am = better(cell.am, s);
    else cell.pm = better(cell.pm, s);
    row.days[m.runDate] = cell;
  }
  for (const row of rows.values()) {
    for (const c of Object.values(row.days)) {
      if (rode(c.am)) row.amRidden += 1;
      if (rode(c.pm)) row.pmRidden += 1;
      if (c.am === "not_boarded") row.notBoarded += 1;
      if (c.pm === "not_boarded") row.notBoarded += 1;
      if (rode(c.am) || rode(c.pm)) row.daysRidden += 1;
    }
  }
  return [...rows.values()].sort(
    (a, b) => a.routeName.localeCompare(b.routeName) || a.fullName.localeCompare(b.fullName),
  );
}
