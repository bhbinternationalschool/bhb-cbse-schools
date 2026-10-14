/**
 * Fuel register — the pure rules behind Transport → Fuel.
 *
 * transport_fuel_fills is the one fuel record (migration 20261014101500).
 * A fill is entered once — by the driver's log book or the office's Fuel tab —
 * and its money lands in Ledger v2 as a Vehicle Fuel (5031) expense voucher.
 * Nothing here touches a database; the server half is
 * transportFuelRegister.server.ts and the routes call both.
 *
 * Rules that matter:
 *  - Unknown is never 0. An odometer nobody read is null; km between two fills
 *    exists only when both readings exist and the second is not lower; ₹/km
 *    and km per unit exist only when km does. A month with no Fleet Edge
 *    events has no Fleet Edge figure (null), not 0 km.
 *  - A fill with no payment mode is AWAITING OFFICE and posts nothing: a
 *    driver at the pump does not know whether the office paid cash or the
 *    dealer runs an account.
 *  - The voucher is built by the same builder the Accounts expense form uses
 *    (buildExpenseVoucherLines), so a fuel voucher from Transport and one
 *    keyed in Accounts are the same shape in the book.
 */

import {
  allocateExpensePayment,
  buildExpenseVoucherLines,
  type BuiltVoucherLine,
} from "@/lib/expenseVoucherDraft";
import { normalizeVehicleKey, vehicleFleetKeys } from "@/lib/fleetEdgeLink";

/* ─── constants ────────────────────────────────────────────── */

/** Ledger v2 expense head for vehicle fuel (created by the office; prod holds it). */
export const FUEL_EXPENSE_CODE = "5031";
/** Ledger v2 cash in hand — the cash box. Every cash payment is from it. */
export const CASH_ACCOUNT_CODE = "1000";
/** Ledger v2 generic bank, used only when the chosen bank has no account of its own. */
export const BANK_FALLBACK_CODE = "1010";
/** Ledger v2 accounts payable (control account, party = the dealer). */
export const PAYABLE_CODE = "2000";
/**
 * The cost centre fuel is tagged to. Vehicles are NOT cost centres in this
 * book: the established pattern (the Accounts expense form) tags fuel to
 * "transport" and names the vehicle in the line narration.
 */
export const FUEL_COST_CENTRE = "transport";
/** ledger_post idempotency key: (source_type, fill id) posts exactly once. */
export const FUEL_SOURCE_TYPE = "transport_fuel_fill";

export type FuelPaymentMode = "cash" | "bank" | "upi" | "on_account";
export const FUEL_PAYMENT_MODES: FuelPaymentMode[] = ["cash", "bank", "upi", "on_account"];
export const PAYMENT_MODE_LABEL: Record<FuelPaymentMode, string> = {
  cash: "Cash (cash box)",
  bank: "Bank transfer",
  upi: "UPI",
  on_account: "On account (dealer credit)",
};

export function isPaymentMode(v: unknown): v is FuelPaymentMode {
  return typeof v === "string" && (FUEL_PAYMENT_MODES as string[]).includes(v);
}

export type FuelUnit = "litre" | "kg";
export type FuelKind = "" | "cng" | "petrol" | "diesel";

/* ─── vehicle label ────────────────────────────────────────── */

/**
 * An Indian number plate, loosely: UP65PT3540, UP 65 RT 9825, DL1CAB1234.
 * A VIN (17 characters) or "NA" or a nickname ("RAJESH VAN") is not one.
 */
export function looksLikePlate(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/.test(s);
}

/**
 * How a bus is named on the register: its plate when it has one; otherwise
 * the desk name (e.g. "Magic-3"), with the stored identifier (a VIN) as the
 * small second line so the row can still be matched to paperwork.
 */
export function vehicleLabel(v: { name?: string; registrationNo?: string } | null | undefined): {
  primary: string;
  secondary: string;
} {
  if (!v) return { primary: "Unknown vehicle", secondary: "" };
  const reg = String(v.registrationNo ?? "").trim();
  const name = String(v.name ?? "").trim();
  if (looksLikePlate(reg)) return { primary: reg.toUpperCase(), secondary: name };
  const key = normalizeVehicleKey(reg);
  const secondary = key && key !== normalizeVehicleKey(name) ? (key.length === 17 ? `VIN ${key}` : reg) : "";
  return { primary: name || reg || "Unnamed vehicle", secondary };
}

