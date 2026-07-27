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
  certTypeLabel,
  computeTransportComplianceAlerts,
  computeTransportPeriodDues,
  getRoute,
  getVehicle,
  lastGpsPingByVehicle,
  listActiveRiders,
  listActiveRoutes,
  listBoardingForTrip,
  listOpenPayables,
  loadTransport,
  vehicleTcoPaise,
  vehicleStatusLabel,
  dealerTypeLabel,
  type TransportState,
} from "@/lib/transport";

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
  { id: "finance", title: "Finance & TCO", headerClass: "bg-[#0f766e]" },
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
    hint: "AM/PM boarding for report date",
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
};

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = new Date(from.slice(0, 10));
  const b = new Date(to.slice(0, 10));
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function agingBucket(daysOverdue: number): string {
  if (daysOverdue <= 0) return "Current";
  if (daysOverdue <= 30) return "1–30 days";
  if (daysOverdue <= 60) return "31–60 days";
  if (daysOverdue <= 90) return "61–90 days";
  return "90+ days";
}

function expiryStatus(expiryDate: string, asOf: string): string {
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

function dealerName(dealerId: string, transport: TransportState): string {
  return transport.dealers.find((d) => d.id === dealerId)?.name || dealerId;
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

export function runTransportReport(
  id: TransportReportId,
  filters: TransportReportFilters,
): { ok: true; message: string } | { ok: false; error: string } {
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
          monthlyFee: formatInr(fee),
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
          monthlyFee: formatInr(rt.monthlyFeePaise),
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
      let routes = listActiveRoutes(transport);
      if (filters.routeId) {
        routes = routes.filter((rt) => rt.id === filters.routeId);
      }
      const rows: Record<string, string | number>[] = [];
      for (const rt of routes) {
        const am = listBoardingForTrip(date, rt.id, "AM", transport);
        const pm = listBoardingForTrip(date, rt.id, "PM", transport);
        const amMap = new Map(am.map((e) => [e.studentId, e]));
        const pmMap = new Map(pm.map((e) => [e.studentId, e]));
        const riderIds = new Set([
          ...listActiveRiders(transport)
            .filter((a) => a.routeId === rt.id)
            .map((a) => a.studentId),
          ...am.map((e) => e.studentId),
          ...pm.map((e) => e.studentId),
        ]);
        for (const sid of riderIds) {
          const info = studentRow(sid, sis, masters);
          const asg = listActiveRiders(transport).find(
            (a) => a.studentId === sid && a.routeId === rt.id,
          );
          const amEv = amMap.get(sid);
          const pmEv = pmMap.get(sid);
          rows.push({
            date,
            route: rt.code,
            routeName: rt.name,
            ...info,
            stop: asg?.stopName || "",
            amStatus: amEv?.status || "—",
            pmStatus: pmEv?.status || "—",
            amNote: amEv?.note || "",
            pmNote: pmEv?.note || "",
          });
        }
      }
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
            { key: "amNote", header: "AM note", width: 0.9 },
            { key: "pmNote", header: "PM note", width: 0.9 },
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

    case "fuel_by_vehicle": {
      let logs = transport.fuelRefillLogs;
      if (filters.vehicleId) {
        logs = logs.filter((l) => l.vehicleId === filters.vehicleId);
      }
      const byVehicle = new Map<
        string,
        {
          refills: number;
          qty: number;
          amountPaise: number;
          km: number;
          mileageSum: number;
          mileageN: number;
          anomalies: number;
        }
      >();
      for (const log of logs) {
        const cur = byVehicle.get(log.vehicleId) ?? {
          refills: 0,
          qty: 0,
          amountPaise: 0,
          km: 0,
          mileageSum: 0,
          mileageN: 0,
          anomalies: 0,
        };
        cur.refills += 1;
        cur.qty += log.qty;
        cur.amountPaise += log.amountPaise;
        cur.km += log.kmSinceLast;
        if (log.mileage > 0) {
          cur.mileageSum += log.mileage;
          cur.mileageN += 1;
        }
        if (log.anomaly) cur.anomalies += 1;
        byVehicle.set(log.vehicleId, cur);
      }
      const rows = [...byVehicle.entries()]
        .map(([vehicleId, agg]) => {
          const v = getVehicle(vehicleId, transport);
          const avgMileage =
            agg.mileageN > 0 ? (agg.mileageSum / agg.mileageN).toFixed(1) : "";
          return {
            vehicle: v?.name || vehicleId,
            registration: v?.registrationNo || "",
            fuelType: v?.fuelType || "",
            fuelUnit: v?.fuelUnit || "",
            refills: agg.refills,
            totalQty: agg.qty.toFixed(1),
            totalAmount: formatInr(agg.amountPaise),
            kmDriven: agg.km.toFixed(0),
            avgMileage,
            anomalies: agg.anomalies,
          };
        })
        .sort((a, b) => String(a.registration).localeCompare(String(b.registration)));
      const r = exportFilterReport(
        {
          title: "Fuel by vehicle",
          subtitle,
          filterNote: note,
          columns: [
            { key: "registration", header: "Reg no", width: 0.9 },
            { key: "vehicle", header: "Vehicle", width: 1 },
            { key: "fuelType", header: "Fuel", width: 0.7 },
            { key: "fuelUnit", header: "Unit", width: 0.6 },
            { key: "refills", header: "Refills", width: 0.7, align: "right" },
            { key: "totalQty", header: "Qty", width: 0.7, align: "right" },
            { key: "totalAmount", header: "Amount", width: 0.9 },
            { key: "kmDriven", header: "Km", width: 0.7, align: "right" },
            { key: "avgMileage", header: "Avg mileage", width: 0.8 },
            { key: "anomalies", header: "Anomalies", width: 0.7, align: "right" },
          ],
          rows,
          fileBaseName: "transport_fuel_by_vehicle",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Fuel summary: ${rows.length} vehicle(s)` }
        : r;
    }

    case "cost_per_km": {
      let logs = transport.fuelRefillLogs;
      if (filters.vehicleId) {
        logs = logs.filter((l) => l.vehicleId === filters.vehicleId);
      }
      const byVehicle = new Map<
        string,
        { amountPaise: number; km: number }
      >();
      for (const log of logs) {
        const km = log.kmSinceLast > 0 ? log.kmSinceLast : 0;
        const cur = byVehicle.get(log.vehicleId) ?? { amountPaise: 0, km: 0 };
        cur.amountPaise += log.amountPaise;
        cur.km += km;
        byVehicle.set(log.vehicleId, cur);
      }
      const rows = [...byVehicle.entries()]
        .map(([vehicleId, agg]) => {
          const v = getVehicle(vehicleId, transport);
          const costPerKm =
            agg.km > 0
              ? formatInr(Math.round(agg.amountPaise / agg.km))
              : "—";
          return {
            registration: v?.registrationNo || "",
            vehicle: v?.name || vehicleId,
            totalKm: agg.km.toFixed(0),
            fuelCost: formatInr(agg.amountPaise),
            costPerKm,
            odometer: v?.odometerKm ?? "",
          };
        })
        .sort((a, b) => String(a.registration).localeCompare(String(b.registration)));
      const r = exportFilterReport(
        {
          title: "Transport cost per km",
          subtitle,
          filterNote: note,
          columns: [
            { key: "registration", header: "Reg no", width: 0.9 },
            { key: "vehicle", header: "Vehicle", width: 1.1 },
            { key: "totalKm", header: "Km (refills)", width: 0.8, align: "right" },
            { key: "fuelCost", header: "Fuel cost", width: 0.9 },
            { key: "costPerKm", header: "₹ / km", width: 0.8 },
            { key: "odometer", header: "Odometer", width: 0.8, align: "right" },
          ],
          rows,
          fileBaseName: "transport_cost_per_km",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Cost/km: ${rows.length} vehicle(s)` }
        : r;
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
      const rows: Record<string, string | number>[] = [];
      for (const v of vehicles) {
        for (const doc of v.compliance) {
          const daysLeft = daysBetween(date, doc.expiryDate);
          rows.push({
            registration: v.registrationNo,
            vehicle: v.name,
            certType: certTypeLabel(doc.certType),
            expiryDate: doc.expiryDate,
            daysLeft,
            status: expiryStatus(doc.expiryDate, date),
            renewalCost: formatInr(doc.renewalCostPaise),
            vendor: dealerName(doc.vendorId, transport),
            note: doc.docNote,
          });
        }
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
          daysLeft: daysBetween(date, alert.date),
          status: alert.severity,
          renewalCost: alert.amountPaise ? formatInr(alert.amountPaise) : "",
          vendor: route ? `${route.code} · ${route.name}` : "",
          note: `${info.student}${info.admissionNo ? ` (${info.admissionNo})` : ""} · ${alert.message}`,
        });
      }
      rows.sort((a, b) =>
        String(a.expiryDate).localeCompare(String(b.expiryDate)),
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
      let schedule = transport.emiSchedule;
      if (filters.vehicleId) {
        const loanIds = new Set(
          transport.vehicleLoans
            .filter((l) => l.vehicleId === filters.vehicleId)
            .map((l) => l.id),
        );
        schedule = schedule.filter((e) => loanIds.has(e.loanId));
      }
      const rows = schedule
        .map((e) => {
          const loan = transport.vehicleLoans.find((l) => l.id === e.loanId);
          const v = loan
            ? getVehicle(loan.vehicleId, transport)
            : undefined;
          return {
            registration: v?.registrationNo || "",
            vehicle: v?.name || loan?.vehicleId || "",
            accountNo: loan?.accountNo || "",
            financier: loan ? dealerName(loan.dealerId, transport) : "",
            installmentNo: e.installmentNo,
            dueOn: e.dueOn,
            amount: formatInr(e.amountPaise),
            status: e.status,
            paidOn: e.paidOn,
            paidAmount: formatInr(e.paidAmountPaise),
          };
        })
        .sort((a, b) =>
          String(a.dueOn).localeCompare(String(b.dueOn)) ||
          Number(a.installmentNo) - Number(b.installmentNo),
        );
      const r = exportFilterReport(
        {
          title: "Vehicle EMI register",
          subtitle,
          filterNote: note,
          columns: [
            { key: "registration", header: "Reg no", width: 0.9 },
            { key: "vehicle", header: "Vehicle", width: 1 },
            { key: "accountNo", header: "Loan ac", width: 0.9 },
            { key: "financier", header: "Financier", width: 1.1 },
            { key: "installmentNo", header: "Inst #", width: 0.6, align: "right" },
            { key: "dueOn", header: "Due on", width: 0.8 },
            { key: "amount", header: "EMI", width: 0.8 },
            { key: "status", header: "Status", width: 0.7 },
            { key: "paidOn", header: "Paid on", width: 0.8 },
            { key: "paidAmount", header: "Paid", width: 0.8 },
          ],
          rows,
          fileBaseName: "transport_emi_register",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `EMI register: ${rows.length} installment(s)` }
        : r;
    }

    case "insurance_cert_schedule": {
      let vehicles = transport.vehicles.filter((v) => v.isActive);
      if (filters.vehicleId) {
        vehicles = vehicles.filter((v) => v.id === filters.vehicleId);
      }
      const vehicleIds = new Set(vehicles.map((v) => v.id));
      const rows: Record<string, string | number>[] = [];

      for (const pol of transport.insurancePolicies) {
        if (!vehicleIds.has(pol.vehicleId)) continue;
        const v = getVehicle(pol.vehicleId, transport);
        rows.push({
          registration: v?.registrationNo || "",
          vehicle: v?.name || pol.vehicleId,
          kind: `Insurance · ${pol.type.replace(/_/g, " ")}`,
          reference: pol.policyNo,
          periodStart: pol.periodStart,
          expiryDate: pol.periodEnd,
          daysLeft: daysBetween(date, pol.periodEnd),
          status: expiryStatus(pol.periodEnd, date),
          amount: formatInr(pol.premiumPaise),
          vendor: dealerName(pol.dealerId, transport),
        });
      }

      for (const cert of transport.certificateRenewals) {
        if (!vehicleIds.has(cert.vehicleId)) continue;
        const v = getVehicle(cert.vehicleId, transport);
        rows.push({
          registration: v?.registrationNo || "",
          vehicle: v?.name || cert.vehicleId,
          kind: certTypeLabel(cert.certType),
          reference: cert.billNo,
          periodStart: cert.issuedDate,
          expiryDate: cert.expiryDate,
          daysLeft: daysBetween(date, cert.expiryDate),
          status: expiryStatus(cert.expiryDate, date),
          amount: formatInr(cert.feePaise),
          vendor: dealerName(cert.dealerId, transport),
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
            { key: "kind", header: "Kind", width: 1.1 },
            { key: "reference", header: "Policy / bill", width: 1 },
            { key: "periodStart", header: "Start", width: 0.8 },
            { key: "expiryDate", header: "Expiry", width: 0.8 },
            { key: "daysLeft", header: "Days left", width: 0.7, align: "right" },
            { key: "status", header: "Status", width: 0.8 },
            { key: "amount", header: "Amount", width: 0.8 },
            { key: "vendor", header: "Vendor", width: 1 },
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
        const tco = vehicleTcoPaise(v.id, transport);
        return {
          registration: v.registrationNo,
          vehicle: v.name,
          status: vehicleStatusLabel(v.status),
          fuel: formatInr(tco.fuel),
          emi: formatInr(tco.emi),
          insurance: formatInr(tco.insurance),
          certs: formatInr(tco.certs),
          jobs: formatInr(tco.jobs),
          total: formatInr(tco.total),
          odometer: v.odometerKm,
        };
      });
      const r = exportFilterReport(
        {
          title: "Total cost of ownership by vehicle",
          subtitle,
          filterNote: note,
          columns: [
            { key: "registration", header: "Reg no", width: 0.9 },
            { key: "vehicle", header: "Vehicle", width: 1 },
            { key: "status", header: "Status", width: 0.8 },
            { key: "fuel", header: "Fuel", width: 0.8 },
            { key: "emi", header: "EMI paid", width: 0.8 },
            { key: "insurance", header: "Insurance", width: 0.8 },
            { key: "certs", header: "Certs", width: 0.8 },
            { key: "jobs", header: "Service/repair", width: 0.9 },
            { key: "total", header: "Total TCO", width: 0.9 },
            { key: "odometer", header: "Odometer", width: 0.7, align: "right" },
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
