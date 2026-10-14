/**
 * Transport reports — riders, fleet, finance exports.
 */

import {
  describeFilters,
  exportFilterReport,
} from "@/lib/reportExport";
import { paidByDueKey, loadFees, type FeesState } from "@/lib/fees";
import { formatInr, loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import { TENANT } from "@/lib/types";
import {
  completedJobsPaise,
  computeTransportComplianceAlerts,
  computeTransportPeriodDues,
  getRoute,
  getVehicle,
  lastGpsPingByVehicle,
  listActiveRiders,
  listActiveRoutes,
  listOpenPayables,
  loadTransport,
  vehicleStatusLabel,
  dealerTypeLabel,
  type TransportState,
} from "@/lib/transport";

import {
  STATUS_LABEL,
  type RegisterDayMark,
  type RegisterTrip,
} from "@/lib/transportBoardingLog";
import { refuseReportBeforeLoad } from "@/lib/reportDataGuard";
import { currentDocsFor, VEHICLE_DOC_LABELS } from "@/lib/transportFinance";
import {
  complianceCalendarRows,
  emiRegisterRows,
  fuelByVehicle,
  tcoPartText,
  tcoTotalText,
  vehicleTco,
  type FuelVehicleRow,
  type TcoPart,
  type VehicleCosts,
} from "@/lib/transportVehicleCosts";
import { reportDesksFor } from "@/lib/reportDesks";

export type TransportReportFormat = "excel" | "pdf";

export type TransportReportId =
  | "rider_roster"
  | "route_occupancy"
  | "unpaid_riders"
  | "unauthorized_boarding"
  | "fuel_by_vehicle"
  | "cost_per_km"
  | "dealer_aging"
  | "service_due"
  | "compliance_calendar"
  | "emi_register"
  | "insurance_cert_schedule"
  | "tco_by_vehicle"
  | "boarding_day_sheet";

export type TransportReportCategory = "ops" | "fleet" | "finance";

export type TransportReportDef = {
  id: TransportReportId;
  category: TransportReportCategory;
  label: string;
  hint?: string;
};

export const TRANSPORT_REPORT_CATEGORIES: {
  id: TransportReportCategory;
  title: string;
  headerClass: string;
}[] = [
  { id: "ops", title: "Riders & boarding", headerClass: "bg-[#1565c0]" },
  { id: "fleet", title: "Fleet & compliance", headerClass: "bg-[#ef6c00]" },
  { id: "finance", title: "Finance & TCO", headerClass: "bg-[var(--tone-teal-solid)]" },
];

export const TRANSPORT_REPORTS: TransportReportDef[] = [
  {
    id: "rider_roster",
    category: "ops",
    label: "Rider roster",
    hint: "Active route assignments",
  },
  {
    id: "route_occupancy",
    category: "ops",
    label: "Route occupancy",
    hint: "Riders per route · optional GPS ping",
  },
  {
    id: "boarding_day_sheet",
    category: "ops",
    label: "Boarding day sheet",
    hint: "AM/PM bus register for report date",
  },
  {
    id: "unauthorized_boarding",
    category: "ops",
    label: "Unauthorized boarding",
    hint: "Uses report date filter",
  },
  {
    id: "unpaid_riders",
    category: "ops",
    label: "Unpaid transport dues",
    hint: "Fee Take balance by rider",
  },
  {
    id: "fuel_by_vehicle",
    category: "fleet",
    label: "Fuel by vehicle",
  },
  {
    id: "cost_per_km",
    category: "fleet",
    label: "Cost per km",
  },
  {
    id: "service_due",
    category: "fleet",
    label: "Service due register",
  },
  {
    id: "compliance_calendar",
    category: "fleet",
    label: "Compliance calendar",
  },
  {
    id: "insurance_cert_schedule",
    category: "fleet",
    label: "Insurance & cert schedule",
  },
  {
    id: "dealer_aging",
    category: "finance",
    label: "Dealer payable aging",
  },
  {
    id: "emi_register",
    category: "finance",
    label: "EMI register",
  },
  {
    id: "tco_by_vehicle",
    category: "finance",
    label: "TCO by vehicle",
  },
];

export type TransportReportFilters = {
  date?: string;
  routeId?: string;
  vehicleId?: string;
  format: TransportReportFormat;
  transport?: TransportState;
  masters?: MastersState;
  sis?: SisState;
  fees?: FeesState;
  /**
   * The day's bus register v2 marks (GET /api/v1/transport/register/runs
   * ?date=&marks=1). The boarding day sheet refuses without them rather than
   * printing a sheet of blanks that reads as "nobody was marked".
   */
  registerMarks?: RegisterDayMark[] | null;
  /**
   * Fuel register, vehicle papers and ledger loans (GET
   * /api/transport/vehicle-costs). The reports in
   * TRANSPORT_REPORTS_NEEDING_COSTS refuse without it.
   */
  costs?: VehicleCosts | null;
};

/** Reports read from the fuel register / vehicle papers / ledger loans, not the desk. */
export const TRANSPORT_REPORTS_NEEDING_COSTS: ReadonlySet<TransportReportId> = new Set<TransportReportId>([
  "fuel_by_vehicle",
  "cost_per_km",
  "compliance_calendar",
  "emi_register",
  "insurance_cert_schedule",
  "tco_by_vehicle",
]);

/** Today in IST (toISOString() is UTC: before 05:30 it named yesterday). */
function todayYmd() {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = new Date(from.slice(0, 10));
  const b = new Date(to.slice(0, 10));
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Days left for a cell: "—" when a date is missing (it printed NaN). */
function daysLeftCell(from: string, to: string): number | string {
  const d = daysBetween(from, to || "");
  return Number.isFinite(d) ? d : "—";
}

function agingBucket(daysOverdue: number): string {
  if (daysOverdue <= 0) return "Current";
  if (daysOverdue <= 30) return "1–30 days";
  if (daysOverdue <= 60) return "31–60 days";
  if (daysOverdue <= 90) return "61–90 days";
  return "90+ days";
}

function expiryStatus(expiryDate: string, asOf: string): string {
  // No expiry on record is not "OK" — it is unknown (a blank date gave NaN
  // days, which fell through every check to "OK").
  if (!/^\d{4}-\d{2}-\d{2}/.test(expiryDate || "")) return "No expiry date";
  const days = daysBetween(asOf, expiryDate);
  if (days < 0) return "Expired";
  if (days <= 30) return "Due soon";
  return "OK";
}

function studentRow(
  studentId: string,
  sis: SisState,
  masters: MastersState,
) {
  const st = sis.students.find((s) => s.id === studentId);
  const cls = masters.classes.find((c) => c.id === st?.classId)?.name || "";
  const sec =
    masters.sections.find((x) => x.id === st?.sectionId)?.name || "";
  return {
    student: st?.fullName || studentId,
    admissionNo: st?.admissionNo || "",
    className: cls,
    section: sec,
  };
}

function routeLabel(routeId: string, transport: TransportState): string {
  const r = getRoute(routeId, transport);
  return r ? `${r.code} · ${r.name}` : routeId;
}

function vehicleLabel(vehicleId: string, transport: TransportState): string {
  const v = getVehicle(vehicleId, transport);
  return v ? `${v.registrationNo} · ${v.name}` : vehicleId;
}

function filterNoteParts(
  filters: TransportReportFilters,
  transport: TransportState,
  masters: MastersState,
  date: string,
) {
  return describeFilters([
    `Date ${date}`,
    filters.routeId
      ? `Route ${getRoute(filters.routeId, transport)?.code || filters.routeId}`
      : null,
    filters.vehicleId
      ? `Vehicle ${getVehicle(filters.vehicleId, transport)?.registrationNo || filters.vehicleId}`
      : null,
  ]);
}

function istClock(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t + 330 * 60_000).toISOString().slice(11, 16);
}

/**
 * The boarding day sheet's rows from bus register v2 marks: every live rider
 * of each route plus anyone marked on it. A trip with no mark says "not
 * marked" — never absent. The register keeps no free-text note, so the old
 * note columns are now who marked the trip and when (IST).
 */
export function boardingDaySheetRows(input: {
  transport: TransportState;
  date: string;
  routeId?: string;
  marks: RegisterDayMark[];
  studentInfo: (studentId: string) => {
    student: string;
    admissionNo: string;
    className: string;
    section: string;
  };
}): Record<string, string | number>[] {
  let routes = listActiveRoutes(input.transport);
  if (input.routeId) routes = routes.filter((rt) => rt.id === input.routeId);
  const riders = listActiveRiders(input.transport);
  const rows: Record<string, string | number>[] = [];
  for (const rt of routes) {
    const onRoute = input.marks.filter((m) => m.date === input.date && m.routeId === rt.id);
    const pick = (trip: RegisterTrip) => {
      const by = new Map<string, RegisterDayMark>();
      for (const m of onRoute) {
        if (m.trip !== trip) continue;
        const held = by.get(m.studentId);
        if (!held || m.tappedAt >= held.tappedAt) by.set(m.studentId, m);
      }
      return by;
    };
    const amMap = pick("AM");
    const pmMap = pick("PM");
    const riderIds = new Set([
      ...riders.filter((a) => a.routeId === rt.id).map((a) => a.studentId),
      ...onRoute.map((m) => m.studentId),
    ]);
    const label = (m: RegisterDayMark | undefined) => (m ? STATUS_LABEL[m.status] : "not marked");
    const by = (m: RegisterDayMark | undefined) =>
      m ? [m.markedByName, istClock(m.tappedAt)].filter(Boolean).join(" ") : "";
    for (const sid of riderIds) {
      const asg = riders.find((a) => a.studentId === sid && a.routeId === rt.id);
      const am = amMap.get(sid);
      const pm = pmMap.get(sid);
      rows.push({
        date: input.date,
        route: rt.code,
        routeName: rt.name,
        ...input.studentInfo(sid),
        stop: asg?.stopName || (asg ? "" : "not on this route's list"),
        amStatus: label(am),
        pmStatus: label(pm),
        amBy: by(am),
        pmBy: by(pm),
      });
    }
  }
  return rows;
}

export function runTransportReport(
  id: TransportReportId,
  filters: TransportReportFilters,
): { ok: true; message: string } | { ok: false; error: string } {
  // Not from a copy this page has not loaded (lib/reportDataGuard).
  const notLoaded = refuseReportBeforeLoad(reportDesksFor("transport", id));
  if (notLoaded) return { ok: false, error: notLoaded };
  if (TRANSPORT_REPORTS_NEEDING_COSTS.has(id) && !filters.costs) {
    return { ok: false, error: "Fuel, vehicle papers and loans could not be read, so this report was not made. Try again." };
  }
  // Only the reports above read this; the fallback says "unknown", never ₹0.
  const costs: VehicleCosts = filters.costs ?? { fills: null, docs: null, loans: { known: false, reason: "not loaded" } };
  const transport = filters.transport ?? loadTransport();
  const masters = filters.masters ?? loadMasters();
  const sis = filters.sis ?? loadSis();
  const fees = filters.fees ?? loadFees();
  const date = filters.date || todayYmd();
  const note = filterNoteParts(filters, transport, masters, date);
  const subtitle = `${TENANT.shortName} · Transport`;

  switch (id) {
    case "rider_roster": {
      let riders = listActiveRiders(transport);
      if (filters.routeId) {
        riders = riders.filter((a) => a.routeId === filters.routeId);
      }
      const rows = riders.map((a) => {
        const info = studentRow(a.studentId, sis, masters);
        const route = a.route ?? getRoute(a.routeId, transport);
        const fee =
          a.monthlyFeePaise > 0
            ? a.monthlyFeePaise
            : route?.monthlyFeePaise ?? 0;
        return {
          ...info,
          routeCode: route?.code || "",
          routeName: route?.name || "",
          busNo: route?.busNo || "",
          vehicleReg: route?.vehicleReg || "",
          stop: a.stopName,
          // 0 means the route was never priced, not that the bus is free.
          monthlyFee: fee > 0 ? formatInr(fee) : "Not priced",
          effectiveFrom: a.effectiveFrom,
          suspended: a.boardingSuspended ? "Yes" : "",
        };
      });
      const r = exportFilterReport(
        {
          title: "Transport rider roster",
          subtitle,
          filterNote: note,
          columns: [
            { key: "admissionNo", header: "Adm no", width: 0.9 },
            { key: "student", header: "Student", width: 1.4 },
            { key: "className", header: "Class", width: 0.8 },
            { key: "section", header: "Sec", width: 0.5 },
            { key: "routeCode", header: "Route", width: 0.8 },
            { key: "routeName", header: "Route name", width: 1.2 },
            { key: "stop", header: "Stop", width: 1 },
            { key: "busNo", header: "Bus", width: 0.7 },
            { key: "vehicleReg", header: "Vehicle", width: 0.9 },
            { key: "monthlyFee", header: "Monthly ₹", width: 0.9 },
            { key: "effectiveFrom", header: "From", width: 0.8 },
            { key: "suspended", header: "Suspended", width: 0.7 },
          ],
          rows,
          fileBaseName: "transport_rider_roster",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Rider roster: ${rows.length} active rider(s)` }
        : r;
    }

    case "route_occupancy": {
      const gpsMap = lastGpsPingByVehicle(transport);
      let routes = listActiveRoutes(transport);
      if (filters.routeId) {
        routes = routes.filter((rt) => rt.id === filters.routeId);
      }
      const rows = routes.map((rt) => {
        const riders = listActiveRiders(transport).filter(
          (a) => a.routeId === rt.id,
        );
        const veh = rt.vehicleId
          ? getVehicle(rt.vehicleId, transport)
          : undefined;
        const ping = rt.vehicleId ? gpsMap.get(rt.vehicleId) : undefined;
        return {
          routeCode: rt.code,
          routeName: rt.name,
          busNo: rt.busNo || veh?.name || "",
          vehicleReg: rt.vehicleReg || veh?.registrationNo || "",
          vehicleStatus: veh ? vehicleStatusLabel(veh.status) : "",
          activeRiders: riders.length,
          stops: rt.stops.length,
          monthlyFee: rt.monthlyFeePaise > 0 ? formatInr(rt.monthlyFeePaise) : "Not priced",
          lastGps: ping
            ? `${ping.recordedAt.slice(0, 16).replace("T", " ")} (${ping.lat.toFixed(4)}, ${ping.lng.toFixed(4)})`
            : "",
        };
      });
      const r = exportFilterReport(
        {
          title: "Route occupancy",
          subtitle,
          filterNote: note,
          columns: [
            { key: "routeCode", header: "Route", width: 0.8 },
            { key: "routeName", header: "Name", width: 1.3 },
            { key: "busNo", header: "Bus", width: 0.7 },
            { key: "vehicleReg", header: "Vehicle", width: 0.9 },
            { key: "vehicleStatus", header: "Fleet status", width: 0.9 },
            { key: "activeRiders", header: "Riders", width: 0.7, align: "right" },
            { key: "stops", header: "Stops", width: 0.6, align: "right" },
            { key: "monthlyFee", header: "Route fee", width: 0.9 },
            { key: "lastGps", header: "Last GPS", width: 1.4 },
          ],
          rows,
          fileBaseName: "transport_route_occupancy",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Route occupancy: ${rows.length} route(s)` }
        : r;
    }

    case "boarding_day_sheet": {
      if (!filters.registerMarks) {
        return {
          ok: false,
          error: "The bus register could not be read, so the boarding day sheet was not made. Try again.",
        };
      }
      const rows = boardingDaySheetRows({
        transport,
        date,
        routeId: filters.routeId,
        marks: filters.registerMarks,
        studentInfo: (sid) => studentRow(sid, sis, masters),
      });
      rows.sort((a, b) =>
        String(a.route).localeCompare(String(b.route)) ||
        String(a.student).localeCompare(String(b.student)),
      );
      const r = exportFilterReport(
        {
          title: `Boarding day sheet · ${date}`,
          subtitle,
          filterNote: note,
          columns: [
            { key: "route", header: "Route", width: 0.7 },
            { key: "routeName", header: "Route name", width: 1.1 },
            { key: "admissionNo", header: "Adm no", width: 0.9 },
            { key: "student", header: "Student", width: 1.3 },
            { key: "className", header: "Class", width: 0.7 },
            { key: "section", header: "Sec", width: 0.5 },
            { key: "stop", header: "Stop", width: 0.9 },
            { key: "amStatus", header: "AM", width: 0.7 },
            { key: "pmStatus", header: "PM", width: 0.7 },
            { key: "amBy", header: "AM marked", width: 0.9 },
            { key: "pmBy", header: "PM marked", width: 0.9 },
          ],
          rows,
          fileBaseName: "transport_boarding_sheet",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Boarding ${date}: ${rows.length} row(s)` }
        : r;
    }

    case "unauthorized_boarding": {
      let events = transport.boardingEvents.filter(
        (e) => e.status === "unauthorized" && e.date === date,
      );
      if (filters.routeId) {
        events = events.filter((e) => e.routeId === filters.routeId);
      }
      const rows = events.map((e) => {
        const info = studentRow(e.studentId, sis, masters);
        return {
          date: e.date,
          trip: e.trip,
          route: routeLabel(e.routeId, transport),
          ...info,
          note: e.note,
        };
      });
      const r = exportFilterReport(
        {
          title: `Unauthorized boarding · ${date}`,
          subtitle,
          filterNote: note,
          columns: [
            { key: "date", header: "Date", width: 0.8 },
            { key: "trip", header: "Trip", width: 0.5 },
            { key: "route", header: "Route", width: 1.2 },
            { key: "admissionNo", header: "Adm no", width: 0.9 },
            { key: "student", header: "Student", width: 1.3 },
            { key: "className", header: "Class", width: 0.8 },
            { key: "section", header: "Sec", width: 0.5 },
            { key: "note", header: "Note", width: 1.2 },
          ],
          rows,
          fileBaseName: "transport_unauthorized_boarding",
        },
        filters.format,
      );
      return r.ok
        ? {
            ok: true,
            message: `Unauthorized boarding: ${rows.length} event(s)`,
          }
        : r;
    }

    case "unpaid_riders": {
      const paidMap = paidByDueKey(fees);
      const rows: Record<string, string | number>[] = [];
      let riders = listActiveRiders(transport);
      if (filters.routeId) {
        riders = riders.filter((a) => a.routeId === filters.routeId);
      }
      for (const asg of riders) {
        const dues = computeTransportPeriodDues(asg.studentId, {
          asOf: date,
          includeFuture: false,
          state: transport,
          academicYearCode: asg.academicYearCode,
        }).filter((d) => d.assignmentId === asg.id);
        for (const d of dues) {
          const paid = paidMap.get(d.dueKey) ?? 0;
          const bal = Math.max(0, d.amountPaise - paid);
          if (bal <= 0) continue;
          const info = studentRow(asg.studentId, sis, masters);
          rows.push({
            ...info,
            route: d.routeCode,
            routeName: d.routeName,
            stop: d.stopName,
            period: d.periodLabel,
            dueOn: d.dueOn,
            billed: formatInr(d.amountPaise),
            paid: formatInr(paid),
            balance: formatInr(bal),
            busNo: d.busNo,
            vehicleReg: d.vehicleReg,
          });
        }
      }
      rows.sort((a, b) => String(a.dueOn).localeCompare(String(b.dueOn)));
      const r = exportFilterReport(
        {
          title: "Unpaid transport dues",
          subtitle: `${subtitle} / Fee Take`,
          filterNote: note,
          columns: [
            { key: "admissionNo", header: "Adm no", width: 0.9 },
            { key: "student", header: "Student", width: 1.3 },
            { key: "className", header: "Class", width: 0.7 },
            { key: "section", header: "Sec", width: 0.5 },
            { key: "route", header: "Route", width: 0.7 },
            { key: "routeName", header: "Route name", width: 1.1 },
            { key: "stop", header: "Stop", width: 0.9 },
            { key: "period", header: "Period", width: 0.9 },
            { key: "dueOn", header: "Due on", width: 0.8 },
            { key: "billed", header: "Billed", width: 0.8 },
            { key: "paid", header: "Paid", width: 0.8 },
            { key: "balance", header: "Balance", width: 0.9 },
            { key: "busNo", header: "Bus", width: 0.6 },
            { key: "vehicleReg", header: "Vehicle", width: 0.8 },
          ],
          rows,
          fileBaseName: "transport_unpaid_riders",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Unpaid transport: ${rows.length} due line(s)` }
        : r;
    }

    case "fuel_by_vehicle":
    case "cost_per_km": {
      // The fuel register (transport_fuel_fills), not the desk's retired
      // fuelRefillLogs. Fills up to the report date; voided ones excluded.
      if (!costs.fills) {
        return { ok: false, error: `The fuel register could not be read${costs.fillsError ? ` (${costs.fillsError})` : ""} — no report was made.` };
      }
      let vehicles = transport.vehicles;
      if (filters.vehicleId) vehicles = vehicles.filter((v) => v.id === filters.vehicleId);
      const fills = costs.fills.filter((f) => f.fillDate <= date);
      const ids = new Set(vehicles.map((v) => v.id));
      const withFills = new Set(fills.map((f) => f.vehicleId));
      // A fill whose vehicle is no longer on the desk still counts (and says so).
      const vehicleIds = [
        ...vehicles.filter((v) => withFills.has(v.id)).map((v) => v.id),
        ...(filters.vehicleId ? [] : [...withFills].filter((id) => !ids.has(id))),
      ];
      const per = fuelByVehicle(fills, vehicleIds);
      const unitText = (r: FuelVehicleRow) =>
        [r.kg > 0 ? `${r.kg} kg` : "", r.litres > 0 ? `${r.litres} L` : ""].filter(Boolean).join(" + ") || "—";
      const kmText = (r: FuelVehicleRow) => (r.km == null ? "unknown" : `${r.km}`);
      if (id === "fuel_by_vehicle") {
        const rows = per
          .map((r) => {
            const v = getVehicle(r.vehicleId, transport);
            return {
              registration: v?.registrationNo || "",
              vehicle: v?.name || `${r.vehicleId} (not in the fleet)`,
              fuelType: v?.fuelType || "",
              fills: r.fills,
              quantity: unitText(r),
              totalAmount: formatInr(r.amountPaise),
              kmDriven: kmText(r),
              kmFrom: r.km == null ? "no odometer pairs" : `${r.fillsWithKm} of ${r.fills} fills`,
              avgMileage: r.kmPerUnit == null ? "unknown" : `${r.kmPerUnit} km/${r.kmPerUnitUnit === "kg" ? "kg" : "L"}`,
              inAccounts: r.inAccounts,
              notInAccounts: r.notInAccounts,
              awaitingOffice: r.awaitingOffice,
              voided: r.voided,
            };
          })
          .sort((a, b) => String(a.registration).localeCompare(String(b.registration)));
        const r = exportFilterReport(
          {
            title: "Fuel by vehicle",
            subtitle: `${subtitle} · fuel register`,
            filterNote: describeFilters([note, `Fills up to ${date}`]),
            columns: [
              { key: "registration", header: "Reg no", width: 0.9 },
              { key: "vehicle", header: "Vehicle", width: 1 },
              { key: "fuelType", header: "Fuel", width: 0.6 },
              { key: "fills", header: "Fills", width: 0.5, align: "right" },
              { key: "quantity", header: "Qty", width: 0.8 },
              { key: "totalAmount", header: "Amount", width: 0.9 },
              { key: "kmDriven", header: "Km", width: 0.6, align: "right" },
              { key: "kmFrom", header: "Km from", width: 0.9 },
              { key: "avgMileage", header: "Mileage", width: 0.8 },
              { key: "inAccounts", header: "In accounts", width: 0.6, align: "right" },
              { key: "notInAccounts", header: "Not in accounts", width: 0.7, align: "right" },
              { key: "awaitingOffice", header: "Awaiting office", width: 0.7, align: "right" },
              { key: "voided", header: "Voided", width: 0.5, align: "right" },
            ],
            rows,
            fileBaseName: "transport_fuel_by_vehicle",
          },
          filters.format,
        );
        return r.ok ? { ok: true, message: `Fuel summary: ${rows.length} vehicle(s)` } : r;
      }
      const rows = per
        .map((r) => {
          const v = getVehicle(r.vehicleId, transport);
          return {
            registration: v?.registrationNo || "",
            vehicle: v?.name || `${r.vehicleId} (not in the fleet)`,
            totalKm: kmText(r),
            fuelCost: formatInr(r.amountPaise),
            costPerKm: r.rupeesPerKm == null ? "unknown" : `₹${r.rupeesPerKm.toFixed(2)}`,
            odometer: v?.odometerKm ?? "",
          };
        })
        .sort((a, b) => String(a.registration).localeCompare(String(b.registration)));
      const r = exportFilterReport(
        {
          title: "Transport cost per km",
          subtitle: `${subtitle} · fuel register`,
          filterNote: describeFilters([note, `Fills up to ${date}`, "Km only from consecutive odometer readings"]),
          columns: [
            { key: "registration", header: "Reg no", width: 0.9 },
            { key: "vehicle", header: "Vehicle", width: 1.1 },
            { key: "totalKm", header: "Km (fills)", width: 0.8, align: "right" },
            { key: "fuelCost", header: "Fuel cost", width: 0.9 },
            { key: "costPerKm", header: "₹ / km", width: 0.8 },
            { key: "odometer", header: "Odometer", width: 0.8, align: "right" },
          ],
          rows,
          fileBaseName: "transport_cost_per_km",
        },
        filters.format,
      );
      return r.ok ? { ok: true, message: `Cost/km: ${rows.length} vehicle(s)` } : r;
    }

    case "dealer_aging": {
      let payables = listOpenPayables(transport);
      if (filters.vehicleId) {
        payables = payables.filter((p) => p.vehicleId === filters.vehicleId);
      }
      const rows = payables
        .map((p) => {
          const dealer = transport.dealers.find((d) => d.id === p.dealerId);
          const balance = Math.max(0, p.amountPaise - p.paidPaise);
          const overdueDays = daysBetween(p.dueOn, date);
          return {
            dealer: dealer?.name || p.dealerId,
            dealerType: dealer ? dealerTypeLabel(dealer.type) : "",
            vehicle: p.vehicleId
              ? vehicleLabel(p.vehicleId, transport)
              : "",
            sourceType: p.sourceType.replace(/_/g, " "),
            dueOn: p.dueOn,
            amount: formatInr(p.amountPaise),
            paid: formatInr(p.paidPaise),
            balance: formatInr(balance),
            daysOverdue: overdueDays > 0 ? overdueDays : 0,
            bucket: agingBucket(overdueDays),
            status: p.status,
            note: p.note,
          };
        })
        .filter((r) => r.balance !== formatInr(0))
        .sort((a, b) => String(a.dueOn).localeCompare(String(b.dueOn)));
      const r = exportFilterReport(
        {
          title: "Dealer payable aging",
          subtitle,
          filterNote: note,
          columns: [
            { key: "dealer", header: "Dealer", width: 1.2 },
            { key: "dealerType", header: "Type", width: 0.9 },
            { key: "vehicle", header: "Vehicle", width: 1.1 },
            { key: "sourceType", header: "Source", width: 0.9 },
            { key: "dueOn", header: "Due on", width: 0.8 },
            { key: "amount", header: "Amount", width: 0.8 },
            { key: "paid", header: "Paid", width: 0.8 },
            { key: "balance", header: "Balance", width: 0.9 },
            { key: "daysOverdue", header: "Overdue days", width: 0.8, align: "right" },
            { key: "bucket", header: "Aging", width: 0.8 },
            { key: "status", header: "Status", width: 0.7 },
            { key: "note", header: "Note", width: 1 },
          ],
          rows,
          fileBaseName: "transport_dealer_aging",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Dealer aging: ${rows.length} open payable(s)` }
        : r;
    }

    case "service_due": {
      let vehicles = transport.vehicles.filter((v) => v.isActive);
      if (filters.vehicleId) {
        vehicles = vehicles.filter((v) => v.id === filters.vehicleId);
      }
      const rows: Record<string, string | number>[] = [];
      for (const v of vehicles) {
        for (const item of v.serviceSchedule) {
          const odoDue =
            item.nextDueOdo > 0 && v.odometerKm >= item.nextDueOdo;
          const dateDue = item.nextDueOn && item.nextDueOn <= date;
          const status =
            odoDue || dateDue
              ? "Due"
              : item.nextDueOn && daysBetween(date, item.nextDueOn) <= 30
                ? "Upcoming"
                : "Scheduled";
          rows.push({
            registration: v.registrationNo,
            vehicle: v.name,
            task: item.task,
            lastDoneOn: item.lastDoneOn,
            lastOdo: item.lastDoneOdo,
            nextDueOn: item.nextDueOn,
            nextDueOdo: item.nextDueOdo,
            currentOdo: v.odometerKm,
            status,
          });
        }
      }
      rows.sort((a, b) =>
        String(a.nextDueOn || "9999").localeCompare(String(b.nextDueOn || "9999")),
      );
      const r = exportFilterReport(
        {
          title: "Service due register",
          subtitle,
          filterNote: note,
          columns: [
            { key: "registration", header: "Reg no", width: 0.9 },
            { key: "vehicle", header: "Vehicle", width: 1 },
            { key: "task", header: "Task", width: 1.2 },
            { key: "lastDoneOn", header: "Last done", width: 0.8 },
            { key: "lastOdo", header: "Last odo", width: 0.7, align: "right" },
            { key: "nextDueOn", header: "Due on", width: 0.8 },
            { key: "nextDueOdo", header: "Due odo", width: 0.7, align: "right" },
            { key: "currentOdo", header: "Current odo", width: 0.8, align: "right" },
            { key: "status", header: "Status", width: 0.8 },
          ],
          rows,
          fileBaseName: "transport_service_due",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Service due: ${rows.length} schedule line(s)` }
        : r;
    }

    case "compliance_calendar": {
      let vehicles = transport.vehicles.filter((v) => v.isActive);
      if (filters.vehicleId) {
        vehicles = vehicles.filter((v) => v.id === filters.vehicleId);
      }
      // Vehicle papers from the server register (transport_vehicle_docs),
      // not the desk's vehicle.compliance[] (never saved). A paper type
      // nobody recorded is listed as such, not left out.
      if (!costs.docs) {
        return { ok: false, error: "The vehicle papers could not be read — no calendar was made. Try again." };
      }
      const rows: Record<string, string | number>[] = [];
      for (const c of complianceCalendarRows(costs.docs, vehicles.map((v) => v.id), date)) {
        const v = getVehicle(c.vehicleId, transport);
        rows.push({
          registration: v?.registrationNo || "",
          vehicle: v?.name || c.vehicleId,
          certType: c.paper,
          expiryDate: c.expiresOn,
          daysLeft: c.daysLeft ?? "—",
          status: c.status,
          renewalCost: c.feePaise > 0 ? formatInr(c.feePaise) : "",
          vendor: c.insurer,
          note: [c.number, c.note].filter(Boolean).join(" · "),
        });
      }
      const paidMap = paidByDueKey(fees);
      const alerts = computeTransportComplianceAlerts({
        state: transport,
        paidByDueKey: paidMap,
        asOf: date,
      });
      for (const alert of alerts) {
        if (filters.routeId && alert.routeId !== filters.routeId) continue;
        const route = alert.routeId
          ? getRoute(alert.routeId, transport)
          : undefined;
        const veh = route?.vehicleId
          ? getVehicle(route.vehicleId, transport)
          : undefined;
        if (filters.vehicleId && veh?.id !== filters.vehicleId) continue;
        const info = alert.studentId
          ? studentRow(alert.studentId, sis, masters)
          : { student: "", admissionNo: "", className: "", section: "" };
        rows.push({
          registration: veh?.registrationNo || "",
          vehicle: veh?.name || route?.busNo || "",
          certType: alert.code.replace(/^TR_/, "").replace(/_/g, " "),
          expiryDate: alert.date,
          daysLeft: daysLeftCell(date, alert.date),
          status: alert.severity,
          renewalCost: alert.amountPaise ? formatInr(alert.amountPaise) : "",
          vendor: route ? `${route.code} · ${route.name}` : "",
          note: `${info.student}${info.admissionNo ? ` (${info.admissionNo})` : ""} · ${alert.message}`,
        });
      }
      rows.sort((a, b) =>
        // A paper with no date ("Not recorded") goes last, not first.
        String(a.expiryDate || "9999").localeCompare(String(b.expiryDate || "9999")),
      );
      const r = exportFilterReport(
        {
          title: "Fleet compliance calendar",
          subtitle,
          filterNote: note,
          columns: [
            { key: "registration", header: "Reg no", width: 0.9 },
            { key: "vehicle", header: "Vehicle", width: 1 },
            { key: "certType", header: "Certificate", width: 1 },
            { key: "expiryDate", header: "Expiry", width: 0.8 },
            { key: "daysLeft", header: "Days left", width: 0.7, align: "right" },
            { key: "status", header: "Status", width: 0.8 },
            { key: "renewalCost", header: "Renewal ₹", width: 0.8 },
            { key: "vendor", header: "Vendor", width: 1 },
            { key: "note", header: "Note", width: 1 },
          ],
          rows,
          fileBaseName: "transport_compliance_calendar",
        },
        filters.format,
      );
      return r.ok
        ? {
            ok: true,
            message: `Compliance calendar: ${rows.length} cert line(s)`,
          }
        : r;
    }

    case "emi_register": {
      // From Ledger v2 (the vehicle-loan accounts), not the desk's
      // emiSchedule — that was never saved and held none of the real loans.
      if (!costs.loans.known) {
        return { ok: false, error: `The EMI register needs the loan accounts: ${costs.loans.reason}.` };
      }
      let loans = costs.loans.loans;
      if (filters.vehicleId) loans = loans.filter((l) => l.vehicleId === filters.vehicleId);
      const rows = emiRegisterRows(loans).map((e) => {
        const v = e.vehicleId ? getVehicle(e.vehicleId, transport) : undefined;
        return {
          registration: v?.registrationNo || "",
          vehicle: v?.name || e.vehicleLabel || "Not linked to a bus",
          loanAccount: `${e.loanCode} · ${e.loanName}`,
          date: e.date,
          status: e.status,
          voucherNo: e.voucherNo,
          principal: e.principalPaise == null ? "" : formatInr(e.principalPaise),
          interest: e.interestPaise == null ? "" : formatInr(e.interestPaise),
        };
      });
      const r = exportFilterReport(
        {
          title: "Vehicle EMI register",
          subtitle: `${subtitle} · from the books`,
          filterNote: describeFilters([note, "EMIs posted in Accounts; months with none posted are listed as Not posted"]),
          columns: [
            { key: "registration", header: "Reg no", width: 0.9 },
            { key: "vehicle", header: "Vehicle", width: 1 },
            { key: "loanAccount", header: "Loan account", width: 1.4 },
            { key: "date", header: "Date / due", width: 0.8 },
            { key: "status", header: "Status", width: 0.8 },
            { key: "voucherNo", header: "Voucher", width: 0.9 },
            { key: "principal", header: "Principal", width: 0.8 },
            { key: "interest", header: "Interest", width: 0.8 },
          ],
          rows,
          fileBaseName: "transport_emi_register",
        },
        filters.format,
      );
      return r.ok ? { ok: true, message: `EMI register: ${rows.length} row(s) across ${loans.length} loan(s)` } : r;
    }

    case "insurance_cert_schedule": {
      // Every vehicle paper on record (renewals keep their history) from
      // transport_vehicle_docs — not the desk's insurancePolicies /
      // certificateRenewals, which were never saved.
      if (!costs.docs) {
        return { ok: false, error: "The vehicle papers could not be read — no schedule was made. Try again." };
      }
      let vehicles = transport.vehicles.filter((v) => v.isActive);
      if (filters.vehicleId) {
        vehicles = vehicles.filter((v) => v.id === filters.vehicleId);
      }
      const vehicleIds = new Set(vehicles.map((v) => v.id));
      const rows: Record<string, string | number>[] = [];
      for (const d of costs.docs) {
        if (!vehicleIds.has(d.vehicleId) || d.status !== "active") continue;
        const v = getVehicle(d.vehicleId, transport);
        const inForce = currentDocsFor(costs.docs, d.vehicleId)[d.type]?.id === d.id;
        rows.push({
          registration: v?.registrationNo || "",
          vehicle: v?.name || d.vehicleId,
          kind: VEHICLE_DOC_LABELS[d.type],
          reference: [d.number, d.policyNo].filter(Boolean).join(" · "),
          periodStart: d.issuedOn,
          expiryDate: d.expiresOn,
          daysLeft: daysLeftCell(date, d.expiresOn),
          status: inForce ? expiryStatus(d.expiresOn, date) : "Renewed",
          amount: d.feePaise > 0 ? formatInr(d.feePaise) : "Not entered",
          booked: d.fee ? (d.fee.reversalVoucherNo ? `${d.fee.voucherNo} (reversed)` : d.fee.voucherNo) : "",
          vendor: d.insurer,
        });
      }

      rows.sort((a, b) =>
        String(a.expiryDate).localeCompare(String(b.expiryDate)),
      );
      const r = exportFilterReport(
        {
          title: "Insurance & certificate schedule",
          subtitle,
          filterNote: note,
          columns: [
            { key: "registration", header: "Reg no", width: 0.9 },
            { key: "vehicle", header: "Vehicle", width: 1 },
            { key: "kind", header: "Kind", width: 0.9 },
            { key: "reference", header: "Number / policy", width: 1 },
            { key: "periodStart", header: "Issued", width: 0.8 },
            { key: "expiryDate", header: "Expiry", width: 0.8 },
            { key: "daysLeft", header: "Days left", width: 0.6, align: "right" },
            { key: "status", header: "Status", width: 0.7 },
            { key: "amount", header: "Fee", width: 0.8 },
            { key: "booked", header: "Voucher", width: 0.8 },
            { key: "vendor", header: "Insurer", width: 0.9 },
          ],
          rows,
          fileBaseName: "transport_insurance_cert_schedule",
        },
        filters.format,
      );
      return r.ok
        ? {
            ok: true,
            message: `Insurance/cert schedule: ${rows.length} row(s)`,
          }
        : r;
    }

    case "tco_by_vehicle": {
      let vehicles = transport.vehicles.filter((v) => v.isActive);
      if (filters.vehicleId) {
        vehicles = vehicles.filter((v) => v.id === filters.vehicleId);
      }
      const rows = vehicles.map((v) => {
        const tco = vehicleTco({
          vehicleId: v.id,
          fills: costs.fills,
          docs: costs.docs,
          loans: costs.loans,
          jobsPaise: completedJobsPaise(v.id, transport),
        });
        const t = (p: TcoPart) => tcoPartText(p, formatInr);
        return {
          registration: v.registrationNo,
          vehicle: v.name,
          status: vehicleStatusLabel(v.status),
          fuel: t(tco.fuel),
          emi: t(tco.emiPrincipal),
          interest: t(tco.interest),
          insurance: t(tco.insurance),
          certs: t(tco.papers),
          jobs: t(tco.jobs),
          total: tcoTotalText(tco, formatInr),
          gaps: [tco.fuel, tco.emiPrincipal, tco.insurance, tco.papers]
            .map((p) => p.note)
            .filter(Boolean)
            .filter((x, i, a) => a.indexOf(x) === i)
            .join("; "),
          odometer: v.odometerKm,
        };
      });
      const r = exportFilterReport(
        {
          title: "Total cost of ownership by vehicle",
          subtitle,
          filterNote: describeFilters([
            note,
            "Fuel: fuel register · EMI & interest: Accounts (loans linked to the bus) · papers: vehicle documents · “+” = at least",
          ]),
          columns: [
            { key: "registration", header: "Reg no", width: 0.9 },
            { key: "vehicle", header: "Vehicle", width: 0.9 },
            { key: "status", header: "Status", width: 0.6 },
            { key: "fuel", header: "Fuel", width: 0.7 },
            { key: "emi", header: "EMI principal", width: 0.8 },
            { key: "interest", header: "Interest", width: 0.7 },
            { key: "insurance", header: "Insurance", width: 0.7 },
            { key: "certs", header: "Other papers", width: 0.7 },
            { key: "jobs", header: "Service/repair", width: 0.7 },
            { key: "total", header: "Total TCO", width: 1.1 },
            { key: "gaps", header: "Not known", width: 1.2 },
            { key: "odometer", header: "Odometer", width: 0.6, align: "right" },
          ],
          rows,
          fileBaseName: "transport_tco_by_vehicle",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `TCO: ${rows.length} vehicle(s)` }
        : r;
    }

    default:
      return { ok: false, error: "Unknown report" };
  }
}
