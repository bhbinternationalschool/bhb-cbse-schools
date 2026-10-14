/**
 * Bus register + driver's log book — the reads and writes.
 *
 * Rows: transport_boarding_marks, transport_vehicle_day_logs,
 * transport_fuel_fills (migration 20261011170000). Rules: transportBoardingLog.ts.
 *
 * Every read here answers `ok:false` when it did not complete. A failed read
 * is never handed on as "no marks today" or "no log for this bus" — on a
 * register that is the difference between "not marked yet" and a child the
 * office believes nobody picked up.
 */
import "server-only";

import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import { positionForVehicle } from "@/lib/fleetLive";
import { readLatestPositions } from "@/lib/fleetLive.server";
import { fetchMastersDeskFromDb } from "@/lib/mastersNormalized.server";
import { featureAccess, hasPermission } from "@/lib/rbac";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchSisFromDb } from "@/lib/sisNormalized.server";
import { fetchAllPages, fetchByIds } from "@/lib/supabase/pageAll";
import { fetchTransportDeskFromDb, type TransportDeskBundle } from "@/lib/transportNormalized.server";
import {
  crewScope,
  isIsoDate,
  istDayBounds,
  type ClassMark,
  type CrewScope,
  type GpsOdometerDay,
  type OdoSource,
  type RegisterTrip,
  type RiderStudent,
  type StoredRegisterStatus,
} from "@/lib/transportBoardingLog";

/* ─── access ───────────────────────────────────────────────── */

export type RegisterAccess = {
  /** Office / leadership: every bus. */
  fleetWide: boolean;
  /** Crew: only these. Null when fleetWide. */
  scope: CrewScope | null;
  staffId: string;
  name: string;
};

/**
 * Who may use the bus register, and over which buses.
 *
 * Entry is `transport.view` (or the Boarding register function), the same
 * line the driver app's manifest uses: the built-in Driver role is view-only
 * on the transport desk, and marking a child aboard is field self-service,
 * not desk editing. Teachers and parents hold no transport grant at all.
 *
 * Reach is the second gate. Holders of `transport.edit` or `transport.export`
 * (the transport desk, office, leadership) or the Boarding function with
 * `edit` see the whole fleet. Everyone else — the Driver role — sees only the
 * buses Staff → Duties or Fleet links them to. A driver with no link sees
 * nothing and is told why, rather than the whole fleet.
 */
export function registerAccess(
  ctx: ApiAuthContext,
  bundle: Pick<TransportDeskBundle, "routes" | "vehicles">,
  date: string,
): RegisterAccess {
  const { session, masters, rbac } = ctx;
  const can = (a: "view" | "edit" | "export") => hasPermission(session, masters, "transport", a, rbac);
  const fn = (a: "view" | "edit") => featureAccess(session, masters, "transport.boarding", a, rbac).allowed;
  if (!can("view") && !fn("view")) {
    throw new ApiError("forbidden", "Missing permission transport.view", 403);
  }
  const staffId = (session.staffId || "").trim();
  const name = session.fullName || "";
  if (can("edit") || can("export") || fn("edit")) {
    return { fleetWide: true, scope: null, staffId, name };
  }
  // Crew. The roster is what says which bus is theirs; an unread roster is
  // NOT "no bus" — refuse instead of showing an empty list as an answer.
  if ((masters.staff ?? []).length === 0) {
    throw new ApiError("server_error", "Staff roster unavailable — cannot tell which bus is yours. Try again.", 503);
  }
  const scope = crewScope({
    staffId,
    staff: masters.staff ?? [],
    routes: bundle.routes,
    vehicles: bundle.vehicles,
    date,
  });
  return { fleetWide: false, scope, staffId, name };
}

export function mayUseRoute(access: RegisterAccess, routeId: string): boolean {
  return access.fleetWide || !!access.scope?.routeIds.includes(routeId);
}

export function mayUseVehicle(access: RegisterAccess, vehicleId: string): boolean {
  return access.fleetWide || !!access.scope?.vehicleIds.includes(vehicleId);
}

