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
  amountPaise: number;
  odometerKm: number | null;
  receiptPath: string;
  note: string;
  dealerName: string;
  billNo: string;
  paymentMode: "" | FuelPaymentMode;
  bankAccountId: string;
  paymentRef: string;
  entrySource: "app" | "web" | "desk_import";
  voucherNo: string;
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
  today: string;
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
  const [amount, setAmount] = useState("");
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
        amountRupees: amount,
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
      setAmount("");
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
        Entered once here; with a payment mode it also posts the Vehicle Fuel expense in Accounts. Do not key fuel
        bills in Accounts as well.
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
          <span className="block text-[var(--muted)]">Amount ₹</span>
          <input inputMode="decimal" className={`${regField} w-full`} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
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
          disabled={busy || uploading || !vehicleId || !qty || !amount || (needsBank && !bank) || (mode === "on_account" && !dealer.trim())}
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

/**
 * Transport → Fuel: the one fuel register (transport_fuel_fills).
 *
 * Every figure comes from the server on each load — no desk state, no
 * localStorage. The office queue sits on top: fills from the driver's log book
 * that wait for someone to say how they were paid, and anything else not yet
 * in accounts.
 */
export function FuelRegisterPanel() {
  const [month, setMonth] = useState(() => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 7));
  const [vehicleId, setVehicleId] = useState("");
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [posting, setPosting] = useState<{ ids: string[]; mode: "" | FuelPaymentMode; dealer: string } | null>(null);
  const [amending, setAmending] = useState<Fill | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const q = new URLSearchParams({ month });
      if (vehicleId) q.set("vehicleId", vehicleId);
      setView(await registerGet<View>(`${URL_BASE}?${q.toString()}`));
    } catch (e) {
      setView(null);
      setError(e instanceof Error ? e.message : "Could not load the fuel register");
    }
  }, [month, vehicleId]);

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
      f.status.kind === "in_accounts" && f.status.origin === "posted"
        ? `Void this fill? Its voucher ${f.voucherNo} will be reversed. Why is it wrong?`
        : "Void this fill? Why is it wrong?",
    );
    if (!reason?.trim()) return;
    try {
      const out = await registerPost<{ notice: string }>(URL_BASE, { action: "void", id: f.id, reason: reason.trim() });
      done(out.notice || "Voided");
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

  const fillColumns: DataTableColumn<Fill>[] = useMemo(
    () => [
      {
        key: "date",
        header: "Date (IST)",
        sortable: true,
        value: (f) => f.fillDate,
        render: (f) => (
          <div className="leading-tight">
            <div>{dateLabel(f.fillDate)}</div>
            <div className="text-[10px] text-[var(--muted)]">entered {dateTimeIst(f.createdAt)}</div>
          </div>
        ),
      },
      { key: "bus", header: "Bus", sortable: true, value: (f) => f.vehicle.primary, render: (f) => <VehicleCell v={f.vehicle} /> },
      {
        key: "qty",
        header: "Quantity",
        align: "right",
        sortable: true,
        value: (f) => f.quantity,
        render: (f) => (
          <div className="leading-tight">
            <div className={f.voided ? "line-through" : ""}>{quantityWithUnit(f.quantity, f.unit)}</div>
            {f.fuelType ? <div className="text-[10px] uppercase text-[var(--muted)]">{f.fuelType}</div> : null}
            {f.rateWarning ? <div className="text-[10px] text-[var(--warning)]">{f.rateWarning}</div> : null}
          </div>
        ),
      },
      {
        key: "amount",
        header: "₹",
        align: "right",
        sortable: true,
        value: (f) => f.amountPaise,
        render: (f) => <span className={f.voided ? "line-through" : ""}>{rupees(f.amountPaise)}</span>,
      },
      {
        key: "odo",
        header: "Odometer",
        align: "right",
        value: (f) => f.odometerKm,
        render: (f) =>
          f.odometerKm == null ? (
            <span className="text-[var(--muted)]">not read</span>
          ) : (
            <div className="leading-tight">
              <div>{f.odometerKm.toLocaleString("en-IN")} km</div>
              {f.kmSincePrevious != null ? <div className="text-[10px] text-[var(--muted)]">+{f.kmSincePrevious} km since last fill</div> : null}
            </div>
          ),
      },
      { key: "dealer", header: "Dealer / pump", value: (f) => f.dealerName, render: (f) => f.dealerName || <span className="text-[var(--muted)]">—</span> },
      { key: "pay", header: "Paid by", value: (f) => f.paymentMode, render: (f) => <span className="text-xs">{paymentText(f, banks)}</span> },
      {
        key: "bill",
        header: "Bill",
        render: (f) => (
          <div className="text-xs leading-tight">
            {f.billNo ? <div>{f.billNo}</div> : null}
            {f.receiptPath ? (
              <a className="text-[var(--primary)] underline" href={f.receiptPath} target="_blank" rel="noreferrer">
                photo
              </a>
            ) : f.billNo ? null : (
              <span className="text-[var(--muted)]">—</span>
            )}
          </div>
        ),
      },
      {
        key: "by",
        header: "Entered by",
        value: (f) => f.createdByName,
        render: (f) => (
          <div className="text-xs leading-tight">
            <div>{f.createdByName || "—"}</div>
            <div className="text-[10px] text-[var(--muted)]">
              {f.entrySource === "app" ? "driver log book" : f.entrySource === "desk_import" ? "old Fuel tab" : "office"}
            </div>
          </div>
        ),
      },
      {
        key: "status",
        header: "Accounts",
        value: (f) => f.status.kind,
        render: (f) => (
          <div className="leading-tight">
            <StatusChip s={f.status} />
            {f.voided && f.voidReason ? <div className="text-[10px] text-[var(--muted)]">{f.voidReason}</div> : null}
          </div>
        ),
      },
    ],
    [banks],
  );

  const rowActions: RowAction<Fill>[] = [
    {
      id: "post",
      label: "Post to accounts…",
      hidden: (f) => !writable || f.voided || f.status.kind === "in_accounts",
      disabled: () => !view?.canPost,
      onSelect: (f) => setPosting({ ids: [f.id], mode: f.paymentMode, dealer: f.dealerName }),
    },
    {
      id: "amend",
      label: "Correct quantity / odometer…",
      hidden: (f) => !writable || f.voided,
      onSelect: (f) => setAmending(f),
    },
    {
      id: "photo",
      label: "Open bill photo",
      hidden: (f) => !f.receiptPath,
      onSelect: (f) => window.open(f.receiptPath, "_blank", "noopener"),
    },
    {
      id: "void",
      label: "Void…",
      tone: "danger",
      separatorAbove: true,
      hidden: (f) => !writable || f.voided,
      disabled: (f) => f.status.kind === "in_accounts" && f.status.origin === "posted" && !view?.canReverse,
      onSelect: (f) => void voidFill(f),
    },
  ];

  const queueBulk: BulkAction[] = view?.canPost
    ? [{ id: "post", label: "Post to accounts…", onRun: (keys) => setPosting({ ids: keys, mode: "", dealer: "" }) }]
    : [];

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

  const totalsActions: RowAction<Totals>[] = [
    { id: "only", label: "Show only this bus", onSelect: (t) => setVehicleId(t.vehicleId) },
  ];

  return (
    <section className="mt-4 space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="block text-[var(--muted)]">Month</span>
          <input type="month" className={regField} value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="block text-[var(--muted)]">Bus</span>
          <select className={regField} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">All buses</option>
            {(view?.vehicles ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.primary}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={regBtnOutline} onClick={() => void load()}>
          Reload
        </button>
      </div>

      {error ? <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p> : null}
      {msg ? <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-sm">{msg}</p> : null}

      {view && writable && view.deskImport.notYetImported > 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
          <div className="text-sm font-semibold text-[var(--brand-deep)]">
            {view.deskImport.notYetImported} fuel entries are still in the old Fuel tab
          </div>
          <p className="text-[11px] text-[var(--muted)]">
            Copies them into this register once (safe to press again). Odometers the old tab saved as 0 come in as
            &ldquo;not read&rdquo;. Nothing is posted: an entry already keyed in Accounts is linked to that voucher;
            the rest show &ldquo;Not in accounts&rdquo; for you to post with a payment mode.
          </p>
          <button type="button" className={`${regBtn} mt-2`} disabled={importing} onClick={runImport}>
            {importing ? "Importing…" : `Import old fuel entries (${view.deskImport.notYetImported})`}
          </button>
        </div>
      ) : null}

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
            {rupees(view.queue.reduce((s, f) => s + f.amountPaise, 0))}
          </h3>
          <p className="text-[11px] text-[var(--muted)]">
            Driver entries wait here until the office says how they were paid; posting books Dr 5031 Vehicle Fuel.
            Tick several to post them together.
          </p>
          <DataTable
            columns={fillColumns}
            rows={view.queue}
            rowKey={(f) => f.id}
            rowActions={rowActions}
            bulkActions={queueBulk}
            selectionNoun="fill"
            pageSize={20}
            minWidth="min-w-[1100px]"
          />
        </div>
      ) : null}

      {view && writable ? <AddFillForm view={view} onSaved={done} /> : null}

      {view ? (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">Per bus — {view.month}</h3>
          {!view.fleetEdge.ok ? (
            <p className="text-[11px] text-[var(--warning)]">Fleet Edge could not be read just now ({view.fleetEdge.error}); its columns are blank, not zero.</p>
          ) : (
            <p className="text-[11px] text-[var(--muted)]">
              Km comes from the log book (days with both readings), else from odometers at consecutive fills; blank when
              neither is known. Fleet Edge columns are what the tracker reported for the month (each 30-minute window
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
            exportFileBaseName={`fuel-by-bus-${view.month}`}
            exportTitle={`Fuel by bus — ${view.month}`}
          />
        </div>
      ) : null}

      {view ? (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            Fills — {view.month} ({view.fills.length})
          </h3>
          <DataTable
            columns={fillColumns}
            rows={view.fills}
            rowKey={(f) => f.id}
            rowActions={rowActions}
            pageSize={50}
            minWidth="min-w-[1100px]"
            emptyTitle="No fuel entered for this month"
            exportFileBaseName={`fuel-register-${view.month}`}
            exportTitle={`Fuel register — ${view.month}`}
          />
        </div>
      ) : null}
    </section>
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
      <p className="text-[11px] text-[var(--muted)]">Amount, date and bus do not change here — void and re-enter for those.</p>
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
