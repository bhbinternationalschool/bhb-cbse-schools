/**
 * Transport → Fuel as a table: the pure rules (14 Oct 2026).
 *
 * The record is the fuel register (transport_fuel_fills; rules in
 * transportFuelRegister.ts). This module is what the director's table needs on
 * top of it — "filter any single vehicle or all, and by date range" — and what
 * the one-time reconcile reports. No I/O; shared by the panel, the API and the
 * self-test.
 *
 *   money        ₹ to the paisa; the rate a fill was bought at
 *   periods      This month · Last month · This FY
 *   filters      vehicle · date range · fuel · status
 *   mileage      km per unit, chained per vehicle AND fuel
 *   totals       quantity per unit (kg never added to litres), amount,
 *                per-vehicle subtotals
 *   reconcile    which old desk refills the import would tie, which have no
 *                live voucher, which live fuel lines have no fill
 */

import { fuelAmountPaise } from "@/lib/fuelExpenseLine";
import { normalizeVehicleKey } from "@/lib/fleetEdgeLink";

/** ₹ to the paisa — a rate of ₹92.67 shown as ₹93 makes rate × qty look wrong when it is not. */
export function inrPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The rate the fill was bought at: the stored one, else amount ÷ quantity. */
export function ratePaiseOf(f: { ratePaise?: number | null; amountPaise: number; quantity: number }): number {
  if (f.ratePaise != null && f.ratePaise > 0) return f.ratePaise;
  return f.quantity > 0 ? Math.round(f.amountPaise / f.quantity) : 0;
}

/** Does the stored amount equal rate × qty, to the paisa (the SQL rule)? */
export function amountMatchesRate(f: { ratePaise?: number | null; amountPaise: number; quantity: number }): boolean {
  if (f.ratePaise == null) return true;
  return fuelAmountPaise(f.ratePaise, f.quantity) === f.amountPaise;
}

/* ─── the row the table works on ───────────────────────────── */

export type FuelStatusKind = "in_accounts" | "not_in_accounts" | "awaiting_office" | "voided";

export const FUEL_STATUS_FILTER_LABEL: Record<FuelStatusKind, string> = {
  in_accounts: "In the book",
  not_in_accounts: "Not in the book",
  awaiting_office: "Awaiting office",
  voided: "Void",
};

export type FuelTableRow = {
  id: string;
  vehicleId: string;
  vehicleName: string;
  fillDate: string;
  createdAt: string;
  fuelType: string;
  unit: "kg" | "litre";
  quantity: number;
  ratePaise?: number | null;
  amountPaise: number;
  odometerKm: number | null;
  voided: boolean;
  statusKind: FuelStatusKind;
};

/* ─── periods ──────────────────────────────────────────────── */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function lastDayOf(y: number, m1: number): number {
  return new Date(Date.UTC(y, m1, 0)).getUTCDate();
}