export function assertRoute(access: RegisterAccess, routeId: string) {
  if (!mayUseRoute(access, routeId)) {
    throw new ApiError("forbidden", "This route is not on your bus. Ask the office to link you in Staff → Duties.", 403);
  }
}

export function assertVehicle(access: RegisterAccess, vehicleId: string) {
  if (!mayUseVehicle(access, vehicleId)) {
    throw new ApiError("forbidden", "This vehicle is not yours. Ask the office to link you in Staff → Duties or Fleet.", 403);
  }
}

/* ─── the desk data a register needs ───────────────────────── */

export type RegisterDesk = {
  transport: TransportDeskBundle;
  students: Map<string, RiderStudent>;
  classNameById: Map<string, string>;
  /** False when the class list could not be read — runs are not filtered then. */
  classesKnown: boolean;
};

export async function loadTransportDesk(): Promise<TransportDeskBundle> {
  const { bundle, ok } = await fetchTransportDeskFromDb();
  if (!ok) throw new ApiError("server_error", "Transport data unavailable", 503);
  return bundle;
}

/** Transport + roster + classes. Refuses when the roster cannot be read. */
export async function loadRegisterDesk(transport?: TransportDeskBundle): Promise<RegisterDesk> {
  const [t, sis, mastersRead] = await Promise.all([
    transport ? Promise.resolve(transport) : loadTransportDesk(),
    fetchSisFromDb(),
    fetchMastersDeskFromDb(),
  ]);
  if (!sis.ok) {
    // An unconfirmed empty roster renders a list of blank names, which on a
    // driver's phone reads as "these children are not enrolled".
    throw new ApiError("server_error", "Student roster unavailable", 503);
  }
  const students = new Map<string, RiderStudent>();
  for (const s of (sis.bundle.students ?? []) as RiderStudent[]) students.set(s.id, s);
  const classes = (mastersRead.bundle?.classes ?? []) as { id: string; name: string }[];
  return {
    transport: t,
    students,
    classNameById: new Map(classes.map((c) => [c.id, c.name])),
    classesKnown: !mastersRead.readFailed,
  };
}

async function tenant() {
  const ctx = await getServerTenantContext();
  if (!ctx) throw new ApiError("server_error", "Database not configured", 503);
  return ctx;
}

/* ─── marks ────────────────────────────────────────────────── */

export type MarkRow = {
  runDate: string;
  routeId: string;
  trip: RegisterTrip;
  shiftId: string;
  vehicleId: string;
  studentId: string;
  stopId: string;
  status: StoredRegisterStatus;
  tappedAt: string;
  markedByName: string;
  updatedAt: string;
  /** The attendant's phone at the tap; null when it gave no location. */
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
};