/* ─── units ────────────────────────────────────────────────── */

/** CNG is sold by the kg; diesel and petrol by the litre. */
export function unitForFuel(fuel: string | null | undefined): FuelUnit {
  return String(fuel ?? "").toLowerCase() === "cng" ? "kg" : "litre";
}

export function unitShort(unit: FuelUnit): string {
  return unit === "kg" ? "kg" : "L";
}

/** "7.55 kg", "40 L". */
export function quantityWithUnit(qty: number, unit: FuelUnit): string {
  const n = Math.round(qty * 100) / 100;
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })} ${unitShort(unit)}`;
}

/**
 * A rate that cannot be right — almost always quantity and rate typed into
 * each other's boxes (on 13 Oct one fill went in as 87.67 kg at ₹7.99/kg).
 * Returns the warning to show, or "" when the rate is plausible. A warning,
 * never a refusal: prices move.
 */
export function rateWarning(qty: number, amountPaise: number, unit: FuelUnit): string {
  if (!(qty > 0) || !(amountPaise > 0)) return "";
  const rate = amountPaise / 100 / qty;
  if (rate < 30 || rate > 250) {
    return `₹${rate.toFixed(2)}/${unitShort(unit)} looks wrong — check the quantity`;
  }
  return "";
}

/* ─── dates ────────────────────────────────────────────────── */

const IST_OFFSET_MS = 5.5 * 3600 * 1000;

/** The IST calendar day of an instant. */
export function istDayOf(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** "12 Aug 2026". */
export function dateLabel(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "12 Aug 2026, 3:42 pm" in IST. */
export function dateTimeIst(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

/* ─── accounts status ──────────────────────────────────────── */

export type FuelAccountsStatus =
  | { kind: "voided"; label: string }
  | { kind: "in_accounts"; label: string; voucherNo: string; origin: "posted" | "adopted" }
  | { kind: "awaiting_office"; label: string }
  | { kind: "not_in_accounts"; label: string };

export type FillAccountsFacts = {
  voided: boolean;
  voucherId: string | null;
  voucherNo: string;
  voucherOrigin: "" | "posted" | "adopted";
  paymentMode: "" | FuelPaymentMode;
  entrySource: "app" | "web" | "desk_import" | "accounts";
  reversalVoucherNo?: string;
};

export function accountsStatus(f: FillAccountsFacts): FuelAccountsStatus {
  if (f.voided) {
    return {
      kind: "voided",
      label: f.reversalVoucherNo ? `Voided · reversed ${f.reversalVoucherNo}` : "Voided",
    };
  }
  if (f.voucherId && (f.voucherOrigin === "posted" || f.voucherOrigin === "adopted")) {
    return {
      kind: "in_accounts",
      origin: f.voucherOrigin,
      voucherNo: f.voucherNo,
      label: f.voucherOrigin === "adopted" ? `In accounts · ${f.voucherNo} (keyed in Accounts)` : `In accounts · ${f.voucherNo}`,
    };
  }
  // A driver's fill with no mode: nobody has said how it was paid.
  if (!f.paymentMode && f.entrySource === "app") {
    return { kind: "awaiting_office", label: "Awaiting office — set how it was paid" };
  }
  return { kind: "not_in_accounts", label: "Not in accounts" };
}

/* ─── the voucher ──────────────────────────────────────────── */

export type FuelVoucherInput = {
  fillId: string;
  fillDate: string;
  vehicle: { name: string; registrationNo: string };
  fuelType: FuelKind;
  quantity: number;
  unit: FuelUnit;
  amountPaise: number;
  odometerKm: number | null;
  dealerName: string;
  billNo: string;
  payment:
    | { mode: "cash" }
    | { mode: "bank" | "upi"; bankAccountCode: string; bankAccountId: string; ref: string }
    | { mode: "on_account" };
};

export type FuelVoucher = {
  voucherType: "payment" | "journal";
  date: string;
  narration: string;
  sourceType: string;
  sourceId: string;
  lines: BuiltVoucherLine[];
};

/** The vehicle as the book names it: plate, else name + identifier. */
export function vehicleForNarration(v: { name: string; registrationNo: string }): string {
  const l = vehicleLabel(v);
  return l.secondary ? `${l.primary} (${l.secondary})` : l.primary;
}

/** "cng 7.55 kg @ ₹92.67/kg — UP65PT3540 · 48,210 km · bill 1182". */
export function fuelLineNarration(input: Pick<FuelVoucherInput, "fuelType" | "quantity" | "unit" | "amountPaise" | "odometerKm" | "billNo" | "vehicle">): string {
  const u = input.unit === "kg" ? "kg" : "L";
  const rate = input.quantity > 0 ? (input.amountPaise / 100 / input.quantity).toFixed(2) : "0.00";
  const bits = [
    `${input.fuelType || "fuel"} ${Math.round(input.quantity * 100) / 100} ${u} @ ₹${rate}/${u} — ${vehicleForNarration(input.vehicle)}`,
  ];
  if (input.odometerKm != null) bits.push(`${input.odometerKm} km`);
  if (input.billNo.trim()) bits.push(`bill ${input.billNo.trim()}`);
  return bits.join(" · ");
}

/**
 * The balanced voucher for one fill.
 *
 * Dr 5031 Vehicle Fuel (tag: transport, vehicle in the narration, dealer as
 * the vendor party when named). Cr: cash → 1000 Cash in Hand; bank/UPI → the
 * bank's own account with its bank sub-ledger and the ref; on account → 2000
 * Accounts Payable against the dealer, who must be named — a payable that
 * cannot say who it is owed to cannot be settled.
 */
export function buildFuelVoucher(input: FuelVoucherInput): { ok: true; voucher: FuelVoucher } | { ok: false; error: string } {
  if (!(input.amountPaise > 0)) return { ok: false, error: "This fill has no amount, so there is nothing to post." };
  const dealer = input.dealerName.trim();
  if (input.payment.mode === "on_account" && !dealer) {
    return { ok: false, error: "On account needs the dealer's name — the payable must say who is owed." };
  }
  if ((input.payment.mode === "bank" || input.payment.mode === "upi") && !input.payment.bankAccountId) {
    return { ok: false, error: "Choose which bank account paid." };
  }
  const narration = fuelLineNarration(input);
  const paidPaise = input.payment.mode === "on_account" ? 0 : input.amountPaise;
  const totals = allocateExpensePayment(
    [
      {
        id: input.fillId,
        accountCode: FUEL_EXPENSE_CODE,
        tag: FUEL_COST_CENTRE,
        vendorName: dealer,
        description: narration,
        amountPaise: input.amountPaise,
        taxPaise: 0,
      },
    ],
    paidPaise,
  );
  const lines = buildExpenseVoucherLines({
    totals,
    gstInputCode: "1080",
    payableCode: PAYABLE_CODE,
    payment:
      input.payment.mode === "cash" || input.payment.mode === "on_account"
        ? { kind: "cash", accountCode: CASH_ACCOUNT_CODE }
        : {
            kind: "bank",
            accountCode: input.payment.bankAccountCode || BANK_FALLBACK_CODE,
            bankId: input.payment.bankAccountId,
            mode: input.payment.mode,
            ref: input.payment.ref.trim(),
            date: input.fillDate,
          },
  });
  const dr = lines.reduce((s, l) => s + l.debitPaise, 0);
  const cr = lines.reduce((s, l) => s + l.creditPaise, 0);
  if (dr !== cr || dr !== input.amountPaise) return { ok: false, error: "The fuel voucher did not balance — nothing was posted." };
  return {
    ok: true,
    voucher: {
      // Money left (cash/bank) is a payment; fuel on credit is a journal
      // (expense against a payable, no cash moved).
      voucherType: input.payment.mode === "on_account" ? "journal" : "payment",
      date: input.fillDate,
      narration: `Fuel — ${vehicleForNarration(input.vehicle)}${dealer ? ` · ${dealer}` : ""} (Transport fuel register)`,
      sourceType: FUEL_SOURCE_TYPE,
      sourceId: input.fillId,
      lines,
    },
  };
}

/* ─── km and totals ────────────────────────────────────────── */

export type KmFill = {
  id: string;
  vehicleId: string;
  fillDate: string;
  createdAt: string;
  odometerKm: number | null;
  voided: boolean;
};

/**
 * Km since the same vehicle's previous fill, per fill id. Present only when
 * this fill AND the previous (non-voided) fill both carry a reading and this
 * one is not lower. A fill with no reading breaks the chain — the next fill's
 * km is measured from the last fill that HAD one only if nothing in between
 * was missing, because the gap may hide a fill whose fuel the km used.
 */
export function kmBetweenFills(fills: KmFill[]): Map<string, number> {
  const out = new Map<string, number>();
  const byVehicle = new Map<string, KmFill[]>();
  for (const f of fills) {
    if (f.voided) continue;
    const list = byVehicle.get(f.vehicleId) ?? [];
    list.push(f);
    byVehicle.set(f.vehicleId, list);
  }
  for (const list of byVehicle.values()) {
    list.sort((a, b) => a.fillDate.localeCompare(b.fillDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!;
      const cur = list[i]!;
      if (prev.odometerKm == null || cur.odometerKm == null) continue;
      if (cur.odometerKm < prev.odometerKm) continue;
      out.set(cur.id, Math.round((cur.odometerKm - prev.odometerKm) * 10) / 10);
    }
  }
  return out;
}

export type TotalsFill = KmFill & { quantity: number; unit: FuelUnit; amountPaise: number };

export type BusMonthTotals = {
  vehicleId: string;
  month: string;
  fills: number;
  litres: number;
  kg: number;
  amountPaise: number;
  /** Km for the month, or null when no source knows it. */
  km: number | null;
  kmSource: "" | "day_log" | "fill_odometer";
  /** ₹ per km — only when km is known and > 0. */
  rupeesPerKm: number | null;
  /** Km per kg / per litre — only when km is known AND the month used one unit. */
  kmPerUnit: number | null;
  kmPerUnitUnit: FuelUnit | null;
  /** Fleet Edge for the same bus and month; null when Fleet Edge sent nothing. */
  fleetEdgeKm: number | null;
  fleetEdgeFuelUsed: number | null;
};

/**
 * Per bus per month. Km comes from the driver's day log (days with both
 * readings) first, because that is a reading per day; failing that, from the
 * odometer at consecutive fills. Neither → km is null, never 0, and every
 * ratio built on it is null too.
 */
export function busMonthTotals(input: {
  month: string;
  vehicleIds: string[];
  /** All fills up to the month's end (earlier ones are needed for km). */
  fills: TotalsFill[];
  /** Day-log km per vehicle for the month (sum of complete days), absent = none. */
  dayLogKm: Map<string, { km: number; days: number }>;
  fleetEdge: Map<string, { km: number; fuelUsed: number }>;
}): BusMonthTotals[] {
  const kmByFill = kmBetweenFills(input.fills);
  return input.vehicleIds.map((vehicleId) => {
    const inMonth = input.fills.filter((f) => !f.voided && f.vehicleId === vehicleId && f.fillDate.slice(0, 7) === input.month);
    const litres = inMonth.filter((f) => f.unit === "litre").reduce((s, f) => s + f.quantity, 0);
    const kg = inMonth.filter((f) => f.unit === "kg").reduce((s, f) => s + f.quantity, 0);
    const amountPaise = inMonth.reduce((s, f) => s + f.amountPaise, 0);

    let km: number | null = null;
    let kmSource: BusMonthTotals["kmSource"] = "";
    const log = input.dayLogKm.get(vehicleId);
    if (log && log.days > 0) {
      km = Math.round(log.km * 10) / 10;
      kmSource = "day_log";
    } else {
      const fillKm = inMonth.map((f) => kmByFill.get(f.id)).filter((k): k is number => k != null);
      if (fillKm.length > 0) {
        km = Math.round(fillKm.reduce((s, k) => s + k, 0) * 10) / 10;
        kmSource = "fill_odometer";
      }
    }

    const units = new Set(inMonth.map((f) => f.unit));
    const oneUnit = units.size === 1 ? ([...units][0] as FuelUnit) : null;
    const qty = oneUnit === "kg" ? kg : oneUnit === "litre" ? litres : 0;
    const fe = input.fleetEdge.get(vehicleId);
    return {
      vehicleId,
      month: input.month,
      fills: inMonth.length,
      litres: Math.round(litres * 100) / 100,
      kg: Math.round(kg * 100) / 100,
      amountPaise,
      km,
      kmSource,
      rupeesPerKm: km != null && km > 0 && amountPaise > 0 ? Math.round((amountPaise / 100 / km) * 100) / 100 : null,
      kmPerUnit: km != null && km > 0 && oneUnit && qty > 0 ? Math.round((km / qty) * 100) / 100 : null,
      kmPerUnitUnit: km != null && km > 0 && oneUnit && qty > 0 ? oneUnit : null,
      fleetEdgeKm: fe ? Math.round(fe.km * 10) / 10 : null,
      fleetEdgeFuelUsed: fe ? Math.round(fe.fuelUsed * 100) / 100 : null,
    };
  });
}

/* ─── Fleet Edge ───────────────────────────────────────────── */

export type FleetEdgeDetailsRow = {
  vehicleRef: string | null;
  registrationNumber: string | null;
  /** The 30-minute window's start, as Fleet Edge sent it. */
  windowFrom: string | null;
  receivedAt: string;
  km: unknown;
  fuelUsed: unknown;
};

function n(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return 0;
}

/**
 * Fleet Edge distance and fuel used per desk vehicle for one IST month.
 *
 * Fleet Edge re-sends the same 30-minute `details` window — one VIN had 7,563
 * events for 1,871 windows — so each (vehicle, window start) counts ONCE, or
 * the km would be four times the truth. A vehicle is matched by plate or VIN,
 * and a tracker that has ever reported a desk vehicle's plate carries that
 * vehicle for its "NA" windows too (Magic-2 reported "NA" for its first days).
 * A vehicle with no window in the month is absent from the map: no figure,
 * not 0.
 */
export function fleetEdgeMonthByVehicle(input: {
  month: string;
  vehicles: { id: string; registrationNo: string; chassisNo?: string }[];
  rows: FleetEdgeDetailsRow[];
  ignoreRefs?: Set<string>;
}): Map<string, { km: number; fuelUsed: number; windows: number }> {
  // Every key a vehicle has (vehicleFleetKeys: registration, chassis no.).
  // Registrations claim first; a key already claimed is not re-pointed, so
  // one tracker is never split between two vehicles.
  const deskByKey = new Map<string, string>();
  for (const pick of [(v: (typeof input.vehicles)[number]) => ({ registrationNo: v.registrationNo }), (v: (typeof input.vehicles)[number]) => ({ chassisNo: v.chassisNo })]) {
    for (const v of input.vehicles) {
      for (const k of vehicleFleetKeys(pick(v))) if (!deskByKey.has(k)) deskByKey.set(k, v.id);
    }
  }
  const vehicleOfRef = new Map<string, string>();
  for (const r of input.rows) {
    const ref = normalizeVehicleKey(r.vehicleRef);
    if (!ref || vehicleOfRef.has(ref)) continue;
    const hit = deskByKey.get(normalizeVehicleKey(r.registrationNumber)) ?? deskByKey.get(ref);
    if (hit) vehicleOfRef.set(ref, hit);
  }
  const seen = new Set<string>();
  const out = new Map<string, { km: number; fuelUsed: number; windows: number }>();
  for (const r of input.rows) {
    const ref = normalizeVehicleKey(r.vehicleRef);
    if (!ref || input.ignoreRefs?.has(String(r.vehicleRef ?? ""))) continue;
    const vehicleId = vehicleOfRef.get(ref);
    if (!vehicleId) continue;
    const at = r.windowFrom || r.receivedAt;
    if (istDayOf(at).slice(0, 7) !== input.month) continue;
    const key = `${ref}|${r.windowFrom || r.receivedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cur = out.get(vehicleId) ?? { km: 0, fuelUsed: 0, windows: 0 };
    cur.km += n(r.km);
    cur.fuelUsed += n(r.fuelUsed);
    cur.windows += 1;
    out.set(vehicleId, cur);
  }
  return out;
}

