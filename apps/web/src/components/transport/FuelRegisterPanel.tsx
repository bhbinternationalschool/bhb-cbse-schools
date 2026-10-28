"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import type { BulkAction, RowAction } from "@/components/ui/erp-grid";
import { uploadMedia } from "@/lib/mediaUpload";
import {
  clientId,
  registerGet,
  registerPost,
  regBtn,
  regBtnOutline,
  regField,
  rupees,
} from "@/lib/transportRegisterClient";
import { SearchPick } from "@/components/ui/SearchPick";
import { ErpMetricCard, ErpMetricGrid } from "@/components/ui/erp-roster";
import { VoucherDetailDialog, type VoucherRef } from "@/components/accounts/VoucherDetailDialog";
import { fuelAmountPaise } from "@/lib/fuelExpenseLine";
import {
  FUEL_STATUS_FILTER_LABEL,
  filterFuelRows,
  fuelDatePresets,
  fuelTotals,
  inrPaise,
  mileageByFill,
  mileageTrend,
  qtyText,
  ratePaiseOf,
  singleMonthOf,
  type FuelStatusKind,
  type FuelTableRow,
} from "@/lib/fuelLog";
import { MonthRangeFilter, useMonthRange } from "@/components/ui/month-range-filter";
import { exactMonth, monthName } from "@/lib/monthRange";
import { fuelRegisterPrintHtml } from "@/lib/fuelLogPrint";
import { printWhenImagesReady } from "@/lib/printLetterheadHtml";
import {
  dateLabel,
  dateTimeIst,
  PAYMENT_MODE_LABEL,
  quantityWithUnit,
  unitShort,
  type FuelAccountsStatus,
  type FuelPaymentMode,
  type FuelUnit,
} from "@/lib/transportFuelRegister";

/* ─── what the server sends ───────────────────────────────── */

type Label = { primary: string; secondary: string };

type Fill = {
  id: string;
  vehicleId: string;
  fillDate: string;
  quantity: number;
  unit: FuelUnit;
  fuelType: string;
  ratePaise: number | null;
  amountPaise: number;
  odometerKm: number | null;
  receiptPath: string;
  note: string;
  dealerName: string;
  billNo: string;
  paymentMode: "" | FuelPaymentMode;
  bankAccountId: string;
  paymentRef: string;
  entrySource: "app" | "web" | "desk_import" | "accounts";
  voucherId: string | null;
  voucherNo: string;
  reversalVoucherNo: string;
  createdByName: string;
  createdAt: string;
  voided: boolean;
  voidReason: string;
  vehicle: Label;
  kmSincePrevious: number | null;
  rateWarning: string;
  status: FuelAccountsStatus;
};

type Totals = {
  vehicleId: string;
  vehicle: Label;
  fills: number;
  litres: number;
  kg: number;
  amountPaise: number;
  km: number | null;
  kmSource: "" | "day_log" | "fill_odometer";
  rupeesPerKm: number | null;
  kmPerUnit: number | null;
  kmPerUnitUnit: FuelUnit | null;
  fleetEdgeKm: number | null;
  fleetEdgeFuelUsed: number | null;
};

type View = {
  month: string;
  from: string;
  to: string;
  today: string;
  canViewVouchers: boolean;
  fleetWide: boolean;
  canEdit: boolean;
  canPost: boolean;
  canReverse: boolean;
  vehicles: (Label & { id: string; fuels: { fuelType: string; unit: FuelUnit }[]; isActive: boolean })[];
  fills: Fill[];
  totals: Totals[];
  fleetEdge: { ok: boolean; error?: string };
  queue: Fill[];
  banks: { bankAccountId: string; code: string; name: string }[];
  deskImport: { deskEntries: number; notYetImported: number };
};

const URL_BASE = "/api/v1/transport/fuel";

function VehicleCell({ v }: { v: Label }) {
  return (
    <div className="leading-tight">
      <div className="font-semibold">{v.primary}</div>
      {v.secondary ? <div className="text-[10px] text-[var(--muted)]">{v.secondary}</div> : null}
    </div>
  );
}