const MARK_COLS =
  "run_date, route_id, trip, shift_id, vehicle_id, student_id, stop_id, status, tapped_at, marked_by_name, updated_at, lat, lng, accuracy_m";

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowToMark(r: Record<string, unknown>): MarkRow {
  return {
    runDate: String(r.run_date).slice(0, 10),
    routeId: String(r.route_id),
    trip: r.trip === "PM" ? "PM" : "AM",
    shiftId: String(r.shift_id ?? ""),
    vehicleId: String(r.vehicle_id ?? ""),
    studentId: String(r.student_id),
    stopId: String(r.stop_id ?? ""),
    status: String(r.status) as StoredRegisterStatus,
    tappedAt: String(r.tapped_at ?? ""),
    markedByName: String(r.marked_by_name ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    lat: numOrNull(r.lat),
    lng: numOrNull(r.lng),
    accuracyM: numOrNull(r.accuracy_m),
  };
}

/** Marks between two dates inclusive, optionally for some routes. Paged. */
export async function readMarks(input: {
  from: string;
  to: string;
  routeIds?: string[];
}): Promise<{ ok: true; marks: MarkRow[] } | { ok: false; error: string }> {
  const { sb, tenantId } = await tenant();
  if (input.routeIds && input.routeIds.length === 0) return { ok: true, marks: [] };
  const base = (from: number, to: number, chunk?: string[]) => {
    let q = sb
      .from("transport_boarding_marks")
      .select(`id, ${MARK_COLS}`)
      .eq("tenant_id", tenantId)
      .gte("run_date", input.from)
      .lte("run_date", input.to);
    if (chunk) q = q.in("route_id", chunk);
    return q.order("id", { ascending: true }).range(from, to);
  };
  const res = input.routeIds
    ? await fetchByIds<Record<string, unknown>>(input.routeIds, (chunk, from, to) => base(from, to, chunk))
    : await fetchAllPages<Record<string, unknown>>((from, to) => base(from, to));
  if (res.error) return { ok: false, error: res.error };
  return { ok: true, marks: res.rows.map(rowToMark) };
}

/**
 * One tap, saved on its own. Idempotent: the same tap retried writes the same
 * row; an older tap arriving after a newer one is not applied, and the newer
 * mark is returned so the phone can show what is actually stored.
 */
export async function writeMark(input: {
  runDate: string;
  routeId: string;
  trip: RegisterTrip;
  shiftId: string;
  vehicleId: string;
  studentId: string;
  stopId: string;
  status: StoredRegisterStatus;
  tappedAt: string;
  clientRef: string;
  staffId: string;
  name: string;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
}): Promise<{ applied: boolean; mark: MarkRow }> {
  const { sb, tenantId } = await tenant();
  const { data, error } = await sb.rpc("transport_boarding_mark_upsert", {
    p_tenant_id: tenantId,
    p: {
      run_date: input.runDate,
      route_id: input.routeId,
      trip: input.trip,
      shift_id: input.shiftId,
      vehicle_id: input.vehicleId,
      student_id: input.studentId,
      stop_id: input.stopId,
      status: input.status,
      tapped_at: input.tappedAt,
      client_ref: input.clientRef.slice(0, 80),
      marked_by_staff_id: input.staffId,
      marked_by_name: input.name.slice(0, 120),
      lat: input.lat == null ? "" : String(input.lat),
      lng: input.lng == null ? "" : String(input.lng),
      accuracy_m: input.accuracyM == null ? "" : String(input.accuracyM),
    },
  });
  if (error) throw new ApiError("server_error", `Could not save the mark: ${error.message}`, 502);
  const out = data as { applied?: boolean; row?: Record<string, unknown> } | null;
  if (!out?.row) throw new ApiError("server_error", "Could not save the mark", 502);
  return { applied: !!out.applied, mark: rowToMark(out.row) };
}

/* ─── class register for one day ───────────────────────────── */

export async function readClassAttendanceForDate(date: string): Promise<
  | { ok: true; sectionsWithRegister: Set<string>; markByStudent: Map<string, ClassMark> }
  | { ok: false; error: string }
> {
  const { sb, tenantId } = await tenant();
  const heads = await fetchAllPages<{ id: string; section_id: string }>((from, to) =>
    sb
      .from("attendance_desk_registers")
      .select("id, section_id")
      .eq("tenant_id", tenantId)
      .eq("attendance_date", date)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (heads.error) return { ok: false, error: heads.error };
  const sectionsWithRegister = new Set(heads.rows.map((h) => String(h.section_id)));
  const marks = await fetchByIds<{ student_id: string; status: string }>(
    heads.rows.map((h) => String(h.id)),
    (chunk, from, to) =>
      sb
        .from("attendance_desk_marks")
        .select("id, student_id, status")
        .eq("tenant_id", tenantId)
        .in("register_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
  );
  if (marks.error) return { ok: false, error: marks.error };
  const markByStudent = new Map<string, ClassMark>();
  for (const m of marks.rows) {
    const s = String(m.status);
    if (s === "P" || s === "A" || s === "L" || s === "HD" || s === "LE") markByStudent.set(String(m.student_id), s);
  }
  return { ok: true, sectionsWithRegister, markByStudent };
}

/* ─── log book ─────────────────────────────────────────────── */

export type DayLogRow = {
  vehicleId: string;
  logDate: string;
  startKm: number | null;
  startSource: OdoSource;
  endKm: number | null;
  endSource: OdoSource;
  driverName: string;
  remarks: string;
  rowVersion: number;
  updatedByName: string;
  updatedAt: string;
};

const LOG_COLS =
  "vehicle_id, log_date, start_km, start_km_source, end_km, end_km_source, driver_name, remarks, row_version, updated_by_name, updated_at";

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowToLog(r: Record<string, unknown>): DayLogRow {
  return {
    vehicleId: String(r.vehicle_id),
    logDate: String(r.log_date).slice(0, 10),
    startKm: num(r.start_km),
    startSource: (String(r.start_km_source ?? "") as OdoSource) || "",
    endKm: num(r.end_km),
    endSource: (String(r.end_km_source ?? "") as OdoSource) || "",
    driverName: String(r.driver_name ?? ""),
    remarks: String(r.remarks ?? ""),
    rowVersion: Number(r.row_version ?? 1),
    updatedByName: String(r.updated_by_name ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

export async function readDayLogs(input: { from: string; to: string }): Promise<
  { ok: true; logs: DayLogRow[] } | { ok: false; error: string }
> {
  const { sb, tenantId } = await tenant();
  const res = await fetchAllPages<Record<string, unknown>>((from, to) =>
    sb
      .from("transport_vehicle_day_logs")
      .select(`id, ${LOG_COLS}`)
      .eq("tenant_id", tenantId)
      .gte("log_date", input.from)
      .lte("log_date", input.to)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (res.error) return { ok: false, error: res.error };
  return { ok: true, logs: res.rows.map(rowToLog) };
}

/**
 * Save one vehicle-day. `expectedVersion` is the row_version the form was
 * loaded at — null when the form believed there was no row yet. Anything
 * else on the server means another phone saved in between: 409, reload.
 */
export async function saveDayLog(input: {
  vehicleId: string;
  logDate: string;
  startKm: number | null;
  startSource: OdoSource;
  endKm: number | null;
  endSource: OdoSource;
  driverName: string;
  remarks: string;
  expectedVersion: number | null;
  staffId: string;
  name: string;
}): Promise<DayLogRow> {
  const { sb, tenantId } = await tenant();
  const fields = {
    start_km: input.startKm,
    start_km_source: input.startKm == null ? "" : input.startSource,
    end_km: input.endKm,
    end_km_source: input.endKm == null ? "" : input.endSource,
    driver_name: input.driverName.slice(0, 120),
    remarks: input.remarks.slice(0, 1000),
    updated_by_staff_id: input.staffId,
    updated_by_name: input.name.slice(0, 120),
    updated_at: new Date().toISOString(),
  };
  const conflict = () =>
    new ApiError(
      "conflict",
      "Someone else saved this log while you were editing. Reload to see their figures, then save again.",
      409,
    );

  if (input.expectedVersion == null) {
    const { data, error } = await sb
      .from("transport_vehicle_day_logs")
      .upsert(
        { tenant_id: tenantId, vehicle_id: input.vehicleId, log_date: input.logDate, row_version: 1, ...fields },
        { onConflict: "tenant_id,vehicle_id,log_date", ignoreDuplicates: true },
      )
      .select(LOG_COLS);
    if (error) throw new ApiError("server_error", `Could not save the log: ${error.message}`, 502);
    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    if (!row) throw conflict();
    return rowToLog(row);
  }

  const { data, error } = await sb
    .from("transport_vehicle_day_logs")
    .update({ ...fields, row_version: input.expectedVersion + 1 })
    .eq("tenant_id", tenantId)
    .eq("vehicle_id", input.vehicleId)
    .eq("log_date", input.logDate)
    .eq("row_version", input.expectedVersion)
    .select(LOG_COLS);
  if (error) throw new ApiError("server_error", `Could not save the log: ${error.message}`, 502);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) throw conflict();
  return rowToLog(row);
}

/* ─── fuel ─────────────────────────────────────────────────── */

export type FuelFillRow = {
  id: string;
  vehicleId: string;
  fillDate: string;
  quantity: number;
  unit: "litre" | "kg";
  amountPaise: number;
  odometerKm: number | null;
  receiptPath: string;
  note: string;
  createdByStaffId: string;
  createdByName: string;
  createdAt: string;
  voided: boolean;
  voidReason: string;
};

const FILL_COLS =
  "id, vehicle_id, fill_date, quantity, unit, amount_paise, odometer_km, receipt_path, note, created_by_staff_id, created_by_name, created_at, voided_at, void_reason";

function rowToFill(r: Record<string, unknown>): FuelFillRow {
  return {
    id: String(r.id),
    vehicleId: String(r.vehicle_id),
    fillDate: String(r.fill_date).slice(0, 10),
    quantity: Number(r.quantity),
    unit: r.unit === "kg" ? "kg" : "litre",
    amountPaise: Number(r.amount_paise),
    odometerKm: num(r.odometer_km),
    receiptPath: String(r.receipt_path ?? ""),
    note: String(r.note ?? ""),
    createdByStaffId: String(r.created_by_staff_id ?? ""),
    createdByName: String(r.created_by_name ?? ""),
    createdAt: String(r.created_at ?? ""),
    voided: r.voided_at != null,
    voidReason: String(r.void_reason ?? ""),
  };
}

export async function readFuelFills(input: { from: string; to: string }): Promise<
  { ok: true; fills: FuelFillRow[] } | { ok: false; error: string }
> {
  const { sb, tenantId } = await tenant();
  const res = await fetchAllPages<Record<string, unknown>>((from, to) =>
    sb
      .from("transport_fuel_fills")
      .select(FILL_COLS)
      .eq("tenant_id", tenantId)
      .gte("fill_date", input.from)
      .lte("fill_date", input.to)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (res.error) return { ok: false, error: res.error };
  return { ok: true, fills: res.rows.map(rowToFill) };
}

/** Insert a fill under the phone's id; a retry of the same id is a no-op. */
export async function addFuelFill(input: Omit<FuelFillRow, "createdAt" | "voided" | "voidReason">): Promise<FuelFillRow> {
  const { sb, tenantId } = await tenant();
  const { error } = await sb.from("transport_fuel_fills").upsert(
    {
      id: input.id,
      tenant_id: tenantId,
      vehicle_id: input.vehicleId,
      fill_date: input.fillDate,
      quantity: input.quantity,
      unit: input.unit,
      amount_paise: input.amountPaise,
      odometer_km: input.odometerKm,
      receipt_path: input.receiptPath,
      note: input.note.slice(0, 500),
      created_by_staff_id: input.createdByStaffId,
      created_by_name: input.createdByName.slice(0, 120),
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (error) throw new ApiError("server_error", `Could not save the fill: ${error.message}`, 502);
  const { data, error: readErr } = await sb
    .from("transport_fuel_fills")
    .select(FILL_COLS)
    .eq("tenant_id", tenantId)
    .eq("id", input.id)
    .maybeSingle();
  if (readErr) throw new ApiError("server_error", `Saved, but could not read it back: ${readErr.message}`, 502);
  // The id belongs to another tenant (or vanished): refuse rather than claim it saved.
  if (!data) throw new ApiError("conflict", "That entry id is already used. Try again.", 409);
  return rowToFill(data as Record<string, unknown>);
}

export async function readFuelFill(id: string): Promise<FuelFillRow | null> {
  const { sb, tenantId } = await tenant();
  const { data, error } = await sb
    .from("transport_fuel_fills")
    .select(FILL_COLS)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new ApiError("server_error", `Could not read the fill: ${error.message}`, 502);
  return data ? rowToFill(data as Record<string, unknown>) : null;
}

/*
 * Voiding lives in transportFuelRegister.server.ts (voidFillWithVoucher): a
 * fill may carry a posted Vehicle Fuel voucher, which must be reversed with it.
 */

/* ─── GPS odometer for one vehicle-day ─────────────────────── */

export type GpsOdometerResult =
  /** Readings found. */
  | { state: "ok"; vehicleRef: string; day: GpsOdometerDay }
  /** The vehicle has a tracker, but no odometer reading that day (or it is past retention). */
  | { state: "no_data"; vehicleRef: string }
  /** No tracker reports for this vehicle. */
  | { state: "untracked" }
  /** The feed could not be read — say so; never "untracked". */
  | { state: "unavailable" };

/**
 * First and last odometer reading of an IST day, from Fleet Edge telemetry.
 *
 * The tracker is found through the live-position helpers (fleetLive), which
 * match on registration OR chassis — two of the buses are stored by VIN. Raw
 * positions are kept for a limited time, so an older day answers "no_data",
 * never 0 km.
 */
export async function readGpsOdometers(
  vehicles: { id: string; registrationNo: string; name: string }[],
  date: string,
): Promise<Map<string, GpsOdometerResult>> {
  const out = new Map<string, GpsOdometerResult>();
  const latest = await readLatestPositions();
  if (latest.length === 0) {
    for (const v of vehicles) out.set(v.id, { state: "unavailable" });
    return out;
  }
  const ctx = await getServerTenantContext();
  if (!ctx) {
    for (const v of vehicles) out.set(v.id, { state: "unavailable" });
    return out;
  }
  const { fromIso, toIso } = istDayBounds(date);
  await Promise.all(
    vehicles.map(async (v) => {
      const pos = positionForVehicle(v, latest);
      if (!pos) {
        out.set(v.id, { state: "untracked" });
        return;
      }
      const ref = pos.vehicleRef;
      const pick = (ascending: boolean) =>
        ctx.sb
          .from("fleet_vehicle_positions")
          .select("recorded_at, odometer_km")
          .eq("tenant_id", ctx.tenantId)
          .eq("vehicle_ref", ref)
          .gte("recorded_at", fromIso)
          .lt("recorded_at", toIso)
          .not("odometer_km", "is", null)
          .order("recorded_at", { ascending })
          .limit(1);
      const [first, last] = await Promise.all([pick(true), pick(false)]);
      if (first.error || last.error) {
        out.set(v.id, { state: "unavailable" });
        return;
      }
      const a = (first.data ?? [])[0] as { recorded_at: string; odometer_km: number } | undefined;
      const b = (last.data ?? [])[0] as { recorded_at: string; odometer_km: number } | undefined;
      if (!a || !b) {
        out.set(v.id, { state: "no_data", vehicleRef: ref });
        return;
      }
      out.set(v.id, {
        state: "ok",
        vehicleRef: ref,
        day: {
          firstKm: Math.round(Number(a.odometer_km) * 10) / 10,
          lastKm: Math.round(Number(b.odometer_km) * 10) / 10,
          firstAt: a.recorded_at,
          lastAt: b.recorded_at,
        },
      });
    }),
  );
  return out;
}

/* ─── request helpers shared by the routes ─────────────────── */

/** A YYYY-MM-DD query/body value, defaulting to today in IST; never in the future. */
export function dayParam(raw: unknown, today: string): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return today;
  if (!isIsoDate(v)) throw new ApiError("bad_request", "date must be YYYY-MM-DD", 400);
  if (v > today) throw new ApiError("bad_request", "That date has not happened yet", 400);
  return v;
}

/** How many days back a register or log may still be changed. */
export function editableDaysBack(access: RegisterAccess): number {
  // Crew: today, plus yesterday for the evening odometer typed next morning.
  // Office: a week, to correct a missed tap from the attendant's word.
  return access.fleetWide ? 7 : 1;
}

export function assertEditableDate(access: RegisterAccess, date: string, today: string) {
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
  if (days < 0) throw new ApiError("bad_request", "That date has not happened yet", 400);
  if (days > editableDaysBack(access)) {
    throw new ApiError(
      "forbidden",
      access.fleetWide
        ? "Older than a week — this day is closed for changes."
        : "Only today and yesterday can be changed from your phone. Ask the office.",
      403,
    );
  }
}
