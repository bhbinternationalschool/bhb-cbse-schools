/**
 * Transport — routes, stops, riders, fleet (§6c), boarding, GPS desk (localStorage).
 * Monthly dues derived from assignments for Fee Take.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import {
  DEFAULT_AY,
  SESSION_MONTHS,
  dueOnForSessionMonth,
  sessionStartYear,
} from "@/lib/masters";
import { checkHold } from "@/lib/holds";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";
import { TENANT } from "@/lib/types";

/* ─── Core ops ─────────────────────────────────────────────── */

/**
 * Where a stop's distance came from.
 *
 * `google` is a Distance Matrix road result and is the only value safe to bill
 * on without a human having looked. `manual` was typed by a person. `""` means
 * nobody has established it — which is NOT the same as zero kilometres, and
 * must never be quietly treated as such.
 */
export type StopDistanceSource = "" | "google" | "manual";

export type TransportStop = {
  id: string;
  name: string;
  sequence: number;
  /** Distance from school (km) — for per-km / slab fee policy */
  distanceKm: number;
  /** Coordinates, when the stop was picked from Google Places. */
  geoLat?: number;
  geoLng?: number;
  /** Google place id, so the same stop resolves identically next time. */
  placeId?: string;
  /** Full address Google returned — shown so a clerk can sanity-check the pin. */
  geoAddress?: string;
  distanceSource: StopDistanceSource;
};

export type TransportRoute = {
  id: string;
  code: string;
  name: string;
  busNo: string;
  vehicleReg: string;
  /** Linked fleet vehicle (preferred over free-text busNo/vehicleReg) */
  vehicleId: string;
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
  effectiveFrom: string;
  effectiveTo: string | null;
  /** Override route / policy fee when > 0 */
  monthlyFeePaise: number;
  /** Audit when fee override differs from expected */
  feeOverrideReason: string;
  boardingSuspended: boolean;
  createdAt: string;
};

export type TransportFeeRateMode = "flat_route" | "per_km" | "slab";

export type TransportFeeSlab = {
  id: string;
  upToKm: number;
  monthlyFeePaise: number;
};

export type TransportFeePolicy = {
  academicYearCode: string;
  rateMode: TransportFeeRateMode;
  ratePerKmPaise: number;
  minFeePaise: number;
  maxFeePaise: number | null;
  slabs: TransportFeeSlab[];
  /** Soft Principal approval threshold for repair estimates */
  repairApprovalPaise: number;
};

/* ─── Fleet §6c ────────────────────────────────────────────── */

export type VehicleType = "bus" | "mini_bus" | "van" | "staff_car";
export type FuelType = "cng" | "diesel" | "petrol" | "electric";
export type FuelUnit = "liter" | "kg" | "kwh";
export type VehicleStatus =
  | "active"
  | "in_workshop"
  | "inactive"
  | "sold";

export type CertType =
  | "insurance"
  | "puc"
  | "fitness"
  | "permit"
  | "road_tax"
  | "cng_hydro"
  | "ais140"
  | "fire_extinguisher";

export type VehicleComplianceDoc = {
  id: string;
  certType: CertType;
  expiryDate: string;
  renewalCostPaise: number;
  vendorId: string;
  docNote: string;
};

export type ServiceScheduleItem = {
  id: string;
  task: string;
  intervalKm: number | null;
  intervalDays: number | null;
  lastDoneOn: string;
  lastDoneOdo: number;
  nextDueOn: string;
  nextDueOdo: number;
};

export type FleetVehicle = {
  id: string;
  registrationNo: string;
  name: string;
  type: VehicleType;
  fuelType: FuelType;
  fuelUnit: FuelUnit;
  tankCapacity: number;
  odometerKm: number;
  avgMileage: number;
  primaryRouteId: string;
  /** Bus photo URL for Fee Take / parent comms */
  photoUrl?: string;
  /** Passenger capacity for route planning */
  seatCapacity?: number;
  /** Assigned driver (WhatsApp hub / fleet comms) */
  driverName?: string;
  driverMobile?: string;
  status: VehicleStatus;
  compliance: VehicleComplianceDoc[];
  serviceSchedule: ServiceScheduleItem[];
  isActive: boolean;
  createdAt: string;
};

export type DealerType =
  | "fuel_dealer"
  | "workshop"
  | "spare_parts_supplier"
  | "financier"
  | "insurer"
  | "rto_agent"
  | "cng_cert_agency";

export type FleetDealer = {
  id: string;
  name: string;
  type: DealerType;
  phone: string;
  gstin: string;
  paymentTermsDays: number;
  isActive: boolean;
};

export type FuelStockLocation = {
  id: string;
  name: string;
  fuelType: FuelType;
  qtyOnHand: number;
  minAlert: number;
  maxCapacity: number;
};

export type FuelPurchase = {
  id: string;
  locationId: string;
  dealerId: string;
  purchasedOn: string;
  qty: number;
  ratePaise: number;
  amountPaise: number;
  billNo: string;
  paymentStatus: "paid_cash" | "on_account";
  createdAt: string;
};

export type FuelRefillLog = {
  id: string;
  vehicleId: string;
  filledAt: string;
  odometerKm: number;
  qty: number;
  ratePerUnitPaise: number;
  amountPaise: number;
  source: "depot_stock" | "dealer_pump";
  dealerId: string;
  locationId: string;
  billNo: string;
  filledBy: string;
  paymentStatus: "paid_cash" | "on_account" | "adjusted_from_stock";
  kmSinceLast: number;
  mileage: number;
  anomaly: boolean;
  createdAt: string;
};

export type PayableSourceType =
  | "fuel_refill"
  | "fuel_purchase"
  | "repair_job"
  | "emi_installment"
  | "insurance_premium"
  | "certificate_renewal";

export type FleetPayable = {
  id: string;
  dealerId: string;
  vehicleId: string;
  sourceType: PayableSourceType;
  sourceId: string;
  amountPaise: number;
  dueOn: string;
  status: "open" | "partial" | "paid";
  paidPaise: number;
  paidOn: string;
  note: string;
  createdAt: string;
};

export type VehicleLoan = {
  id: string;
  vehicleId: string;
  dealerId: string;
  accountNo: string;
  principalPaise: number;
  ratePct: number;
  tenureMonths: number;
  emiPaise: number;
  emiDueDay: number;
  startDate: string;
  endDate: string;
  createdAt: string;
};

export type EmiScheduleRow = {
  id: string;
  loanId: string;
  installmentNo: number;
  dueOn: string;
  amountPaise: number;
  status: "due" | "paid" | "overdue" | "waived";
  paidOn: string;
  paidAmountPaise: number;
};

export type VehicleInsurance = {
  id: string;
  vehicleId: string;
  dealerId: string;
  policyNo: string;
  type: "third_party" | "comprehensive";
  premiumPaise: number;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
};

export type CertificateRenewal = {
  id: string;
  vehicleId: string;
  certType: CertType;
  dealerId: string;
  issuedDate: string;
  expiryDate: string;
  feePaise: number;
  billNo: string;
  paymentStatus: "open" | "paid";
  paidOn: string;
  createdAt: string;
};

export type ServiceJobStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled";

export type ServiceJobCard = {
  id: string;
  vehicleId: string;
  dealerId: string;
  kind: "service" | "repair";
  repairType: "" | "breakdown" | "accident" | "warranty";
  title: string;
  odometerKm: number;
  laborPaise: number;
  partsPaise: number;
  status: ServiceJobStatus;
  openedOn: string;
  completedOn: string;
  note: string;
};

export type RepairRequest = {
  id: string;
  vehicleId: string;
  reportedBy: string;
  reportedOn: string;
  symptom: string;
  location: string;
  estimatePaise: number;
  status: "open" | "approved" | "converted" | "closed";
  jobCardId: string;
};

/* ─── Boarding + GPS ───────────────────────────────────────── */

export type BoardingTrip = "AM" | "PM";
export type BoardingStatus = "boarded" | "absent" | "unauthorized";

/** GPS captured from the attendant's own phone at the moment they mark
 * boarding/offboarding — not from Fleet Edge vehicle telemetry, which is
 * only continuous for 1 of 5 vehicles today and far too coarse (30-minute
 * windows) on the rest to pin down a specific stop. */
export type BoardingGeoCapture = {
  lat: number;
  lng: number;
  accuracyM: number | null;
  at: string;
  distanceFromSchoolKm: number;
};

export type BoardingEvent = {
  id: string;
  date: string;
  routeId: string;
  trip: BoardingTrip;
  studentId: string;
  status: BoardingStatus;
  note: string;
  createdAt: string;
  /** Optional: old records predate location capture. */
  boardedLocation?: BoardingGeoCapture | null;
  offboardedLocation?: BoardingGeoCapture | null;
};

export type GpsPing = {
  id: string;
  vehicleId: string;
  lat: number;
  lng: number;
  recordedAt: string;
  source: "manual" | "device" | "browser";
  note: string;
};

/* ─── State ────────────────────────────────────────────────── */