/** This month · last month · this financial year (April–March), from a YYYY-MM-DD today. */
export function fuelDatePresets(today: string): {
  thisMonth: { from: string; to: string };
  lastMonth: { from: string; to: string };
  thisFy: { from: string; to: string };
} {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const lmY = m === 1 ? y - 1 : y;
  const lmM = m === 1 ? 12 : m - 1;
  const fyY = m >= 4 ? y : y - 1;
  return {
    thisMonth: { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDayOf(y, m))}` },
    lastMonth: { from: `${lmY}-${pad(lmM)}-01`, to: `${lmY}-${pad(lmM)}-${pad(lastDayOf(lmY, lmM))}` },
    thisFy: { from: `${fyY}-04-01`, to: `${fyY + 1}-03-31` },
  };
}

/** The month a range sits in, when it sits in exactly one ("" otherwise). */
export function singleMonthOf(from: string, to: string): string {
  if (!from || !to || from.slice(0, 7) !== to.slice(0, 7)) return "";
  return from.slice(0, 7);
}

/* ─── filters ──────────────────────────────────────────────── */

export type FuelFilter = {
  /** "" = all vehicles. */
  vehicleId: string;
  from: string;
  to: string;
  fuelType: string;
  status: FuelStatusKind | "";
};

export function filterFuelRows<T extends FuelTableRow>(rows: T[], f: FuelFilter): T[] {
  return rows
    .filter((r) => !f.vehicleId || r.vehicleId === f.vehicleId)
    .filter((r) => !f.from || r.fillDate >= f.from)
    .filter((r) => !f.to || r.fillDate <= f.to)
    .filter((r) => !f.fuelType || r.fuelType === f.fuelType)
    .filter((r) => !f.status || r.statusKind === f.status)
    .sort(
      (a, b) =>
        b.fillDate.localeCompare(a.fillDate) ||
        a.vehicleName.localeCompare(b.vehicleName) ||
        b.createdAt.localeCompare(a.createdAt),
    );
}

/* ─── mileage ──────────────────────────────────────────────── */

export type FuelMileage = { km: number; kmPerUnit: number };

/**
 * Km per unit for each fill that has one, chained per vehicle AND fuel.
 *
 * A CNG bus with a petrol tank takes kg of one and litres of the other, and
 * km ÷ (kg + litres) is not a mileage — so the CNG chain runs CNG fill to CNG
 * fill. Voided fills and fills with no odometer reading (null — never 0, the
 * register's rule) are skipped; a dial lower than the last gives no figure
 * rather than a negative one.
 */
export function mileageByFill(rows: FuelTableRow[]): Map<string, FuelMileage> {
  const out = new Map<string, FuelMileage>();
  const chains = new Map<string, FuelTableRow[]>();
  for (const r of rows) {
    if (r.voided || r.odometerKm == null || !(r.odometerKm > 0)) continue;
    const key = `${r.vehicleId}|${r.fuelType}`;
    const list = chains.get(key) ?? [];
    list.push(r);
    chains.set(key, list);
  }
  for (const list of chains.values()) {
    list.sort(
      (a, b) =>
        a.fillDate.localeCompare(b.fillDate) ||
        (a.odometerKm ?? 0) - (b.odometerKm ?? 0) ||
        a.createdAt.localeCompare(b.createdAt),
    );
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!;
      const cur = list[i]!;
      if ((cur.odometerKm ?? 0) <= (prev.odometerKm ?? 0) || !(cur.quantity > 0)) continue;
      const km = Math.round(((cur.odometerKm ?? 0) - (prev.odometerKm ?? 0)) * 10) / 10;
      out.set(cur.id, { km, kmPerUnit: Math.round((km / cur.quantity) * 100) / 100 });
    }
  }
  return out;
}

/** Per vehicle+fuel: each fill's km per unit in date order, and the weighted average. */
export function mileageTrend(
  rows: FuelTableRow[],
  mileage: Map<string, FuelMileage>,
): { vehicleId: string; vehicleName: string; fuelType: string; unit: string; points: { date: string; kmPerUnit: number }[]; average: number }[] {
  const by = new Map<
    string,
    { vehicleId: string; vehicleName: string; fuelType: string; unit: string; points: { date: string; kmPerUnit: number }[]; km: number; qty: number }
  >();
  for (const r of rows) {
    const m = mileage.get(r.id);
    if (!m) continue;
    const key = `${r.vehicleId}|${r.fuelType}`;
    const g = by.get(key) ?? { vehicleId: r.vehicleId, vehicleName: r.vehicleName, fuelType: r.fuelType, unit: r.unit, points: [], km: 0, qty: 0 };
    g.points.push({ date: r.fillDate, kmPerUnit: m.kmPerUnit });
    g.km += m.km;
    g.qty += r.quantity;
    by.set(key, g);
  }
  return [...by.values()]
    .map((g) => ({
      vehicleId: g.vehicleId,
      vehicleName: g.vehicleName,
      fuelType: g.fuelType,
      unit: g.unit,
      points: g.points.sort((a, b) => a.date.localeCompare(b.date)),
      average: g.qty > 0 ? Math.round((g.km / g.qty) * 100) / 100 : 0,
    }))
    .sort((a, b) => a.vehicleName.localeCompare(b.vehicleName) || a.fuelType.localeCompare(b.fuelType));
}

/* ─── totals ───────────────────────────────────────────────── */

export type FuelTotals = {
  fills: number;
  amountPaise: number;
  /** kg and litres are never added together. */
  kg: number;
  litres: number;
};

function totalsOf(rows: FuelTableRow[]): FuelTotals {
  const live = rows.filter((r) => !r.voided);
  return {
    fills: live.length,
    amountPaise: live.reduce((n, r) => n + r.amountPaise, 0),
    kg: Math.round(live.filter((r) => r.unit === "kg").reduce((n, r) => n + r.quantity, 0) * 100) / 100,
    litres: Math.round(live.filter((r) => r.unit === "litre").reduce((n, r) => n + r.quantity, 0) * 100) / 100,
  };
}

/** The whole filtered set and each vehicle in it. A voided fill counts for nothing. */
export function fuelTotals(rows: FuelTableRow[]): {
  all: FuelTotals;
  byVehicle: ({ vehicleId: string; vehicleName: string } & FuelTotals)[];
} {
  const groups = new Map<string, FuelTableRow[]>();
  for (const r of rows) {
    const list = groups.get(r.vehicleId) ?? [];
    list.push(r);
    groups.set(r.vehicleId, list);
  }
  return {
    all: totalsOf(rows),
    byVehicle: [...groups.entries()]
      .map(([vehicleId, list]) => ({ vehicleId, vehicleName: list[0]?.vehicleName ?? "", ...totalsOf(list) }))
      .sort((a, b) => a.vehicleName.localeCompare(b.vehicleName)),
  };
}

export function qtyText(t: { kg: number; litres: number }): string {
  const parts = [t.kg ? `${t.kg.toFixed(2)} kg` : "", t.litres ? `${t.litres.toFixed(2)} L` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

/* ─── reconcile: the old desk refills against the book ─────── */

/** "cng 8.63 kg @ ₹92.67/kg — UP65RT9825 · 41200 km · bill B-1" → its parts (both narration styles). */
export function parseFuelNarration(narration: string): {
  fuelType: string;
  qty: number;
  unit: string;
  ratePaise: number;
  plate: string;
} | null {
  const m = /^\s*([a-z]+)\s+([\d.]+)\s+([a-z]+)\s+@\s+₹([\d.,]+)\/[a-z]+\s+—\s+([^()·]+?)\s*(?:\(|·|$)/i.exec(narration);
  if (!m) return null;
  return {
    fuelType: m[1]!.toLowerCase(),
    qty: Number(m[2]),
    unit: m[3]!.toLowerCase(),
    ratePaise: Math.round(Number(m[4]!.replace(/,/g, "")) * 100),
    plate: m[5]!.trim(),
  };
}

export type ReconcileLine = {
  lineId: string;
  voucherId: string;
  voucherNo: string;
  voucherDate: string;
  debitPaise: number;
  narration: string;
  reversed: boolean;
  /** This line already carries a register fill. */
  linked: boolean;
};

export type ReconcileRefill = {
  id: string;
  vehicleId: string;
  fillDate: string;
  qty: number;
  amountPaise: number;
  /** Already copied into the register by the import. */
  imported: boolean;
};

export type FuelReconcilePlan = {
  /** The import will tie these to the voucher already keyed in Accounts. */
  matched: { refill: ReconcileRefill; line: ReconcileLine }[];
  /** No live voucher holds them — most were cleared in the 13 Oct clean-up. Offer: void. */
  refillOnly: ReconcileRefill[];
  /** Live fuel money in the book with no fill in the register. Offer: create the fill. */
  lineOnly: ReconcileLine[];
};

/**
 * What the reconcile would do — read-only, nothing written.
 *
 * Pairing is the import's own rule (matchExistingFuelLine): same day, same
 * amount to the paisa, the line names the vehicle's plate or VIN, the voucher
 * not reversed, one line per refill and ambiguity refused — so the report
 * says exactly what pressing Import will do, never something else.
 */
export function planFuelReconcile(input: {
  refills: ReconcileRefill[];
  lines: ReconcileLine[];
  vehicles: { id: string; registrationNo: string }[];
}): FuelReconcilePlan {
  const plate = new Map(input.vehicles.map((v) => [v.id, normalizeVehicleKey(v.registrationNo)]));
  const taken = new Set(input.lines.filter((l) => l.linked).map((l) => l.lineId));
  const matched: FuelReconcilePlan["matched"] = [];
  const refillOnly: ReconcileRefill[] = [];
  const pending = [...input.refills]
    .filter((r) => !r.imported)
    .sort((a, b) => a.fillDate.localeCompare(b.fillDate) || a.id.localeCompare(b.id));
  for (const r of pending) {
    const key = plate.get(r.vehicleId) ?? "";
    const hits = key
      ? input.lines.filter(
          (l) =>
            !l.reversed &&
            !taken.has(l.lineId) &&
            l.voucherDate === r.fillDate &&
            l.debitPaise === r.amountPaise &&
            l.narration.toUpperCase().replace(/[^A-Z0-9]/g, "").includes(key),
        )
      : [];
    if (hits.length === 1) {
      taken.add(hits[0]!.lineId);
      matched.push({ refill: r, line: hits[0]! });
    } else {
      refillOnly.push(r);
    }
  }
  const lineOnly = input.lines.filter((l) => !l.reversed && !taken.has(l.lineId));
  return { matched, refillOnly, lineOnly };
}
