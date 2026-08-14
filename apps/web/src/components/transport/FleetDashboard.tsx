"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, WifiOff } from "lucide-react";
import { ErpMetricCard } from "@/components/ui/erp-roster";
import { dashboardToneToMetric, kpiIconForTone, type DashboardTone } from "@/components/dashboard/ModuleDashboard";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { field } from "@/components/ui/erp-ui";
import {
  averageEngineLoad,
  averageEngineRpm,
  averageGearUtilisation,
  averageGsa,
  type FleetBucket,
  type OfflinePeriod,
  type VehicleDashboardRow,
} from "@/lib/fleetEdgeAnalytics";

type Tab = "live" | "vehicleWise" | "directorReport" | "scorecard" | "health";

const TABS: ModuleTabItem[] = [
  { id: "live", label: "Live", tone: "teal" },
  { id: "vehicleWise", label: "Vehicle wise", tone: "navy" },
  { id: "directorReport", label: "Director's Report", tone: "amber" },
  { id: "scorecard", label: "Driving Scorecard", tone: "rose" },
  { id: "health", label: "Vehicle Health", tone: "violet" },
];

const GEAR_LABELS: Record<string, string> = {
  gear1: "1st", gear2: "2nd", gear3: "3rd", gear4: "4th", gear5: "5th",
  gear6: "6th", gear7: "7th", gear8: "8th", gear9: "9th", gearN: "N", gearR: "R",
};

type VehicleIdentity = { model: string | null; year: number | null; name: string | null } | null;

type VehicleRow = VehicleDashboardRow & { identity: VehicleIdentity };

type DashboardResponse = {
  ok: boolean;
  from: string;
  to: string;
  kpis: Record<FleetBucket, number>;
  total: number;
  vehicles: VehicleRow[];
  offlineHistory: OfflinePeriod[];
  error?: string;
};

/** ms → "2h 15m" / "3d 4h", dropping the smaller unit once the larger one
 * is already double digits so a 9-day gap doesn't read as "9d 14h 32m". */
function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Fleet Edge never sends model/year — prefer what staff have recorded
 * (Vehicle wise tab) over a bare VIN, which is genuinely ambiguous when two
 * buses share a model. */
function vehicleLabel(v: { registrationNumber: string | null; vehicleRef: string; identity?: VehicleIdentity }): string {
  const base = v.registrationNumber || v.vehicleRef;
  const idy = v.identity;
  if (idy?.name) return `${idy.name} (${base})`;
  if (idy?.model) return `${idy.model}${idy.year ? ` ${idy.year}` : ""} — ${base}`;
  return base;
}

function bucketLabel(b: FleetBucket): string {
  if (b === "high") return "High performing";
  if (b === "average") return "Average";
  if (b === "low") return "Low performing";
  return "Offline";
}

function monthOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    out.push({ value, label });
  }
  return out;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Plain YYYY-MM-DD in local calendar terms — deliberately not built via
 * `.toISOString()`, which converts to UTC and rolls the date back a day
 * for any timezone ahead of UTC (e.g. IST), showing "31 Jul" for "August". */
function monthBounds(value: string): { fromDate: string; toDate: string } {
  const [y, m] = value.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { fromDate: `${y}-${pad2(m)}-01`, toDate: `${y}-${pad2(m)}-${pad2(lastDay)}` };
}