export type TransportState = {
  version: 2;
  feePolicy: TransportFeePolicy;
  routes: TransportRoute[];
  assignments: TransportAssignment[];
  vehicles: FleetVehicle[];
  dealers: FleetDealer[];
  fuelStockLocations: FuelStockLocation[];
  fuelPurchases: FuelPurchase[];
  fuelRefillLogs: FuelRefillLog[];
  payables: FleetPayable[];
  vehicleLoans: VehicleLoan[];
  emiSchedule: EmiScheduleRow[];
  insurancePolicies: VehicleInsurance[];
  certificateRenewals: CertificateRenewal[];
  serviceJobCards: ServiceJobCard[];
  repairRequests: RepairRequest[];
  boardingEvents: BoardingEvent[];
  gpsPings: GpsPing[];
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
  vehicleId: string;
  vehiclePhotoUrl: string;
  stopName: string;
  periodKey: string;
  periodLabel: string;
  dueOn: string;
  amountPaise: number;
};

export type TransportComplianceAlertCode =
  | "TR_UNAUTHORIZED"
  | "TR_NO_DUE"
  | "TR_UNPAID"
  | "TR_UNDERCHARGE"
  | "TR_RIDING_INACTIVE_FEE";

export type TransportComplianceAlert = {
  code: TransportComplianceAlertCode;
  severity: "critical" | "high" | "medium";
  studentId: string;
  routeId: string;
  assignmentId: string;
  message: string;
  amountPaise: number;
  date: string;
};

const STORAGE_KEY = "bhb_transport_v2";
const LEGACY_KEY = "bhb_transport_v1";

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fuelUnitFor(ft: FuelType): FuelUnit {
  if (ft === "cng") return "kg";
  if (ft === "electric") return "kwh";
  return "liter";
}

export function defaultFeePolicy(ay = DEFAULT_AY): TransportFeePolicy {
  return {
    academicYearCode: ay,
    rateMode: "flat_route",
    ratePerKmPaise: 800,
    minFeePaise: 0,
    maxFeePaise: null,
    slabs: [
      { id: id("slb"), upToKm: 3, monthlyFeePaise: 40000 },
      { id: id("slb"), upToKm: 5, monthlyFeePaise: 55000 },
      { id: id("slb"), upToKm: 8, monthlyFeePaise: 70000 },
      { id: id("slb"), upToKm: 99, monthlyFeePaise: 90000 },
    ],
    repairApprovalPaise: 2500000,
  };
}

function emptyTransport(): TransportState {
  return {
    version: 2,
    feePolicy: defaultFeePolicy(),
    routes: [],
    assignments: [],
    vehicles: [],
    dealers: [],
    fuelStockLocations: [],
    fuelPurchases: [],
    fuelRefillLogs: [],
    payables: [],
    vehicleLoans: [],
    emiSchedule: [],
    insurancePolicies: [],
    certificateRenewals: [],
    serviceJobCards: [],
    repairRequests: [],
    boardingEvents: [],
    gpsPings: [],
  };
}

export function normalizeStop(
  s: Partial<TransportStop>,
  i: number,
): TransportStop {
  const km = Math.max(0, Number(s.distanceKm) || 0);
  const src: StopDistanceSource =
    s.distanceSource === "google" || s.distanceSource === "manual"
      ? s.distanceSource
      : // Stops saved before distances were sourced carry a hand-typed km and
        // no provenance. Call that `manual` rather than inventing `google`; a
        // stop with no distance at all stays unsourced.
        km > 0
        ? "manual"
        : "";
  const lat = Number(s.geoLat);
  const lng = Number(s.geoLng);
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
  return {
    id: s.id ?? id("st"),
    name: s.name ?? `Stop ${i + 1}`,
    sequence: s.sequence ?? i + 1,
    distanceKm: km,
    distanceSource: src,
    ...(hasGeo ? { geoLat: lat, geoLng: lng } : {}),
    ...(s.placeId ? { placeId: String(s.placeId) } : {}),
    ...(s.geoAddress ? { geoAddress: String(s.geoAddress) } : {}),
  };
}

/** True when the stop has coordinates we can measure a road distance from. */
export function stopHasGeo(stop: TransportStop | undefined): boolean {
  return (
    !!stop &&
    Number.isFinite(stop.geoLat) &&
    Number.isFinite(stop.geoLng) &&
    (stop.geoLat !== 0 || stop.geoLng !== 0)
  );
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
    vehicleId: r.vehicleId ?? "",
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
    effectiveFrom: a.effectiveFrom ?? todayIso(),
    effectiveTo: a.effectiveTo ?? null,
    monthlyFeePaise: Math.max(0, a.monthlyFeePaise ?? 0),
    feeOverrideReason: a.feeOverrideReason ?? "",
    boardingSuspended: !!a.boardingSuspended,
    createdAt: a.createdAt ?? new Date().toISOString(),
  };
}

function normalizeVehicle(v: Partial<FleetVehicle>): FleetVehicle {
  const fuelType = (v.fuelType as FuelType) || "diesel";
  return {
    id: v.id ?? id("veh"),
    registrationNo: (v.registrationNo ?? "").trim().toUpperCase() || "TBD",
    name: v.name ?? v.registrationNo ?? "Bus",
    type: (v.type as VehicleType) || "bus",
    fuelType,
    fuelUnit: v.fuelUnit || fuelUnitFor(fuelType),
    tankCapacity: Math.max(0, Number(v.tankCapacity) || 0),
    odometerKm: Math.max(0, Number(v.odometerKm) || 0),
    avgMileage: Math.max(0, Number(v.avgMileage) || 0),
    primaryRouteId: v.primaryRouteId ?? "",
    photoUrl: v.photoUrl?.trim() || "",
    seatCapacity: Math.max(1, Number(v.seatCapacity) || 40),
    driverName: (v.driverName ?? "").trim(),
    driverMobile: (v.driverMobile ?? "").replace(/\D/g, "").slice(-10),
    status: (v.status as VehicleStatus) || "active",
    compliance: Array.isArray(v.compliance) ? v.compliance : [],
    serviceSchedule: Array.isArray(v.serviceSchedule) ? v.serviceSchedule : [],
    isActive: v.isActive !== false,
    createdAt: v.createdAt ?? new Date().toISOString(),
  };
}

function normalizeFeePolicy(p?: Partial<TransportFeePolicy>): TransportFeePolicy {
  const base = defaultFeePolicy(p?.academicYearCode);
  if (!p) return base;
  return {
    ...base,
    ...p,
    slabs: Array.isArray(p.slabs) && p.slabs.length ? p.slabs : base.slabs,
    repairApprovalPaise:
      p.repairApprovalPaise ?? base.repairApprovalPaise,
  };
}

function migrateFromV1(raw: unknown): TransportState {
  const empty = emptyTransport();
  if (!raw || typeof raw !== "object") return empty;
  const parsed = raw as {
    routes?: Partial<TransportRoute>[];
    assignments?: Partial<TransportAssignment>[];
  };
  const routes = (parsed.routes ?? []).map(normalizeRoute);
  const vehicles: FleetVehicle[] = [];
  for (const r of routes) {
    if (!r.vehicleReg && !r.busNo) continue;
    const reg = (r.vehicleReg || r.busNo || "").toUpperCase();
    if (vehicles.some((v) => v.registrationNo === reg)) {
      const hit = vehicles.find((v) => v.registrationNo === reg)!;
      r.vehicleId = hit.id;
      continue;
    }
    const veh = normalizeVehicle({
      registrationNo: reg,
      name: r.busNo || reg,
      primaryRouteId: r.id,
      type: "bus",
      fuelType: "diesel",
    });
    vehicles.push(veh);
    r.vehicleId = veh.id;
  }
  return {
    ...empty,
    routes,
    assignments: (parsed.assignments ?? []).map(normalizeAssignment),
    vehicles,
  };
}

export function loadTransport(): TransportState {
  if (typeof window === "undefined") return emptyTransport();
  try {
    const raw2 = localStorage.getItem(STORAGE_KEY);
    if (raw2) {
      const parsed = JSON.parse(raw2) as Partial<TransportState>;
      return {
        version: 2,
        feePolicy: normalizeFeePolicy(parsed.feePolicy),
        routes: Array.isArray(parsed.routes)
          ? parsed.routes.map(normalizeRoute)
          : [],
        assignments: Array.isArray(parsed.assignments)
          ? parsed.assignments.map(normalizeAssignment)
          : [],
        vehicles: Array.isArray(parsed.vehicles)
          ? parsed.vehicles.map(normalizeVehicle)
          : [],
        dealers: Array.isArray(parsed.dealers) ? parsed.dealers : [],
        fuelStockLocations: Array.isArray(parsed.fuelStockLocations)
          ? parsed.fuelStockLocations
          : [],
        fuelPurchases: Array.isArray(parsed.fuelPurchases)
          ? parsed.fuelPurchases
          : [],
        fuelRefillLogs: Array.isArray(parsed.fuelRefillLogs)
          ? parsed.fuelRefillLogs
          : [],
        payables: Array.isArray(parsed.payables) ? parsed.payables : [],
        vehicleLoans: Array.isArray(parsed.vehicleLoans)
          ? parsed.vehicleLoans
          : [],
        emiSchedule: Array.isArray(parsed.emiSchedule)
          ? parsed.emiSchedule
          : [],
        insurancePolicies: Array.isArray(parsed.insurancePolicies)
          ? parsed.insurancePolicies
          : [],
        certificateRenewals: Array.isArray(parsed.certificateRenewals)
          ? parsed.certificateRenewals
          : [],
        serviceJobCards: Array.isArray(parsed.serviceJobCards)
          ? parsed.serviceJobCards
          : [],
        repairRequests: Array.isArray(parsed.repairRequests)
          ? parsed.repairRequests
          : [],
        boardingEvents: Array.isArray(parsed.boardingEvents)
          ? parsed.boardingEvents
          : [],
        gpsPings: Array.isArray(parsed.gpsPings) ? parsed.gpsPings : [],
      };
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = migrateFromV1(JSON.parse(legacy));
      saveTransport(migrated);
      return migrated;
    }
    return emptyTransport();
  } catch {
    return emptyTransport();
  }
}

