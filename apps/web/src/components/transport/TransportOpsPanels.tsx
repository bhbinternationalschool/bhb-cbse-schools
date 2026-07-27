"use client";

import { useEffect, useMemo, useState } from "react";
import { formatInr } from "@/lib/fees";
import type { MastersState } from "@/lib/masters";
import type { SisState } from "@/lib/sis";
import {
  deactivateTransportRoute,
  downloadTransportRoutesTemplate,
  exportTransportRoutesCsv,
  importTransportRoutesCsv,
  recordFuelPurchase,
  recordFuelRefill,
  saveFeePolicy,
  setRouteStops,
  upsertFuelStockLocation,
  upsertTransportRoute,
  vehicleTcoPaise,
  type FleetVehicle,
  type TransportFeePolicy,
  type TransportFeeSlab,
  type TransportRoute,
  type TransportState,
} from "@/lib/transport";

export function RoutesPanel({
  state,
  vehicles,
  onRefresh,
  onFlash,
  onError,
}: {
  state: TransportState;
  vehicles: FleetVehicle[];
  onRefresh: () => void;
  onFlash: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [editId, setEditId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busNo, setBusNo] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [fee, setFee] = useState("");
  const [stopsText, setStopsText] = useState("");
  const [policy, setPolicy] = useState<TransportFeePolicy>(state.feePolicy);

  useEffect(() => {
    setPolicy(state.feePolicy);
  }, [state.feePolicy]);

  function loadRoute(r: TransportRoute) {
    setEditId(r.id);
    setCode(r.code);
    setName(r.name);
    setBusNo(r.busNo);
    setVehicleId(r.vehicleId);
    setFee(String(r.monthlyFeePaise / 100));
    setStopsText(
      r.stops
        .map((s) =>
          s.distanceKm > 0 ? `${s.name}:${s.distanceKm}` : s.name,
        )
        .join("\n"),
    );
  }

  function clearForm() {
    setEditId(null);
    setCode("");
    setName("");
    setBusNo("");
    setVehicleId("");
    setFee("");
    setStopsText("");
  }

  function save() {
    const stopLines = stopsText
      .split(/\n|,/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [nm, km] = line.split(":").map((x) => x.trim());
        return { name: nm || line, distanceKm: Number(km) || 0 };
      });
    const veh = vehicles.find((v) => v.id === vehicleId);
    const r = upsertTransportRoute({
      id: editId || undefined,
      code,
      name,
      busNo: busNo || veh?.name || "",
      vehicleReg: veh?.registrationNo || "",
      vehicleId,
      monthlyFeePaise: Math.round(Number(fee || "0") * 100),
      isActive: true,
      stops: stopLines.map((s, i) => ({
        id: `st_${i}`,
        name: s.name,
        sequence: i + 1,
        distanceKm: s.distanceKm,
      })),
    });
    if (!r.ok) {
      onError(r.error);
      return;
    }
    if (stopLines.length) {
      setRouteStops(
        r.route.id,
        stopLines.map((s) => ({ name: s.name, distanceKm: s.distanceKm })),
      );
    }
    clearForm();
    onRefresh();
    onFlash(editId ? "Route updated" : "Route added");
  }

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            {editId ? "Edit route" : "Add route"}
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Code
              </span>
              <input
                className="field !py-1.5"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Name
              </span>
              <input
                className="field !py-1.5"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Bus label
              </span>
              <input
                className="field !py-1.5"
                value={busNo}
                onChange={(e) => setBusNo(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Vehicle
              </span>
              <select
                className="field !py-1.5"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
              >
                <option value="">—</option>
                {vehicles
                  .filter((v) => v.isActive)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.registrationNo} · {v.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                {policy.rateMode === "flat_route"
                  ? "Flat fee ₹/mo"
                  : "Route fee ₹/mo (fallback)"}
              </span>
              <input
                className="field !py-1.5"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                placeholder={
                  policy.rateMode === "flat_route"
                    ? "Monthly fee for this route"
                    : "Used if distance fee is 0"
                }
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Stops (one per line
                {policy.rateMode !== "flat_route"
                  ? ", use Name:km e.g. Lanka:2"
                  : ", optional :km e.g. Lanka:2"}
                )
              </span>
              <textarea
                className="field min-h-[6rem] !py-1.5"
                value={stopsText}
                onChange={(e) => setStopsText(e.target.value)}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-sm font-bold text-white"
              onClick={save}
            >
              {editId ? "Save route" : "Add route"}
            </button>
            {editId ? (
              <button
                type="button"
                className="rounded-lg border px-3 py-2 text-sm font-semibold"
                onClick={clearForm}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Fee policy (AY)
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            How monthly transport dues are calculated on assign / Fee Take.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Mode
              </span>
              <select
                className="field !py-1.5"
                value={policy.rateMode}
                onChange={(e) =>
                  setPolicy((p) => ({
                    ...p,
                    rateMode: e.target
                      .value as TransportFeePolicy["rateMode"],
                  }))
                }
              >
                <option value="flat_route">Flat route fee</option>
                <option value="per_km">Per km</option>
                <option value="slab">Distance slabs</option>
              </select>
            </label>

            {policy.rateMode === "flat_route" ? (
              <p className="sm:col-span-2 rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-2 text-[12px] text-[var(--brand-deep)]">
                Each route’s <strong>Flat fee ₹/mo</strong> is billed. Stop
                distances are not used for pricing in this mode.
              </p>
            ) : null}

            {policy.rateMode === "per_km" ? (
              <>
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    ₹ per km / month
                  </span>
                  <input
                    className="field !py-1.5"
                    inputMode="decimal"
                    value={String(policy.ratePerKmPaise / 100)}
                    onChange={(e) =>
                      setPolicy((p) => ({
                        ...p,
                        ratePerKmPaise: Math.round(
                          Number(e.target.value || "0") * 100,
                        ),
                      }))
                    }
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Minimum ₹/mo
                  </span>
                  <input
                    className="field !py-1.5"
                    inputMode="decimal"
                    value={String(policy.minFeePaise / 100)}
                    onChange={(e) =>
                      setPolicy((p) => ({
                        ...p,
                        minFeePaise: Math.round(
                          Number(e.target.value || "0") * 100,
                        ),
                      }))
                    }
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Maximum ₹/mo (blank = no cap)
                  </span>
                  <input
                    className="field !py-1.5"
                    inputMode="decimal"
                    value={
                      policy.maxFeePaise == null
                        ? ""
                        : String(policy.maxFeePaise / 100)
                    }
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      setPolicy((p) => ({
                        ...p,
                        maxFeePaise:
                          raw === ""
                            ? null
                            : Math.round(Number(raw || "0") * 100),
                      }));
                    }}
                    placeholder="Optional"
                  />
                </label>
                <p className="sm:col-span-2 text-[11px] text-[var(--muted)]">
                  Fee = stop distance (km) × rate. Set km on each stop as{" "}
                  <code className="text-[10px]">Name:km</code>.
                </p>
              </>
            ) : null}

            {policy.rateMode === "slab" ? (
              <div className="sm:col-span-2 space-y-2">
                <div className="text-[11px] text-[var(--muted)]">
                  Slabs by distance from school (up to km → monthly ₹). First
                  matching slab wins.
                </div>
                <ul className="space-y-2">
                  {[...policy.slabs]
                    .sort((a, b) => a.upToKm - b.upToKm)
                    .map((slab) => (
                      <li
                        key={slab.id}
                        className="grid grid-cols-[1fr_1fr_auto] gap-2"
                      >
                        <label className="text-sm">
                          <span className="mb-1 block text-[10px] text-[var(--muted)]">
                            Up to km
                          </span>
                          <input
                            className="field !py-1.5"
                            type="number"
                            min={0}
                            step={0.5}
                            value={slab.upToKm}
                            onChange={(e) => {
                              const upToKm = Number(e.target.value) || 0;
                              setPolicy((p) => ({
                                ...p,
                                slabs: p.slabs.map((s) =>
                                  s.id === slab.id ? { ...s, upToKm } : s,
                                ),
                              }));
                            }}
                          />
                        </label>
                        <label className="text-sm">
                          <span className="mb-1 block text-[10px] text-[var(--muted)]">
                            Fee ₹/mo
                          </span>
                          <input
                            className="field !py-1.5"
                            inputMode="decimal"
                            value={String(slab.monthlyFeePaise / 100)}
                            onChange={(e) => {
                              const monthlyFeePaise = Math.round(
                                Number(e.target.value || "0") * 100,
                              );
                              setPolicy((p) => ({
                                ...p,
                                slabs: p.slabs.map((s) =>
                                  s.id === slab.id
                                    ? { ...s, monthlyFeePaise }
                                    : s,
                                ),
                              }));
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className="self-end pb-2 text-[11px] font-semibold text-[#dc2626]"
                          onClick={() =>
                            setPolicy((p) => ({
                              ...p,
                              slabs: p.slabs.filter((s) => s.id !== slab.id),
                            }))
                          }
                          disabled={policy.slabs.length <= 1}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                </ul>
                <button
                  type="button"
                  className="rounded-md border px-2 py-1 text-[11px] font-semibold"
                  onClick={() => {
                    const last = [...policy.slabs].sort(
                      (a, b) => a.upToKm - b.upToKm,
                    )[policy.slabs.length - 1];
                    const next: TransportFeeSlab = {
                      id: `slb_${Math.random().toString(36).slice(2, 10)}`,
                      upToKm: (last?.upToKm ?? 0) + 3,
                      monthlyFeePaise: (last?.monthlyFeePaise ?? 40000) + 10000,
                    };
                    setPolicy((p) => ({
                      ...p,
                      slabs: [...p.slabs, next],
                    }));
                  }}
                >
                  Add slab
                </button>
              </div>
            ) : null}

            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Repair approval threshold ₹
              </span>
              <input
                className="field !py-1.5"
                value={String(policy.repairApprovalPaise / 100)}
                onChange={(e) =>
                  setPolicy((p) => ({
                    ...p,
                    repairApprovalPaise: Math.round(
                      Number(e.target.value || "0") * 100,
                    ),
                  }))
                }
              />
              <span className="mt-1 block text-[10px] text-[var(--muted)]">
                Service jobs estimated above this need Principal approval.
              </span>
            </label>
          </div>
          <button
            type="button"
            className="mt-3 rounded-lg border px-3 py-2 text-sm font-semibold"
            onClick={() => {
              const toSave =
                policy.rateMode === "slab"
                  ? {
                      ...policy,
                      slabs: [...policy.slabs].sort(
                        (a, b) => a.upToKm - b.upToKm,
                      ),
                    }
                  : policy;
              if (toSave.rateMode === "slab" && toSave.slabs.length === 0) {
                onError("Add at least one distance slab");
                return;
              }
              saveFeePolicy(toSave);
              onRefresh();
              onFlash(
                `Fee policy saved · ${
                  toSave.rateMode === "flat_route"
                    ? "flat route"
                    : toSave.rateMode === "per_km"
                      ? "per km"
                      : "slabs"
                }`,
              );
            }}
          >
            Save policy
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            All routes
          </h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border px-2 py-1 text-[10px] font-semibold"
              onClick={() => downloadTransportRoutesTemplate()}
            >
              Template
            </button>
            <button
              type="button"
              className="rounded-md border px-2 py-1 text-[10px] font-semibold"
              onClick={() => exportTransportRoutesCsv(state)}
            >
              Export
            </button>
            <label className="cursor-pointer rounded-md border px-2 py-1 text-[10px] font-semibold">
              Import
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const result = importTransportRoutesCsv(
                      String(reader.result ?? ""),
                    );
                    if (result.error) {
                      onError(result.error);
                      return;
                    }
                    onRefresh();
                    onFlash(`${result.added} route(s) imported`);
                  };
                  reader.readAsText(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
        <ul className="mt-2 max-h-[32rem] divide-y overflow-y-auto text-sm">
          {state.routes.map((r) => (
            <li key={r.id} className={`py-2 ${r.isActive ? "" : "opacity-50"}`}>
              <div className="flex justify-between gap-2">
                <div>
                  <div className="font-bold text-[var(--brand-deep)]">
                    {r.code} · {r.name}
                  </div>
                  <div className="text-[10px] text-[var(--muted)]">
                    {r.busNo} · {formatInr(r.monthlyFeePaise)}/mo ·{" "}
                    {r.stops.length} stops
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-[11px] font-semibold"
                    onClick={() => loadRoute(r)}
                  >
                    Edit
                  </button>
                  {r.isActive ? (
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-[#dc2626]"
                      onClick={() => {
                        deactivateTransportRoute(r.id);
                        onRefresh();
                      }}
                    >
                      Off
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function FleetPanel({
  state,
  masters,
  onRefresh,
  onFlash,
  onError,
  upsertVehicle,
}: {
  state: TransportState;
  masters: MastersState | null;
  onRefresh: () => void;
  onFlash: (m: string) => void;
  onError: (m: string) => void;
  upsertVehicle: typeof import("@/lib/transport").upsertFleetVehicle;
}) {
  const [reg, setReg] = useState("");
  const [vname, setVname] = useState("");
  const [fuelType, setFuelType] = useState<"diesel" | "cng" | "petrol">(
    "diesel",
  );
  const [odo, setOdo] = useState("0");
  const [editId, setEditId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = state.vehicles.find((v) => v.id === selectedId) ?? null;

  function save() {
    const r = upsertVehicle({
      id: editId || undefined,
      registrationNo: reg,
      name: vname || reg,
      fuelType,
      odometerKm: Number(odo) || 0,
      type: "bus",
    });
    if (!r.ok) {
      onError(r.error);
      return;
    }
    setEditId(null);
    setReg("");
    setVname("");
    setOdo("0");
    onRefresh();
    onFlash("Vehicle saved");
  }

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          {editId ? "Edit vehicle" : "Add vehicle"}
        </h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Registration
            </span>
            <input
              className="field !py-1.5"
              value={reg}
              onChange={(e) => setReg(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Name
            </span>
            <input
              className="field !py-1.5"
              value={vname}
              onChange={(e) => setVname(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Fuel
            </span>
            <select
              className="field !py-1.5"
              value={fuelType}
              onChange={(e) =>
                setFuelType(e.target.value as "diesel" | "cng" | "petrol")
              }
            >
              <option value="diesel">Diesel</option>
              <option value="cng">CNG</option>
              <option value="petrol">Petrol</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Odometer km
            </span>
            <input
              className="field !py-1.5"
              value={odo}
              onChange={(e) => setOdo(e.target.value)}
            />
          </label>
        </div>
        <button
          type="button"
          className="mt-3 rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-sm font-bold text-white"
          onClick={save}
        >
          Save vehicle
        </button>
        <ul className="mt-4 max-h-80 divide-y overflow-y-auto text-sm">
          {state.vehicles.map((v) => (
            <li key={v.id} className="flex justify-between gap-2 py-2">
              <button
                type="button"
                className="text-left"
                onClick={() => setSelectedId(v.id)}
              >
                <div className="font-semibold text-[var(--brand-deep)]">
                  {v.registrationNo}
                </div>
                <div className="text-[10px] text-[var(--muted)]">
                  {v.name} · {v.fuelType} · {v.status} · {v.odometerKm} km
                </div>
              </button>
              <button
                type="button"
                className="text-[11px] font-semibold"
                onClick={() => {
                  setEditId(v.id);
                  setReg(v.registrationNo);
                  setVname(v.name);
                  setFuelType(
                    v.fuelType === "cng" || v.fuelType === "petrol"
                      ? v.fuelType
                      : "diesel",
                  );
                  setOdo(String(v.odometerKm));
                }}
              >
                Edit
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Vehicle 360
        </h2>
        {!selected ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            Select a vehicle to view timeline.
          </p>
        ) : (
          <Vehicle360 state={state} vehicle={selected} masters={masters} />
        )}
      </div>
    </div>
  );
}

function Vehicle360({
  state,
  vehicle,
}: {
  state: TransportState;
  vehicle: FleetVehicle;
  masters: MastersState | null;
}) {
  const tco = useMemo(
    () => vehicleTcoPaise(vehicle.id, state),
    [state, vehicle.id],
  );

  const fuels = state.fuelRefillLogs
    .filter((l) => l.vehicleId === vehicle.id)
    .slice(0, 8);
  const jobs = state.serviceJobCards
    .filter((j) => j.vehicleId === vehicle.id)
    .slice(0, 6);

  return (
    <div className="mt-2 space-y-3 text-sm">
      <div className="rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-2">
        <div className="font-bold text-[var(--brand-deep)]">
          {vehicle.registrationNo} · {vehicle.name}
        </div>
        <div className="text-[11px] text-[var(--muted)]">
          TCO {formatInr(tco.total)} (fuel {formatInr(tco.fuel)} · EMI{" "}
          {formatInr(tco.emi)} · jobs {formatInr(tco.jobs)})
        </div>
      </div>
      <div>
        <div className="text-[11px] font-bold uppercase text-[var(--muted)]">
          Compliance
        </div>
        {vehicle.compliance.length === 0 ? (
          <p className="text-[11px] text-[var(--muted)]">None recorded</p>
        ) : (
          <ul className="text-[11px]">
            {vehicle.compliance.map((c) => (
              <li key={c.id}>
                {c.certType} · exp {c.expiryDate}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="text-[11px] font-bold uppercase text-[var(--muted)]">
          Recent fuel
        </div>
        <ul className="text-[11px]">
          {fuels.map((f) => (
            <li key={f.id}>
              {f.filledAt.slice(0, 10)} · {f.qty} · {formatInr(f.amountPaise)}
              {f.anomaly ? " · anomaly" : ""}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="text-[11px] font-bold uppercase text-[var(--muted)]">
          Jobs
        </div>
        <ul className="text-[11px]">
          {jobs.map((j) => (
            <li key={j.id}>
              {j.title} · {j.status} · {formatInr(j.laborPaise + j.partsPaise)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function FuelPanel({
  state,
  onRefresh,
  onFlash,
  onError,
}: {
  state: TransportState;
  onRefresh: () => void;
  onFlash: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [vehicleId, setVehicleId] = useState("");
  const [odo, setOdo] = useState("");
  const [qty, setQty] = useState("");
  const [amount, setAmount] = useState("");
  const [dealerId, setDealerId] = useState("");
  const [source, setSource] = useState<"dealer_pump" | "depot_stock">(
    "dealer_pump",
  );
  const [locationId, setLocationId] = useState("");
  const [purchaseQty, setPurchaseQty] = useState("");
  const [purchaseRate, setPurchaseRate] = useState("");

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Log refill
        </h2>
        <div className="mt-3 grid gap-2">
          <select
            className="field !py-1.5"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
          >
            <option value="">Vehicle…</option>
            {state.vehicles
              .filter((v) => v.isActive)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registrationNo}
                </option>
              ))}
          </select>
          <select
            className="field !py-1.5"
            value={source}
            onChange={(e) =>
              setSource(e.target.value as "dealer_pump" | "depot_stock")
            }
          >
            <option value="dealer_pump">Pump (Mode B)</option>
            <option value="depot_stock">Depot stock (Mode A)</option>
          </select>
          {source === "depot_stock" ? (
            <select
              className="field !py-1.5"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">Depot…</option>
              {state.fuelStockLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.qtyOnHand})
                </option>
              ))}
            </select>
          ) : (
            <select
              className="field !py-1.5"
              value={dealerId}
              onChange={(e) => setDealerId(e.target.value)}
            >
              <option value="">Dealer…</option>
              {state.dealers
                .filter((d) => d.type === "fuel_dealer")
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          )}
          <input
            className="field !py-1.5"
            placeholder="Odometer km"
            value={odo}
            onChange={(e) => setOdo(e.target.value)}
          />
          <input
            className="field !py-1.5"
            placeholder="Qty"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <input
            className="field !py-1.5"
            placeholder="Amount ₹"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-sm font-bold text-white"
            onClick={() => {
              const r = recordFuelRefill({
                vehicleId,
                filledAt: new Date().toISOString(),
                odometerKm: Number(odo) || 0,
                qty: Number(qty) || 0,
                amountPaise: Math.round(Number(amount || "0") * 100),
                source,
                dealerId,
                locationId,
                paymentStatus:
                  source === "depot_stock"
                    ? "adjusted_from_stock"
                    : "on_account",
              });
              if (!r.ok) {
                onError(r.error);
                return;
              }
              onRefresh();
              onFlash(
                r.log.anomaly
                  ? "Refill logged (mileage anomaly)"
                  : "Refill logged",
              );
            }}
          >
            Save refill
          </button>
        </div>
        <ul className="mt-4 max-h-64 divide-y overflow-y-auto text-[11px]">
          {state.fuelRefillLogs.slice(0, 20).map((l) => (
            <li key={l.id} className="py-1.5">
              {l.filledAt.slice(0, 16)} ·{" "}
              {state.vehicles.find((v) => v.id === l.vehicleId)?.registrationNo}{" "}
              · {l.qty} · {formatInr(l.amountPaise)}
              {l.anomaly ? " · ANOMALY" : ""}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Depot purchase (Mode A)
        </h2>
        <div className="mt-3 grid gap-2">
          <select
            className="field !py-1.5"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">Location…</option>
            {state.fuelStockLocations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <select
            className="field !py-1.5"
            value={dealerId}
            onChange={(e) => setDealerId(e.target.value)}
          >
            <option value="">Dealer…</option>
            {state.dealers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <input
            className="field !py-1.5"
            placeholder="Qty"
            value={purchaseQty}
            onChange={(e) => setPurchaseQty(e.target.value)}
          />
          <input
            className="field !py-1.5"
            placeholder="Rate ₹/unit"
            value={purchaseRate}
            onChange={(e) => setPurchaseRate(e.target.value)}
          />
          <button
            type="button"
            className="rounded-lg border px-3 py-2 text-sm font-semibold"
            onClick={() => {
              let locId = locationId;
              if (!locId && state.fuelStockLocations.length === 0) {
                const loc = upsertFuelStockLocation({
                  name: "Campus diesel depot",
                  fuelType: "diesel",
                  qtyOnHand: 0,
                });
                if (!loc.ok) {
                  onError(loc.error);
                  return;
                }
                locId = loc.location.id;
                setLocationId(locId);
              }
              const r = recordFuelPurchase({
                locationId: locId || state.fuelStockLocations[0]?.id || "",
                dealerId,
                purchasedOn: new Date().toISOString().slice(0, 10),
                qty: Number(purchaseQty) || 0,
                ratePaise: Math.round(Number(purchaseRate || "0") * 100),
              });
              if (!r.ok) {
                onError(r.error);
                return;
              }
              onRefresh();
              onFlash("Fuel purchased into stock");
            }}
          >
            Post purchase
          </button>
        </div>
        <ul className="mt-4 text-sm">
          {state.fuelStockLocations.map((l) => (
            <li key={l.id} className="py-1">
              {l.name}: <strong>{l.qtyOnHand}</strong> {l.fuelType}
              {l.qtyOnHand <= l.minAlert ? (
                <span className="ml-2 text-[#c2410c]">LOW</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
