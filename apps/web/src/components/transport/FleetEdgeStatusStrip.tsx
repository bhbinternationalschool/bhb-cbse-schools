"use client";

import { useEffect, useState } from "react";
import {
  linkFleetEdgeToDesk,
  type FleetEdgeVehicleStatus,
} from "@/lib/fleetEdgeLink";
import type { FleetVehicle } from "@/lib/transport";

/**
 * What Tata Fleet Edge is actually reporting, shown against the school's own
 * vehicles.
 *
 * Fleet Edge data used to live only in its own report tab, so the Fleet and
 * Live screens showed nothing while thousands of events arrived — and two of
 * the six vehicles could not be matched at all, because the desk holds their
 * VIN where a registration should be. Matching happens on either key here,
 * and anything that fails to match is named rather than dropped.
 */
export function FleetEdgeStatusStrip({
  vehicles,
  variant,
}: {
  vehicles: FleetVehicle[];
  /** "live" leads with whether positions are available; "fleet" with per-vehicle status. */
  variant: "fleet" | "live";
}) {
  const [data, setData] = useState<{
    vehicles: FleetEdgeVehicleStatus[];
    telemetry: {
      live: boolean;
      vehiclesReporting: number;
      newestAt: string | null;
      reason: string;
    };
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/transport/fleet-edge/vehicle-status", {
          cache: "no-store",
        });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error || "Could not read Fleet Edge status");
        } else {
          setData(body);
        }
      } catch {
        if (!cancelled) setError("Could not reach Fleet Edge status");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-[11px] text-[var(--muted)]">
        Checking Fleet Edge…
      </p>
    );
  }
  if (error || !data) {
    // Not "nothing is reporting" — the check itself failed, and those mean
    // opposite things to someone asking whether the fleet is online.
    return (
      <p className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[var(--card)] p-3 text-[11px] text-[var(--danger)]">
        Fleet Edge status could not be read: {error}. This is not the same as
        no vehicle reporting.
      </p>
    );
  }

  const link = linkFleetEdgeToDesk(
    vehicles,
    (v) => v.registrationNo,
    data.vehicles,
  );
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h3 className="text-sm font-bold text-[var(--brand-deep)]">
        {variant === "live" ? "Live position feed" : "Fleet Edge"}
      </h3>

      {!data.telemetry.live ? (
        <p className="mt-2 rounded-lg border border-[color-mix(in_srgb,var(--warning)_50%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-3 py-2 text-[11px] text-[var(--ink)]">
          <strong>No live positions.</strong> {data.telemetry.reason}
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-[var(--success)]">
          Live telemetry from {data.telemetry.vehiclesReporting} vehicle
          {data.telemetry.vehiclesReporting === 1 ? "" : "s"}, newest{" "}
          {fmt(data.telemetry.newestAt)}.
        </p>
      )}

      <ul className="mt-3 space-y-1 text-[11px]">
        {link.matched.map((m) => (
          <li key={m.status.vin} className="flex flex-wrap gap-x-2">
            <span className="font-semibold text-[var(--ink)]">
              {m.vehicle.registrationNo}
            </span>
            {m.matchedOn === "vin" ? (
              <span
                className="text-[var(--warning)]"
                title="This desk row holds a VIN where the registration should be"
              >
                (matched by VIN — plate is {m.status.registrationNumber || "not set"})
              </span>
            ) : null}
            <span className="text-[var(--muted)]">
              last heard {fmt(m.status.lastSeenAt)} · {m.status.detailCount}{" "}
              summaries · {m.status.alertCount} alerts
              {m.status.telemetryCount === 0 ? " · no live feed" : ""}
            </span>
          </li>
        ))}
      </ul>

      {link.deskOnly.length > 0 ? (
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          Not on Fleet Edge:{" "}
          {link.deskOnly.map((v) => v.registrationNo).join(", ")} — no telemetry
          is expected for these.
        </p>
      ) : null}

      {link.edgeOnly.length > 0 ? (
        <p className="mt-2 text-[11px] text-[var(--warning)]">
          Reporting to Fleet Edge but not on the fleet list:{" "}
          {link.edgeOnly
            .map((s) => s.registrationNumber || s.vin)
            .join(", ")}
          . Add them under Fleet, or their data stays unattached.
        </p>
      ) : null}
    </section>
  );
}