function StatusChip({ s }: { s: FuelAccountsStatus }) {
  const tone =
    s.kind === "in_accounts"
      ? "bg-[var(--success-soft)] text-[var(--success)]"
      : s.kind === "voided"
        ? "bg-[var(--surface-sunken)] text-[var(--muted)]"
        : "bg-[var(--warning-soft)] text-[var(--warning)]";
  return <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${tone}`}>{s.label}</span>;
}

function paymentText(f: Fill, banks: View["banks"]): string {
  if (!f.paymentMode) return "—";
  const base = PAYMENT_MODE_LABEL[f.paymentMode];
  if (f.paymentMode === "bank" || f.paymentMode === "upi") {
    const b = banks.find((x) => x.bankAccountId === f.bankAccountId);
    return [base, b?.name, f.paymentRef].filter(Boolean).join(" · ");
  }
  return base;
}

/* ─── payment picker (post one or many) ───────────────────── */

function PostForm({
  ids,
  banks,
  defaultMode,
  defaultDealer,
  onDone,
  onCancel,
}: {
  ids: string[];
  banks: View["banks"];
  defaultMode: "" | FuelPaymentMode;
  defaultDealer: string;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"" | FuelPaymentMode>(defaultMode);
  const [bank, setBank] = useState("");
  const [ref, setRef] = useState("");
  const [dealer, setDealer] = useState(defaultDealer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const out = await registerPost<{ posted: Fill[]; failed: { id: string; error: string }[] }>(URL_BASE, {
        action: "post-many",
        ids,
        paymentMode: mode,
        bankAccountId: bank,
        paymentRef: ref,
        ...(dealer.trim() ? { dealerName: dealer.trim() } : {}),
      });
      const nos = out.posted.map((f) => f.voucherNo).filter(Boolean);
      const msg =
        `${out.posted.length} posted${nos.length ? ` (${nos.slice(0, 3).join(", ")}${nos.length > 3 ? "…" : ""})` : ""}` +
        (out.failed.length ? ` · ${out.failed.length} not posted: ${out.failed[0]!.error}` : "");
      if (out.failed.length && out.posted.length === 0) setError(msg);
      else onDone(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not post");
    } finally {
      setBusy(false);
    }
  };

  const needsBank = mode === "bank" || mode === "upi";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
      <div className="text-sm font-semibold text-[var(--brand-deep)]">
        Post {ids.length === 1 ? "this fill" : `${ids.length} fills`} to accounts — Dr 5031 Vehicle Fuel
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="block text-[var(--muted)]">Paid by</span>
          <select className={regField} value={mode} onChange={(e) => setMode(e.target.value as FuelPaymentMode)}>
            <option value="">Choose…</option>
            {(Object.keys(PAYMENT_MODE_LABEL) as FuelPaymentMode[]).map((m) => (
              <option key={m} value={m}>
                {PAYMENT_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        {needsBank ? (
          <>
            <label className="text-xs">
              <span className="block text-[var(--muted)]">From bank</span>
              <select className={regField} value={bank} onChange={(e) => setBank(e.target.value)}>
                <option value="">Choose…</option>
                {banks.map((b) => (
                  <option key={b.bankAccountId} value={b.bankAccountId}>
                    {b.code} · {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="block text-[var(--muted)]">UTR / ref (optional)</span>
              <input className={regField} value={ref} onChange={(e) => setRef(e.target.value)} />
            </label>
          </>
        ) : null}
        <label className="text-xs">
          <span className="block text-[var(--muted)]">Dealer / pump{mode === "on_account" ? " (required)" : ""}</span>
          <input className={regField} value={dealer} onChange={(e) => setDealer(e.target.value)} placeholder="e.g. Shiv CNG station" />
        </label>
        <button type="button" className={regBtn} disabled={busy || !mode || (needsBank && !bank) || (mode === "on_account" && !dealer.trim())} onClick={submit}>
          {busy ? "Posting…" : "Post"}
        </button>
        <button type="button" className={regBtnOutline} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      <p className="mt-1 text-[11px] text-[var(--muted)]">
        Cash is booked from the cash box (1000 Cash in Hand); bank and UPI from the bank you choose; on account
        becomes a payable to the dealer. A fill is never posted twice — pressing again lands on the same voucher.
      </p>
      {error ? <p className="mt-1 text-xs text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}

/* ─── add a fill (office) ─────────────────────────────────── */

function AddFillForm({ view, onSaved }: { view: View; onSaved: (msg: string) => void }) {
  const active = view.vehicles.filter((v) => v.isActive);
  const [entryId, setEntryId] = useState(() => clientId("fuelw"));
  const [vehicleId, setVehicleId] = useState("");
  const vehicle = active.find((v) => v.id === vehicleId);
  const [fuelType, setFuelType] = useState("");
  const [date, setDate] = useState(view.today);
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [odo, setOdo] = useState("");
  const [dealer, setDealer] = useState("");
  const [billNo, setBillNo] = useState("");
  const [mode, setMode] = useState<"" | FuelPaymentMode>("");
  const [bank, setBank] = useState("");
  const [ref, setRef] = useState("");
  const [receiptUrl, setReceiptUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const fuel = vehicle?.fuels.find((f) => f.fuelType === fuelType) ?? vehicle?.fuels[0];
  const unit = fuel?.unit ?? "litre";
  // Rate × quantity, to the paisa — the same rule Accounts and the table's
  // check use, so the voucher line and this register carry one figure.
  const ratePaise = Math.round((Number(rate.replace(/[,\s₹]/g, "")) || 0) * 100);
  const qtyNum = Math.round((Number(qty) || 0) * 100) / 100;
  const amountPaise = fuelAmountPaise(ratePaise, qtyNum);

  const upload = async (file: File | undefined) => {
    if (!file || !vehicle) return;
    setUploading(true);
    const r = await uploadMedia({ file, visibility: "private", pathPrefix: `transport/fuel-receipts/${vehicle.id}` });
    setUploading(false);
    if (r.ok) setReceiptUrl(r.url);
    else setError(`Bill photo not uploaded: ${r.error}`);
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const out = await registerPost<{ fill: Fill; notice: string }>(URL_BASE, {
        action: "add",
        id: entryId,
        vehicleId,
        fuelType: fuel?.fuelType ?? "",
        date,
        quantity: qty,
        ratePaise,
        odometerKm: odo,
        dealerName: dealer,
        billNo,
        receiptUrl,
        ...(mode ? { paymentMode: mode, bankAccountId: bank, paymentRef: ref } : {}),
      });
      onSaved(
        out.notice ||
          (out.fill.voucherNo
            ? `Saved and posted as ${out.fill.voucherNo}`
            : "Saved — not in accounts until someone sets how it was paid"),
      );
      setEntryId(clientId("fuelw"));
      setQty("");
      setOdo("");
      setBillNo("");
      setReceiptUrl("");
      setRef("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const needsBank = mode === "bank" || mode === "upi";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h3 className="text-sm font-bold text-[var(--brand-deep)]">Enter a fill</h3>
      <p className="text-[11px] text-[var(--muted)]">
        Entered once — here or in Accounts → Quick / Multi-line expense; either way it is one fill and one voucher,
        written together. With a payment mode it posts the Vehicle Fuel expense; without one it waits as &ldquo;not in
        accounts&rdquo; for the office.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs">
          <span className="block text-[var(--muted)]">Bus</span>
          <select className={`${regField} w-full`} value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); setFuelType(""); }}>
            <option value="">Choose…</option>
            {active.map((v) => (
              <option key={v.id} value={v.id}>
                {v.primary}
                {v.secondary ? ` (${v.secondary})` : ""}
              </option>
            ))}
          </select>
        </label>
        {vehicle && vehicle.fuels.length > 1 ? (
          <label className="text-xs">
            <span className="block text-[var(--muted)]">Fuel</span>
            <select className={`${regField} w-full`} value={fuel?.fuelType ?? ""} onChange={(e) => setFuelType(e.target.value)}>
              {vehicle.fuels.map((f) => (
                <option key={f.fuelType} value={f.fuelType}>
                  {f.fuelType.toUpperCase()} ({unitShort(f.unit)})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="text-xs">
          <span className="block text-[var(--muted)]">Date</span>
          <input type="date" className={`${regField} w-full`} max={view.today} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="block text-[var(--muted)]">Quantity ({unitShort(unit)})</span>
          <input inputMode="decimal" className={`${regField} w-full`} value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="block text-[var(--muted)]">Rate ₹/{unitShort(unit)}</span>
          <input inputMode="decimal" className={`${regField} w-full`} value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        <div className="text-xs">
          <span className="block text-[var(--muted)]">Amount (rate × quantity)</span>
          <span className={`${regField} block w-full bg-[var(--surface-sunken)] text-right font-bold tabular-nums`}>{inrPaise(amountPaise)}</span>
        </div>
        <label className="text-xs">
          <span className="block text-[var(--muted)]">Odometer km (blank if not read)</span>
          <input inputMode="decimal" className={`${regField} w-full`} value={odo} onChange={(e) => setOdo(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="block text-[var(--muted)]">Dealer / pump</span>
          <input className={`${regField} w-full`} value={dealer} onChange={(e) => setDealer(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="block text-[var(--muted)]">Bill no.</span>
          <input className={`${regField} w-full`} value={billNo} onChange={(e) => setBillNo(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="block text-[var(--muted)]">Bill photo {receiptUrl ? "· attached" : uploading ? "· uploading…" : ""}</span>
          <input type="file" accept="image/*,application/pdf" className="text-xs" disabled={!vehicle || uploading} onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
        <label className="text-xs">
          <span className="block text-[var(--muted)]">Paid by</span>
          <select className={`${regField} w-full`} value={mode} onChange={(e) => setMode(e.target.value as FuelPaymentMode)}>
            <option value="">Not known yet (no voucher)</option>
            {(Object.keys(PAYMENT_MODE_LABEL) as FuelPaymentMode[]).map((m) => (
              <option key={m} value={m}>
                {PAYMENT_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        {needsBank ? (
          <>
            <label className="text-xs">
              <span className="block text-[var(--muted)]">From bank</span>
              <select className={`${regField} w-full`} value={bank} onChange={(e) => setBank(e.target.value)}>
                <option value="">Choose…</option>
                {view.banks.map((b) => (
                  <option key={b.bankAccountId} value={b.bankAccountId}>
                    {b.code} · {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="block text-[var(--muted)]">UTR / ref</span>
              <input className={`${regField} w-full`} value={ref} onChange={(e) => setRef(e.target.value)} />
            </label>
          </>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={regBtn}
          disabled={busy || uploading || !vehicleId || !(qtyNum > 0) || !(ratePaise > 0) || (needsBank && !bank) || (mode === "on_account" && !dealer.trim())}
          onClick={save}
        >
          {busy ? "Saving…" : mode ? "Save and post" : "Save"}
        </button>
        {mode && !view.canPost ? (
          <span className="text-[11px] text-[var(--warning)]">You can save; posting needs the Accounts expense-entry permission.</span>
        ) : null}
        {error ? <span className="text-xs text-[var(--danger)]">{error}</span> : null}
      </div>
    </div>
  );
}

/* ─── the panel ───────────────────────────────────────────── */

function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** The row the table helpers (lib/fuelLog) work on. */
function tableRow(f: Fill): FuelTableRow & { fill: Fill } {
  return {
    id: f.id,
    vehicleId: f.vehicleId,
    vehicleName: f.vehicle.primary,
    fillDate: f.fillDate,
    createdAt: f.createdAt,
    fuelType: f.fuelType,
    unit: f.unit,
    quantity: f.quantity,
    ratePaise: f.ratePaise,
    amountPaise: f.amountPaise,
    odometerKm: f.odometerKm,
    voided: f.voided,
    statusKind: f.status.kind,
    fill: f,
  };
}

/**
 * Transport → Fuel: the one fuel register (transport_fuel_fills).
 *
 * Director, 14 Oct 2026: "show the fuel log as a table, filter any single
 * vehicle or all, and by date range." Every figure comes from the server on
 * each load — no desk state, no localStorage. The date range picks the fills;
 * vehicle, fuel and status narrow them on screen. Fills keyed in Accounts are
 * here too (one record, written with its voucher), and a voucher reversed in
 * Accounts shows its fill voided with the reversal number.
 */
export function FuelRegisterPanel() {
  const presets = useMemo(() => fuelDatePresets(istToday()), []);
  // One period (lib/monthRange.ts): the month box and From / To always
  // describe the same dates. Not bound to a session — fills go back years.
  const period = useMonthRange({ initial: presets.thisMonth });
  const { from, to } = period;
  const [vehicleId, setVehicleId] = useState("");
  const [fuelFilter, setFuelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<FuelStatusKind | "">("");
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [posting, setPosting] = useState<{ ids: string[]; mode: "" | FuelPaymentMode; dealer: string } | null>(null);
  const [amending, setAmending] = useState<Fill | null>(null);
  const [importing, setImporting] = useState(false);
  const [voucher, setVoucher] = useState<VoucherRef | null>(null);

  // The month sent is only the server's fallback when From or To is blank
  // (the range's own month, else the month it ends in). The list, the
  // per-bus totals and Fleet Edge all read exactly From..To.
  const today = istToday();
  const month = singleMonthOf(from, to) || (to && to < today ? to : today).slice(0, 7);

  const load = useCallback(async () => {
    setError("");
    try {
      const q = new URLSearchParams({ month });
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      if (vehicleId) q.set("vehicleId", vehicleId);
      setView(await registerGet<View>(`${URL_BASE}?${q.toString()}`));
    } catch (e) {
      setView(null);
      setError(e instanceof Error ? e.message : "Could not load the fuel register");
    }
  }, [month, from, to, vehicleId]);

  useEffect(() => {
    void load();
  }, [load]);

  const done = (m: string) => {
    setMsg(m);
    setPosting(null);
    setAmending(null);
    void load();
  };

  const voidFill = async (f: Fill) => {
    const reason = window.prompt(
      f.status.kind === "in_accounts"
        ? `Void this fill? Its voucher ${f.voucherNo} will be reversed (a voucher that also carries other lines is voided in Accounts instead). Why is it wrong?`
        : "Void this fill? It stays in the register, struck through. Why is it wrong?",
    );
    if (!reason?.trim()) return;
    try {
      const out = await registerPost<{ notice: string; fill: Fill }>(URL_BASE, { action: "void", id: f.id, reason: reason.trim() });
      done(out.notice || (out.fill.reversalVoucherNo ? `Voided — ${f.voucherNo} reversed by ${out.fill.reversalVoucherNo}` : "Voided"));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not void");
    }
  };

  const runImport = async () => {
    setImporting(true);
    try {
      const out = await registerPost<{
        result: { imported: number; linkedToAccounts: number; notInAccounts: number; alreadyImported: number; skipped: { reason: string }[] };
        notice: string;
      }>(URL_BASE, { action: "import-desk" });
      const r = out.result;
      done(
        `Imported ${r.imported}: ${r.linkedToAccounts} already in accounts (linked to the voucher keyed there), ${r.notInAccounts} not in accounts` +
          (r.alreadyImported ? ` · ${r.alreadyImported} were imported before` : "") +
          (r.skipped.length ? ` · ${r.skipped.length} skipped (${r.skipped[0]!.reason})` : "") +
          (out.notice ? ` · ${out.notice}` : ""),
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const banks = useMemo(() => view?.banks ?? [], [view]);
  const writable = !!view?.canEdit;

  const all = useMemo(() => (view?.fills ?? []).map(tableRow), [view]);
  const rows = useMemo(
    () => filterFuelRows(all, { vehicleId: "", from: "", to: "", fuelType: fuelFilter, status: statusFilter }),
    [all, fuelFilter, statusFilter],
  );
  const mileage = useMemo(() => mileageByFill(all), [all]);
  const totals = useMemo(() => fuelTotals(rows), [rows]);
  const trend = useMemo(() => mileageTrend(rows, mileage), [rows, mileage]);
  const fuelTypes = useMemo(() => [...new Set(all.map((r) => r.fuelType).filter(Boolean))].sort(), [all]);
  const vehicleItems = useMemo(
    () =>
      (view?.vehicles ?? []).map((v) => ({
        id: v.id,
        label: v.primary,
        sub: [v.secondary, v.isActive ? "" : "inactive"].filter(Boolean).join(" · "),
      })),
    [view],
  );
  const vehicleName = vehicleItems.find((v) => v.id === vehicleId)?.label ?? "All vehicles";
  const filterNote = [
    vehicleName,
    `${from ? dateLabel(from) : "start"} → ${to ? dateLabel(to) : "today"}`,
    fuelFilter ? fuelFilter.toUpperCase() : "",
    statusFilter ? FUEL_STATUS_FILTER_LABEL[statusFilter] : "",
  ]
    .filter(Boolean)
    .join(" · ");

  // The per-bus table's period is the one the server read (view.from..to) —
  // the same dates as the fill list; a whole month is named as the month.
  const perBusMonth = view ? exactMonth({ from: view.from, to: view.to }) : null;
  const perBusPeriod = !view ? "" : perBusMonth ? monthName(perBusMonth) : `${dateLabel(view.from)} → ${dateLabel(view.to)}`;
  const perBusNote = [vehicleName, perBusPeriod].filter(Boolean).join(" · ");

  const openVoucher = (f: Fill) => {
    if (f.voucherNo && view?.canViewVouchers) setVoucher({ voucherId: f.voucherId ?? undefined, voucherNo: f.voucherNo });
  };

  const print = () => {
    const w = window.open("", "_blank", "width=1100,height=900");
    if (!w) {
      setMsg("The browser blocked the print window — allow pop-ups for this site.");
      return;
    }
    w.document.write(
      fuelRegisterPrintHtml({
        rows: rows.map((r) => ({
          fillDate: r.fillDate,
          vehicle: r.vehicleName,
          fuelType: r.fuelType,
          quantity: r.quantity,
          unit: r.unit,
          ratePaise: ratePaiseOf(r),
          amountPaise: r.amountPaise,
          odometerKm: r.odometerKm,
          kmSinceLast: r.fill.kmSincePrevious,
          kmPerUnit: mileage.get(r.id)?.kmPerUnit ?? null,
          paidBy: paymentText(r.fill, banks),
          billDealer: [r.fill.billNo, r.fill.dealerName].filter(Boolean).join(" · "),
          voucherNo: r.fill.voucherNo,
          status: r.fill.status.label,
          voided: r.voided,
        })),
        totals,
        perVehicle: !vehicleId,
        filterNote,
      }),
    );
    w.document.close();
    printWhenImagesReady(w);
  };

  type Row = ReturnType<typeof tableRow>;

  const fillColumns: DataTableColumn<Row>[] = useMemo(
    () => [
      {
        key: "date",
        header: "Date (IST)",
        sortable: true,
        value: (r) => r.fillDate,
        render: (r) => (
          <div className="leading-tight">
            <div className={r.voided ? "line-through" : ""}>{dateLabel(r.fillDate)}</div>
            <div className="text-[10px] text-[var(--muted)]">entered {dateTimeIst(r.createdAt)}</div>
          </div>
        ),
      },
      { key: "bus", header: "Vehicle", sortable: true, value: (r) => r.vehicleName, render: (r) => <VehicleCell v={r.fill.vehicle} /> },
      { key: "fuel", header: "Fuel", value: (r) => r.fuelType.toUpperCase(), render: (r) => <span className="text-xs uppercase">{r.fuelType || "—"}</span> },
      {
        key: "qty",
        header: "Quantity",
        align: "right",
        sortable: true,
        value: (r) => r.quantity,
        render: (r) => (
          <div className="leading-tight">
            <div className={r.voided ? "line-through" : ""}>{quantityWithUnit(r.quantity, r.unit)}</div>
            {r.fill.rateWarning ? <div className="text-[10px] text-[var(--warning)]">{r.fill.rateWarning}</div> : null}
          </div>
        ),
      },
      {
        key: "rate",
        header: "Rate",
        align: "right",
        value: (r) => ratePaiseOf(r) / 100,
        render: (r) => <span className={r.voided ? "line-through" : ""}>{inrPaise(ratePaiseOf(r))}/{unitShort(r.unit)}</span>,
      },
      {
        key: "amount",
        header: "Amount",
        align: "right",
        sortable: true,
        value: (r) => r.amountPaise / 100,
        render: (r) => <span className={`font-semibold tabular-nums ${r.voided ? "line-through" : ""}`}>{inrPaise(r.amountPaise)}</span>,
      },
      {
        key: "odo",
        header: "Odometer",
        align: "right",
        value: (r) => r.odometerKm,
        render: (r) =>
          r.odometerKm == null ? <span className="text-[var(--muted)]">not read</span> : `${r.odometerKm.toLocaleString("en-IN")} km`,
      },
      {
        key: "km",
        header: "Km since last",
        align: "right",
        value: (r) => r.fill.kmSincePrevious,
        render: (r) => (r.fill.kmSincePrevious == null ? "—" : r.fill.kmSincePrevious.toLocaleString("en-IN")),
      },
      {
        key: "kpu",
        header: "Km / unit",
        align: "right",
        value: (r) => mileage.get(r.id)?.kmPerUnit ?? null,
        render: (r) => {
          const m = mileage.get(r.id);
          return m ? `${m.kmPerUnit.toFixed(2)} km/${unitShort(r.unit)}` : "—";
        },
      },
      { key: "pay", header: "Paid by", value: (r) => paymentText(r.fill, banks), render: (r) => <span className="text-xs">{paymentText(r.fill, banks)}</span> },
      {
        key: "bill",
        header: "Bill / dealer",
        value: (r) => [r.fill.billNo, r.fill.dealerName].filter(Boolean).join(" · "),
        render: (r) => (
          <div className="text-xs leading-tight">
            <div>{[r.fill.billNo, r.fill.dealerName].filter(Boolean).join(" · ") || "—"}</div>
            {r.fill.receiptPath ? (
              <a className="text-[var(--primary)] underline" href={r.fill.receiptPath} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                photo
              </a>
            ) : null}
          </div>
        ),
      },
      {
        key: "voucher",
        header: "Voucher",
        value: (r) => r.fill.voucherNo,
        render: (r) =>
          r.fill.voucherNo ? (
            <span className="text-xs font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline">{r.fill.voucherNo}</span>
          ) : (
            <span className="text-[var(--muted)]">—</span>
          ),
      },
      {
        key: "status",
        header: "Status",
        value: (r) => r.fill.status.label,
        render: (r) => (
          <div className="leading-tight">
            <StatusChip s={r.fill.status} />
            {r.voided && r.fill.voidReason ? <div className="text-[10px] text-[var(--muted)]">{r.fill.voidReason}</div> : null}
            <div className="text-[10px] text-[var(--muted)]">
              {r.fill.entrySource === "app"
                ? "driver log book"
                : r.fill.entrySource === "desk_import"
                  ? "old Fuel tab"
                  : r.fill.entrySource === "accounts"
                    ? "keyed in Accounts"
                    : "Transport office"}
              {r.fill.createdByName ? ` · ${r.fill.createdByName}` : ""}
            </div>
          </div>
        ),
      },
    ],
    [banks, mileage],
  );

  const rowActions: RowAction<Row>[] = [
    {
      id: "voucher",
      label: "Open voucher",
      hidden: (r) => !r.fill.voucherNo || !view?.canViewVouchers,
      onSelect: (r) => openVoucher(r.fill),
    },
    {
      id: "post",
      label: "Post to accounts…",
      hidden: (r) => !writable || r.voided || r.fill.status.kind === "in_accounts",
      disabled: () => !view?.canPost,
      onSelect: (r) => setPosting({ ids: [r.id], mode: r.fill.paymentMode, dealer: r.fill.dealerName }),
    },
    {
      id: "amend",
      label: "Correct odometer / dealer / bill…",
      hidden: (r) => !writable || r.voided,
      onSelect: (r) => setAmending(r.fill),
    },
    {
      id: "photo",
      label: "Open bill photo",
      hidden: (r) => !r.fill.receiptPath,
      onSelect: (r) => window.open(r.fill.receiptPath, "_blank", "noopener"),
    },
    {
      id: "void",
      label: "Void…",
      tone: "danger",
      separatorAbove: true,
      hidden: (r) => !writable || r.voided,
      disabled: (r) => r.fill.status.kind === "in_accounts" && !view?.canReverse,
      onSelect: (r) => void voidFill(r.fill),
    },
  ];

  const queueColumns = fillColumns.filter((c) => !["kpu", "km", "voucher"].includes(c.key));
  const queueRows = useMemo(() => (view?.queue ?? []).map(tableRow), [view]);
  const queueBulk: BulkAction[] = view?.canPost
    ? [{ id: "post", label: "Post to accounts…", onRun: (keys) => setPosting({ ids: keys, mode: "", dealer: "" }) }]
    : [];

  const subtotalColumns: DataTableColumn<ReturnType<typeof fuelTotals>["byVehicle"][number]>[] = [
    { key: "veh", header: "Vehicle", sortable: true, value: (t) => t.vehicleName },
    { key: "fills", header: "Fills", align: "right", value: (t) => t.fills },
    { key: "qty", header: "Quantity", align: "right", value: (t) => qtyText(t) },
    { key: "amt", header: "Amount", align: "right", sortable: true, value: (t) => t.amountPaise / 100, render: (t) => inrPaise(t.amountPaise) },
    {
      key: "avg",
      header: "Avg km / unit",
      align: "right",
      value: (t) => trend.filter((x) => x.vehicleId === t.vehicleId).map((x) => `${x.average} km/${unitShort(x.unit as FuelUnit)}`).join(" · ") || "—",
    },
  ];
  const subtotalActions: RowAction<ReturnType<typeof fuelTotals>["byVehicle"][number]>[] = [
    { id: "only", label: "Show only this vehicle", onSelect: (t) => setVehicleId(t.vehicleId) },
  ];

  const totalsColumns: DataTableColumn<Totals>[] = [
    { key: "bus", header: "Bus", value: (t) => t.vehicle.primary, sortable: true, render: (t) => <VehicleCell v={t.vehicle} /> },
    { key: "fills", header: "Fills", align: "right", value: (t) => t.fills },
    {
      key: "qty",
      header: "Quantity",
      align: "right",
      value: (t) => t.kg + t.litres,
      render: (t) =>
        [t.kg ? quantityWithUnit(t.kg, "kg") : "", t.litres ? quantityWithUnit(t.litres, "litre") : ""].filter(Boolean).join(" + ") || "—",
    },
    { key: "amt", header: "₹", align: "right", sortable: true, value: (t) => t.amountPaise, render: (t) => rupees(t.amountPaise) },
    {
      key: "km",
      header: "Km",
      align: "right",
      value: (t) => t.km,
      render: (t) =>
        t.km == null ? (
          <span className="text-[var(--muted)]">not known</span>
        ) : (
          <div className="leading-tight">
            <div>{t.km.toLocaleString("en-IN")}</div>
            <div className="text-[10px] text-[var(--muted)]">{t.kmSource === "day_log" ? "log book" : "fill odometers"}</div>
          </div>
        ),
    },
    { key: "rpk", header: "₹/km", align: "right", value: (t) => t.rupeesPerKm, render: (t) => (t.rupeesPerKm == null ? "—" : `₹${t.rupeesPerKm.toFixed(2)}`) },
    {
      key: "kpu",
      header: "Km per unit",
      align: "right",
      value: (t) => t.kmPerUnit,
      render: (t) => (t.kmPerUnit == null || !t.kmPerUnitUnit ? "—" : `${t.kmPerUnit} km/${unitShort(t.kmPerUnitUnit)}`),
    },
    {
      key: "fekm",
      header: "Fleet Edge km",
      align: "right",
      value: (t) => t.fleetEdgeKm,
      render: (t) => (t.fleetEdgeKm == null ? <span className="text-[var(--muted)]">no data</span> : t.fleetEdgeKm.toLocaleString("en-IN")),
    },
    {
      key: "fefuel",
      header: "Fleet Edge fuel used",
      align: "right",
      value: (t) => t.fleetEdgeFuelUsed,
      render: (t) => (t.fleetEdgeFuelUsed == null ? <span className="text-[var(--muted)]">no data</span> : t.fleetEdgeFuelUsed.toLocaleString("en-IN")),
    },
  ];

  const totalsActions: RowAction<Totals>[] = [{ id: "only", label: "Show only this bus", onSelect: (t) => setVehicleId(t.vehicleId) }];

  const chip = "rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--brand-deep)]";
  const notInBook = (view?.queue ?? []).length;

  return (
    <section className="mt-4 space-y-4">
      {error ? <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p> : null}
      {msg ? <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-sm">{msg}</p> : null}

      <ErpMetricGrid>
        <ErpMetricCard title="Fills" value={totals.all.fills} tone="sky" hint={filterNote} />
        <ErpMetricCard title="Fuel cost" value={inrPaise(totals.all.amountPaise)} tone="green" hint="Live fills in this view" />
        <ErpMetricCard title="Quantity" value={qtyText(totals.all)} tone="violet" hint="kg and litres kept apart" />
        <ErpMetricCard
          title="Not in the book"
          value={notInBook}
          tone={notInBook ? "amber" : "navy"}
          hint={notInBook ? "Waiting for the office to post" : "Every fill is in the book"}
        />
      </ErpMetricGrid>

      {view && writable && view.deskImport.notYetImported > 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
          <div className="text-sm font-semibold text-[var(--brand-deep)]">
            {view.deskImport.notYetImported} fuel entries are still in the old Fuel tab
          </div>
          <p className="text-[11px] text-[var(--muted)]">
            Copies them into this register once (safe to press again). Odometers the old tab saved as 0 come in as
            &ldquo;not read&rdquo;. Nothing is posted: an entry already keyed in Accounts is linked to that voucher;
            the rest show &ldquo;Not in accounts&rdquo;. Read the reconcile below first to see exactly what it will do.
          </p>
          <button type="button" className={`${regBtn} mt-2`} disabled={importing} onClick={runImport}>
            {importing ? "Importing…" : `Import old fuel entries (${view.deskImport.notYetImported})`}
          </button>
        </div>
      ) : null}

      {view && writable && view.fleetWide && view.canViewVouchers ? <FuelReconcileCard canApprove={view.canReverse} onDone={done} /> : null}

      {posting && view ? (
        <PostForm
          ids={posting.ids}
          banks={view.banks}
          defaultMode={posting.mode}
          defaultDealer={posting.dealer}
          onDone={done}
          onCancel={() => setPosting(null)}
        />
      ) : null}

      {amending ? <AmendForm fill={amending} onDone={done} onCancel={() => setAmending(null)} /> : null}

      {view && view.fleetWide && view.queue.length > 0 ? (
        <div className="rounded-xl border border-[var(--warning)] bg-[var(--card)] p-3">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            Not in accounts yet — {view.queue.length} fill{view.queue.length === 1 ? "" : "s"},{" "}
            {inrPaise(view.queue.reduce((s, f) => s + f.amountPaise, 0))}
          </h3>
          <p className="text-[11px] text-[var(--muted)]">
            Driver entries, and fills saved by someone who keeps the register but does not post vouchers, wait here until
            the office says how they were paid; posting books Dr 5031 Vehicle Fuel and ties the fill to it in one step.
            Tick several to post them together.
          </p>
          <DataTable
            columns={queueColumns}
            rows={queueRows}
            rowKey={(r) => r.id}
            rowActions={rowActions}
            bulkActions={queueBulk}
            selectionNoun="fill"
            pageSize={20}
            minWidth="min-w-[1100px]"
          />
        </div>
      ) : null}

      {view && writable ? <AddFillForm view={view} onSaved={done} /> : null}

      <div className="erp-control-bar flex flex-wrap items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 shadow-[var(--shadow-1)]">
        <label className="w-56 text-xs">
          <span className="block text-[var(--muted)]">Vehicle</span>
          <SearchPick
            items={vehicleItems}
            value={vehicleId}
            onChange={setVehicleId}
            placeholder="All vehicles"
            clearable
            aria-label="Vehicle"
          />
        </label>
        <MonthRangeFilter
          period={period}
          labelClassName="text-xs"
          captionClassName="block text-[var(--muted)]"
          fieldClassName={regField}
          testId="fuel-period"
        />
        <button type="button" className={chip} onClick={() => period.setRange(presets.thisMonth)}>
          This month
        </button>
        <button type="button" className={chip} onClick={() => period.setRange(presets.lastMonth)}>
          Last month
        </button>
        <button type="button" className={chip} onClick={() => period.setRange(presets.thisFy)}>
          This FY
        </button>
        <label className="text-xs">
          <span className="block text-[var(--muted)]">Fuel</span>
          <select className={regField} value={fuelFilter} onChange={(e) => setFuelFilter(e.target.value)}>
            <option value="">All fuels</option>
            {fuelTypes.map((f) => (
              <option key={f} value={f}>
                {f.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-[var(--muted)]">Status</span>
          <select className={regField} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as FuelStatusKind | "")}>
            <option value="">All</option>
            {(Object.keys(FUEL_STATUS_FILTER_LABEL) as FuelStatusKind[]).map((k) => (
              <option key={k} value={k}>
                {FUEL_STATUS_FILTER_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-[var(--muted)]">
            {rows.length} of {all.length} fills
          </span>
          <button type="button" className={regBtnOutline} onClick={print} disabled={!rows.length}>
            Print
          </button>
          <button type="button" className={regBtnOutline} onClick={() => void load()}>
            Reload
          </button>
        </div>
      </div>

      {view ? (
        <div className="space-y-2" data-testid="fuel-log">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            Fuel log — {filterNote} ({rows.length})
          </h3>
          <DataTable
            columns={fillColumns}
            rows={rows}
            rowKey={(r) => r.id}
            rowActions={rowActions}
            onRowClick={(r) => openVoucher(r.fill)}
            pageSize={50}
            minWidth="min-w-[1300px]"
            emptyTitle="No fuel in this view"
            exportFileBaseName={`fuel-log-${from || "start"}-${to || "today"}`}
            exportTitle="Fuel log"
            exportFilterNote={filterNote}
          />
          <p className="rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-sm font-semibold text-[var(--brand-deep)]">
            Total — {totals.all.fills} live fill(s) · {qtyText(totals.all)} · {inrPaise(totals.all.amountPaise)}
            <span className="ml-2 text-[11px] font-normal text-[var(--muted)]">Voided fills are shown struck through and not added in.</span>
          </p>
        </div>
      ) : null}

      {view && !vehicleId && totals.byVehicle.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">By vehicle — {filterNote}</h3>
          <DataTable
            columns={subtotalColumns}
            rows={totals.byVehicle.filter((t) => t.fills > 0)}
            rowKey={(t) => t.vehicleId}
            rowActions={subtotalActions}
            pageSize={20}
            minWidth="min-w-[640px]"
            exportFileBaseName={`fuel-by-vehicle-${from || "start"}-${to || "today"}`}
            exportTitle="Fuel by vehicle"
            exportFilterNote={filterNote}
          />
        </div>
      ) : null}

      {trend.length ? (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">Mileage trend</h3>
          <p className="text-[11px] text-[var(--muted)]">
            Km per unit, fill to fill, for fills with an odometer reading — per vehicle and per fuel (a CNG bus&apos;s
            petrol is its own line).
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {trend.map((t) => (
              <ErpMetricCard
                key={`${t.vehicleId}|${t.fuelType}`}
                title={`${t.vehicleName} · ${t.fuelType.toUpperCase()}`}
                value={`${t.average.toFixed(2)} km/${unitShort(t.unit as FuelUnit)}`}
                tone="navy"
                hint={`average over ${t.points.length} fill(s)`}
                spark={t.points.map((p, i) => ({ key: String(i), label: p.date, value: p.kmPerUnit }))}
              />
            ))}
          </div>
        </div>
      ) : null}

      {view ? (
        <div className="space-y-2" data-testid="fuel-per-bus">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]" data-testid="fuel-per-bus-heading">
            Per bus — {perBusPeriod}
          </h3>
          {!view.fleetEdge.ok ? (
            <p className="text-[11px] text-[var(--warning)]">Fleet Edge could not be read just now ({view.fleetEdge.error}); its columns are blank, not zero.</p>
          ) : (
            <p className="text-[11px] text-[var(--muted)]">
              Km comes from the log book (days with both readings), else from odometers at consecutive fills; blank when
              neither is known. Fleet Edge columns are what the tracker reported for these dates (each 30-minute window
              counted once); its fuel figure is as Fleet Edge sends it and is not a meter reading of CNG.
            </p>
          )}
          <DataTable
            columns={totalsColumns}
            rows={view.totals}
            rowKey={(t) => t.vehicleId}
            rowActions={totalsActions}
            pageSize={20}
            minWidth="min-w-[900px]"
            exportFileBaseName={`fuel-by-bus-${view.from}-${view.to}`}
            exportTitle={`Fuel by bus — ${perBusPeriod}`}
            exportFilterNote={perBusNote}
          />
        </div>
      ) : null}

      {voucher ? <VoucherDetailDialog target={voucher} onClose={() => setVoucher(null)} /> : null}
    </section>
  );
}

/* ─── the one-time reconcile ──────────────────────────────── */

type ReconcileView = {
  matched: { refill: { id: string; vehicleId: string; fillDate: string; qty: number; amountPaise: number }; line: { voucherNo: string; debitPaise: number } }[];
  refillOnly: { id: string; vehicleId: string; fillDate: string; qty: number; amountPaise: number; imported: boolean }[];
  lineOnly: { lineId: string; voucherNo: string; voucherDate: string; debitPaise: number; narration: string; tieTo: string[]; refusal: string }[];
  importedNotInAccounts: Fill[];
  deskEntries: number;
  liveLines: number;
  liveLinePaise: number;
};

/**
 * The old desk fuel log against the book — read-only until the director
 * confirms a group. Nothing is deleted: a refill no live voucher holds is
 * voided (kept, struck through); live fuel money with no fill gets one,
 * tied to its own line.
 */
function FuelReconcileCard({ canApprove, onDone }: { canApprove: boolean; onDone: (m: string) => void }) {
  const [report, setReport] = useState<ReconcileView | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const read = async () => {
    setError("");
    try {
      const out = await registerPost<{ report: ReconcileView }>(URL_BASE, { action: "reconcile-report" });
      setReport(out.report);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the reconcile");
    }
  };

  const run = async (label: string, body: Record<string, unknown>, count: number) => {
    if (!count || !window.confirm(`${label} — ${count} row(s). Continue?`)) return;
    setBusy(label);
    try {
      const out = await registerPost<{ done: number; failed: { error: string }[] }>(URL_BASE, body);
      onDone(`${label}: ${out.done} done${out.failed.length ? ` · ${out.failed.length} refused (${out.failed[0]!.error})` : ""}`);
      await read();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refused");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="text-sm font-semibold text-[var(--brand-deep)]">Reconcile the old fuel log with the book</div>
      <p className="text-[11px] text-[var(--muted)]">
        Pairs each old Fuel-tab entry with the live 5031 Vehicle Fuel line keyed for it in Accounts (same day, same amount,
        the line names the vehicle) — exactly the rule the import uses. Reading changes nothing; each group is applied only
        when you confirm it.
      </p>
      {error ? <p className="mt-1 text-xs text-[var(--danger)]">{error}</p> : null}
      {!report ? (
        <button type="button" className={`${regBtnOutline} mt-2`} onClick={() => void read()}>
          Read the reconcile (changes nothing)
        </button>
      ) : (
        <div className="mt-2 space-y-2 text-xs">
          <p className="text-[var(--muted)]">
            {report.deskEntries} old entries · {report.liveLines} live fuel lines in the book ({inrPaise(report.liveLinePaise)})
          </p>
          <p>
            <b>Will be tied by Import — {report.matched.length}</b>
            {report.matched.length ? " (press Import above)" : ""}
          </p>
          <p>
            <b>Old entries with no live voucher — {report.refillOnly.length + report.importedNotInAccounts.length}</b>
            {report.refillOnly.some((r) => !r.imported) ? " · import them first, then void them here" : ""}
          </p>
          {report.importedNotInAccounts.length ? (
            <button
              type="button"
              className={regBtnOutline}
              disabled={!!busy}
              onClick={() =>
                void run("Void old entries with no voucher", { action: "reconcile-void", ids: report.importedNotInAccounts.map((f) => f.id) }, report.importedNotInAccounts.length)
              }
            >
              Void these {report.importedNotInAccounts.length} (kept, struck through)
            </button>
          ) : null}
          <p>
            <b>Fuel in the book with no fill — {report.lineOnly.length}</b>
          </p>
          {report.lineOnly.length ? (
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {report.lineOnly.map((l) => (
                <li key={l.lineId} className="tabular-nums">
                  <div>
                    {dateLabel(l.voucherDate)} · {l.voucherNo} · {inrPaise(l.debitPaise)} · {l.narration}
                  </div>
                  {l.tieTo.length ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[var(--muted)]">Already in the register as {l.tieTo.join(", ")} — tie it, never a second fill.</span>
                      {canApprove && l.tieTo.length === 1 ? (
                        <button
                          type="button"
                          className={regBtnOutline}
                          disabled={!!busy}
                          onClick={() => void run(`Tie ${l.tieTo[0]} to ${l.voucherNo}`, { action: "reconcile-tie", fillId: l.tieTo[0], lineId: l.lineId }, 1)}
                        >
                          Tie
                        </button>
                      ) : null}
                    </div>
                  ) : l.refusal ? (
                    <div className="text-[var(--warning)]">{l.refusal}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {(() => {
            const creatable = report.lineOnly.filter((l) => !l.tieTo.length && !l.refusal);
            if (!creatable.length) return null;
            return canApprove ? (
              <button
                type="button"
                className={regBtnOutline}
                disabled={!!busy}
                onClick={() =>
                  void run("Create fills from vouchers", { action: "reconcile-create", lineIds: creatable.map((l) => l.lineId) }, creatable.length)
                }
              >
                Create {creatable.length} fill(s) from their vouchers
              </button>
            ) : (
              <p className="text-[var(--muted)]">Creating fills from vouchers needs Accounts approval.</p>
            );
          })()}
        </div>
      )}
    </div>
  );
}


function AmendForm({ fill, onDone, onCancel }: { fill: Fill; onDone: (m: string) => void; onCancel: () => void }) {
  const [qty, setQty] = useState(String(fill.quantity));
  const [odo, setOdo] = useState(fill.odometerKm == null ? "" : String(fill.odometerKm));
  const [dealer, setDealer] = useState(fill.dealerName);
  const [billNo, setBillNo] = useState(fill.billNo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const out = await registerPost<{ notice: string }>(URL_BASE, {
        action: "amend",
        id: fill.id,
        quantity: qty,
        odometerKm: odo,
        dealerName: dealer,
        billNo,
      });
      onDone(out.notice || "Corrected");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not correct");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
      <div className="text-sm font-semibold text-[var(--brand-deep)]">
        Correct {fill.vehicle.primary} · {dateLabel(fill.fillDate)} · {rupees(fill.amountPaise)}
      </div>
      <p className="text-[11px] text-[var(--muted)]">
        Amount, date and bus do not change here — void and re-enter for those.
        {fill.voucherNo ? ` In the book as ${fill.voucherNo}, the quantity is fixed too: no silent edits to money.` : ""}
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="block text-[var(--muted)]">Quantity ({unitShort(fill.unit)})</span>
          <input className={regField} value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="block text-[var(--muted)]">Odometer km</span>
          <input className={regField} value={odo} onChange={(e) => setOdo(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="block text-[var(--muted)]">Dealer / pump</span>
          <input className={regField} value={dealer} onChange={(e) => setDealer(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="block text-[var(--muted)]">Bill no.</span>
          <input className={regField} value={billNo} onChange={(e) => setBillNo(e.target.value)} />
        </label>
        <button type="button" className={regBtn} disabled={busy} onClick={save}>
          Save
        </button>
        <button type="button" className={regBtnOutline} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      {error ? <p className="mt-1 text-xs text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
