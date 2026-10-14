"use client";

/**
 * Accounts → Quick expense, when the head is fuel: the fill itself.
 *
 * Director, 14 Oct 2026: "allow fuel entry in Accounts and sync both ways."
 * The fill is written to the ONE fuel record (transport_fuel_fills, the
 * Transport → Fuel register) and its voucher to the book in ONE transaction
 * (/api/v1/transport/fuel "add-accounts" → transport_fuel_fill_post). The
 * amount is rate × quantity to the paisa, never typed, so the voucher line
 * and the register carry the same figure.
 */

import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { SearchPick } from "@/components/ui/SearchPick";
import { fuelAmountPaise } from "@/lib/fuelExpenseLine";
import { clientId, registerGet, registerPost } from "@/lib/transportRegisterClient";
import {
  PAYMENT_MODE_LABEL,
  unitShort,
  type FuelPaymentMode,
  type FuelUnit,
} from "@/lib/transportFuelRegister";
import { inrPaise } from "@/lib/fuelLog";

export type FuelFormVehicle = {
  id: string;
  registrationNo: string;
  name: string;
  primary: string;
  secondary: string;
  isActive: boolean;
  fuels: { fuelType: string; unit: FuelUnit }[];
};

export type FuelFormContext = {
  today: string;
  canPost: boolean;
  canEdit: boolean;
  vehicles: FuelFormVehicle[];
  banks: { bankAccountId: string; code: string; name: string }[];
  lastOdometer: Record<string, number>;
};

const FIELD = "w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm";
const LABEL = "text-[11px] font-bold text-[var(--muted)]";
const BTN =
  "inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50";

/** "1,234.56" → 123456. NaN and negatives come back as 0. */
function paiseFromRupees(v: string): number {
  const n = Number(String(v).replace(/[,\s₹]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

/** The fleet, banks and last odometers — read once from the server, never from this browser. */
export function useFuelFormContext(reloadKey = 0): { ctx: FuelFormContext | null; error: string } {
  const [ctx, setCtx] = useState<FuelFormContext | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    registerGet<FuelFormContext>("/api/v1/transport/fuel?form=1")
      .then((d) => live && setCtx(d))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "The fleet could not be read"));
    return () => {
      live = false;
    };
  }, [reloadKey]);
  return { ctx, error };
}

