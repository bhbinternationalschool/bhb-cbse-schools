"use client";

import { useCallback, useEffect, useState } from "react";
import { uploadMedia } from "@/lib/mediaUpload";
import {
  odometerField,
  sourceForSave,
  type DayKm,
  type GpsOdometerDay,
  type OdoSource,
} from "@/lib/transportBoardingLog";
import {
  clientId,
  registerGet,
  registerPost,
  regBtn,
  regBtnOutline,
  regField,
  rupees,
  timeIst,
} from "@/lib/transportRegisterClient";

type Gps =
  | { state: "ok"; vehicleRef: string; day: GpsOdometerDay }
  | { state: "no_data"; vehicleRef: string }
  | { state: "untracked" }
  | { state: "unavailable" };

type DayLog = {
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

type Fill = {
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
  voided: boolean;
  voidReason: string;
};

type VehicleDay = {
  id: string;
  name: string;
  registrationNo: string;
  driverName: string;
  fuelUnit: "litre" | "kg";
  routes: string[];
  log: DayLog | null;
  km: DayKm | null;
  gps: Gps;
  fills: Fill[];
};

type LogView = {
  date: string;
  today: string;
  fleetWide: boolean;
  unlinked: boolean;
  editable: boolean;
  staffId: string;
  vehicles: VehicleDay[];
};

function gpsLine(g: Gps, isToday: boolean): string {
  if (g.state === "ok") {
    return `GPS odometer: ${g.day.firstKm} km at ${timeIst(g.day.firstAt)} → ${g.day.lastKm} km at ${timeIst(g.day.lastAt)}${isToday ? " (so far)" : ""}`;
  }
  if (g.state === "no_data") return "GPS: no odometer readings kept for this day — type the figures.";
  if (g.state === "untracked") return "No GPS tracker reports for this vehicle — type the figures.";
  return "GPS feed could not be read just now — type the figures, or reload later.";
}

function SourceBadge({ source, saved }: { source: OdoSource; saved: boolean }) {
  if (!source) return null;
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase ${
        source === "gps" ? "bg-[var(--info-soft)] text-[var(--info)]" : "bg-[var(--surface-sunken)] text-[var(--muted)]"
      }`}
    >
      {source === "gps" ? "GPS" : "Typed"}
      {saved ? "" : " · not saved"}
    </span>
  );
}

/**
 * The driver's log book for one day: start / end odometer per vehicle, fuel
 * filled, remarks. Odometer boxes are pre-filled from the Fleet Edge tracker
 * where one reports, and every figure is labelled GPS or Typed — editing a
 * GPS figure makes it Typed.
 */
export function VehicleLogBook({ initialDate }: { initialDate: string }) {
  const [date, setDate] = useState(initialDate);
  const [view, setView] = useState<LogView | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setView(await registerGet<LogView>(`/api/v1/transport/logbook?date=${date}`));
    } catch (e) {
      setView(null);
      setError(e instanceof Error ? e.message : "Could not load the log book");
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-semibold text-[var(--brand-deep)]" htmlFor="logbook-date">
          Day
        </label>
        <input
          id="logbook-date"
          type="date"
          className={regField}
          value={date}
          max={view?.today}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
        <button type="button" className={regBtnOutline} onClick={() => void load()}>
          Reload
        </button>
      </div>
      {error ? (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          Could not load the log book: {error}
        </p>
      ) : null}
      {!view && !error ? <p className="text-sm text-[var(--muted)]">Loading…</p> : null}
      {view?.unlinked ? (
        <p className="rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-sm text-[var(--warning)]">
          You are not linked to a vehicle yet. Ask the office to add you under Staff → Duties (vehicle), or as the
          vehicle&apos;s driver in Transport → Fleet.
        </p>
      ) : null}
      {view && !view.editable ? (
        <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--muted)]">
          This day is closed for changes from your login.
        </p>
      ) : null}
      {view?.vehicles.map((v) => (
        <VehicleDayCard
          key={`${view.date}:${v.id}:${v.log?.rowVersion ?? 0}`}
          vehicle={v}
          date={view.date}
          isToday={view.date === view.today}
          editable={view.editable}
          fleetWide={view.fleetWide}
          staffId={view.staffId}
          onChanged={() => void load()}
        />
      ))}
    </section>
  );
}

function VehicleDayCard({
  vehicle,
  date,
  isToday,
  editable,
  fleetWide,
  staffId,
  onChanged,
}: {
  vehicle: VehicleDay;
  date: string;
  isToday: boolean;
  editable: boolean;
  fleetWide: boolean;
  staffId: string;
  onChanged: () => void;
}) {
  const gpsStart = vehicle.gps.state === "ok" ? vehicle.gps.day.firstKm : null;
  // The end figure is only offered from GPS for a finished day: today's "last
  // reading so far" is not the evening odometer.
  const gpsEnd = vehicle.gps.state === "ok" && !isToday ? vehicle.gps.day.lastKm : null;
  const startInit = odometerField(
    vehicle.log ? { value: vehicle.log.startKm, source: vehicle.log.startSource } : null,
    gpsStart,
  );
  const endInit = odometerField(vehicle.log ? { value: vehicle.log.endKm, source: vehicle.log.endSource } : null, gpsEnd);

  const [start, setStart] = useState(startInit.value == null ? "" : String(startInit.value));
  const [startSrc, setStartSrc] = useState<OdoSource>(startInit.source);
  const [end, setEnd] = useState(endInit.value == null ? "" : String(endInit.value));
  const [endSrc, setEndSrc] = useState<OdoSource>(endInit.source);
  const [driver, setDriver] = useState(vehicle.log?.driverName || vehicle.driverName || "");
  const [remarks, setRemarks] = useState(vehicle.log?.remarks ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const startNum = start.trim() === "" ? null : Number(start);
  const endNum = end.trim() === "" ? null : Number(end);
  const km =
    startNum != null && endNum != null && Number.isFinite(startNum) && Number.isFinite(endNum)
      ? endNum >= startNum
        ? `${Math.round((endNum - startNum) * 10) / 10} km`
        : "End is below start — check"
      : "";

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await registerPost("/api/v1/transport/logbook", {
        vehicleId: vehicle.id,
        date,
        startKm: start,
        startSource: sourceForSave(startNum, gpsStart, startSrc),
        endKm: end,
        endSource: sourceForSave(endNum, vehicle.gps.state === "ok" ? vehicle.gps.day.lastKm : null, endSrc),
        driverName: driver,
        remarks,
        expectedVersion: vehicle.log?.rowVersion ?? null,
      });
      setMsg({ ok: true, text: "Saved." });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Not saved" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-[var(--shadow-1)]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <p className="text-base font-bold text-[var(--brand-deep)]">{vehicle.name}</p>
        <p className="text-xs text-[var(--muted)]">
          {vehicle.registrationNo}
          {vehicle.routes.length ? ` · ${vehicle.routes.join(", ")}` : ""}
        </p>
        {vehicle.log ? (
          <p className="ml-auto text-[11px] text-[var(--muted)]">
            Saved by {vehicle.log.updatedByName || "—"} {timeIst(vehicle.log.updatedAt)}
          </p>
        ) : (
          <p className="ml-auto text-[11px] text-[var(--warning)]">Not saved for this day yet</p>
        )}
      </div>
      <p className="mt-1 text-xs text-[var(--muted)]">{gpsLine(vehicle.gps, isToday)}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-[var(--muted)]">
          <span className="flex items-center gap-2">
            Start odometer (km) <SourceBadge source={start.trim() ? startSrc : ""} saved={startInit.saved && start === String(startInit.value) && startSrc === startInit.source} />
          </span>
          <input
            inputMode="decimal"
            className={`${regField} mt-1 w-full`}
            value={start}
            disabled={!editable}
            onChange={(e) => {
              setStart(e.target.value);
              setStartSrc("typed");
            }}
          />
          {gpsStart != null && (startSrc !== "gps" || start !== String(gpsStart)) && editable ? (
            <button
              type="button"
              className="mt-1 text-[11px] font-semibold text-[var(--info)] underline"
              onClick={() => {
                setStart(String(gpsStart));
                setStartSrc("gps");
              }}
            >
              Use GPS {gpsStart}
            </button>
          ) : null}
        </label>
        <label className="block text-xs font-semibold text-[var(--muted)]">
          <span className="flex items-center gap-2">
            End odometer (km) <SourceBadge source={end.trim() ? endSrc : ""} saved={endInit.saved && end === String(endInit.value) && endSrc === endInit.source} />
          </span>
          <input
            inputMode="decimal"
            className={`${regField} mt-1 w-full`}
            value={end}
            disabled={!editable}
            onChange={(e) => {
              setEnd(e.target.value);
              setEndSrc("typed");
            }}
          />
          {vehicle.gps.state === "ok" && editable && (endSrc !== "gps" || end !== String(vehicle.gps.day.lastKm)) ? (
            <button
              type="button"
              className="mt-1 text-[11px] font-semibold text-[var(--info)] underline"
              onClick={() => {
                if (vehicle.gps.state !== "ok") return;
                setEnd(String(vehicle.gps.day.lastKm));
                setEndSrc("gps");
              }}
            >
              Use GPS {vehicle.gps.day.lastKm}
              {isToday ? " (latest so far)" : ""}
            </button>
          ) : null}
        </label>
        <label className="block text-xs font-semibold text-[var(--muted)]">
          Driver
          <input className={`${regField} mt-1 w-full`} value={driver} disabled={!editable} onChange={(e) => setDriver(e.target.value)} />
        </label>
        <label className="block text-xs font-semibold text-[var(--muted)]">
          Remarks
          <input
            className={`${regField} mt-1 w-full`}
            value={remarks}
            disabled={!editable}
            placeholder="Breakdown, detour, extra trip…"
            onChange={(e) => setRemarks(e.target.value)}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {editable ? (
          <button type="button" className={regBtn} disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save log"}
          </button>
        ) : null}
        {km ? <span className="text-sm font-semibold text-[var(--brand-deep)]">{km}</span> : null}
        {msg ? (
          <span className={`text-sm ${msg.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{msg.text}</span>
        ) : null}
      </div>

      <FuelSection
        vehicle={vehicle}
        date={date}
        editable={editable}
        fleetWide={fleetWide}
        staffId={staffId}
        onChanged={onChanged}
      />
    </div>
  );
}