/* ─── import of the retired desk fuel log ──────────────────── */

export type DeskFuelLog = {
  id: string;
  vehicleId: string;
  filledAt: string;
  odometerKm: number;
  qty: number;
  amountPaise: number;
  dealerId?: string;
  billNo?: string;
  filledBy?: string;
  paymentStatus?: string;
};

export type ImportedFill = {
  id: string;
  deskEntryId: string;
  vehicleId: string;
  fillDate: string;
  quantity: number;
  unit: FuelUnit;
  fuelType: FuelKind;
  amountPaise: number;
  odometerKm: number | null;
  dealerName: string;
  billNo: string;
  paymentMode: "" | FuelPaymentMode;
  createdByName: string;
  note: string;
};

/** A register id for a desk entry: stable (re-import = same id), route-safe. */
export function importedFillId(deskId: string): string {
  const clean = String(deskId).replace(/[^A-Za-z0-9_-]/g, "");
  return `dk_${clean}`.slice(0, 64);
}

/**
 * One desk fuel log → one register row, as history.
 *
 * Kept: date (the IST day of filledAt), vehicle, quantity, amount, bill.
 * The desk wrote 0 for every odometer nobody typed, so 0 becomes null
 * (unknown). The unit follows the vehicle's primary fuel — the desk log never
 * said which fuel went in. "paid_cash" maps to cash and "on_account" to on
 * account; anything else stays blank for the office to choose.
 */
