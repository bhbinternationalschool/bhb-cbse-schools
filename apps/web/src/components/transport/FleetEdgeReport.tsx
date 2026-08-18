"use client";

/**
 * Transport → Fleet Edge report. One screen, scanned top-to-bottom:
 *
 *   toolbar (range · vehicle · refresh · auto-refresh)
 *   → attention strip (things that need a human now)
 *   → KPI tiles (fleet totals for the range)
 *   → tabs: Overview charts · Vehicles · Alerts · Notifications · Offline ·
 *           Health · Director's report
 *
 * Everything renders from GET /api/transport/fleet-edge/dashboard (see
 * lib/fleetEdgeReport.server.ts) — no client-side re-aggregation. Alerts can
 * be viewed (full payload) and deleted (transport:edit, audited, confirm
 * dialog); vehicle model/year is edited inline as before.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  Download,
  Eye,
  Fuel,
  Gauge,
  MapPin,
  RefreshCw,
  Route,
  ShieldAlert,
  Siren,
  Sparkles,
  Trash2,
  Truck,
  WifiOff,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErpArea, ErpBar, ErpDonut, type ErpChartRow } from "@/components/ui/erp-chart-lazy";
import { ErpChartCard, ErpChartGrid, ErpMetricCard, ErpPanel } from "@/components/ui/erp-roster";
import { field } from "@/components/ui/erp-ui";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { pushToast } from "@/components/shell/Toast";
import { downloadExcelCsv } from "@/lib/reportExport";
import type { FleetBucket, OfflinePeriod, VehicleDashboardRow } from "@/lib/fleetEdgeAnalytics";
import { averageEngineLoad, averageGsa, averageSpeed } from "@/lib/fleetEdgeAnalytics";
import {
  isServiceDue,
  type FleetAlertRow,
  type FleetDailyPoint,
  type FleetNotificationRow,
  type FleetTotals,
  type FleetVehicleIdentity,
} from "@/lib/fleetEdgeReport.types";

// ── Types (wire shape of the report endpoint) ───────────────────────────
type VehicleRow = VehicleDashboardRow & { identity: FleetVehicleIdentity | null };
type Report = {
  ok: true;
  from: string;
  to: string;
  generatedAt: string;
  kpis: Record<FleetBucket, number>;
  totals: FleetTotals;
  vehicles: VehicleRow[];
  daily: FleetDailyPoint[];
  alerts: FleetAlertRow[];
  offlineHistory: OfflinePeriod[];
  notifications: FleetNotificationRow[];
  notifyMobiles: string[];
};

type Tab = "overview" | "vehicles" | "alerts" | "notifications" | "offline" | "health" | "director";
const TABS: ModuleTabItem[] = [
  { id: "overview", label: "Overview", tone: "teal" },
  { id: "vehicles", label: "Vehicles", tone: "navy" },
  { id: "alerts", label: "Alerts", tone: "rose" },
  { id: "notifications", label: "Notifications", tone: "amber" },
  { id: "offline", label: "Offline history", tone: "slate" },
  { id: "health", label: "Vehicle health", tone: "violet" },
  { id: "director", label: "Director's report", tone: "amber" },
];

type Preset = "today" | "7d" | "30d" | "month" | "lastMonth" | "custom";
const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "month", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "custom", label: "Custom" },
];

// ── Helpers ─────────────────────────────────────────────────────────────
function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function presetBounds(p: Preset): { fromDate: string; toDate: string } {
  const now = new Date();
  const today = ymd(now);
  if (p === "today") return { fromDate: today, toDate: today };
  if (p === "7d") return { fromDate: ymd(new Date(now.getTime() - 6 * 86400000)), toDate: today };
  if (p === "30d") return { fromDate: ymd(new Date(now.getTime() - 29 * 86400000)), toDate: today };
  if (p === "month") return { fromDate: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), toDate: today };
  if (p === "lastMonth") {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { fromDate: ymd(first), toDate: ymd(last) };
  }
  return { fromDate: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), toDate: today };
}
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function fmtDuration(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}
function n1(v: number | null | undefined, unit = ""): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 10) / 10}${unit}`;
}
function vehicleLabel(v: { registrationNumber: string | null; vehicleRef: string; identity?: FleetVehicleIdentity | null }): string {
  const reg = v.registrationNumber && v.registrationNumber !== "NA" ? v.registrationNumber : null;
  const model = v.identity?.model || null;
  if (reg && model) return `${reg} · ${model}`;
  return reg || model || v.vehicleRef;
}
const ALERT_LABEL: Record<string, string> = {
  PanicSosEvent: "SOS (panic button)",
  DriverSOSAlert: "SOS (driver)",
  OverSpeedEvent: "Over-speed",
  FuelDrainAlert: "Fuel drain",
  RefuelAlert: "Refuel",
  GeoFenceEntered: "Geofence entered",
  GeoFenceExited: "Geofence exited",
};
function alertLabel(name: string) {
  return ALERT_LABEL[name] || name;
}
function bucketLabel(b: FleetBucket): string {
  return b === "high" ? "High" : b === "average" ? "Average" : b === "low" ? "Low" : "Offline";
}
function chip(kind: "critical" | "warning" | "info" | "ok" | "muted", text: string) {
  const cls =
    kind === "critical"
      ? "bg-[var(--danger-soft)] text-[var(--danger)]"
      : kind === "warning"
        ? "bg-[var(--warning-soft,var(--surface-sunken))] text-[var(--warning,var(--brand-deep))]"
        : kind === "ok"
          ? "bg-[var(--success-soft)] text-[var(--success)]"
          : kind === "info"
            ? "bg-[var(--brand-deep)]/10 text-[var(--brand-deep)]"
            : "bg-[var(--surface-sunken)] text-[var(--muted)]";
  return <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-black uppercase ${cls}`}>{text}</span>;
}
function mapsHref(lat: number | null, lng: number | null) {
  return lat != null && lng != null ? `https://maps.google.com/?q=${lat},${lng}` : null;
}

// ── Component ───────────────────────────────────────────────────────────
export function FleetEdgeReport({ canEdit }: { canEdit: boolean }) {
  const [preset, setPreset] = useState<Preset>("month");
  const [fromDate, setFromDate] = useState(() => presetBounds("month").fromDate);
  const [toDate, setToDate] = useState(() => presetBounds("month").toDate);
  const [vehicleFilter, setVehicleFilter] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Alerts: selection, view, delete
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<FleetAlertRow | null>(null);
  const [viewPayload, setViewPayload] = useState<unknown>(null);
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [alertTypeFilter, setAlertTypeFilter] = useState<string>("");

  // Identity edit
  const [identityDrafts, setIdentityDrafts] = useState<Record<string, { model: string; year: string }>>({});
  const [identitySaving, setIdentitySaving] = useState<string | null>(null);

  // Director's report
  const [report, setReport] = useState<{ headline: string; highlights: string[] } | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const from = new Date(`${fromDate}T00:00:00`).toISOString();
      const to = new Date(`${toDate}T23:59:59`).toISOString();
      const qs = new URLSearchParams({ from, to });
      if (vehicleFilter) qs.set("vehicleRef", vehicleFilter);
      const res = await fetch(`/api/transport/fleet-edge/dashboard?${qs}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as Report | { error?: string };
      if (!res.ok || !("ok" in json) || !json.ok) {
        setError(("error" in json && json.error) || `Could not load Fleet Edge report (HTTP ${res.status})`);
        return;
      }
      setData(json);
      setSelected(new Set());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, vehicleFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  function applyPreset(p: Preset) {
    setPreset(p);
    if (p === "custom") return;
    const b = presetBounds(p);
    setFromDate(b.fromDate);
    setToDate(b.toDate);
  }

  const vehicles = useMemo(() => data?.vehicles ?? [], [data]);
  const totals = data?.totals;
  const nowMs = Date.now();

  // ── Attention strip: what needs a human right now ─────────────────────
  const attention = useMemo(() => {
    if (!data) return [] as { kind: "critical" | "warning" | "info"; text: string; tab: Tab }[];
    const items: { kind: "critical" | "warning" | "info"; text: string; tab: Tab }[] = [];
    const sos24 = data.alerts.filter((a) => a.severity === "critical" && nowMs - Date.parse(a.at) < 86400000);
    if (sos24.length > 0) {
      const byV = new Map<string, number>();
      for (const a of sos24) byV.set(a.registrationNumber || a.vehicleRef, (byV.get(a.registrationNumber || a.vehicleRef) || 0) + 1);
      items.push({
        kind: "critical",
        text: `${sos24.length} SOS alert${sos24.length === 1 ? "" : "s"} in the last 24 h — ${[...byV.entries()].map(([v, c]) => `${v} ×${c}`).join(", ")}`,
        tab: "alerts",
      });
    }
    const ongoing = data.offlineHistory.filter((p) => p.to === null);
    if (ongoing.length > 0) {
      items.push({
        kind: "warning",
        text: `${ongoing.length} vehicle${ongoing.length === 1 ? "" : "s"} offline now — ${ongoing.map((p) => `${p.registrationNumber || p.vehicleRef} (${fmtDuration(p.durationMs)})`).join(", ")}`,
        tab: "offline",
      });
    }
    const crit = vehicles.filter((v) => v.faultCritical > 0);
    if (crit.length > 0) {
      items.push({ kind: "critical", text: `Critical fault codes on ${crit.map(vehicleLabel).join(", ")}`, tab: "health" });
    }
    const due = vehicles.filter((v) => isServiceDue(v.serviceDue));
    if (due.length > 0) {
      items.push({ kind: "warning", text: `Service due: ${due.map((v) => `${vehicleLabel(v)} (${v.serviceDue})`).join(", ")}`, tab: "health" });
    }
    const lowFuel = vehicles.filter((v) => v.lastTelemetry?.fuelLevelPercent != null && v.lastTelemetry.fuelLevelPercent < 15);
    if (lowFuel.length > 0) {
      items.push({ kind: "warning", text: `Low fuel: ${lowFuel.map((v) => `${vehicleLabel(v)} ${v.lastTelemetry?.fuelLevelPercent}%`).join(", ")}`, tab: "vehicles" });
    }
    const failedNotif = data.notifications.filter((n) => n.status === "failed" && nowMs - Date.parse(n.createdAt) < 7 * 86400000);
    if (failedNotif.length > 0) {
      items.push({ kind: "warning", text: `${failedNotif.length} escalation message${failedNotif.length === 1 ? "" : "s"} failed to send in the last 7 days`, tab: "notifications" });
    }
    if (data.totals.vehicles > 0 && data.totals.telemetryVehicles === 0) {
      items.push({
        kind: "info",
        text: "Odometer, live GPS and fuel level are not available yet: Tata Fleet Edge has not enabled the Basic Push (telemetry) feed for these vehicles — only the 30-minute summaries and alerts are arriving. Ask Fleet Edge support to subscribe the fleet's Basic Push webhook to /api/transport/fleet-edge/live.",
        tab: "vehicles",
      });
    }
    if (data.notifyMobiles.length === 0) {
      items.push({ kind: "info", text: "No SOS escalation number is configured (FLEET_EDGE_SOS_NOTIFY_MOBILE) — SOS alerts are recorded but nobody is messaged", tab: "notifications" });
    }
    return items;
  }, [data, vehicles, nowMs]);

  // ── Chart rows ────────────────────────────────────────────────────────
  const daily = data?.daily ?? [];
  const distanceRows: ErpChartRow[] = daily.map((d) => ({ key: d.day, label: d.label, value: Math.round(d.distanceKm * 10) / 10 }));
  const harshRows: ErpChartRow[] = daily.map((d) => ({ key: d.day, label: d.label, value: d.harshEvents }));
  const speedRows: ErpChartRow[] = daily.filter((d) => d.avgSpeed != null).map((d) => ({ key: d.day, label: d.label, value: Math.round((d.avgSpeed || 0) * 10) / 10 }));
  const alertsByDayRows: ErpChartRow[] = daily.map((d) => ({ key: d.day, label: d.label, value: d.alerts, color: d.sos > 0 ? "var(--danger)" : undefined }));
  const alertTypeRows: ErpChartRow[] = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of data?.alerts ?? []) m.set(a.alertName, (m.get(a.alertName) || 0) + 1);
    return [...m.entries()].map(([k, v]) => ({ key: k, label: alertLabel(k), value: v }));
  }, [data]);
  const scoreRows: ErpChartRow[] = vehicles
    .filter((v) => v.score != null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .map((v) => ({
      key: v.vehicleRef,
      label: v.registrationNumber && v.registrationNumber !== "NA" ? v.registrationNumber : v.vehicleRef.slice(-6),
      value: v.score ?? 0,
      color: v.bucket === "low" ? "var(--danger)" : v.bucket === "average" ? "var(--chart-3)" : "var(--success)",
    }));
  const kmByVehicleRows: ErpChartRow[] = vehicles
    .filter((v) => v.distanceTravelledKm > 0)
    .sort((a, b) => b.distanceTravelledKm - a.distanceTravelledKm)
    .map((v) => ({ key: v.vehicleRef, label: v.registrationNumber && v.registrationNumber !== "NA" ? v.registrationNumber : v.vehicleRef.slice(-6), value: Math.round(v.distanceTravelledKm) }));

  // ── Alerts table ──────────────────────────────────────────────────────
  const alertRows = useMemo(
    () => (data?.alerts ?? []).filter((a) => !alertTypeFilter || a.alertName === alertTypeFilter),
    [data, alertTypeFilter],
  );
  const alertTypes = useMemo(() => [...new Set((data?.alerts ?? []).map((a) => a.alertName))].sort(), [data]);
  const allSelected = alertRows.length > 0 && alertRows.every((a) => selected.has(a.id));

  async function openView(a: FleetAlertRow) {
    setViewing(a);
    setViewPayload(null);
    try {
      const res = await fetch(`/api/transport/fleet-edge/events?id=${encodeURIComponent(a.id)}&limit=1`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { events?: { payload?: unknown }[] };
      setViewPayload(json.events?.[0]?.payload ?? { note: "Payload not found" });
    } catch (e) {
      setViewPayload({ error: String(e) });
    }
  }

  async function deleteIds(ids: string[]) {
    const res = await fetch("/api/transport/fleet-edge/events", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, reason: "Removed from Fleet Edge report" }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; deleted?: number; error?: string };
    if (!res.ok || !json.ok) {
      pushToast({ kind: "error", message: `Delete failed: ${json.error || `HTTP ${res.status}`}` });
      return;
    }
    pushToast({ kind: "success", message: `Deleted ${json.deleted ?? ids.length} alert${(json.deleted ?? ids.length) === 1 ? "" : "s"}` });
    setViewing(null);
    await load();
  }

  async function saveIdentity(v: VehicleRow) {
    const draft = identityDrafts[v.vehicleRef];
    const model = (draft?.model ?? v.identity?.model ?? "").trim();
    const yearStr = draft?.year ?? (v.identity?.year != null ? String(v.identity.year) : "");
    const year = yearStr.trim() ? Number(yearStr.trim()) : null;
    setIdentitySaving(v.vehicleRef);
    try {
      const res = await fetch("/api/transport/fleet-edge/vehicle-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vin: v.vehicleRef, registrationNumber: v.registrationNumber, model: model || null, year }),
      });
      if (!res.ok) {
        pushToast({ kind: "error", message: `Could not save vehicle details (HTTP ${res.status})` });
        return;
      }
      setData((prev) =>
        prev
          ? { ...prev, vehicles: prev.vehicles.map((row) => (row.vehicleRef === v.vehicleRef ? { ...row, identity: { model: model || null, year, name: row.identity?.name ?? null } } : row)) }
          : prev,
      );
      setIdentityDrafts((prev) => {
        const next = { ...prev };
        delete next[v.vehicleRef];
        return next;
      });
      pushToast({ kind: "success", message: `Saved details for ${vehicleLabel(v)}` });
    } finally {
      setIdentitySaving(null);
    }
  }

  async function generateDirectorReport() {
    if (!data) return;
    setReportLoading(true);
    setReportError(null);
    try {
      const worst = data.vehicles.filter((v) => v.bucket !== "offline").sort((a, b) => (a.score ?? 100) - (b.score ?? 100)).slice(0, 5);
      const res = await fetch("/api/ai/fleet-director-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: data.from,
          to: data.to,
          kpis: data.kpis,
          total: data.vehicles.length,
          topVehicles: worst.map((v) => ({
            label: vehicleLabel(v),
            score: v.score,
            bucket: v.bucket,
            haCount: v.haCount,
            hbCount: v.hbCount,
            rtCount: v.rtCount,
            overSpeedCount: v.overSpeedCount,
            sosCount: v.sosCount,
            faultCritical: v.faultCritical,
            distanceTravelledKm: v.distanceTravelledKm,
          })),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; headline?: string; highlights?: string[]; error?: string };
      if (!json.ok || !json.headline || !json.highlights) {
        setReportError(json.error || "Report generation failed");
        return;
      }
      setReport({ headline: json.headline, highlights: json.highlights });
    } catch (e) {
      setReportError(String(e));
    } finally {
      setReportLoading(false);
    }
  }

  function exportSummary() {
    if (!data) return;
    const headers = ["Vehicle", "VIN", "Model", "Status", "Score", "Distance km", "Fuel L", "km/L", "Avg speed", "Harsh accel", "Harsh brake", "Rash turn", "Over-speed", "SOS", "Critical faults", "Warnings", "Service due", "Odometer", "Last seen"];
    downloadExcelCsv({
      title: `Fleet Edge report ${fromDate} to ${toDate}`,
      fileBaseName: `fleet-edge-report-${fromDate}-${toDate}`,
      columns: headers.map((h) => ({ key: h, header: h })),
      rows: data.vehicles.map((v) => {
        const spd = averageSpeed(v);
        const cells: (string | number | null)[] = [
          v.registrationNumber || "", v.vehicleRef, v.identity?.model || "", bucketLabel(v.bucket), v.score ?? "",
          Math.round(v.distanceTravelledKm * 10) / 10, Math.round(v.fuelConsumed * 10) / 10,
          v.fuelConsumed > 0 ? Math.round((v.distanceTravelledKm / v.fuelConsumed) * 10) / 10 : "",
          spd != null ? Math.round(spd * 10) / 10 : "",
          v.haCount, v.hbCount, v.rtCount, v.overSpeedCount, v.sosCount, v.faultCritical, v.faultWarning, v.serviceDue || "", v.lastTelemetry?.odometer ?? "", fmtDateTime(v.lastSeenAt),
        ];
        return Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
      }),
    });
  }

  // ── Columns ───────────────────────────────────────────────────────────
  const vehicleCols: DataTableColumn<VehicleRow>[] = [
    { key: "vehicle", header: "Vehicle", sortable: true, value: (v) => vehicleLabel(v), render: (v) => (
      <div>
        <div className="font-semibold">{v.registrationNumber && v.registrationNumber !== "NA" ? v.registrationNumber : <span className="text-[var(--muted)]">No reg. yet</span>}</div>
        <div className="text-[11px] text-[var(--muted)]">{v.vehicleRef}</div>
      </div>
    ) },
    { key: "model", header: "Model / year", className: "min-w-[420px]", render: (v) => canEdit ? (
      <div className="flex items-center gap-2">
        <input className={`${field} h-9 w-52 min-w-[13rem] text-sm`} placeholder="Model (e.g. Starbus 32)" title="Vehicle model" value={identityDrafts[v.vehicleRef]?.model ?? v.identity?.model ?? ""} onChange={(e) => setIdentityDrafts((p) => ({ ...p, [v.vehicleRef]: { model: e.target.value, year: p[v.vehicleRef]?.year ?? (v.identity?.year != null ? String(v.identity.year) : "") } }))} />
        <input className={`${field} h-9 w-24 min-w-[6rem] text-sm tabular-nums`} placeholder="Year" title="Year of manufacture" inputMode="numeric" maxLength={4} value={identityDrafts[v.vehicleRef]?.year ?? (v.identity?.year != null ? String(v.identity.year) : "")} onChange={(e) => setIdentityDrafts((p) => ({ ...p, [v.vehicleRef]: { model: p[v.vehicleRef]?.model ?? v.identity?.model ?? "", year: e.target.value } }))} />
        <Button size="sm" variant={identityDrafts[v.vehicleRef] ? "default" : "outline"} disabled={identitySaving === v.vehicleRef || !identityDrafts[v.vehicleRef]} onClick={() => void saveIdentity(v)}>{identitySaving === v.vehicleRef ? "Saving…" : "Save"}</Button>
      </div>
    ) : <span>{v.identity?.model || "—"}{v.identity?.year ? ` (${v.identity.year})` : ""}</span>, value: (v) => v.identity?.model || "" },
    { key: "status", header: "Status", sortable: true, value: (v) => v.bucket, render: (v) => chip(v.bucket === "offline" ? "muted" : v.bucket === "low" ? "critical" : v.bucket === "average" ? "warning" : "ok", bucketLabel(v.bucket)) },
    { key: "score", header: "Score", align: "right", sortable: true, value: (v) => v.score, render: (v) => <span className="tabular-nums font-semibold">{v.score ?? "—"}</span> },
    { key: "km", header: "Distance", align: "right", sortable: true, value: (v) => v.distanceTravelledKm, render: (v) => <span className="tabular-nums">{n1(v.distanceTravelledKm, " km")}</span> },
    { key: "fuel", header: "Fuel", align: "right", sortable: true, value: (v) => v.fuelConsumed, render: (v) => <span className="tabular-nums">{v.fuelConsumed > 0 ? `${n1(v.fuelConsumed, " L")} · ${n1(v.distanceTravelledKm / v.fuelConsumed, " km/L")}` : "—"}</span> },
    { key: "speed", header: "Avg speed", align: "right", sortable: true, value: (v) => averageSpeed(v), render: (v) => <span className="tabular-nums">{n1(averageSpeed(v), " km/h")}</span> },
    { key: "harsh", header: "HA / HB / RT", align: "right", sortable: true, value: (v) => v.haCount + v.hbCount + v.rtCount, render: (v) => <span className="tabular-nums">{v.haCount} / {v.hbCount} / {v.rtCount}</span> },
    { key: "overspeed", header: "Over-speed", align: "right", sortable: true, value: (v) => v.overSpeedCount, render: (v) => <span className="tabular-nums">{v.overSpeedCount}</span> },
    { key: "sos", header: "SOS", align: "right", sortable: true, value: (v) => v.sosCount, render: (v) => v.sosCount > 0 ? chip("critical", String(v.sosCount)) : <span className="text-[var(--muted)]">0</span> },
    { key: "faults", header: "Faults", align: "right", sortable: true, value: (v) => v.faultCritical * 100 + v.faultWarning, render: (v) => <span className="tabular-nums">{v.faultCritical > 0 ? chip("critical", `${v.faultCritical} crit`) : null} {v.faultWarning > 0 ? chip("warning", `${v.faultWarning} warn`) : null}{v.faultCritical + v.faultWarning === 0 ? <span className="text-[var(--muted)]">—</span> : null}</span> },
    { key: "service", header: "Service", sortable: true, value: (v) => v.serviceDue || "", render: (v) => isServiceDue(v.serviceDue) ? chip("warning", v.serviceDue || "Due") : v.serviceDue && v.serviceDue.toLowerCase() === "not due" ? chip("ok", "Not due") : <span className="text-[var(--muted)]">—</span> },
    { key: "odo", header: "Odometer", align: "right", sortable: true, value: (v) => v.lastTelemetry?.odometer ?? null, render: (v) => v.lastTelemetry?.odometer != null ? <span className="tabular-nums">{Math.round(v.lastTelemetry.odometer).toLocaleString("en-IN")} km</span> : <span className="text-[var(--muted)]" title="Odometer comes only in Fleet Edge's Basic Push (telemetry) feed, which this vehicle has not sent yet">—</span> },
    { key: "seen", header: "Last seen", sortable: true, value: (v) => v.lastSeenAt || "", render: (v) => (
      <div className="text-xs">
        <div>{fmtDateTime(v.lastSeenAt)}</div>
        {v.lastTelemetry?.lat != null && v.lastTelemetry.lng != null ? <a className="text-[var(--brand-deep)] underline" href={mapsHref(v.lastTelemetry.lat, v.lastTelemetry.lng) || "#"} target="_blank" rel="noreferrer">map</a> : v.lastOfflinePosition?.lat != null ? <a className="text-[var(--brand-deep)] underline" href={mapsHref(v.lastOfflinePosition.lat, v.lastOfflinePosition.lng) || "#"} target="_blank" rel="noreferrer">last parked</a> : null}
      </div>
    ) },
  ];

  const alertCols: DataTableColumn<FleetAlertRow>[] = [
    ...(canEdit ? [{
      key: "sel",
      header: <input type="checkbox" aria-label="Select all alerts" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(alertRows.map((a) => a.id)) : new Set())} />,
      render: (a: FleetAlertRow) => <input type="checkbox" aria-label={`Select alert ${a.id}`} checked={selected.has(a.id)} onChange={(e) => setSelected((prev) => { const n = new Set(prev); if (e.target.checked) n.add(a.id); else n.delete(a.id); return n; })} />,
      className: "w-8",
    } as DataTableColumn<FleetAlertRow>] : []),
    { key: "at", header: "When", sortable: true, value: (a) => a.at, render: (a) => <span className="whitespace-nowrap tabular-nums">{fmtDateTime(a.at)}</span> },
    { key: "vehicle", header: "Vehicle", sortable: true, value: (a) => a.registrationNumber || a.vehicleRef, render: (a) => <span className="font-semibold">{a.registrationNumber && a.registrationNumber !== "NA" ? a.registrationNumber : a.vehicleRef}</span> },
    { key: "type", header: "Alert", sortable: true, value: (a) => a.alertName, render: (a) => chip(a.severity === "critical" ? "critical" : a.severity === "warning" ? "warning" : "info", alertLabel(a.alertName)) },
    { key: "detail", header: "Details", render: (a) => (
      <span className="text-xs">
        {a.maxSpeed != null ? `${a.maxSpeed} km/h` : ""}{a.duration != null ? ` for ${a.duration}s` : ""}
        {a.fuelDifference != null ? `${a.fuelDifference} L${a.fuelTank ? ` (${a.fuelTank})` : ""}` : ""}
      </span>
    ) },
    { key: "location", header: "Location", value: (a) => a.location || "", render: (a) => (
      <span className="text-xs">
        {a.location ? <span title={a.location}>{a.location.length > 60 ? `${a.location.slice(0, 60)}…` : a.location}</span> : "—"}
        {mapsHref(a.lat, a.lng) ? <> · <a className="text-[var(--brand-deep)] underline" href={mapsHref(a.lat, a.lng) || "#"} target="_blank" rel="noreferrer"><MapPin className="inline size-3" aria-hidden /> map</a></> : null}
      </span>
    ) },
    { key: "actions", header: "", align: "right", render: (a) => (
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => void openView(a)} aria-label="View alert"><Eye className="size-4" aria-hidden /></Button>
        {canEdit ? <Button size="sm" variant="ghost" onClick={() => setConfirmIds([a.id])} aria-label="Delete alert"><Trash2 className="size-4 text-[var(--danger)]" aria-hidden /></Button> : null}
      </div>
    ) },
  ];

  const notifCols: DataTableColumn<FleetNotificationRow>[] = [
    { key: "at", header: "When", sortable: true, value: (r) => r.createdAt, render: (r) => <span className="whitespace-nowrap tabular-nums">{fmtDateTime(r.createdAt)}</span> },
    { key: "vehicle", header: "Vehicle", sortable: true, value: (r) => r.registrationNumber || r.vehicleRef || "", render: (r) => r.registrationNumber && r.registrationNumber !== "NA" ? r.registrationNumber : (r.vehicleRef || "—") },
    { key: "alert", header: "Trigger", sortable: true, value: (r) => r.alertName, render: (r) => alertLabel(r.alertName) === r.alertName && r.alertName === "TrackerFirstSeen" ? "Tracker first seen" : alertLabel(r.alertName) },
    { key: "to", header: "Sent to", value: (r) => r.recipient, render: (r) => <span className="tabular-nums">{r.recipient}</span> },
    { key: "status", header: "Status", sortable: true, value: (r) => r.status, render: (r) => chip(r.status === "sent" ? "ok" : r.status === "failed" ? "critical" : r.status === "suppressed" ? "muted" : "warning", r.status) },
    { key: "detail", header: "Note", render: (r) => <span className="text-xs text-[var(--muted)]">{r.detail || (r.body ? r.body.slice(0, 80) : "")}</span> },
  ];

  const offlineCols: DataTableColumn<OfflinePeriod>[] = [
    { key: "vehicle", header: "Vehicle", sortable: true, value: (p) => p.registrationNumber || p.vehicleRef, render: (p) => <span className="font-semibold">{p.registrationNumber && p.registrationNumber !== "NA" ? p.registrationNumber : p.vehicleRef}</span> },
    { key: "from", header: "Went offline", sortable: true, value: (p) => p.from, render: (p) => fmtDateTime(p.from) },
    { key: "to", header: "Back online", sortable: true, value: (p) => p.to || "", render: (p) => p.to ? fmtDateTime(p.to) : chip("critical", "Ongoing") },
    { key: "dur", header: "Offline for", align: "right", sortable: true, value: (p) => p.durationMs, render: (p) => <span className="tabular-nums">{fmtDuration(p.durationMs)}</span> },
  ];

  const kpiTiles = totals ? [
    { title: "Vehicles online", value: `${totals.online}/${totals.vehicles}`, hint: `${totals.offline} offline (no data 24 h+)`, tone: totals.offline > 0 ? "amber" : "green", icon: totals.offline > 0 ? <WifiOff className="size-5" aria-hidden /> : <Truck className="size-5" aria-hidden /> },
    { title: "Distance", value: n1(totals.distanceKm, " km"), hint: `${totals.eventsInRange} pushes in range`, tone: "sky", icon: <Route className="size-5" aria-hidden /> },
    { title: "Fuel used", value: totals.fuelL > 0 ? n1(totals.fuelL, " L") : "—", hint: totals.kmPerL != null ? `${n1(totals.kmPerL)} km/L` : "Fleet Edge not reporting fuel yet", tone: "navy", icon: <Fuel className="size-5" aria-hidden /> },
    { title: "Avg speed", value: n1(totals.avgSpeed, " km/h"), hint: `${totals.overSpeed} over-speed alert${totals.overSpeed === 1 ? "" : "s"}`, tone: totals.overSpeed > 0 ? "amber" : "sky", icon: <Gauge className="size-5" aria-hidden /> },
    { title: "Harsh driving", value: totals.harshEvents, hint: `${totals.harshAcceleration} accel · ${totals.harshBrake} brake · ${totals.rashTurning} turn`, tone: totals.harshEvents > 20 ? "rose" : totals.harshEvents > 0 ? "amber" : "green", icon: <AlertTriangle className="size-5" aria-hidden /> },
    { title: "SOS alerts", value: totals.sos, hint: totals.sos > 0 ? "Panic button pressed — see Alerts" : "None in range", tone: totals.sos > 0 ? "rose" : "green", icon: <Siren className="size-5" aria-hidden /> },
    { title: "Faults", value: `${totals.faultCritical} / ${totals.faultWarning}`, hint: "critical / warning codes", tone: totals.faultCritical > 0 ? "rose" : totals.faultWarning > 0 ? "amber" : "green", icon: <ShieldAlert className="size-5" aria-hidden /> },
    { title: "Service due", value: totals.serviceDue, hint: totals.serviceDue > 0 ? "vehicle(s) reporting service due" : "All vehicles: not due", tone: totals.serviceDue > 0 ? "amber" : "green", icon: <Wrench className="size-5" aria-hidden /> },
  ] as const : [];

  return (
    <div className="space-y-4">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <ErpPanel>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => applyPreset(p.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${preset === p.id ? "bg-[var(--brand-deep)] text-white" : "bg-[var(--surface-sunken)] text-[var(--muted)] hover:text-[var(--foreground)]"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <label className="text-xs">From<input type="date" className={`${field} mt-1 h-8`} value={fromDate} onChange={(e) => { setPreset("custom"); setFromDate(e.target.value); }} /></label>
          <label className="text-xs">To<input type="date" className={`${field} mt-1 h-8`} value={toDate} onChange={(e) => { setPreset("custom"); setToDate(e.target.value); }} /></label>
          <label className="text-xs">Vehicle
            <select className={`${field} mt-1 h-8 w-44`} value={vehicleFilter} onChange={(e) => setVehicleFilter(e.target.value)}>
              <option value="">All vehicles</option>
              {vehicles.map((v) => <option key={v.vehicleRef} value={v.vehicleRef}>{vehicleLabel(v)}</option>)}
            </select>
          </label>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-[var(--muted)]"><input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} /> Auto-refresh (1 min)</label>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden /> {loading ? "Loading…" : "Refresh"}</Button>
            <Button variant="outline" size="sm" onClick={exportSummary} disabled={!data}><Download className="size-4" aria-hidden /> Export summary</Button>
          </div>
        </div>
        {data ? <p className="mt-2 text-[11px] text-[var(--muted)]">Report window {fmtDateTime(data.from)} → {fmtDateTime(data.to)} · generated {fmtDateTime(data.generatedAt)} · {data.totals.eventsTotal} events stored in total</p> : null}
      </ErpPanel>

      {error ? <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p> : null}

      {/* ── Attention strip ─────────────────────────────────────────── */}
      {attention.length > 0 ? (
        <div className="space-y-1.5">
          {attention.map((a, i) => (
            <button key={i} type="button" onClick={() => setTab(a.tab)}
              className={`flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left text-sm ${a.kind === "critical" ? "border-[var(--danger)]/30 bg-[var(--danger-soft)] text-[var(--danger)]" : a.kind === "warning" ? "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)]" : "border-[var(--border)] bg-[var(--surface-sunken)] text-[var(--muted)]"}`}>
              {a.kind === "critical" ? <Siren className="mt-0.5 size-4 shrink-0" aria-hidden /> : a.kind === "warning" ? <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> : <Bell className="mt-0.5 size-4 shrink-0" aria-hidden />}
              <span>{a.text}</span>
            </button>
          ))}
        </div>
      ) : data && !loading ? (
        <p className="rounded-xl border border-[var(--success)]/25 bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]">Nothing needs attention right now — no SOS in 24 h, no vehicle offline, no critical faults.</p>
      ) : null}

      {/* ── KPI tiles ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpiTiles.map((k) => <ErpMetricCard key={k.title} title={k.title} value={k.value} hint={k.hint} tone={k.tone} icon={k.icon} />)}
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <ModuleTabs value={tab} onChange={(id) => setTab(id as Tab)} items={TABS} />

      {vehicles.length === 0 && !loading ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">No vehicle has reported Fleet Edge data in the last 30 days.</p>
      ) : null}

      {tab === "overview" ? (
        <div className="space-y-4">
          <ErpChartGrid cols={3}>
            <ErpChartCard title="Distance per day (km)"><ErpBar rows={distanceRows} valueFormatter={(v) => `${v} km`} emptyLabel="No distance reported in range" /></ErpChartCard>
            <ErpChartCard title="Harsh driving events per day"><ErpBar rows={harshRows} color="var(--chart-3)" emptyLabel="No harsh events in range" /></ErpChartCard>
            <ErpChartCard title="Average speed per day (km/h)"><ErpArea rows={speedRows} color="var(--chart-2)" valueFormatter={(v) => `${v} km/h`} emptyLabel="No speed samples in range" /></ErpChartCard>
          </ErpChartGrid>
          <ErpChartGrid cols={3}>
            <ErpChartCard title="Alerts per day (red = includes SOS)"><ErpBar rows={alertsByDayRows} color="var(--chart-4)" emptyLabel="No alerts in range" /></ErpChartCard>
            <ErpChartCard title="Alerts by type"><ErpDonut rows={alertTypeRows} centerLabel="alerts" centerValue={String(data?.alerts.length ?? 0)} emptyLabel="No alerts in range" /></ErpChartCard>
            <ErpChartCard title="Performance score by vehicle"><ErpBar rows={scoreRows} valueFormatter={(v) => `${v}/100`} emptyLabel="No scored vehicles (all offline?)" /></ErpChartCard>
          </ErpChartGrid>
          <ErpChartGrid cols={2}>
            <ErpChartCard title="Distance by vehicle (km)"><ErpBar rows={kmByVehicleRows} color="var(--chart-5)" valueFormatter={(v) => `${v} km`} emptyLabel="No distance reported in range" /></ErpChartCard>
            <ErpChartCard title="How the score works">
              <ul className="space-y-1 text-xs text-[var(--muted)]">
                <li>Starts at 100 for every online vehicle; deductions for harsh accel/brake/turn, over-speed, SOS, fault codes, incidents, fuel drain and excessive idling — each capped so one bad category can&apos;t zero the score.</li>
                <li><b>High</b> = above the 60th percentile of the online fleet · <b>Average</b> = 40th–60th · <b>Low</b> = below 40th · <b>Offline</b> = no data for 24 h+ (not ranked).</li>
                <li>Counts and distances are bounded to the selected range; online/offline and last position are live status.</li>
              </ul>
            </ErpChartCard>
          </ErpChartGrid>
        </div>
      ) : null}

      {tab === "vehicles" ? (
        <ErpPanel title="Vehicle summary" description="One row per vehicle for the selected range. Sort any column; export as CSV.">
          <DataTable columns={vehicleCols} rows={vehicles} rowKey={(v) => v.vehicleRef} loading={loading} minWidth="min-w-[1400px]" exportFileBaseName={`fleet-vehicles-${fromDate}-${toDate}`} exportTitle="Fleet Edge vehicles" emptyTitle="No vehicles" />
        </ErpPanel>
      ) : null}

      {tab === "alerts" ? (
        <ErpPanel title="Alert log" description="Every TimeBound Push alert in range — SOS, over-speed, fuel drain/refuel, geofence. View the full payload or remove test / duplicate pushes.">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select className={`${field} h-8 w-48`} value={alertTypeFilter} onChange={(e) => setAlertTypeFilter(e.target.value)}>
              <option value="">All alert types</option>
              {alertTypes.map((t) => <option key={t} value={t}>{alertLabel(t)}</option>)}
            </select>
            <span className="text-xs text-[var(--muted)]">{alertRows.length} alert{alertRows.length === 1 ? "" : "s"}</span>
            {canEdit && selected.size > 0 ? (
              <Button size="sm" variant="destructive" className="ml-auto" onClick={() => setConfirmIds([...selected])}><Trash2 className="size-4" aria-hidden /> Delete {selected.size} selected</Button>
            ) : null}
          </div>
          <DataTable columns={alertCols} rows={alertRows} rowKey={(a) => a.id} loading={loading} minWidth="min-w-[900px]" exportFileBaseName={`fleet-alerts-${fromDate}-${toDate}`} exportTitle="Fleet Edge alerts" emptyTitle="No alerts in range" />
        </ErpPanel>
      ) : null}

      {tab === "notifications" ? (
        <div className="space-y-4">
          <ErpPanel title="Escalation settings" description="Who the ERP messages on WhatsApp when a driver presses the SOS button.">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Bell className="size-4 text-[var(--brand-deep)]" aria-hidden />
              {data?.notifyMobiles.length ? (
                <>SOS escalation goes to <b>{data.notifyMobiles.join(", ")}</b> · one message per vehicle per 10 minutes; repeats are logged as <i>suppressed</i>.</>
              ) : (
                <span className="text-[var(--danger)]">No escalation number configured — set <code>FLEET_EDGE_SOS_NOTIFY_MOBILE</code> on the server. SOS alerts are still recorded below.</span>
              )}
            </div>
          </ErpPanel>
          <ErpPanel title="Notification log" description="Every escalation attempt: sent, failed, suppressed (cooldown) or skipped (no number configured).">
            <DataTable columns={notifCols} rows={data?.notifications ?? []} rowKey={(r) => r.id} loading={loading} minWidth="min-w-[820px]" exportFileBaseName="fleet-notifications" exportTitle="Fleet Edge notifications" emptyTitle="No notifications yet" emptyDescription="Appears when an SOS alert is escalated or a new tracker is first seen." />
          </ErpPanel>
        </div>
      ) : null}

      {tab === "offline" ? (
        <ErpPanel title="Offline history (last 30 days)" description="Gaps of 24 h+ with no push of any kind from the vehicle. A parked bus over a weekend can legitimately show here.">
          <DataTable columns={offlineCols} rows={data?.offlineHistory ?? []} rowKey={(p) => `${p.vehicleRef}-${p.from}`} loading={loading} minWidth="min-w-[640px]" exportFileBaseName="fleet-offline-history" exportTitle="Fleet Edge offline history" emptyTitle="No offline periods in the last 30 days" />
        </ErpPanel>
      ) : null}

      {tab === "health" ? (
        <div className="space-y-3">
          {vehicles.map((v) => {
            const load = averageEngineLoad(v);
            const gsa = averageGsa(v);
            return (
              <ErpPanel key={v.vehicleRef} title={vehicleLabel(v)} description={`Service: ${v.serviceDue || "—"} · night driving ${n1(v.nightDrivingSeconds / 3600, " h")} · idling ${n1(v.idlingSeconds / 3600, " h")}${gsa != null ? ` · gear-shift advisor ${n1(gsa)}` : ""}${load ? ` · engine load H/M/L ${n1(load.heavy)}/${n1(load.medium)}/${n1(load.light)}%` : ""}`}>
                {v.faultCritical + v.faultWarning + v.lowEngineOilPressureEvents.length + v.lowFuelAlertCount + v.lowDefAlertCount + v.incidents === 0 ? (
                  <p className="text-sm text-[var(--success)]">No fault codes or health events in range.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {v.faultCriticalDetails.map((f, i) => <li key={`c${i}`}>{chip("critical", "Critical")} {f.description}{f.suggestedAction ? <span className="text-[var(--muted)]"> — {f.suggestedAction}</span> : null}</li>)}
                    {v.faultWarningDetails.map((f, i) => <li key={`w${i}`}>{chip("warning", "Warning")} {f.description}{f.suggestedAction ? <span className="text-[var(--muted)]"> — {f.suggestedAction}</span> : null}</li>)}
                    {v.lowEngineOilPressureEvents.map((e, i) => <li key={`o${i}`}>{chip("critical", "Oil pressure")} {e.description || "Low engine oil pressure"} {e.eventDateTime ? <span className="text-[var(--muted)]">· {fmtDateTime(e.eventDateTime)}</span> : null}</li>)}
                    {v.lowFuelAlertCount > 0 ? <li>{chip("warning", "Low fuel")} {v.lowFuelAlertCount} alert{v.lowFuelAlertCount === 1 ? "" : "s"}</li> : null}
                    {v.lowDefAlertCount > 0 ? <li>{chip("warning", "Low DEF")} {v.lowDefAlertCount} alert{v.lowDefAlertCount === 1 ? "" : "s"}</li> : null}
                    {v.incidents > 0 ? <li>{chip("critical", "Incident")} {v.incidents} reported</li> : null}
                  </ul>
                )}
              </ErpPanel>
            );
          })}
        </div>
      ) : null}

      {tab === "director" ? (
        <ErpPanel title="Director's report" description="A short narrative written from the numbers above (never in place of them). Regenerate after changing the range.">
          <Button variant="outline" size="sm" onClick={() => void generateDirectorReport()} disabled={!data || reportLoading}><Sparkles className="size-4" aria-hidden /> {reportLoading ? "Writing…" : report ? "Regenerate" : "Generate report"}</Button>
          {reportError ? <p className="mt-3 text-sm text-[var(--danger)]">{reportError}</p> : null}
          {report ? (
            <div className="mt-4">
              <p className="text-base font-semibold">{report.headline}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{report.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
            </div>
          ) : null}
        </ErpPanel>
      ) : null}

      {/* ── View dialog ──────────────────────────────────────────────── */}
      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o) { setViewing(null); setViewPayload(null); } }}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{viewing ? `${alertLabel(viewing.alertName)} — ${viewing.registrationNumber && viewing.registrationNumber !== "NA" ? viewing.registrationNumber : viewing.vehicleRef}` : "Alert"}</DialogTitle>
          </DialogHeader>
          {viewing ? (
            <>
              <DialogDescription>
                {fmtDateTime(viewing.at)} · received {fmtDateTime(viewing.receivedAt)}
                {viewing.location ? <><br />{viewing.location}</> : null}
                {mapsHref(viewing.lat, viewing.lng) ? <> · <a className="text-[var(--brand-deep)] underline" href={mapsHref(viewing.lat, viewing.lng) || "#"} target="_blank" rel="noreferrer">open in Google Maps</a></> : null}
              </DialogDescription>
              <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-[var(--surface-sunken)] p-3 text-[11px] leading-relaxed">{viewPayload == null ? "Loading payload…" : JSON.stringify(viewPayload, null, 2)}</pre>
              {canEdit ? <div className="mt-3 flex justify-end"><Button variant="destructive" size="sm" onClick={() => setConfirmIds([viewing.id])}><Trash2 className="size-4" aria-hidden /> Delete this alert</Button></div> : null}
            </>
          ) : null}
        </DialogPopup>
      </Dialog>

      <ConfirmDialog
        open={!!confirmIds}
        onOpenChange={(o) => { if (!o) setConfirmIds(null); }}
        title={confirmIds && confirmIds.length > 1 ? `Delete ${confirmIds.length} alerts?` : "Delete this alert?"}
        description="The raw Fleet Edge event is removed from the ERP permanently and the deletion is recorded in the audit log. Use this for test pushes and duplicate SOS bursts, not to hide real incidents."
        confirmLabel="Delete"
        onConfirm={async () => { if (confirmIds) await deleteIds(confirmIds); setConfirmIds(null); }}
      />
    </div>
  );
}