export function FuelEntryForm({
  onSaved,
  initialDate,
}: {
  onSaved?: (message: string) => void;
  initialDate?: string;
}) {
  const [reload, setReload] = useState(0);
  const { ctx, error: ctxError } = useFuelFormContext(reload);
  const [vehicleId, setVehicleId] = useState("");
  const [date, setDate] = useState(initialDate || new Date().toISOString().slice(0, 10));
  const [fuelType, setFuelType] = useState("");
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [odometer, setOdometer] = useState("");
  const [mode, setMode] = useState<FuelPaymentMode>("cash");
  const [bankId, setBankId] = useState("");
  const [payRef, setPayRef] = useState("");
  const [dealer, setDealer] = useState("");
  const [billNo, setBillNo] = useState("");
  const [note, setNote] = useState("");
  // Kept until the save succeeds, so a retry after a timeout lands once.
  const [entryId, setEntryId] = useState(() => clientId("fuela"));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const vehicle = ctx?.vehicles.find((v) => v.id === vehicleId);
  const fuel = vehicle?.fuels.find((f) => f.fuelType === fuelType) ?? vehicle?.fuels[0];
  const unit: FuelUnit = fuel?.unit ?? "litre";
  const ratePaise = paiseFromRupees(rate);
  const qtyNum = Math.round((Number(qty) || 0) * 100) / 100;
  const amountPaise = fuelAmountPaise(ratePaise, qtyNum);
  const lastOdo = vehicleId ? ctx?.lastOdometer[vehicleId] ?? 0 : 0;
  const odoNum = Number(odometer) || 0;
  const needsBank = mode === "bank" || mode === "upi";

  const problems: string[] = [];
  if (!vehicleId) problems.push("Choose the vehicle.");
  if (!(qtyNum > 0)) problems.push("Enter how much fuel was filled.");
  if (!(ratePaise > 0)) problems.push(`Enter the rate per ${unitShort(unit)}.`);
  if (needsBank && !bankId) problems.push("Say which bank paid.");
  if (mode === "on_account" && !dealer.trim()) problems.push("Fuel on credit is owed to someone — name the dealer.");

  const pickItems = useMemo(
    () =>
      (ctx?.vehicles ?? [])
        .filter((v) => v.isActive || v.id === vehicleId)
        .map((v) => ({
          id: v.id,
          label: v.primary,
          sub: [v.secondary, v.fuels.map((f) => f.fuelType.toUpperCase()).join(" + ")].filter(Boolean).join(" · "),
          keywords: [v.name, v.registrationNo],
        })),
    [ctx, vehicleId],
  );

  async function save() {
    if (problems.length || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const out = await registerPost<{ fill: { voucherNo: string }; notice: string }>("/api/v1/transport/fuel", {
        action: "add-accounts",
        id: entryId,
        vehicleId,
        fuelType: fuel?.fuelType ?? "",
        date,
        quantity: qtyNum,
        ratePaise,
        odometerKm: odometer,
        paymentMode: mode,
        bankAccountId: needsBank ? bankId : "",
        paymentRef: needsBank ? payRef : "",
        dealerName: dealer,
        billNo,
        note,
      });
      const msg =
        `${out.fill.voucherNo} — ${inrPaise(amountPaise)} · ${qtyNum} ${unitShort(unit)} ${fuel?.fuelType ?? ""} for ${vehicle?.primary ?? ""}` +
        " · in the book and in Transport → Fuel" +
        (out.notice ? ` · ${out.notice}` : "");
      setNotice({ tone: "ok", text: msg });
      onSaved?.(msg);
      // Vehicle, date, rate and how it was paid stay for the next bill in the pile.
      setQty("");
      setOdometer("");
      setBillNo("");
      setNote("");
      setPayRef("");
      setEntryId(clientId("fuela"));
      setReload((n) => n + 1);
    } catch (e) {
      setNotice({ tone: "bad", text: e instanceof Error ? e.message : "The fill was not saved" });
    } finally {
      setBusy(false);
    }
  }

  if (ctxError) return <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">{ctxError}</p>;
  if (!ctx) return <p className="text-xs text-[var(--muted)]">Loading the fleet…</p>;
  if (!ctx.canPost) {
    return (
      <p className="rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning)]">
        Entering fuel in Accounts needs the Accounts expense-entry permission.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {notice ? (
        <p
          className={`rounded-lg px-3 py-1.5 text-xs ${
            notice.tone === "ok" ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <label className={`${LABEL} w-full min-w-0 sm:w-60`}>
          Vehicle
          <SearchPick
            items={pickItems}
            value={vehicleId}
            onChange={(id) => {
              setVehicleId(id);
              setFuelType(ctx.vehicles.find((x) => x.id === id)?.fuels[0]?.fuelType ?? "");
            }}
            placeholder="Type a plate or name…"
            recentKey="fuel-entry-vehicle"
            aria-label="Vehicle"
          />
        </label>
        <label className={LABEL}>
          Date
          <input type="date" className={FIELD} max={ctx.today} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {vehicle && vehicle.fuels.length > 1 ? (
          <label className={LABEL}>
            Fuel
            <select className={FIELD} value={fuel?.fuelType ?? ""} onChange={(e) => setFuelType(e.target.value)}>
              {vehicle.fuels.map((f) => (
                <option key={f.fuelType} value={f.fuelType}>
                  {f.fuelType.toUpperCase()} ({unitShort(f.unit)})
                </option>
              ))}
            </select>
          </label>
        ) : fuel ? (
          <span className="rounded-lg bg-[var(--surface-sunken)] px-2 py-2 text-[11px] font-bold uppercase text-[var(--brand-deep)]">
            {fuel.fuelType} · {unitShort(fuel.unit)}
          </span>
        ) : null}
        <label className={LABEL}>
          Quantity ({unitShort(unit)})
          <input className={`${FIELD} max-w-[7rem] text-right`} inputMode="decimal" placeholder="0.00" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className={LABEL}>
          Rate ₹/{unitShort(unit)}
          <input className={`${FIELD} max-w-[7rem] text-right`} inputMode="decimal" placeholder="0.00" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        <span className={LABEL}>
          Amount
          <span
            className={`${FIELD} block min-w-[7rem] bg-[var(--surface-sunken)] text-right font-bold tabular-nums text-[var(--brand-deep)]`}
            title="Rate × quantity, to the paisa — the same figure goes to the book and the register"
          >
            {inrPaise(amountPaise)}
          </span>
        </span>
        <label className={LABEL}>
          Odometer km
          <input
            className={`${FIELD} max-w-[8rem] text-right`}
            inputMode="numeric"
            placeholder={lastOdo ? `last ${lastOdo}` : "blank if not read"}
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className={LABEL}>
          Paid by
          <select className={FIELD} value={mode} onChange={(e) => setMode(e.target.value as FuelPaymentMode)}>
            {(Object.keys(PAYMENT_MODE_LABEL) as FuelPaymentMode[]).map((m) => (
              <option key={m} value={m}>
                {PAYMENT_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        {needsBank ? (
          <>
            <label className={LABEL}>
              Bank
              <select className={FIELD} value={bankId} onChange={(e) => setBankId(e.target.value)}>
                <option value="">Which bank…</option>
                {ctx.banks.map((b) => (
                  <option key={b.bankAccountId} value={b.bankAccountId}>
                    {b.code} · {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL}>
              UTR / ref
              <input className={FIELD} value={payRef} onChange={(e) => setPayRef(e.target.value)} />
            </label>
          </>
        ) : null}
        <label className={`${LABEL} min-w-[10rem] flex-1`}>
          Dealer / pump{mode === "on_account" ? " (owed to)" : ""}
          <input className={FIELD} placeholder="e.g. Jai Hind CNG" value={dealer} onChange={(e) => setDealer(e.target.value)} />
        </label>
        <label className={LABEL}>
          Bill no.
          <input className={`${FIELD} max-w-[8rem]`} value={billNo} onChange={(e) => setBillNo(e.target.value)} />
        </label>
        <label className={`${LABEL} min-w-[10rem] flex-1`}>
          Note
          <input className={FIELD} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      {vehicleId && odoNum > 0 && lastOdo > 0 && odoNum < lastOdo ? (
        <p className="rounded-lg bg-[var(--warning-soft)] px-3 py-1.5 text-[11px] text-[var(--warning)]">
          The odometer reads {odoNum} km but the last fill showed {lastOdo} km. Check the reading — every mileage after it depends on it.
        </p>
      ) : null}
      {problems.length && (vehicleId || qty || rate) ? (
        <ul className="space-y-0.5 rounded-lg bg-[var(--danger-soft)] px-3 py-1.5 text-[11px] text-[var(--danger)]">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={BTN} disabled={busy || problems.length > 0} onClick={() => void save()}>
          <Check className="size-3.5" aria-hidden />
          {busy ? "Saving…" : "Save to the book and Transport → Fuel"}
        </button>
        <span className="text-[11px] text-[var(--muted)]">
          Dr 5031 Vehicle Fuel (Transport) · Cr{" "}
          {mode === "cash" ? "Cash in Hand" : mode === "on_account" ? "Accounts Payable — the dealer" : "the bank"}
        </span>
      </div>
    </div>
  );
}