export function mapDeskFuelLog(
  log: DeskFuelLog,
  vehicle: { id: string; fuelType?: string } | undefined,
  dealerNameById: Map<string, string>,
): { ok: true; fill: ImportedFill } | { ok: false; deskEntryId: string; reason: string } {
  const deskEntryId = String(log.id ?? "").trim();
  if (!deskEntryId) return { ok: false, deskEntryId: "", reason: "entry has no id" };
  if (!vehicle) return { ok: false, deskEntryId, reason: "vehicle no longer on the fleet" };
  const fillDate = istDayOf(String(log.filledAt ?? ""));
  if (!fillDate) return { ok: false, deskEntryId, reason: "no date" };
  const qty = Number(log.qty);
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, deskEntryId, reason: "no quantity" };
  const amount = Math.round(Number(log.amountPaise));
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, deskEntryId, reason: "bad amount" };
  const odo = Number(log.odometerKm);
  const fuel = String(vehicle.fuelType ?? "").toLowerCase();
  const fuelType: FuelKind = fuel === "cng" || fuel === "petrol" || fuel === "diesel" ? fuel : "";
  const ps = String(log.paymentStatus ?? "");
  return {
    ok: true,
    fill: {
      id: importedFillId(deskEntryId),
      deskEntryId,
      vehicleId: vehicle.id,
      fillDate,
      quantity: Math.round(qty * 100) / 100,
      unit: unitForFuel(fuelType),
      fuelType,
      amountPaise: amount,
      odometerKm: Number.isFinite(odo) && odo > 0 ? Math.round(odo * 10) / 10 : null,
      dealerName: (log.dealerId && dealerNameById.get(log.dealerId)) || "",
      billNo: String(log.billNo ?? "").slice(0, 60),
      paymentMode: ps === "paid_cash" ? "cash" : ps === "on_account" ? "on_account" : "",
      createdByName: String(log.filledBy ?? "").trim() || "Old Fuel tab",
      note: "Imported from the old Transport Fuel tab",
    },
  };
}

