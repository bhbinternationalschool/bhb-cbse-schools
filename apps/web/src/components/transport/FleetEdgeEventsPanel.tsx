"use client";

import { useEffect, useState } from "react";
import { RadioTower } from "lucide-react";
import { field } from "@/components/ui/erp-ui";

type FleetEdgeEventType = "alert" | "details" | "telemetry";

type FleetEdgeEvent = {
  id: string;
  event_type: FleetEdgeEventType;
  alert_name: string | null;
  vehicle_ref: string | null;
  registration_number: string | null;
  event_at: string | null;
  window_from: string | null;
  window_to: string | null;
  source_ip: string | null;
  payload: Record<string, unknown>;
  received_at: string;
};

function eventTypeLabel(t: FleetEdgeEventType): string {
  if (t === "alert") return "Alert";
  if (t === "details") return "Periodic summary";
  return "Live telemetry";
}

function summarize(event: FleetEdgeEvent): string {
  const p = event.payload || {};
  if (event.event_type === "alert") {
    const details = (p.eventDetails as Record<string, unknown>) || {};
    const bits: string[] = [];
    if (typeof details.location === "string") bits.push(details.location);
    if (typeof details.maxSpeed === "number") bits.push(`max speed ${details.maxSpeed}`);
    if (typeof details.fuelDifference === "number") bits.push(`Δfuel ${details.fuelDifference}`);
    return bits.join(" · ") || "—";
  }
  if (event.event_type === "telemetry") {
    const bits: string[] = [];
    if (typeof p.gpsLatitude === "number" && typeof p.gpsLongitude === "number") {
      bits.push(`${p.gpsLatitude.toFixed(4)}, ${p.gpsLongitude.toFixed(4)}`);
    }
    if (typeof p.speed === "number") bits.push(`${p.speed} km/h`);
    if (typeof p.ignitionOn === "boolean") bits.push(p.ignitionOn ? "ignition on" : "ignition off");
    if (typeof p.fuelLevelPercent === "number") bits.push(`fuel ${p.fuelLevelPercent}%`);
    return bits.join(" · ") || "—";
  }
  const health = (p.vehicleHealth as Record<string, unknown>) || {};
  const fault = (health.faultCodes as Record<string, unknown>) || {};
  const eff = (p.vehicleEfficiency as Record<string, unknown>) || {};
  const bits: string[] = [];
  if (Array.isArray(fault.critical) || Array.isArray(fault.warning)) {
    const criticalCount = Array.isArray(fault.critical) ? fault.critical.length : 0;
    const warningCount = Array.isArray(fault.warning) ? fault.warning.length : 0;
    bits.push(`fault codes: ${criticalCount} critical, ${warningCount} warning`);
  }
  const fuelUsed = typeof eff.fuelUsed === "number" ? eff.fuelUsed : eff.fuelConsumed;
  if (typeof fuelUsed === "number") bits.push(`fuel used ${fuelUsed}`);
  if (typeof eff.averageSpeed === "number") bits.push(`avg speed ${eff.averageSpeed}`);
  return bits.join(" · ") || "—";
}

export function FleetEdgeEventsPanel() {
  const [events, setEvents] = useState<FleetEdgeEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vehicleRef, setVehicleRef] = useState("");
  const [eventType, setEventType] = useState<FleetEdgeEventType | "">("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (vehicleRef.trim()) params.set("vehicleRef", vehicleRef.trim());
      if (eventType) params.set("eventType", eventType);
      const res = await fetch(`/api/transport/fleet-edge/events?${params.toString()}`);
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        events?: FleetEdgeEvent[];
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error || `HTTP ${res.status}`);
        setEvents([]);
        return;
      }
      setEvents(data.events || []);
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

  return (
    <div className="mt-5 space-y-4">
      <div className="flex items-center gap-2">
        <RadioTower className="size-5 text-[var(--brand-deep)]" aria-hidden />
        <div>
          <p className="text-sm font-bold">Fleet Edge feed</p>
          <p className="text-xs text-[var(--muted)]">
            Raw events from Tata Motors Fleet Edge — telemetry, alerts, and periodic summaries.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Vehicle (chassis or reg. no.)</span>
          <input
            className={`${field} !py-1.5`}
            placeholder="e.g. MH01AA1111"
            value={vehicleRef}
            onChange={(e) => setVehicleRef(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Type</span>
          <select
            className={`${field} !py-1.5`}
            value={eventType}
            onChange={(e) => setEventType(e.target.value as FleetEdgeEventType | "")}
          >
            <option value="">All</option>
            <option value="telemetry">Live telemetry</option>
            <option value="alert">Alerts</option>
            <option value="details">Periodic summary</option>
          </select>
        </label>
        <button
          type="button"
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      {!loading && events.length === 0 && !error ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          No Fleet Edge events yet. Once vehicles start pushing data, they&apos;ll show up here.
        </p>
      ) : (
        <ul className="space-y-2">
          {events.map((ev) => (
            <li key={ev.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--muted)]">
                    {eventTypeLabel(ev.event_type)}
                  </span>
                  {ev.alert_name ? <span className="ml-2 font-semibold">{ev.alert_name}</span> : null}
                  <span className="ml-2 text-xs text-[var(--muted)]">
                    {ev.registration_number || ev.vehicle_ref || "unknown vehicle"}
                  </span>
                </div>
                <span className="text-xs text-[var(--muted)]">
                  {new Date(ev.received_at).toLocaleString()}
                </span>
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">{summarize(ev)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