function FuelSection({
  vehicle,
  date,
  editable,
  fleetWide,
  staffId,
  onChanged,
}: {
  vehicle: VehicleDay;
  date: string;
  editable: boolean;
  fleetWide: boolean;
  staffId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState("");
  const [amount, setAmount] = useState("");
  const [odo, setOdo] = useState("");
  const [note, setNote] = useState("");
  const [receiptUrl, setReceiptUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // One id per entry being typed: a double-tapped or retried Save records it once.
  const [entryId, setEntryId] = useState(() => clientId("ff"));

  const unitWord = vehicle.fuelUnit === "kg" ? "kg" : "litres";
  const live = vehicle.fills.filter((f) => !f.voided);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setMsg(null);
    const r = await uploadMedia({ file, visibility: "private", pathPrefix: `transport/fuel-receipts/${vehicle.id}` });
    setUploading(false);
    if (r.ok) setReceiptUrl(r.url);
    else setMsg({ ok: false, text: `Receipt not uploaded: ${r.error}` });
  };

  const add = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await registerPost("/api/v1/transport/logbook/fuel", {
        action: "add",
        id: entryId,
        vehicleId: vehicle.id,
        date,
        quantity: qty,
        amountRupees: amount,
        odometerKm: odo,
        receiptUrl,
        note,
      });
      setQty("");
      setAmount("");
      setOdo("");
      setNote("");
      setReceiptUrl("");
      setEntryId(clientId("ff"));
      setOpen(false);
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Not saved" });
    } finally {
      setBusy(false);
    }
  };

  const voidFill = async (f: Fill) => {
    const reason = window.prompt("Why is this fuel entry wrong?");
    if (!reason?.trim()) return;
    try {
      await registerPost("/api/v1/transport/logbook/fuel", { action: "void", id: f.id, reason });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not void" });
    }
  };

  return (
    <div className="mt-4 border-t border-[var(--border)] pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-[var(--brand-deep)]">Fuel filled</p>
        {live.length ? (
          <p className="text-xs text-[var(--muted)]">
            {live.reduce((s, f) => s + f.quantity, 0)} {unitWord} · {rupees(live.reduce((s, f) => s + f.amountPaise, 0))}
          </p>
        ) : (
          <p className="text-xs text-[var(--muted)]">None recorded this day</p>
        )}
        {editable && !open ? (
          <button type="button" className={`${regBtnOutline} ml-auto`} onClick={() => setOpen(true)}>
            + Add fuel
          </button>
        ) : null}
      </div>
      <ul className="mt-2 space-y-1.5">
        {vehicle.fills.map((f) => (
          <li
            key={f.id}
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-sm ${f.voided ? "opacity-60 line-through" : ""}`}
          >
            <span className="font-semibold">
              {f.quantity} {f.unit === "kg" ? "kg" : "L"}
            </span>
            <span>{rupees(f.amountPaise)}</span>
            {f.odometerKm != null ? <span className="text-xs text-[var(--muted)]">at {f.odometerKm} km</span> : null}
            {f.note ? <span className="text-xs text-[var(--muted)]">{f.note}</span> : null}
            <span className="text-xs text-[var(--muted)]">by {f.createdByName || "—"}</span>
            {f.receiptPath ? (
              <a className="text-xs font-semibold text-[var(--info)] underline" href={f.receiptPath} target="_blank" rel="noreferrer">
                Receipt
              </a>
            ) : null}
            {f.voided ? <span className="text-xs">Voided: {f.voidReason}</span> : null}
            {!f.voided && editable && (fleetWide || (staffId && f.createdByStaffId === staffId)) ? (
              <button type="button" className="ml-auto text-xs font-semibold text-[var(--danger)] underline" onClick={() => void voidFill(f)}>
                Void
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {open ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-[var(--muted)]">
            Quantity ({unitWord})
            <input inputMode="decimal" className={`${regField} mt-1 w-full`} value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
          <label className="block text-xs font-semibold text-[var(--muted)]">
            Amount paid (₹)
            <input inputMode="decimal" className={`${regField} mt-1 w-full`} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="block text-xs font-semibold text-[var(--muted)]">
            Odometer at the pump (km, optional)
            <input inputMode="decimal" className={`${regField} mt-1 w-full`} value={odo} onChange={(e) => setOdo(e.target.value)} />
          </label>
          <label className="block text-xs font-semibold text-[var(--muted)]">
            Note (optional)
            <input className={`${regField} mt-1 w-full`} value={note} placeholder="Pump name, bill no…" onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="block text-xs font-semibold text-[var(--muted)] sm:col-span-2">
            Receipt photo (optional)
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="mt-1 block w-full text-sm"
              onChange={(e) => void upload(e.target.files?.[0])}
            />
            {uploading ? <span className="text-[var(--muted)]">Uploading…</span> : null}
            {receiptUrl ? <span className="text-[var(--success)]">Receipt attached.</span> : null}
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="button" className={regBtn} disabled={busy || uploading} onClick={() => void add()}>
              {busy ? "Saving…" : "Save fuel"}
            </button>
            <button type="button" className={regBtnOutline} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {msg ? <p className={`mt-2 text-sm ${msg.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{msg.text}</p> : null}
    </div>
  );
}