export function FleetDashboard() {
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[0]?.value || "");
  const [fromDate, setFromDate] = useState(() => monthBounds(months[0]?.value || "").fromDate);
  const [toDate, setToDate] = useState(() => monthBounds(months[0]?.value || "").toDate);
  const [tab, setTab] = useState<Tab>("live");
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [report, setReport] = useState<{ headline: string; highlights: string[] } | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const [identityDrafts, setIdentityDrafts] = useState<Record<string, { model: string; year: string }>>({});
  const [identitySaving, setIdentitySaving] = useState<string | null>(null);

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
        body: JSON.stringify({
          vin: v.vehicleRef,
          registrationNumber: v.registrationNumber,
          model: model || null,
          year,
        }),
      });
      if (!res.ok) return;
      setData((prev) =>
        prev
          ? {
              ...prev,
              vehicles: prev.vehicles.map((row) =>
                row.vehicleRef === v.vehicleRef
                  ? { ...row, identity: { model: model || null, year, name: row.identity?.name ?? null } }
                  : row,
              ),
            }
          : prev,
      );
      setIdentityDrafts((prev) => {
        const next = { ...prev };
        delete next[v.vehicleRef];
        return next;
      });
    } finally {
      setIdentitySaving(null);
    }
  }

  function applyMonth(value: string) {
    setMonth(value);
    const b = monthBounds(value);
    setFromDate(b.fromDate);
    setToDate(b.toDate);
  }

  async function load() {
    setLoading(true);
    setError(null);
    setReport(null);
    setReportError(null);
    try {
      const from = new Date(`${fromDate}T00:00:00`).toISOString();
      const to = new Date(`${toDate}T23:59:59`).toISOString();
      const res = await fetch(
        `/api/transport/fleet-edge/dashboard?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      const json = (await res.json().catch(() => ({}))) as DashboardResponse;
      if (!res.ok || !json.ok) {
        setError(json.error || `HTTP ${res.status}`);
        setData(null);
        return;
      }
      setData(json);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generateReport() {
    if (!data) return;
    setReportLoading(true);
    setReportError(null);
    try {
      const worst = data.vehicles
        .filter((v) => v.bucket !== "offline")
        .sort((a, b) => (a.score ?? 100) - (b.score ?? 100))
        .slice(0, 5);
      const res = await fetch("/api/ai/fleet-director-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: data.from,
          to: data.to,
          kpis: data.kpis,
          total: data.total,
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
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        headline?: string;
        highlights?: string[];
        error?: string;
      };
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

  const kpiTone = (b: FleetBucket): DashboardTone => {
    if (b === "high") return "green";
    if (b === "average") return "sky";
    if (b === "low") return "rose";
    return "slate";
  };

  const rows = data?.vehicles || [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Month</span>
          <select
            className={`${field} !py-1.5`}
            value={month}
            onChange={(e) => applyMonth(e.target.value)}
          >
            {months.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">From</span>
          <input
            type="date"
            className={`${field} !py-1.5`}
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setMonth("");
            }}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">To</span>
          <input
            type="date"
            className={`${field} !py-1.5`}
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setMonth("");
            }}
          />
        </label>
        <button
          type="button"
          className="btn-accent rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "Loading…" : "Apply"}
        </button>
      </div>

      {error ? (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      <div>
        <p className="mb-2 text-sm font-bold">Vehicle Performance</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ErpMetricCard
            title="High performing"
            value={data?.kpis.high ?? 0}
            hint="Above 60th percentile of the online fleet"
            tone={dashboardToneToMetric(kpiTone("high"))}
            icon={kpiIconForTone(kpiTone("high"))}
          />
          <ErpMetricCard
            title="Average"
            value={data?.kpis.average ?? 0}
            hint="40th–60th percentile"
            tone={dashboardToneToMetric(kpiTone("average"))}
            icon={kpiIconForTone(kpiTone("average"))}
          />
          <ErpMetricCard
            title="Low performing"
            value={data?.kpis.low ?? 0}
            hint="Below 40th percentile"
            tone={dashboardToneToMetric(kpiTone("low"))}
            icon={kpiIconForTone(kpiTone("low"))}
          />
          <ErpMetricCard
            title="Offline"
            value={data?.kpis.offline ?? 0}
            hint="No data in 24h+"
            tone={dashboardToneToMetric(kpiTone("offline"))}
            icon={<WifiOff className="size-5" aria-hidden />}
          />
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-bold">Vehicle Insights</p>
        <ModuleTabs value={tab} onChange={(id) => setTab(id as Tab)} items={TABS} />

        {rows.length === 0 && !loading ? (
          <p className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
            No vehicles have reported Fleet Edge data in the last 30 days yet.
          </p>
        ) : (
          <>
            {tab === "live" ? (
              <ul className="mt-4 space-y-2">
                {rows.map((v) => (
                  <li key={v.vehicleRef} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{vehicleLabel(v)}</span>
                      <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--muted)]">
                        {bucketLabel(v.bucket)}
                      </span>
                    </div>
                    {v.lastTelemetry ? (
                      <>
                        <p className="mt-1 text-sm text-[var(--muted)]">
                          {v.lastTelemetry.lat != null && v.lastTelemetry.lng != null
                            ? `${v.lastTelemetry.lat.toFixed(4)}, ${v.lastTelemetry.lng.toFixed(4)} · `
                            : ""}
                          {v.lastTelemetry.speed != null ? `${v.lastTelemetry.speed} km/h · ` : ""}
                          {v.lastTelemetry.ignitionOn != null
                            ? v.lastTelemetry.ignitionOn ? "ignition on · " : "ignition off · "
                            : ""}
                          {v.lastTelemetry.fuelLevelPercent != null ? `fuel ${v.lastTelemetry.fuelLevelPercent}% · ` : ""}
                          last seen {v.lastTelemetry.at ? new Date(v.lastTelemetry.at).toLocaleString() : "—"}
                        </p>
                        <p className="mt-1 text-sm text-[var(--muted)]">
                          {v.lastTelemetry.currentGear != null ? `gear ${v.lastTelemetry.currentGear} · ` : ""}
                          {v.lastTelemetry.engineRunHour != null ? `engine ${v.lastTelemetry.engineRunHour.toFixed(1)}h · ` : ""}
                          {v.lastTelemetry.vehicleStatus != null ? `${v.lastTelemetry.vehicleStatus} · ` : ""}
                          {v.lastTelemetry.gpsSignalQuality != null ? `GPS ${v.lastTelemetry.gpsSignalQuality}` : ""}
                          {v.lastTelemetry.noOfSatForFix != null ? ` (${v.lastTelemetry.noOfSatForFix} sats)` : ""}
                          {v.lastTelemetry.primaryFuelTankCapacity != null
                            ? ` · tank 1 cap ${v.lastTelemetry.primaryFuelTankCapacity}L`
                            : ""}
                          {v.lastTelemetry.secondaryFuelLevel1 != null
                            ? ` · tank 2 ${v.lastTelemetry.secondaryFuelLevel1}%`
                            : ""}
                          {v.lastTelemetry.imei != null ? ` · IMEI ${v.lastTelemetry.imei}` : ""}
                        </p>
                      </>
                    ) : v.lastOfflinePosition ? (
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        No live telemetry — last known parked position:{" "}
                        {v.lastOfflinePosition.location || `${v.lastOfflinePosition.lat}, ${v.lastOfflinePosition.lng}`}
                        {v.lastOfflinePosition.at ? ` (as of ${new Date(v.lastOfflinePosition.at).toLocaleDateString()})` : ""}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        No live telemetry yet — {v.lastSeenAt ? `last event ${new Date(v.lastSeenAt).toLocaleString()}` : "never reported"}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}

            {tab === "live" ? (
              <div className="mt-4">
                <p className="mb-2 text-sm font-bold">Offline history (last 30 days)</p>
                {(data?.offlineHistory || []).length === 0 ? (
                  <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-4 text-center text-sm text-[var(--muted)]">
                    No offline periods in the last 30 days.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {(data?.offlineHistory || []).map((p, i) => {
                      const v = rows.find((row) => row.vehicleRef === p.vehicleRef);
                      return (
                        <li
                          key={`${p.vehicleRef}-${p.from}-${i}`}
                          className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold">{v ? vehicleLabel(v) : p.registrationNumber || p.vehicleRef}</span>
                            {p.to === null ? (
                              <span className="rounded-full bg-[var(--danger-soft)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--danger)]">
                                Ongoing
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm text-[var(--muted)]">
                            Went offline {new Date(p.from).toLocaleString()}
                            {p.to ? ` · back online ${new Date(p.to).toLocaleString()}` : ""} ·
                            {" "}offline for {formatDuration(p.durationMs)}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : null}

            {tab === "vehicleWise" ? (
              <ul className="mt-4 space-y-2">
                {rows.map((v) => {
                  const load = averageEngineLoad(v);
                  const economy = v.fuelConsumed > 0 ? v.distanceTravelledKm / v.fuelConsumed : null;
                  const gsa = averageGsa(v);
                  const rpm = averageEngineRpm(v);
                  const gears = averageGearUtilisation(v);
                  const topGears = gears
                    ? (Object.entries(gears) as [string, number][])
                        .filter(([, pct]) => pct > 0)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(([k, pct]) => `${GEAR_LABELS[k] || k} ${pct.toFixed(0)}%`)
                        .join(" · ")
                    : "";
                  return (
                    <li key={v.vehicleRef} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">{vehicleLabel(v)}</span>
                        <span className="text-sm font-bold">
                          {v.score != null ? `Score ${v.score}` : "—"}
                          <span className="ml-2 rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--muted)]">
                            {bucketLabel(v.bucket)}
                          </span>
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {v.distanceTravelledKm.toFixed(0)} km · fuel used {v.fuelConsumed.toFixed(1)} L
                        {economy != null ? ` (${economy.toFixed(1)} km/L)` : ""} ·
                        {" "}avg speed {(() => {
                          const s = v.averageSpeedSamples;
                          return s.length ? (s.reduce((a, b) => a + b, 0) / s.length).toFixed(0) : "—";
                        })()} km/h ·
                        {" "}idling {(v.idlingSeconds / 60).toFixed(0)} min · coasting {(v.coastingSeconds / 60).toFixed(0)} min
                      </p>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {load
                          ? `Engine load — heavy ${load.heavy.toFixed(0)}% · medium ${load.medium.toFixed(0)}% · light ${load.light.toFixed(0)}%`
                          : "Engine load — no data yet"}
                        {v.refuelCount > 0 ? ` · refuelled ${v.refuelCount}×` : ""}
                        {v.fuelDrainedLiters > 0 ? ` · drained ${v.fuelDrainedLiters.toFixed(1)} L` : ""}
                        {v.geofenceVisits.length > 0 ? ` · ${v.geofenceVisits.length} geofence visits` : ""}
                      </p>
                      {gsa != null || rpm != null || topGears ? (
                        <p className="mt-1 text-sm text-[var(--muted)]">
                          {gsa != null ? `Gear shift advisor ${gsa.toFixed(1)} · ` : ""}
                          {rpm != null ? `avg engine RPM ${rpm.toFixed(0)} · ` : ""}
                          {topGears ? `top gears — ${topGears}` : ""}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2">
                        <input
                          type="text"
                          placeholder="Model (e.g. Tata LP 909)"
                          className={`${field} !py-1 !text-sm w-48`}
                          value={identityDrafts[v.vehicleRef]?.model ?? v.identity?.model ?? ""}
                          onChange={(e) =>
                            setIdentityDrafts((prev) => ({
                              ...prev,
                              [v.vehicleRef]: {
                                model: e.target.value,
                                year: prev[v.vehicleRef]?.year ?? (v.identity?.year != null ? String(v.identity.year) : ""),
                              },
                            }))
                          }
                        />
                        <input
                          type="number"
                          placeholder="Year"
                          className={`${field} !py-1 !text-sm w-24`}
                          value={identityDrafts[v.vehicleRef]?.year ?? (v.identity?.year != null ? String(v.identity.year) : "")}
                          onChange={(e) =>
                            setIdentityDrafts((prev) => ({
                              ...prev,
                              [v.vehicleRef]: {
                                model: prev[v.vehicleRef]?.model ?? (v.identity?.model || ""),
                                year: e.target.value,
                              },
                            }))
                          }
                        />
                        <button
                          type="button"
                          className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs font-semibold disabled:opacity-50"
                          disabled={identitySaving === v.vehicleRef}
                          onClick={() => void saveIdentity(v)}
                        >
                          {identitySaving === v.vehicleRef ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {tab === "directorReport" ? (
              <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-5 text-[var(--brand-gold)]" aria-hidden />
                    <p className="text-sm font-bold">AI fleet summary</p>
                  </div>
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
                    disabled={reportLoading || !data}
                    onClick={() => void generateReport()}
                  >
                    {reportLoading ? "Generating…" : report ? "Regenerate" : "Generate report"}
                  </button>
                </div>
                {reportError ? (
                  <p className="mt-2 text-sm text-[var(--danger)]">{reportError}</p>
                ) : null}
                {report ? (
                  <div className="mt-3">
                    <p className="text-sm font-semibold">{report.headline}</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
                      {report.highlights.map((h, i) => (
                        <li key={i}>{h}</li>
                      ))}
                    </ul>
                  </div>
                ) : !reportError ? (
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    Generates a short narrative from the exact numbers on this page — nothing invented.
                  </p>
                ) : null}
              </div>
            ) : null}

            {tab === "scorecard" ? (
              <ul className="mt-4 space-y-2">
                {rows
                  .filter((v) => v.bucket !== "offline")
                  .sort((a, b) => (a.score ?? 100) - (b.score ?? 100))
                  .map((v) => (
                    <li key={v.vehicleRef} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">{vehicleLabel(v)}</span>
                        <span className="text-sm font-bold">Score {v.score}</span>
                      </div>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        Harsh accel/brake/turn: {v.haCount}/{v.hbCount}/{v.rtCount} · overspeed {v.overSpeedCount} ·
                        {" "}SOS {v.sosCount} · night driving {(v.nightDrivingSeconds / 60).toFixed(0)} min
                      </p>
                      {v.alertEvents.length > 0 ? (
                        <ul className="mt-2 space-y-1 border-t border-[var(--border)] pt-2 text-sm text-[var(--muted)]">
                          {v.alertEvents.map((a, i) => (
                            <li key={i}>
                              <span className="font-semibold">{a.alertName}</span>
                              {a.eventDateTime ? ` — ${new Date(a.eventDateTime).toLocaleString()}` : ""}
                              {a.maxSpeed != null ? ` · ${a.maxSpeed} km/h` : ""}
                              {a.duration != null ? ` · ${a.duration}s` : ""}
                              {a.fuelTank ? ` · ${a.fuelTank} tank` : ""}
                              {a.location ? ` · ${a.location}` : ""}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
              </ul>
            ) : null}

            {tab === "health" ? (
              <ul className="mt-4 space-y-2">
                {rows
                  .slice()
                  .sort((a, b) => b.faultCritical - a.faultCritical || b.faultWarning - a.faultWarning)
                  .map((v) => (
                    <li key={v.vehicleRef} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">{vehicleLabel(v)}</span>
                        <div className="flex flex-wrap gap-1.5">
                          {v.faultCritical > 0 ? (
                            <span className="rounded-full bg-[var(--danger-soft)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--danger)]">
                              {v.faultCritical} critical
                            </span>
                          ) : null}
                          {v.lowFuelAlertCount > 0 ? (
                            <span className="rounded-full bg-[var(--warning-soft)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--warning)]">
                              Low fuel ×{v.lowFuelAlertCount}
                            </span>
                          ) : null}
                          {v.lowDefAlertCount > 0 ? (
                            <span className="rounded-full bg-[var(--warning-soft)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--warning)]">
                              Low DEF ×{v.lowDefAlertCount}
                            </span>
                          ) : null}
                          {v.lowEngineOilPressureEvents.length > 0 ? (
                            <span className="rounded-full bg-[var(--danger-soft)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--danger)]">
                              Low oil pressure ×{v.lowEngineOilPressureEvents.length}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {v.faultCritical} critical · {v.faultWarning} warning fault codes · {v.incidents} incidents
                        {v.serviceDue ? ` · service: ${v.serviceDue}` : ""}
                      </p>
                      {v.faultCriticalDetails.length || v.faultWarningDetails.length || v.lowEngineOilPressureEvents.length ? (
                        <ul className="mt-2 space-y-1 border-t border-[var(--border)] pt-2 text-sm">
                          {v.faultCriticalDetails.map((f, i) => (
                            <li key={`c${i}`} className="text-[var(--danger)]">
                              {f.description}
                              {f.suggestedAction ? ` — ${f.suggestedAction}` : ""}
                            </li>
                          ))}
                          {v.faultWarningDetails.map((f, i) => (
                            <li key={`w${i}`} className="text-[var(--warning)]">
                              {f.description}
                              {f.suggestedAction ? ` — ${f.suggestedAction}` : ""}
                            </li>
                          ))}
                          {v.lowEngineOilPressureEvents.map((o, i) => (
                            <li key={`o${i}`} className="text-[var(--danger)]">
                              {o.description || "Low engine oil pressure"}
                              {o.eventDateTime ? ` — ${new Date(o.eventDateTime).toLocaleString()}` : ""}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