export function saveTransport(state: TransportState) {
  if (!assertModulePermission("transport", "edit", "saveTransport")) return;

  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify({ ...state, version: 2 }));
  void import("@/lib/transportPersistence").then(({ scheduleTransportSync }) => {
    scheduleTransportSync(state);
  });

}

export function writeTransportLocalRaw(state: TransportState) {
  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify({ ...state, version: 2 }));
}

export function transportStateIsEmpty(state: TransportState): boolean {
  return (state.routes?.length ?? 0) === 0 && (state.vehicles?.length ?? 0) === 0;
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

export function getVehicle(
  vehicleId: string,
  state?: TransportState,
): FleetVehicle | undefined {
  const s = state ?? loadTransport();
  return s.vehicles.find((v) => v.id === vehicleId);
}

export function transportDueKey(
  studentId: string,
  assignmentId: string,
  periodKey: string,
): string {
  return `transport:${studentId}:${assignmentId}:${periodKey}`;
}

export function sessionPeriodKeys(ayCode: string): string[] {
  const start = sessionStartYear(ayCode);
  return SESSION_MONTHS.map((m) => {
    const year = m.month >= 4 ? start : start + 1;
    return `${year}-${String(m.month).padStart(2, "0")}`;
  });
}

function periodLabel(periodKey: string): string {
  const [, ms] = periodKey.split("-");
  const month = Number(ms);
  const year = Number(periodKey.slice(0, 4));
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
  const fromKey = asg.effectiveFrom.slice(0, 7);
  if (fromKey > periodKey) return false;
  if (asg.effectiveTo) {
    const toKey = asg.effectiveTo.slice(0, 7);
    if (toKey < periodKey) return false;
  }
  return true;
}

export function expectedMonthlyFeePaise(
  route: TransportRoute,
  stop: TransportStop | undefined,
  policy?: TransportFeePolicy,
): number {
  const p = policy ?? loadTransport().feePolicy;
  if (p.rateMode === "flat_route" || !stop) {
    return Math.max(0, route.monthlyFeePaise);
  }
  const km = stop.distanceKm || 0;
  let fee = 0;
  if (p.rateMode === "per_km") {
    fee = Math.round(km * p.ratePerKmPaise);
  } else {
    const slabs = [...p.slabs].sort((a, b) => a.upToKm - b.upToKm);
    const hit = slabs.find((s) => km <= s.upToKm) ?? slabs[slabs.length - 1];
    fee = hit?.monthlyFeePaise ?? route.monthlyFeePaise;
  }
  fee = Math.max(p.minFeePaise, fee);
  if (p.maxFeePaise != null) fee = Math.min(p.maxFeePaise, fee);
  return fee;
}

export function listAssignmentsForStudent(
  studentId: string,
  state?: TransportState,
): TransportAssignment[] {
  const s = state ?? loadTransport();
  return s.assignments.filter((a) => a.studentId === studentId);
}

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
  const asOf = options?.asOf ?? todayIso();
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
    const expected = expectedMonthlyFeePaise(route, stop, s.feePolicy);
    const fee =
      asg.monthlyFeePaise > 0 ? asg.monthlyFeePaise : expected;
    if (fee <= 0) continue;

    const veh = route.vehicleId
      ? s.vehicles.find((v) => v.id === route.vehicleId)
      : undefined;
    const busNo = route.busNo || veh?.name || "";
    const vehicleReg = route.vehicleReg || veh?.registrationNo || "";

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
        busNo,
        vehicleReg,
        vehicleId: veh?.id || route.vehicleId || "",
        vehiclePhotoUrl: veh?.photoUrl || "",
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

/* ─── Fee policy ───────────────────────────────────────────── */

export function saveFeePolicy(
  patch: Partial<TransportFeePolicy>,
): TransportFeePolicy {
  const state = loadTransport();
  const feePolicy = normalizeFeePolicy({ ...state.feePolicy, ...patch });
  saveTransport({ ...state, feePolicy });
  return feePolicy;
}

/* ─── Routes / stops ───────────────────────────────────────── */

export function upsertTransportRoute(
  patch: Partial<TransportRoute> & { code: string; name: string },
):
  | { ok: true; route: TransportRoute; state: TransportState }
  | { ok: false; error: string } {
  const code = patch.code.trim().toUpperCase();
  const name = patch.name.trim();
  if (!code || !name) return { ok: false, error: "Code and name required" };
  const state = loadTransport();
  const existing = patch.id
    ? state.routes.find((r) => r.id === patch.id)
    : state.routes.find((r) => r.code === code);
  if (
    !patch.id &&
    state.routes.some((r) => r.code === code && r.id !== existing?.id)
  ) {
    return { ok: false, error: `Route code ${code} already exists` };
  }
  const route = normalizeRoute({
    ...existing,
    ...patch,
    code,
    name,
    id: existing?.id ?? patch.id ?? id("tr"),
    stops: patch.stops ?? existing?.stops ?? [],
  });
  const routes = existing
    ? state.routes.map((r) => (r.id === route.id ? route : r))
    : [...state.routes, route];
  const next = { ...state, routes };
  saveTransport(next);
  return { ok: true, route, state: next };
}

export function deactivateTransportRoute(routeId: string): boolean {
  const state = loadTransport();
  if (!state.routes.some((r) => r.id === routeId)) return false;
  saveTransport({
    ...state,
    routes: state.routes.map((r) =>
      r.id === routeId ? { ...r, isActive: false } : r,
    ),
  });
  return true;
}

export function setRouteStops(
  routeId: string,
  stops: {
    name: string;
    distanceKm?: number;
    geoLat?: number;
    geoLng?: number;
    placeId?: string;
    geoAddress?: string;
    distanceSource?: StopDistanceSource;
  }[],
):
  | { ok: true; route: TransportRoute }
  | { ok: false; error: string } {
  const state = loadTransport();
  const route = state.routes.find((r) => r.id === routeId);
  if (!route) return { ok: false, error: "Route not found" };
  const nextStops = stops
    .map((s) => s.name.trim())
    .filter(Boolean)
    .map((name, i) =>
      normalizeStop(
        {
          name,
          sequence: i + 1,
          distanceKm: stops[i]?.distanceKm ?? 0,
          geoLat: stops[i]?.geoLat,
          geoLng: stops[i]?.geoLng,
          placeId: stops[i]?.placeId,
          geoAddress: stops[i]?.geoAddress,
          distanceSource: stops[i]?.distanceSource,
        },
        i,
      ),
    );
  const updated = { ...route, stops: nextStops };
  saveTransport({
    ...state,
    routes: state.routes.map((r) => (r.id === routeId ? updated : r)),
  });
  return { ok: true, route: updated };
}

/* ─── Assignments ──────────────────────────────────────────── */

export function assignStudentToRoute(input: {
  studentId: string;
  householdId: string;
  routeId: string;
  stopId: string;
  effectiveFrom: string;
  academicYearCode?: string;
  monthlyFeePaise?: number;
  feeOverrideReason?: string;
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
  const expected = expectedMonthlyFeePaise(route, stop, state.feePolicy);
  const override =
    input.monthlyFeePaise != null && input.monthlyFeePaise > 0
      ? input.monthlyFeePaise
      : 0;
  if (override > 0 && override !== expected && !input.feeOverrideReason?.trim()) {
    return {
      ok: false,
      error: "Fee override differs from expected — enter a reason",
    };
  }

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
    monthlyFeePaise: override,
    feeOverrideReason: input.feeOverrideReason ?? "",
    createdAt: new Date().toISOString(),
  });

  saveTransport({
    ...state,
    assignments: [assignment, ...nextAssignments],
  });
  saveTransport(alignVehiclesToRoutes(loadTransport()));
  return { ok: true, assignment };
}

