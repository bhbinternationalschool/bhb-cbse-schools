"use client";

import { useMemo, useState } from "react";
import { formatInr } from "@/lib/fees";
import type { MastersState } from "@/lib/masters";
import {
  assignStaffToTransport,
  endStaffTransport,
  listActiveRoutes,
  listActiveStaffRiders,
  type TransportServiceMode,
  type TransportState,
} from "@/lib/transport";

/**
 * Staff who ride the school bus — free, or with a monthly recovery.
 *
 * Staff riders are not students: they have no household, no fee head and no
 * concession rules, and nothing they owe belongs on a family's invoice. So
 * they are recorded separately and the money is reported for payroll to
 * recover rather than billed.
 *
 * Nothing on this screen creates a salary deduction. A transport screen
 * quietly changing someone's pay would be the wrong module doing it, and the
 * amount would land without the payroll desk ever agreeing to it.
 */
export function StaffRiderPanel({
  state,
  masters,
  academicYearCode,
  onRefresh,
  onFlash,
  onError,
}: {
  state: TransportState;
  masters: MastersState | null;
  academicYearCode: string;
  onRefresh: () => void;
  onFlash: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [staffId, setStaffId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [stopId, setStopId] = useState("");
  const [costMode, setCostMode] = useState<"free" | "charged">("charged");
  const [rupees, setRupees] = useState("");
  const [serviceMode, setServiceMode] = useState<TransportServiceMode>("both");
  const [note, setNote] = useState("");
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));

  const routes = useMemo(() => listActiveRoutes(state), [state]);
  const route = routes.find((r) => r.id === routeId);
  const riders = useMemo(
    () => listActiveStaffRiders(state, academicYearCode),
    [state, academicYearCode],
  );

  const staffById = useMemo(
    () =>
      new Map(
        (masters?.staff ?? []).map((s) => [
          s.id,
          {
            fullName: s.fullName,
            designation:
              (masters?.designations ?? []).find((d) => d.id === s.designationId)
                ?.name ?? "",
          },
        ]),
      ),
    [masters],
  );

  const assignable = useMemo(
    () =>
      (masters?.staff ?? [])
        .filter((s) => s.status === "active")
        .map((s) => ({
          id: s.id,
          fullName: s.fullName,
          designation:
            (masters?.designations ?? []).find((d) => d.id === s.designationId)
              ?.name ?? "",
        }))
        .sort(
          (a, b) =>
            a.designation.localeCompare(b.designation) ||
            a.fullName.localeCompare(b.fullName),
        ),
    [masters],
  );

  const totalRecovery = riders
    .filter((r) => r.costMode === "charged")
    .reduce((n, r) => n + r.monthlyFeePaise, 0);
  const freeCount = riders.filter((r) => r.costMode === "free").length;

  function save() {
    const r = assignStaffToTransport({
      staffId,
      routeId,
      stopId,
      academicYearCode,
      effectiveFrom: from,
      costMode,
      monthlyFeePaise:
        costMode === "charged" ? Math.round(Number(rupees) * 100) || 0 : 0,
      serviceMode,
      note,
    });
    if (!r.ok) {
      onError(r.error);
      return;
    }
    setStaffId("");
    setStopId("");
    setRupees("");
    setNote("");
    onRefresh();
    onFlash("Staff rider saved");
  }

  if (!masters) {
    return (
      <p className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted)]">
        Waiting for the staff roster to load.
      </p>
    );
  }

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Put a staff member on a bus
        </h2>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          Staff take a seat like anyone else, so they count towards capacity.
          A charge is recorded here and recovered through payroll — this screen
          never deducts pay.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Staff member
            </span>
            <select
              className="field !py-1.5"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
            >
              <option value="">— pick —</option>
              {assignable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                  {s.designation ? ` · ${s.designation}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Route
            </span>
            <select
              className="field !py-1.5"
              value={routeId}
              onChange={(e) => {
                setRouteId(e.target.value);
                setStopId("");
              }}
            >
              <option value="">— pick —</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.busNo || r.code}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Stop
            </span>
            <select
              className="field !py-1.5"
              value={stopId}
              onChange={(e) => setStopId(e.target.value)}
              disabled={!route}
            >
              <option value="">— pick —</option>
              {[...(route?.stops ?? [])]
                .sort((a, b) => a.sequence - b.sequence)
                .map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                    {st.distanceKm > 0 ? ` · ${st.distanceKm} km` : ""}
                  </option>
                ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Cost
            </span>
            <select
              className="field !py-1.5"
              value={costMode}
              onChange={(e) =>
                setCostMode(e.target.value === "free" ? "free" : "charged")
              }
            >
              <option value="charged">Charged monthly</option>
              <option value="free">Free — no charge</option>
            </select>
          </label>

          {costMode === "charged" ? (
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Monthly amount (₹)
              </span>
              <input
                className="field !py-1.5"
                value={rupees}
                onChange={(e) => setRupees(e.target.value)}
                inputMode="numeric"
                placeholder="e.g. 500"
              />
            </label>
          ) : (
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Why is it free?
              </span>
              <input
                className="field !py-1.5"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. part of appointment terms"
              />
            </label>
          )}

          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Service
            </span>
            <select
              className="field !py-1.5"
              value={serviceMode}
              onChange={(e) =>
                setServiceMode(e.target.value as TransportServiceMode)
              }
            >
              <option value="both">Both ways</option>
              <option value="pickup">Pick-up only</option>
              <option value="drop">Drop only</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              From
            </span>
            <input
              type="date"
              className="field !py-1.5"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
        </div>

        <button
          type="button"
          className="mt-3 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-bold text-[var(--primary-foreground)]"
          onClick={save}
        >
          Save staff rider
        </button>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Staff riding ({riders.length})
        </h2>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          {formatInr(totalRecovery)}/month to recover
          {freeCount > 0 ? ` · ${freeCount} riding free` : ""}
        </p>
        {totalRecovery > 0 ? (
          <p className="mt-2 rounded-lg border border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-3 py-2 text-[11px] text-[var(--ink)]">
            Not deducted automatically. Apply {formatInr(totalRecovery)} through
            Payroll as a deduction for the month.
          </p>
        ) : null}

        {riders.length === 0 ? (
          <p className="mt-3 text-[11px] text-[var(--muted)]">
            No staff member is on a bus yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y text-sm">
            {riders.map((r) => {
              const who = staffById.get(r.staffId);
              const rt = state.routes.find((x) => x.id === r.routeId);
              const stop = rt?.stops.find((x) => x.id === r.stopId);
              return (
                <li key={r.id} className="flex justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-[var(--brand-deep)]">
                      {who?.fullName || "(staff record not found)"}
                    </div>
                    <div className="text-[11px] text-[var(--muted)]">
                      {who?.designation ? `${who.designation} · ` : ""}
                      {rt ? rt.busNo || rt.code : "route missing"} ·{" "}
                      {stop?.name || (
                        <span className="text-[var(--warning)]">
                          stop link broken
                        </span>
                      )}{" "}
                      · from {r.effectiveFrom}
                    </div>
                    <div className="text-[10px] text-[var(--muted)]">
                      {r.costMode === "free"
                        ? `Free — ${r.note || "no reason recorded"}`
                        : `${formatInr(r.monthlyFeePaise)}/month`}
                      {r.serviceMode !== "both"
                        ? ` · ${r.serviceMode === "pickup" ? "pick-up only" : "drop only"}`
                        : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 self-start text-[11px] font-semibold text-[var(--danger)]"
                    onClick={() => {
                      const end = new Date().toISOString().slice(0, 10);
                      if (
                        !window.confirm(
                          `Take ${who?.fullName ?? "this staff member"} off the bus from ${end}?`,
                        )
                      ) {
                        return;
                      }
                      endStaffTransport(r.id, end);
                      onRefresh();
                      onFlash("Staff rider ended");
                    }}
                  >
                    Off bus
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