/* ─── linking an imported fill to the voucher already in Accounts ─── */

export type FuelVoucherLine = {
  lineId: string;
  voucherId: string;
  voucherNo: string;
  voucherDate: string;
  debitPaise: number;
  narration: string;
  /** True when a reversal of this voucher exists — it no longer counts. */
  reversed: boolean;
};

/**
 * The live Vehicle Fuel line that already carries this fill, if exactly one
 * does: same date, same amount, and the line names this vehicle's plate or
 * VIN. The Accounts expense form wrote the fuel log AND the voucher from one
 * form (13 Oct), so each desk entry has such a line; posting it again would
 * double the fuel in the book.
 *
 * Ambiguity is refused, not guessed: two candidate lines for one entry → no
 * link (the office sees "not in accounts" and checks).
 */
export function matchExistingFuelLine(
  fill: { fillDate: string; amountPaise: number },
  vehicle: { registrationNo: string; chassisNo?: string },
  lines: FuelVoucherLine[],
  taken: Set<string>,
): FuelVoucherLine | null {
  const keys = vehicleFleetKeys(vehicle);
  if (keys.length === 0) return null;
  const hits = lines.filter((l) => {
    if (l.reversed || taken.has(l.lineId)) return false;
    if (l.voucherDate !== fill.fillDate || l.debitPaise !== fill.amountPaise) return false;
    const text = l.narration.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return keys.some((k) => text.includes(k));
  });
  return hits.length === 1 ? hits[0]! : null;
}