/** Sync vehicle.primaryRouteId ↔ route.vehicleId from fleet records. */
export function alignVehiclesToRoutes(state: TransportState): TransportState {
  const vehicles = state.vehicles.map((v) => {
    const linked = state.routes.find(
      (r) => r.isActive !== false && r.vehicleId === v.id,
    );
    if (linked && v.primaryRouteId !== linked.id) {
      return { ...v, primaryRouteId: linked.id };
    }
    return v;
  });

  const routes = state.routes.map((r) => {
    if (!r.vehicleId && r.busNo) {
      const veh = vehicles.find(
        (v) =>
          v.isActive &&
          (v.registrationNo === r.vehicleReg ||
            v.name === r.busNo ||
            v.registrationNo === r.busNo),
      );
      if (veh) {
        return { ...r, vehicleId: veh.id, vehicleReg: veh.registrationNo };
      }
    }
    return r;
  });

  return { ...state, vehicles, routes };
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

export function setBoardingSuspended(
  assignmentId: string,
  suspended: boolean,
): boolean {
  const state = loadTransport();
  if (!state.assignments.some((a) => a.id === assignmentId)) return false;
  saveTransport({
    ...state,
    assignments: state.assignments.map((a) =>
      a.id === assignmentId ? { ...a, boardingSuspended: suspended } : a,
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

export function listActiveRiders(state?: TransportState) {
  return listAllAssignments(state).filter((a) => a.effectiveTo == null);
}

/* ─── Vehicles ─────────────────────────────────────────────── */

export function upsertFleetVehicle(
  patch: Partial<FleetVehicle> & { registrationNo: string },
):
  | { ok: true; vehicle: FleetVehicle }
  | { ok: false; error: string } {
  const reg = patch.registrationNo.trim().toUpperCase();
  if (!reg) return { ok: false, error: "Registration number required" };
  const state = loadTransport();
  const existing = patch.id
    ? state.vehicles.find((v) => v.id === patch.id)
    : state.vehicles.find((v) => v.registrationNo === reg);
  const vehicle = normalizeVehicle({
    ...existing,
    ...patch,
    registrationNo: reg,
    id: existing?.id ?? patch.id ?? id("veh"),
  });
  const vehicles = existing
    ? state.vehicles.map((v) => (v.id === vehicle.id ? vehicle : v))
    : [...state.vehicles, vehicle];
  saveTransport({ ...state, vehicles });
  return { ok: true, vehicle };
}

export function setVehicleStatus(
  vehicleId: string,
  status: VehicleStatus,
): boolean {
  const state = loadTransport();
  if (!state.vehicles.some((v) => v.id === vehicleId)) return false;
  saveTransport({
    ...state,
    vehicles: state.vehicles.map((v) =>
      v.id === vehicleId ? { ...v, status } : v,
    ),
  });
  return true;
}

/* ─── Dealers + payables ───────────────────────────────────── */

export function upsertDealer(
  patch: Partial<FleetDealer> & { name: string; type: DealerType },
):
  | { ok: true; dealer: FleetDealer }
  | { ok: false; error: string } {
  const name = patch.name.trim();
  if (!name) return { ok: false, error: "Dealer name required" };
  const state = loadTransport();
  const existing = patch.id
    ? state.dealers.find((d) => d.id === patch.id)
    : undefined;
  const dealer: FleetDealer = {
    id: existing?.id ?? patch.id ?? id("dlr"),
    name,
    type: patch.type,
    phone: patch.phone ?? existing?.phone ?? "",
    gstin: patch.gstin ?? existing?.gstin ?? "",
    paymentTermsDays:
      patch.paymentTermsDays ?? existing?.paymentTermsDays ?? 15,
    isActive: patch.isActive ?? existing?.isActive ?? true,
  };
  const dealers = existing
    ? state.dealers.map((d) => (d.id === dealer.id ? dealer : d))
    : [...state.dealers, dealer];
  saveTransport({ ...state, dealers });
  return { ok: true, dealer };
}

function addPayable(
  state: TransportState,
  input: Omit<FleetPayable, "id" | "createdAt" | "paidPaise" | "paidOn" | "status"> & {
    status?: FleetPayable["status"];
  },
): TransportState {
  if (input.amountPaise <= 0) return state;
  const row: FleetPayable = {
    id: id("pay"),
    dealerId: input.dealerId,
    vehicleId: input.vehicleId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    amountPaise: input.amountPaise,
    dueOn: input.dueOn,
    status: input.status ?? "open",
    paidPaise: 0,
    paidOn: "",
    note: input.note ?? "",
    createdAt: new Date().toISOString(),
  };
  return { ...state, payables: [row, ...state.payables] };
}

export function markPayablePaid(
  payableId: string,
  paidOn = todayIso(),
  amountPaise?: number,
): boolean {
  const state = loadTransport();
  const row = state.payables.find((p) => p.id === payableId);
  if (!row) return false;
  const paid = amountPaise ?? row.amountPaise;
  const paidPaise = Math.min(row.amountPaise, Math.max(0, paid));
  const status: FleetPayable["status"] =
    paidPaise >= row.amountPaise ? "paid" : paidPaise > 0 ? "partial" : "open";
  saveTransport({
    ...state,
    payables: state.payables.map((p) =>
      p.id === payableId
        ? { ...p, paidPaise, paidOn, status }
        : p,
    ),
  });
  return true;
}

export function listOpenPayables(state?: TransportState): FleetPayable[] {
  const s = state ?? loadTransport();
  return s.payables.filter((p) => p.status !== "paid");
}

/* ─── Fuel ─────────────────────────────────────────────────── */

export function upsertFuelStockLocation(
  patch: Partial<FuelStockLocation> & { name: string; fuelType: FuelType },
):
  | { ok: true; location: FuelStockLocation }
  | { ok: false; error: string } {
  const state = loadTransport();
  const existing = patch.id
    ? state.fuelStockLocations.find((l) => l.id === patch.id)
    : undefined;
  const location: FuelStockLocation = {
    id: existing?.id ?? patch.id ?? id("fsl"),
    name: patch.name.trim(),
    fuelType: patch.fuelType,
    qtyOnHand: patch.qtyOnHand ?? existing?.qtyOnHand ?? 0,
    minAlert: patch.minAlert ?? existing?.minAlert ?? 50,
    maxCapacity: patch.maxCapacity ?? existing?.maxCapacity ?? 500,
  };
  if (!location.name) return { ok: false, error: "Location name required" };
  const fuelStockLocations = existing
    ? state.fuelStockLocations.map((l) =>
        l.id === location.id ? location : l,
      )
    : [...state.fuelStockLocations, location];
  saveTransport({ ...state, fuelStockLocations });
  return { ok: true, location };
}

export function recordFuelPurchase(input: {
  locationId: string;
  dealerId: string;
  purchasedOn: string;
  qty: number;
  ratePaise: number;
  billNo?: string;
  paymentStatus?: "paid_cash" | "on_account";
}):
  | { ok: true; purchase: FuelPurchase }
  | { ok: false; error: string } {
  const state = loadTransport();
  const loc = state.fuelStockLocations.find((l) => l.id === input.locationId);
  if (!loc) return { ok: false, error: "Depot location not found" };
  const qty = Math.max(0, input.qty);
  if (qty <= 0) return { ok: false, error: "Quantity required" };
  const amountPaise = Math.round(qty * input.ratePaise);
  const purchase: FuelPurchase = {
    id: id("fpur"),
    locationId: input.locationId,
    dealerId: input.dealerId,
    purchasedOn: input.purchasedOn || todayIso(),
    qty,
    ratePaise: Math.max(0, input.ratePaise),
    amountPaise,
    billNo: input.billNo ?? "",
    paymentStatus: input.paymentStatus ?? "on_account",
    createdAt: new Date().toISOString(),
  };
  let next: TransportState = {
    ...state,
    fuelPurchases: [purchase, ...state.fuelPurchases],
    fuelStockLocations: state.fuelStockLocations.map((l) =>
      l.id === loc.id ? { ...l, qtyOnHand: l.qtyOnHand + qty } : l,
    ),
  };
  if (purchase.paymentStatus === "on_account") {
    next = addPayable(next, {
      dealerId: input.dealerId,
      vehicleId: "",
      sourceType: "fuel_purchase",
      sourceId: purchase.id,
      amountPaise,
      dueOn: purchase.purchasedOn,
      note: `Fuel purchase ${loc.name}`,
    });
  }
  saveTransport(next);
  return { ok: true, purchase };
}

export function recordFuelRefill(input: {
  vehicleId: string;
  filledAt: string;
  odometerKm: number;
  qty: number;
  ratePerUnitPaise?: number;
  amountPaise?: number;
  source: "depot_stock" | "dealer_pump";
  dealerId?: string;
  locationId?: string;
  billNo?: string;
  filledBy?: string;
  paymentStatus?: "paid_cash" | "on_account" | "adjusted_from_stock";
}):
  | { ok: true; log: FuelRefillLog }
  | { ok: false; error: string } {
  const state = loadTransport();
  const vehicle = state.vehicles.find((v) => v.id === input.vehicleId);
  if (!vehicle) return { ok: false, error: "Vehicle not found" };
  if (vehicle.status === "in_workshop") {
    return { ok: false, error: "Vehicle is in workshop — refill blocked" };
  }
  const odo = Math.max(0, Math.round(input.odometerKm));
  if (odo < vehicle.odometerKm) {
    return {
      ok: false,
      error: `Odometer ${odo} < last reading ${vehicle.odometerKm}`,
    };
  }
  const qty = Math.max(0, Number(input.qty) || 0);
  if (qty <= 0) return { ok: false, error: "Quantity required" };

  if (input.source === "depot_stock") {
    const loc = state.fuelStockLocations.find(
      (l) => l.id === input.locationId,
    );
    if (!loc) return { ok: false, error: "Select depot location" };
    if (loc.qtyOnHand < qty) {
      return { ok: false, error: `Insufficient stock (${loc.qtyOnHand})` };
    }
  }

  const priorLogs = state.fuelRefillLogs
    .filter((l) => l.vehicleId === vehicle.id)
    .sort((a, b) => b.filledAt.localeCompare(a.filledAt));
  const last = priorLogs[0];
  const kmSinceLast = last ? Math.max(0, odo - last.odometerKm) : 0;
  const mileage = qty > 0 && kmSinceLast > 0 ? kmSinceLast / qty : 0;
  const anomaly =
    vehicle.avgMileage > 0 &&
    mileage > 0 &&
    (mileage < vehicle.avgMileage * 0.8 || mileage > vehicle.avgMileage * 1.2);

  const rate = Math.max(0, input.ratePerUnitPaise ?? 0);
  const amount =
    input.amountPaise != null
      ? Math.max(0, input.amountPaise)
      : Math.round(qty * rate);

  const paymentStatus =
    input.paymentStatus ??
    (input.source === "depot_stock"
      ? "adjusted_from_stock"
      : "on_account");

  const log: FuelRefillLog = {
    id: id("fuel"),
    vehicleId: vehicle.id,
    filledAt: input.filledAt || new Date().toISOString(),
    odometerKm: odo,
    qty,
    ratePerUnitPaise: rate,
    amountPaise: amount,
    source: input.source,
    dealerId: input.dealerId ?? "",
    locationId: input.locationId ?? "",
    billNo: input.billNo ?? "",
    filledBy: input.filledBy ?? "",
    paymentStatus,
    kmSinceLast,
    mileage: Math.round(mileage * 100) / 100,
    anomaly,
    createdAt: new Date().toISOString(),
  };

  let nextAvg = vehicle.avgMileage;
  if (mileage > 0) {
    nextAvg =
      vehicle.avgMileage > 0
        ? Math.round(((vehicle.avgMileage + mileage) / 2) * 100) / 100
        : mileage;
  }

  let next: TransportState = {
    ...state,
    fuelRefillLogs: [log, ...state.fuelRefillLogs],
    vehicles: state.vehicles.map((v) =>
      v.id === vehicle.id
        ? { ...v, odometerKm: odo, avgMileage: nextAvg }
        : v,
    ),
  };

  if (input.source === "depot_stock" && input.locationId) {
    next = {
      ...next,
      fuelStockLocations: next.fuelStockLocations.map((l) =>
        l.id === input.locationId
          ? { ...l, qtyOnHand: Math.max(0, l.qtyOnHand - qty) }
          : l,
      ),
    };
  }

  if (paymentStatus === "on_account" && amount > 0) {
    next = addPayable(next, {
      dealerId: input.dealerId ?? "",
      vehicleId: vehicle.id,
      sourceType: "fuel_refill",
      sourceId: log.id,
      amountPaise: amount,
      dueOn: log.filledAt.slice(0, 10),
      note: `Fuel refill ${vehicle.registrationNo}`,
    });
  }

  saveTransport(next);
  return { ok: true, log };
}

/* ─── Finance: EMI / insurance / certs ─────────────────────── */

export function createVehicleLoan(input: {
  vehicleId: string;
  dealerId: string;
  accountNo: string;
  principalPaise: number;
  ratePct: number;
  tenureMonths: number;
  emiPaise: number;
  emiDueDay: number;
  startDate: string;
}):
  | { ok: true; loan: VehicleLoan }
  | { ok: false; error: string } {
  const state = loadTransport();
  if (!state.vehicles.some((v) => v.id === input.vehicleId)) {
    return { ok: false, error: "Vehicle not found" };
  }
  const tenure = Math.max(1, Math.floor(input.tenureMonths));
  const start = input.startDate || todayIso();
  const endDate = new Date(`${start}T12:00:00`);
  endDate.setMonth(endDate.getMonth() + tenure);
  const loan: VehicleLoan = {
    id: id("loan"),
    vehicleId: input.vehicleId,
    dealerId: input.dealerId,
    accountNo: input.accountNo.trim(),
    principalPaise: Math.max(0, input.principalPaise),
    ratePct: Math.max(0, input.ratePct),
    tenureMonths: tenure,
    emiPaise: Math.max(0, input.emiPaise),
    emiDueDay: Math.min(28, Math.max(1, input.emiDueDay || 5)),
    startDate: start,
    endDate: endDate.toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
  };
  const schedule: EmiScheduleRow[] = [];
  for (let i = 0; i < tenure; i++) {
    const d = new Date(`${start}T12:00:00`);
    d.setMonth(d.getMonth() + i);
    d.setDate(loan.emiDueDay);
    schedule.push({
      id: id("emi"),
      loanId: loan.id,
      installmentNo: i + 1,
      dueOn: d.toISOString().slice(0, 10),
      amountPaise: loan.emiPaise,
      status: "due",
      paidOn: "",
      paidAmountPaise: 0,
    });
  }
  saveTransport({
    ...state,
    vehicleLoans: [loan, ...state.vehicleLoans],
    emiSchedule: [...schedule, ...state.emiSchedule],
  });
  return { ok: true, loan };
}

export function recordEmiPayment(
  scheduleId: string,
  paidOn = todayIso(),
  amountPaise?: number,
):
  | { ok: true }
  | { ok: false; error: string } {
  const state = loadTransport();
  const row = state.emiSchedule.find((e) => e.id === scheduleId);
  if (!row) return { ok: false, error: "EMI row not found" };
  const loan = state.vehicleLoans.find((l) => l.id === row.loanId);
  const paid = amountPaise ?? row.amountPaise;
  let next = {
    ...state,
    emiSchedule: state.emiSchedule.map((e) =>
      e.id === scheduleId
        ? {
            ...e,
            status: "paid" as const,
            paidOn,
            paidAmountPaise: paid,
          }
        : e,
    ),
  };
  next = addPayable(next, {
    dealerId: loan?.dealerId ?? "",
    vehicleId: loan?.vehicleId ?? "",
    sourceType: "emi_installment",
    sourceId: row.id,
    amountPaise: paid,
    dueOn: row.dueOn,
    note: `EMI #${row.installmentNo}`,
    status: "paid",
  });
  // Mark the just-added payable as paid
  const last = next.payables[0];
  if (last?.sourceId === row.id) {
    next = {
      ...next,
      payables: next.payables.map((p, i) =>
        i === 0
          ? { ...p, status: "paid", paidPaise: paid, paidOn }
          : p,
      ),
    };
  }
  saveTransport(next);
  return { ok: true };
}

export function upsertInsurance(
  patch: Partial<VehicleInsurance> & {
    vehicleId: string;
    policyNo: string;
    periodStart: string;
    periodEnd: string;
    premiumPaise: number;
  },
):
  | { ok: true; policy: VehicleInsurance }
  | { ok: false; error: string } {
  const state = loadTransport();
  if (!state.vehicles.some((v) => v.id === patch.vehicleId)) {
    return { ok: false, error: "Vehicle not found" };
  }
  const existing = patch.id
    ? state.insurancePolicies.find((p) => p.id === patch.id)
    : undefined;
  const policy: VehicleInsurance = {
    id: existing?.id ?? patch.id ?? id("ins"),
    vehicleId: patch.vehicleId,
    dealerId: patch.dealerId ?? existing?.dealerId ?? "",
    policyNo: patch.policyNo.trim(),
    type: patch.type ?? existing?.type ?? "comprehensive",
    premiumPaise: Math.max(0, patch.premiumPaise),
    periodStart: patch.periodStart,
    periodEnd: patch.periodEnd,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  const insurancePolicies = existing
    ? state.insurancePolicies.map((p) => (p.id === policy.id ? policy : p))
    : [policy, ...state.insurancePolicies];

  // Sync insurance compliance doc
  const vehicles = state.vehicles.map((v) => {
    if (v.id !== policy.vehicleId) return v;
    const others = v.compliance.filter((c) => c.certType !== "insurance");
    return {
      ...v,
      compliance: [
        ...others,
        {
          id: id("cmp"),
          certType: "insurance" as const,
          expiryDate: policy.periodEnd,
          renewalCostPaise: policy.premiumPaise,
          vendorId: policy.dealerId,
          docNote: policy.policyNo,
        },
      ],
    };
  });

  saveTransport({ ...state, insurancePolicies, vehicles });
  return { ok: true, policy };
}

export function recordInsurancePayment(
  policyId: string,
  paidOn = todayIso(),
):
  | { ok: true }
  | { ok: false; error: string } {
  const state = loadTransport();
  const policy = state.insurancePolicies.find((p) => p.id === policyId);
  if (!policy) return { ok: false, error: "Policy not found" };
  let next = addPayable(state, {
    dealerId: policy.dealerId,
    vehicleId: policy.vehicleId,
    sourceType: "insurance_premium",
    sourceId: policy.id,
    amountPaise: policy.premiumPaise,
    dueOn: paidOn,
    note: `Insurance ${policy.policyNo}`,
    status: "paid",
  });
  if (next.payables[0]?.sourceId === policy.id) {
    next = {
      ...next,
      payables: next.payables.map((p, i) =>
        i === 0
          ? {
              ...p,
              status: "paid",
              paidPaise: policy.premiumPaise,
              paidOn,
            }
          : p,
      ),
    };
  }
  saveTransport(next);
  return { ok: true };
}

export function recordCertificateRenewal(input: {
  vehicleId: string;
  certType: CertType;
  dealerId?: string;
  issuedDate: string;
  expiryDate: string;
  feePaise: number;
  billNo?: string;
  markPaid?: boolean;
}):
  | { ok: true; renewal: CertificateRenewal }
  | { ok: false; error: string } {
  const state = loadTransport();
  if (!state.vehicles.some((v) => v.id === input.vehicleId)) {
    return { ok: false, error: "Vehicle not found" };
  }
  const renewal: CertificateRenewal = {
    id: id("crt"),
    vehicleId: input.vehicleId,
    certType: input.certType,
    dealerId: input.dealerId ?? "",
    issuedDate: input.issuedDate || todayIso(),
    expiryDate: input.expiryDate,
    feePaise: Math.max(0, input.feePaise),
    billNo: input.billNo ?? "",
    paymentStatus: input.markPaid ? "paid" : "open",
    paidOn: input.markPaid ? todayIso() : "",
    createdAt: new Date().toISOString(),
  };
  let next: TransportState = {
    ...state,
    certificateRenewals: [renewal, ...state.certificateRenewals],
    vehicles: state.vehicles.map((v) => {
      if (v.id !== input.vehicleId) return v;
      const others = v.compliance.filter((c) => c.certType !== input.certType);
      return {
        ...v,
        compliance: [
          ...others,
          {
            id: id("cmp"),
            certType: input.certType,
            expiryDate: input.expiryDate,
            renewalCostPaise: renewal.feePaise,
            vendorId: renewal.dealerId,
            docNote: renewal.billNo,
          },
        ],
      };
    }),
  };
  if (renewal.feePaise > 0) {
    next = addPayable(next, {
      dealerId: renewal.dealerId,
      vehicleId: renewal.vehicleId,
      sourceType: "certificate_renewal",
      sourceId: renewal.id,
      amountPaise: renewal.feePaise,
      dueOn: renewal.issuedDate,
      note: `${renewal.certType} renewal`,
      status: renewal.paymentStatus === "paid" ? "paid" : "open",
    });
    if (renewal.paymentStatus === "paid" && next.payables[0]) {
      next = {
        ...next,
        payables: next.payables.map((p, i) =>
          i === 0
            ? {
                ...p,
                status: "paid",
                paidPaise: renewal.feePaise,
                paidOn: renewal.paidOn,
              }
            : p,
        ),
      };
    }
  }
  saveTransport(next);
  return { ok: true, renewal };
}

/* ─── Service / repairs ────────────────────────────────────── */

export function upsertServiceScheduleItem(
  vehicleId: string,
  item: Partial<ServiceScheduleItem> & { task: string },
):
  | { ok: true }
  | { ok: false; error: string } {
  const state = loadTransport();
  const vehicle = state.vehicles.find((v) => v.id === vehicleId);
  if (!vehicle) return { ok: false, error: "Vehicle not found" };
  const existing = item.id
    ? vehicle.serviceSchedule.find((s) => s.id === item.id)
    : undefined;
  const row: ServiceScheduleItem = {
    id: existing?.id ?? item.id ?? id("ssc"),
    task: item.task.trim(),
    intervalKm: item.intervalKm ?? existing?.intervalKm ?? null,
    intervalDays: item.intervalDays ?? existing?.intervalDays ?? null,
    lastDoneOn: item.lastDoneOn ?? existing?.lastDoneOn ?? "",
    lastDoneOdo: item.lastDoneOdo ?? existing?.lastDoneOdo ?? 0,
    nextDueOn: item.nextDueOn ?? existing?.nextDueOn ?? "",
    nextDueOdo: item.nextDueOdo ?? existing?.nextDueOdo ?? 0,
  };
  if (!row.task) return { ok: false, error: "Task name required" };
  const serviceSchedule = existing
    ? vehicle.serviceSchedule.map((s) => (s.id === row.id ? row : s))
    : [...vehicle.serviceSchedule, row];
  saveTransport({
    ...state,
    vehicles: state.vehicles.map((v) =>
      v.id === vehicleId ? { ...v, serviceSchedule } : v,
    ),
  });
  return { ok: true };
}

export function openServiceJob(input: {
  vehicleId: string;
  dealerId?: string;
  kind: "service" | "repair";
  repairType?: ServiceJobCard["repairType"];
  title: string;
  odometerKm?: number;
  laborPaise?: number;
  partsPaise?: number;
  note?: string;
  setWorkshop?: boolean;
}):
  | { ok: true; job: ServiceJobCard }
  | { ok: false; error: string } {
  const state = loadTransport();
  const vehicle = state.vehicles.find((v) => v.id === input.vehicleId);
  if (!vehicle) return { ok: false, error: "Vehicle not found" };
  const job: ServiceJobCard = {
    id: id("job"),
    vehicleId: input.vehicleId,
    dealerId: input.dealerId ?? "",
    kind: input.kind,
    repairType: input.repairType ?? "",
    title: input.title.trim() || "Job",
    odometerKm: input.odometerKm ?? vehicle.odometerKm,
    laborPaise: Math.max(0, input.laborPaise ?? 0),
    partsPaise: Math.max(0, input.partsPaise ?? 0),
    status: "in_progress",
    openedOn: todayIso(),
    completedOn: "",
    note: input.note ?? "",
  };
  let next: TransportState = {
    ...state,
    serviceJobCards: [job, ...state.serviceJobCards],
  };
  if (input.setWorkshop !== false) {
    next = {
      ...next,
      vehicles: next.vehicles.map((v) =>
        v.id === vehicle.id ? { ...v, status: "in_workshop" } : v,
      ),
    };
  }
  saveTransport(next);
  return { ok: true, job };
}

export function completeServiceJob(
  jobId: string,
  input?: { laborPaise?: number; partsPaise?: number; onAccount?: boolean },
):
  | { ok: true }
  | { ok: false; error: string } {
  const state = loadTransport();
  const job = state.serviceJobCards.find((j) => j.id === jobId);
  if (!job) return { ok: false, error: "Job not found" };
  const labor = input?.laborPaise ?? job.laborPaise;
  const parts = input?.partsPaise ?? job.partsPaise;
  const total = labor + parts;
  let next: TransportState = {
    ...state,
    serviceJobCards: state.serviceJobCards.map((j) =>
      j.id === jobId
        ? {
            ...j,
            laborPaise: labor,
            partsPaise: parts,
            status: "completed",
            completedOn: todayIso(),
          }
        : j,
    ),
    vehicles: state.vehicles.map((v) =>
      v.id === job.vehicleId && v.status === "in_workshop"
        ? { ...v, status: "active" }
        : v,
    ),
  };
  if (input?.onAccount !== false && total > 0) {
    next = addPayable(next, {
      dealerId: job.dealerId,
      vehicleId: job.vehicleId,
      sourceType: "repair_job",
      sourceId: job.id,
      amountPaise: total,
      dueOn: todayIso(),
      note: job.title,
    });
  }
  saveTransport(next);
  return { ok: true };
}

export function createRepairRequest(input: {
  vehicleId: string;
  reportedBy: string;
  symptom: string;
  location?: string;
  estimatePaise?: number;
}):
  | { ok: true; request: RepairRequest; needsApproval: boolean }
  | { ok: false; error: string } {
  const state = loadTransport();
  if (!state.vehicles.some((v) => v.id === input.vehicleId)) {
    return { ok: false, error: "Vehicle not found" };
  }
  const estimate = Math.max(0, input.estimatePaise ?? 0);
  const needsApproval = estimate > state.feePolicy.repairApprovalPaise;
  const request: RepairRequest = {
    id: id("rr"),
    vehicleId: input.vehicleId,
    reportedBy: input.reportedBy,
    reportedOn: todayIso(),
    symptom: input.symptom.trim(),
    location: input.location ?? "",
    estimatePaise: estimate,
    status: needsApproval ? "open" : "approved",
    jobCardId: "",
  };
  if (!request.symptom) return { ok: false, error: "Describe the fault" };
  saveTransport({
    ...state,
    repairRequests: [request, ...state.repairRequests],
  });
  return { ok: true, request, needsApproval };
}

export function approveRepairRequest(requestId: string): boolean {
  const state = loadTransport();
  if (!state.repairRequests.some((r) => r.id === requestId)) return false;
  saveTransport({
    ...state,
    repairRequests: state.repairRequests.map((r) =>
      r.id === requestId ? { ...r, status: "approved" } : r,
    ),
  });
  return true;
}

export function convertRepairToJob(requestId: string):
  | { ok: true; job: ServiceJobCard }
  | { ok: false; error: string } {
  const state = loadTransport();
  const req = state.repairRequests.find((r) => r.id === requestId);
  if (!req) return { ok: false, error: "Request not found" };
  if (req.status !== "approved" && req.status !== "open") {
    return { ok: false, error: "Request not convertible" };
  }
  const opened = openServiceJob({
    vehicleId: req.vehicleId,
    kind: "repair",
    repairType: "breakdown",
    title: req.symptom.slice(0, 80),
    laborPaise: req.estimatePaise,
    note: req.location,
  });
  if (!opened.ok) return opened;
  const s2 = loadTransport();
  saveTransport({
    ...s2,
    repairRequests: s2.repairRequests.map((r) =>
      r.id === requestId
        ? { ...r, status: "converted", jobCardId: opened.job.id }
        : r,
    ),
  });
  return opened;
}

/* ─── Boarding ─────────────────────────────────────────────── */

export function upsertBoardingEvent(input: {
  date: string;
  routeId: string;
  trip: BoardingTrip;
  studentId: string;
  status: BoardingStatus;
  note?: string;
}):
  | { ok: true; event: BoardingEvent }
  | { ok: false; error: string } {
  const state = loadTransport();
  if (!input.studentId) return { ok: false, error: "Student required" };
  if (!input.routeId) return { ok: false, error: "Route required" };
  const existing = state.boardingEvents.find(
    (e) =>
      e.date === input.date &&
      e.routeId === input.routeId &&
      e.trip === input.trip &&
      e.studentId === input.studentId,
  );
  const event: BoardingEvent = {
    id: existing?.id ?? id("brd"),
    date: input.date,
    routeId: input.routeId,
    trip: input.trip,
    studentId: input.studentId,
    status: input.status,
    note: input.note ?? "",
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    boardedLocation: existing?.boardedLocation ?? null,
    offboardedLocation: existing?.offboardedLocation ?? null,
  };
  const boardingEvents = existing
    ? state.boardingEvents.map((e) => (e.id === event.id ? event : e))
    : [event, ...state.boardingEvents];
  saveTransport({ ...state, boardingEvents });
  return { ok: true, event };
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type BoardingDistanceFlag = {
  registeredKm: number;
  actualKm: number;
  deltaKm: number;
};

/** Delta above which a boarding location is flagged as differing from the
 * student's registered stop. 1.5 km is a judgment call, not a confirmed
 * school policy — loose enough to absorb ordinary GPS drift (the school
 * itself already shows ~20-30m of scatter across vehicles at rest), tight
 * enough to catch "boarded from a different stop entirely". Tune once real
 * capture data shows what normal variance actually looks like. */
const BOARDING_DISTANCE_FLAG_THRESHOLD_KM = 1.5;

function boardingDistanceFlag(
  state: TransportState,
  studentId: string,
  routeId: string,
  actualKm: number,
): BoardingDistanceFlag | null {
  const assignment = state.assignments.find(
    (a) => a.studentId === studentId && a.routeId === routeId && a.effectiveTo == null,
  );
  const route = state.routes.find((r) => r.id === routeId);
  const stop = route?.stops.find((s) => s.id === assignment?.stopId);
  if (!stop) return null;
  const deltaKm = Math.abs(actualKm - stop.distanceKm);
  if (deltaKm < BOARDING_DISTANCE_FLAG_THRESHOLD_KM) return null;
  return { registeredKm: stop.distanceKm, actualKm, deltaKm };
}

/**
 * Records where a student actually boarded/offboarded, from the marking
 * staff member's own phone GPS — not Fleet Edge vehicle telemetry (see
 * BoardingGeoCapture's doc comment for why). Boarding sets status
 * "boarded" as a side effect; offboarding requires the student to already
 * be marked boarded for this trip (you can't get off a bus you never got
 * on) and does not change status.
 */
export function recordBoardingGeoEvent(input: {
  date: string;
  routeId: string;
  trip: BoardingTrip;
  studentId: string;
  kind: "boarded" | "offboarded";
  lat: number;
  lng: number;
  accuracyM?: number;
}):
  | { ok: true; event: BoardingEvent; flag: BoardingDistanceFlag | null }
  | { ok: false; error: string } {
  if (!input.studentId) return { ok: false, error: "Student required" };
  if (!input.routeId) return { ok: false, error: "Route required" };
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
    return { ok: false, error: "Invalid GPS coordinates" };
  }
  const state = loadTransport();
  const existing = state.boardingEvents.find(
    (e) =>
      e.date === input.date &&
      e.routeId === input.routeId &&
      e.trip === input.trip &&
      e.studentId === input.studentId,
  );
  if (input.kind === "offboarded" && existing?.status !== "boarded") {
    return { ok: false, error: "Mark boarded before recording where they got off" };
  }

  const distanceFromSchoolKm = haversineKm(input.lat, input.lng, TENANT.schoolLat, TENANT.schoolLng);
  const capture: BoardingGeoCapture = {
    lat: input.lat,
    lng: input.lng,
    accuracyM: typeof input.accuracyM === "number" ? input.accuracyM : null,
    at: new Date().toISOString(),
    distanceFromSchoolKm,
  };

  const event: BoardingEvent = {
    id: existing?.id ?? id("brd"),
    date: input.date,
    routeId: input.routeId,
    trip: input.trip,
    studentId: input.studentId,
    status: input.kind === "boarded" ? "boarded" : (existing?.status ?? "boarded"),
    note: existing?.note ?? "",
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    boardedLocation: input.kind === "boarded" ? capture : (existing?.boardedLocation ?? null),
    offboardedLocation: input.kind === "offboarded" ? capture : (existing?.offboardedLocation ?? null),
  };
  const boardingEvents = existing
    ? state.boardingEvents.map((e) => (e.id === event.id ? event : e))
    : [event, ...state.boardingEvents];
  saveTransport({ ...state, boardingEvents });

  const flag = boardingDistanceFlag(state, input.studentId, input.routeId, distanceFromSchoolKm);
  return { ok: true, event, flag };
}

export function listBoardingForTrip(
  date: string,
  routeId: string,
  trip: BoardingTrip,
  state?: TransportState,
): BoardingEvent[] {
  const s = state ?? loadTransport();
  return s.boardingEvents.filter(
    (e) => e.date === date && e.routeId === routeId && e.trip === trip,
  );
}

/* ─── GPS ──────────────────────────────────────────────────── */

export function recordGpsPing(input: {
  vehicleId: string;
  lat: number;
  lng: number;
  source?: GpsPing["source"];
  note?: string;
  recordedAt?: string;
}):
  | { ok: true; ping: GpsPing }
  | { ok: false; error: string } {
  const state = loadTransport();
  if (!state.vehicles.some((v) => v.id === input.vehicleId)) {
    return { ok: false, error: "Vehicle not found" };
  }
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
    return { ok: false, error: "Invalid coordinates" };
  }
  const ping: GpsPing = {
    id: id("gps"),
    vehicleId: input.vehicleId,
    lat: input.lat,
    lng: input.lng,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    source: input.source ?? "manual",
    note: input.note ?? "",
  };
  saveTransport({
    ...state,
    gpsPings: [ping, ...state.gpsPings].slice(0, 500),
  });
  return { ok: true, ping };
}

export function lastGpsPingByVehicle(state?: TransportState) {
  const s = state ?? loadTransport();
  const map = new Map<string, GpsPing>();
  for (const p of s.gpsPings) {
    if (!map.has(p.vehicleId)) map.set(p.vehicleId, p);
  }
  return map;
}

/* ─── TCO + compliance alerts ──────────────────────────────── */

export function vehicleTcoPaise(
  vehicleId: string,
  state?: TransportState,
): {
  fuel: number;
  emi: number;
  insurance: number;
  certs: number;
  jobs: number;
  total: number;
} {
  const s = state ?? loadTransport();
  const fuel = s.fuelRefillLogs
    .filter((l) => l.vehicleId === vehicleId)
    .reduce((n, l) => n + l.amountPaise, 0);
  const loanIds = new Set(
    s.vehicleLoans.filter((l) => l.vehicleId === vehicleId).map((l) => l.id),
  );
  const emi = s.emiSchedule
    .filter((e) => loanIds.has(e.loanId) && e.status === "paid")
    .reduce((n, e) => n + e.paidAmountPaise, 0);
  const insurance = s.insurancePolicies
    .filter((p) => p.vehicleId === vehicleId)
    .reduce((n, p) => n + p.premiumPaise, 0);
  const certs = s.certificateRenewals
    .filter((c) => c.vehicleId === vehicleId && c.paymentStatus === "paid")
    .reduce((n, c) => n + c.feePaise, 0);
  const jobs = s.serviceJobCards
    .filter((j) => j.vehicleId === vehicleId && j.status === "completed")
    .reduce((n, j) => n + j.laborPaise + j.partsPaise, 0);
  const total = fuel + emi + insurance + certs + jobs;
  return { fuel, emi, insurance, certs, jobs, total };
}

export function computeTransportComplianceAlerts(options?: {
  state?: TransportState;
  paidByDueKey?: Map<string, number>;
  asOf?: string;
  periodKey?: string;
}): TransportComplianceAlert[] {
  const s = options?.state ?? loadTransport();
  const asOf = options?.asOf ?? todayIso();
  const periodKey = options?.periodKey ?? asOf.slice(0, 7);
  const paidMap = options?.paidByDueKey ?? new Map<string, number>();
  const alerts: TransportComplianceAlert[] = [];

  // Unauthorized boarding today
  for (const e of s.boardingEvents.filter(
    (b) => b.date === asOf && b.status === "unauthorized",
  )) {
    alerts.push({
      code: "TR_UNAUTHORIZED",
      severity: "critical",
      studentId: e.studentId,
      routeId: e.routeId,
      assignmentId: "",
      message: "Boarded without active route assignment",
      amountPaise: 0,
      date: e.date,
    });
  }

  const active = listActiveRiders(s);
  for (const asg of active) {
    const dues = computeTransportPeriodDues(asg.studentId, {
      academicYearCode: asg.academicYearCode,
      asOf,
      includeFuture: false,
      state: s,
    }).filter((d) => d.assignmentId === asg.id && d.periodKey === periodKey);

    if (dues.length === 0) {
      alerts.push({
        code: "TR_NO_DUE",
        severity: "critical",
        studentId: asg.studentId,
        routeId: asg.routeId,
        assignmentId: asg.id,
        message: `No transport due line for ${periodKey}`,
        amountPaise: 0,
        date: asOf,
      });
      continue;
    }

    for (const d of dues) {
      const paid = paidMap.get(d.dueKey) ?? 0;
      const bal = Math.max(0, d.amountPaise - paid);
      if (bal > 0 && d.dueOn < asOf) {
        alerts.push({
          code: "TR_UNPAID",
          severity: "high",
          studentId: asg.studentId,
          routeId: asg.routeId,
          assignmentId: asg.id,
          message: `Unpaid transport ${d.periodLabel}`,
          amountPaise: bal,
          date: d.dueOn,
        });
      }

      const route = s.routes.find((r) => r.id === asg.routeId);
      const stop = route?.stops.find((st) => st.id === asg.stopId);
      if (route) {
        const expected = expectedMonthlyFeePaise(route, stop, s.feePolicy);
        const charged =
          asg.monthlyFeePaise > 0 ? asg.monthlyFeePaise : expected;
        if (charged < expected && !asg.feeOverrideReason) {
          alerts.push({
            code: "TR_UNDERCHARGE",
            severity: "high",
            studentId: asg.studentId,
            routeId: asg.routeId,
            assignmentId: asg.id,
            message: `Charged below expected (expected higher)`,
            amountPaise: expected - charged,
            date: asOf,
          });
        }
      }
    }

    // Boarded while suspended
    const boarded = s.boardingEvents.some(
      (b) =>
        b.date === asOf &&
        b.studentId === asg.studentId &&
        b.status === "boarded" &&
        (asg.boardingSuspended || asg.effectiveTo != null),
    );
    if (boarded && asg.boardingSuspended) {
      alerts.push({
        code: "TR_RIDING_INACTIVE_FEE",
        severity: "critical",
        studentId: asg.studentId,
        routeId: asg.routeId,
        assignmentId: asg.id,
        message: "Boarding while transport boarding suspended",
        amountPaise: 0,
        date: asOf,
      });
    }
  }

  return alerts;
}

/* ─── CSV ──────────────────────────────────────────────────── */

export function importTransportRoutesCsv(text: string): {
  added: number;
  state: TransportState;
  error?: string;
} {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { added: 0, state: loadTransport(), error: "Empty file" };
  }
  let start = 0;
  if (/code|name|fee|route/i.test(lines[0]!)) start = 1;
  const state = loadTransport();
  const byCode = new Map(state.routes.map((r) => [r.code.toUpperCase(), r]));
  let added = 0;
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i]!.split(",").map((p) => p.trim().replace(/^"|"$/g, ""));
    const code = (parts[0] ?? "").toUpperCase();
    const name = parts[1] ?? "";
    if (!code || !name) continue;
    const busNo = parts[2] ?? "";
    const vehicleReg = parts[3] ?? "";
    const monthlyFeePaise = Math.round(Number(parts[4] ?? "0") * 100);
    const stopNames = (parts[5] ?? "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    const stops: TransportStop[] = stopNames.map((n, idx) => {
      const [nm, km] = n.split(":").map((x) => x.trim());
      const importedKm = Number(km) || 0;
      return {
        id: id("st"),
        name: nm || n,
        sequence: idx + 1,
        distanceKm: importedKm,
        // A km in the CSV is someone's typed figure, not a measured road
        // distance — record it as manual so it is never mistaken for Google.
        distanceSource: importedKm > 0 ? ("manual" as const) : ("" as const),
      };
    });
    const existing = byCode.get(code);
    if (existing) {
      existing.name = name;
      existing.busNo = busNo;
      existing.vehicleReg = vehicleReg;
      existing.monthlyFeePaise = Math.max(0, monthlyFeePaise);
      if (stops.length) existing.stops = stops;
      existing.isActive = true;
    } else {
      const route = normalizeRoute({
        id: id("tr"),
        code,
        name,
        busNo,
        vehicleReg,
        monthlyFeePaise: Math.max(0, monthlyFeePaise),
        isActive: true,
        stops,
      });
      state.routes.push(route);
      byCode.set(code, route);
      added += 1;
    }
  }
  saveTransport(state);
  return { added, state };
}

export function downloadTransportRoutesTemplate(): void {
  const body =
    "Code,Name,Bus,VehicleReg,MonthlyFee,Stops\r\nR-12,Lanka – Cantonment,Bus 3,UP32 BT 4512,1200,Lanka Gate:2|BHU Gate:4|Sigra:6|Cantonment:8\r\n";
  const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "transport_routes_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function exportTransportRoutesCsv(state?: TransportState): void {
  const s = state ?? loadTransport();
  const rows = [
    "Code,Name,Bus,VehicleReg,MonthlyFee,Stops,VehicleId",
    ...s.routes.map((r) => {
      const stops = r.stops
        .map((st) =>
          st.distanceKm > 0 ? `${st.name}:${st.distanceKm}` : st.name,
        )
        .join("|");
      return [
        r.code,
        `"${r.name.replace(/"/g, '""')}"`,
        r.busNo,
        r.vehicleReg,
        (r.monthlyFeePaise / 100).toFixed(0),
        `"${stops}"`,
        r.vehicleId,
      ].join(",");
    }),
  ];
  const blob = new Blob(["\uFEFF" + rows.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "transport_routes.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/** The school's real fleet, per Tata Fleet Edge's official Subscribed
 * Vehicles Report (2026-08-15) — VIN and registration number (where
 * allotted) are the only confirmed facts. Everything else about these
 * vehicles (fuel type, tank capacity, odometer, mileage, routes, driver)
 * is NOT known here and is deliberately left for staff to fill in via the
 * Fleet tab, rather than invented. */
const REAL_FLEET: readonly { registrationNo: string; vin: string }[] = [
  { registrationNo: "UP65QT4657", vin: "MAT805022SFB02913" },
  { registrationNo: "UP65MT0849", vin: "MAT557029PUA00368" },
  { registrationNo: "UP65PT3540", vin: "MAT558017RVE22810" },
  { registrationNo: "", vin: "MAT558053TVE29204" },
  { registrationNo: "", vin: "MAT558053TVG40149" },
];

function buildRealFleetVehicles(): FleetVehicle[] {
  return REAL_FLEET.map((v) =>
    normalizeVehicle({
      registrationNo: v.registrationNo || v.vin,
      name: v.registrationNo || `Bus — registration pending (VIN ${v.vin})`,
    }),
  );
}

/** Seed the real fleet when the registry is genuinely empty — no
 * fictional route, dealer, or fuel stock; none of that is known either. */
export function seedTransportIfEmpty(): TransportState {
  const state = loadTransport();
  if (state.routes.length > 0 || state.vehicles.length > 0) return state;
  const next: TransportState = { ...state, vehicles: buildRealFleetVehicles() };
  saveTransport(next);
  return next;
}

/** One-time cleanup for browsers that already seeded the OLD placeholder
 * demo bus (UP32 BT 4512 / "Lanka – Cantonment") before the real fleet
 * was known. Narrow, exact-match check — only touches state that still
 * looks untouched, so it never overwrites anything staff has since
 * entered themselves. */
export function migrateDemoFleetToReal(): TransportState {
  const state = loadTransport();
  const onlyDemoVehicle =
    state.vehicles.length === 1 && state.vehicles[0].registrationNo === "UP32 BT 4512";
  if (!onlyDemoVehicle) return state;
  const demoVehicleId = state.vehicles[0].id;
  const next: TransportState = {
    ...state,
    vehicles: buildRealFleetVehicles(),
    routes: state.routes.filter((r) => r.vehicleId !== demoVehicleId),
    dealers: state.dealers.filter((d) => d.name !== "IOCL Sigra Pump"),
    fuelStockLocations: state.fuelStockLocations.filter((f) => f.name !== "Campus diesel depot"),
  };
  saveTransport(next);
  return next;
}

export function certTypeLabel(t: CertType): string {
  const map: Record<CertType, string> = {
    insurance: "Insurance",
    puc: "PUC",
    fitness: "Fitness",
    permit: "Permit",
    road_tax: "Road tax",
    cng_hydro: "CNG hydro",
    ais140: "AIS-140",
    fire_extinguisher: "Fire extinguisher",
  };
  return map[t] ?? t;
}

export function dealerTypeLabel(t: DealerType): string {
  return t.replace(/_/g, " ");
}

export function vehicleStatusLabel(s: VehicleStatus): string {
  return s.replace(/_/g, " ");
}
