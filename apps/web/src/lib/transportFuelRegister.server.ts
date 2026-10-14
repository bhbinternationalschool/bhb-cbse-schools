/**
 * Fuel register — reads and writes (server only).
 *
 * The register is transport_fuel_fills (migrations 20261011170000 +
 * 20261014101500). Rules live in transportFuelRegister.ts; the money goes
 * through the ledger's own posting function (ledgerPost → ledger_post RPC) and
 * reversal (ledgerReverse → ledger_reverse) — no journal row is written here.
 *
 * Every read answers ok:false when it did not complete. A failed read is never
 * shown as "no fuel this month" or "nothing awaiting the office".
 */
import "server-only";

import { ApiError } from "@/lib/api/v1/errors";
import { NON_FLEET_VEHICLE_REFS } from "@/lib/fleetEdgeAnalytics";
import { ledgerListAccounts } from "@/lib/ledger/ledger.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages, fetchByIds } from "@/lib/supabase/pageAll";
import {
  buildFuelVoucher,
  FUEL_EXPENSE_CODE,
  fleetEdgeMonthByVehicle,
  mapDeskFuelLog,
  matchExistingFuelLine,
  type DeskFuelLog,
  type FleetEdgeDetailsRow,
  type FuelKind,
  type FuelPaymentMode,
  type FuelUnit,
  type FuelVoucherLine,
  istDayOf,
  unitForFuel,
} from "@/lib/transportFuelRegister";
import {
  createFromLineRefusal,
  parseFuelNarration,
  planFuelReconcile,
  tieCandidatesFor,
  type UnlinkedFill,
  type FuelReconcilePlan,
  type ReconcileLine,
} from "@/lib/fuelLog";
import { normalizeVehicleKey } from "@/lib/fleetEdgeLink";
import { fuelAmountPaise } from "@/lib/fuelExpenseLine";

async function tenant() {
  const ctx = await getServerTenantContext();
  if (!ctx) throw new ApiError("server_error", "Database not configured", 503);
  return ctx;
}

/* ─── rows ─────────────────────────────────────────────────── */

export type RegisterFill = {
  id: string;
  vehicleId: string;
  fillDate: string;
  quantity: number;
  unit: FuelUnit;
  fuelType: FuelKind;
  /** Rate per kg / litre in paise when the rate was entered; amount = round(rate × qty). */
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
  deskEntryId: string;
  voucherId: string | null;
  voucherNo: string;
  voucherOrigin: "" | "posted" | "adopted";
  postedAt: string;
  postedByName: string;
  reversalVoucherNo: string;
  createdByStaffId: string;
  createdByName: string;
  createdAt: string;
  voided: boolean;
  voidedByName: string;
  voidReason: string;
};

const REGISTER_COLS =
  "id, vehicle_id, fill_date, quantity, unit, fuel_type, rate_paise, amount_paise, odometer_km, receipt_path, note, dealer_name, bill_no, payment_mode, bank_account_id, payment_ref, entry_source, desk_entry_id, voucher_id, voucher_no, voucher_origin, posted_at, posted_by_name, reversal_voucher_no, created_by_staff_id, created_by_name, created_at, voided_at, voided_by_name, void_reason";

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function rowToFill(r: Record<string, unknown>): RegisterFill {
  const mode = String(r.payment_mode ?? "");
  const src = String(r.entry_source ?? "app");
  const origin = String(r.voucher_origin ?? "");
  const fuel = String(r.fuel_type ?? "");
  return {
    id: String(r.id),
    vehicleId: String(r.vehicle_id),
    fillDate: String(r.fill_date).slice(0, 10),
    quantity: Number(r.quantity),
    unit: r.unit === "kg" ? "kg" : "litre",
    fuelType: fuel === "cng" || fuel === "petrol" || fuel === "diesel" ? fuel : "",
    ratePaise: numOrNull(r.rate_paise),
    amountPaise: Number(r.amount_paise),
    odometerKm: numOrNull(r.odometer_km),
    receiptPath: String(r.receipt_path ?? ""),
    note: String(r.note ?? ""),
    dealerName: String(r.dealer_name ?? ""),
    billNo: String(r.bill_no ?? ""),
    paymentMode: mode === "cash" || mode === "bank" || mode === "upi" || mode === "on_account" ? mode : "",
    bankAccountId: String(r.bank_account_id ?? ""),
    paymentRef: String(r.payment_ref ?? ""),
    entrySource: src === "web" || src === "desk_import" || src === "accounts" ? src : "app",
    deskEntryId: String(r.desk_entry_id ?? ""),
    voucherId: r.voucher_id ? String(r.voucher_id) : null,
    voucherNo: String(r.voucher_no ?? ""),
    voucherOrigin: origin === "posted" || origin === "adopted" ? origin : "",
    postedAt: String(r.posted_at ?? ""),
    postedByName: String(r.posted_by_name ?? ""),
    reversalVoucherNo: String(r.reversal_voucher_no ?? ""),
    createdByStaffId: String(r.created_by_staff_id ?? ""),
    createdByName: String(r.created_by_name ?? ""),
    createdAt: String(r.created_at ?? ""),
    voided: r.voided_at != null,
    voidedByName: String(r.voided_by_name ?? ""),
    voidReason: String(r.void_reason ?? ""),
  };
}

/** Fills between two dates inclusive (either end optional). Paged. */
export async function readRegisterFills(input: { from?: string; to?: string }): Promise<
  { ok: true; fills: RegisterFill[] } | { ok: false; error: string }
> {
  const { sb, tenantId } = await tenant();
  const res = await fetchAllPages<Record<string, unknown>>((from, to) => {
    let q = sb.from("transport_fuel_fills").select(REGISTER_COLS).eq("tenant_id", tenantId);
    if (input.from) q = q.gte("fill_date", input.from);
    if (input.to) q = q.lte("fill_date", input.to);
    return q.order("id", { ascending: true }).range(from, to);
  });
  if (res.error) return { ok: false, error: res.error };
  return { ok: true, fills: res.rows.map(rowToFill) };
}

/** Every fill not yet in accounts and not voided — the office's queue. Paged. */
export async function readUnpostedFills(): Promise<{ ok: true; fills: RegisterFill[] } | { ok: false; error: string }> {
  const { sb, tenantId } = await tenant();
  const res = await fetchAllPages<Record<string, unknown>>((from, to) =>
    sb
      .from("transport_fuel_fills")
      .select(REGISTER_COLS)
      .eq("tenant_id", tenantId)
      .is("voucher_id", null)
      .is("voided_at", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (res.error) return { ok: false, error: res.error };
  return { ok: true, fills: res.rows.map(rowToFill) };
}

export async function readRegisterFill(id: string): Promise<RegisterFill | null> {
  const { sb, tenantId } = await tenant();
  const { data, error } = await sb
    .from("transport_fuel_fills")
    .select(REGISTER_COLS)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new ApiError("server_error", `Could not read the fill: ${error.message}`, 502);
  return data ? rowToFill(data as Record<string, unknown>) : null;
}

/* ─── office entry ─────────────────────────────────────────── */

/**
 * The office's own fill, saved under the browser's id: a retried or
 * double-clicked save writes one row. Posting is a separate step
 * (postFillToAccounts) so a refused voucher leaves the fill saved and visibly
 * "not in accounts", never silently lost.
 */
export async function addOfficeFill(input: {
  id: string;
  vehicleId: string;
  fillDate: string;
  quantity: number;
  unit: FuelUnit;
  fuelType: FuelKind;
  ratePaise?: number | null;
  amountPaise: number;
  odometerKm: number | null;
  receiptPath: string;
  note: string;
  dealerName: string;
  billNo: string;
  paymentMode: "" | FuelPaymentMode;
  bankAccountId: string;
  paymentRef: string;
  staffId: string;
  name: string;
}): Promise<RegisterFill> {
  const { sb, tenantId } = await tenant();
  const { error } = await sb.from("transport_fuel_fills").upsert(
    {
      id: input.id,
      tenant_id: tenantId,
      vehicle_id: input.vehicleId,
      fill_date: input.fillDate,
      quantity: input.quantity,
      unit: input.unit,
      fuel_type: input.fuelType,
      rate_paise: input.ratePaise ?? null,
      amount_paise: input.amountPaise,
      odometer_km: input.odometerKm,
      receipt_path: input.receiptPath,
      note: input.note.slice(0, 500),
      dealer_name: input.dealerName.slice(0, 120),
      bill_no: input.billNo.slice(0, 60),
      payment_mode: input.paymentMode,
      bank_account_id: input.bankAccountId,
      payment_ref: input.paymentRef.slice(0, 80),
      entry_source: "web",
      created_by_staff_id: input.staffId,
      created_by_name: input.name.slice(0, 120),
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (error) throw new ApiError("server_error", `Could not save the fill: ${error.message}`, 502);
  const fill = await readRegisterFill(input.id);
  if (!fill) throw new ApiError("conflict", "That entry id is already used. Try again.", 409);
  return fill;
}

/**
 * Say how a fill was paid. Only while it is not yet in accounts and not
 * voided — once a voucher carries it, the mode is the voucher's.
 */
export async function setFillPayment(input: {
  id: string;
  paymentMode: FuelPaymentMode;
  bankAccountId: string;
  paymentRef: string;
  dealerName?: string;
}): Promise<RegisterFill> {
  const { sb, tenantId } = await tenant();
  const patch: Record<string, unknown> = {
    payment_mode: input.paymentMode,
    bank_account_id: input.paymentMode === "bank" || input.paymentMode === "upi" ? input.bankAccountId : "",
    payment_ref: input.paymentMode === "bank" || input.paymentMode === "upi" ? input.paymentRef.slice(0, 80) : "",
  };
  if (input.dealerName != null && input.dealerName.trim()) patch.dealer_name = input.dealerName.trim().slice(0, 120);
  const { data, error } = await sb
    .from("transport_fuel_fills")
    .update(patch)
    .eq("tenant_id", tenantId)
    .eq("id", input.id)
    .is("voucher_id", null)
    .is("voided_at", null)
    .select(REGISTER_COLS);
  if (error) throw new ApiError("server_error", `Could not save the payment: ${error.message}`, 502);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) throw new ApiError("conflict", "This fill is already in accounts or voided — reload.", 409);
  return rowToFill(row);
}

/** Correct the non-money facts of a fill (a mistyped quantity, a missed odometer). */
export async function amendFillDetails(input: {
  id: string;
  quantity: number;
  odometerKm: number | null;
  dealerName: string;
  billNo: string;
  note: string;
  name: string;
}): Promise<RegisterFill> {
  const before = await readRegisterFill(input.id);
  // In the book, quantity is part of the money (the voucher line says "7.55 kg
  // @ ₹92.67") — the table refuses the change (migration 20261014150000), so
  // say why in words: void and enter again.
  if (before?.voucherId && Math.abs(before.quantity - input.quantity) > 0.0001) {
    throw new ApiError(
      "conflict",
      `This fill is in the book as ${before.voucherNo}; its quantity changes only by voiding it and entering it again.`,
      409,
    );
  }
  const { sb, tenantId } = await tenant();
  const { data, error } = await sb
    .from("transport_fuel_fills")
    .update({
      quantity: input.quantity,
      odometer_km: input.odometerKm,
      dealer_name: input.dealerName.slice(0, 120),
      bill_no: input.billNo.slice(0, 60),
      note: input.note.slice(0, 500),
      amended_at: new Date().toISOString(),
      amended_by_name: input.name.slice(0, 120),
    })
    .eq("tenant_id", tenantId)
    .eq("id", input.id)
    .is("voided_at", null)
    .select(REGISTER_COLS);
  if (error) throw new ApiError("server_error", `Could not correct the fill: ${error.message}`, 502);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) throw new ApiError("conflict", "This fill is voided — it cannot be corrected.", 409);
  return rowToFill(row);
}

/* ─── accounts ─────────────────────────────────────────────── */

export type BankChoice = { bankAccountId: string; code: string; name: string };

/** The per-bank ledger accounts the office can pay fuel from. */
export async function fuelBankChoices(): Promise<BankChoice[]> {
  const accounts = await ledgerListAccounts();
  return accounts
    .filter((a) => a.isBank && a.bankAccountId)
    .map((a) => ({ bankAccountId: a.bankAccountId, code: a.code, name: a.name }));
}

/**
 * Post one fill's Vehicle Fuel voucher, exactly once.
 *
 * ledger_post is idempotent on (source_type 'transport_fuel_fill', fill id):
 * a retry, a double click or two people pressing Post at once all land on the
 * SAME voucher. The fill row is then stamped only if it is still unstamped;
 * when a concurrent call stamped it first, the stored voucher is returned.
 */
export async function postFillToAccounts(input: {
  fill: RegisterFill;
  vehicle: { name: string; registrationNo: string };
  actor: string;
}): Promise<RegisterFill> {
  const { fill } = input;
  if (fill.voided) throw new ApiError("conflict", "This fill is voided — nothing to post.", 409);
  if (fill.voucherId) return fill;
  if (!fill.paymentMode) throw new ApiError("bad_request", "Say how this fill was paid before posting it.", 400);

  const accounts = await ledgerListAccounts();
  const head = accounts.find((a) => a.code === FUEL_EXPENSE_CODE);
  if (!head || head.hasChildren) {
    throw new ApiError(
      "server_error",
      `The book has no postable ${FUEL_EXPENSE_CODE} Vehicle Fuel head — nothing was posted. Check Accounts → Masters.`,
      503,
    );
  }
  let payment: Parameters<typeof buildFuelVoucher>[0]["payment"];
  if (fill.paymentMode === "bank" || fill.paymentMode === "upi") {
    const bank = accounts.find((a) => a.isBank && a.bankAccountId === fill.bankAccountId);
    if (!bank) throw new ApiError("bad_request", "Choose which bank account paid.", 400);
    payment = { mode: fill.paymentMode, bankAccountCode: bank.code, bankAccountId: fill.bankAccountId, ref: fill.paymentRef };
  } else {
    payment = { mode: fill.paymentMode };
  }
  const built = buildFuelVoucher({
    fillId: fill.id,
    fillDate: fill.fillDate,
    vehicle: input.vehicle,
    fuelType: fill.fuelType,
    quantity: fill.quantity,
    unit: fill.unit,
    amountPaise: fill.amountPaise,
    odometerKm: fill.odometerKm,
    dealerName: fill.dealerName,
    billNo: fill.billNo,
    payment,
  });
  if (!built.ok) throw new ApiError("bad_request", built.error, 400);

  // Voucher and stamp in ONE transaction (transport_fuel_fill_post, migration
  // 20261014150000): either the book and the fill both say "posted", or
  // neither does. Still keyed (transport_fuel_fill, fill id), so a retry or a
  // second press lands on the same voucher.
  const res = await rpcFuelPost({
    voucher: { ...built.voucher, createdBy: input.actor },
    fills: [{ id: fill.id, line_no: 1, existing: true }],
    actor: input.actor,
  });
  if (!res.ok) throw new ApiError("server_error", `The book refused the fuel voucher: ${res.error}`, 422);
  const now = await readRegisterFill(fill.id);
  if (!now) throw new ApiError("not_found", "Fuel entry not found", 404);
  return now;
}

/**
 * Void a fill. A voucher THIS register posted is reversed first (ledger_reverse
 * is idempotent, so a retry after a half-finished void is safe). A voucher the
 * office keyed in Accounts ("adopted") is NOT reversed from here — it may carry
 * other lines — and the caller is told to correct it in Accounts.
 */
export async function voidFillWithVoucher(input: {
  fill: RegisterFill;
  reason: string;
  actor: string;
}): Promise<{ fill: RegisterFill; warning: string }> {
  const { fill } = input;
  if (fill.voided) throw new ApiError("conflict", "This entry was already voided.", 409);
  // One transaction (transport_fuel_fill_void): the voucher is reversed and
  // the fill voided together. A voucher that is this fill and nothing else is
  // reversed whoever keyed it; one that also carries other lines is refused
  // with its number — it is voided in Accounts, which voids this fill too.
  const { sb, tenantId } = await tenant();
  const { data, error } = await sb.rpc("transport_fuel_fill_void", {
    p_tenant_id: tenantId,
    p_id: fill.id,
    p_reason: input.reason.slice(0, 300),
    p_actor: input.actor.slice(0, 120),
  });
  if (error) throw new ApiError("server_error", `Could not void the fill: ${error.message}`, 502);
  const r = (data ?? {}) as { ok?: boolean; error?: string };
  if (!r.ok) throw new ApiError("conflict", r.error || "The fill could not be voided", 409);
  const now = await readRegisterFill(fill.id);
  if (!now) throw new ApiError("not_found", "Fuel entry not found", 404);
  return { fill: now, warning: "" };
}

/* ─── the Vehicle Fuel lines already in the book ───────────── */

/** Every 5031 debit line, with whether its voucher has been reversed. Paged. */
export async function readFuelVoucherLines(): Promise<{ ok: true; lines: FuelVoucherLine[] } | { ok: false; error: string }> {
  const { sb, tenantId } = await tenant();
  const acct = await sb
    .from("ledger_accounts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("code", FUEL_EXPENSE_CODE)
    .maybeSingle();
  if (acct.error) return { ok: false, error: acct.error.message };
  if (!acct.data) return { ok: true, lines: [] };
  const accountId = String((acct.data as { id: string }).id);

  const lines = await fetchAllPages<Record<string, unknown>>((from, to) =>
    sb
      .from("ledger_lines")
      .select("id, voucher_id, debit_paise, narration")
      .eq("tenant_id", tenantId)
      .eq("account_id", accountId)
      .gt("debit_paise", 0)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (lines.error) return { ok: false, error: lines.error };
  const voucherIds = [...new Set(lines.rows.map((l) => String(l.voucher_id)))];
  const vouchers = await fetchByIds<Record<string, unknown>>(voucherIds, (chunk, from, to) =>
    sb
      .from("ledger_vouchers")
      .select("id, voucher_no, voucher_date, voucher_type")
      .eq("tenant_id", tenantId)
      .in("id", chunk)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (vouchers.error) return { ok: false, error: vouchers.error };
  const reversals = await fetchByIds<Record<string, unknown>>(voucherIds, (chunk, from, to) =>
    sb
      .from("ledger_vouchers")
      .select("id, reverses_voucher_id")
      .eq("tenant_id", tenantId)
      .in("reverses_voucher_id", chunk)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (reversals.error) return { ok: false, error: reversals.error };
  const reversed = new Set(reversals.rows.map((r) => String(r.reverses_voucher_id)));
  const byId = new Map(vouchers.rows.map((v) => [String(v.id), v]));
  const out: FuelVoucherLine[] = [];
  for (const l of lines.rows) {
    const v = byId.get(String(l.voucher_id));
    if (!v || v.voucher_type === "reversal") continue;
    out.push({
      lineId: String(l.id),
      voucherId: String(l.voucher_id),
      voucherNo: String(v.voucher_no ?? ""),
      voucherDate: String(v.voucher_date ?? "").slice(0, 10),
      debitPaise: Number(l.debit_paise),
      narration: String(l.narration ?? ""),
      reversed: reversed.has(String(l.voucher_id)),
    });
  }
  return { ok: true, lines: out };
}

/* ─── import of the retired desk fuel log ──────────────────── */

export type ImportResult = {
  deskEntries: number;
  imported: number;
  alreadyImported: number;
  linkedToAccounts: number;
  notInAccounts: number;
  skipped: { deskEntryId: string; reason: string }[];
};

/**
 * Copy the desk's fuelRefillLogs into the register, once.
 *
 * Idempotent twice over: each row's id is derived from the desk id, and
 * desk_entry_id is unique per tenant — pressing Import again adds nothing.
 * No voucher is POSTED. Where the book already holds the very same fill
 * (same date, amount and vehicle on a live 5031 line — the office keyed
 * Apr–Sep fuel through Accounts on 13 Oct), the row is LINKED to that
 * voucher, so posting it again is impossible. Anything else stays "not in
 * accounts" for the office to post with a payment mode.
 */
export async function importDeskFuelLogs(input: {
  logs: DeskFuelLog[];
  vehicles: { id: string; name: string; registrationNo: string; fuelType?: string }[];
  dealers: { id: string; name: string }[];
}): Promise<ImportResult> {
  const { sb, tenantId } = await tenant();
  const existing = await readRegisterFills({});
  if (!existing.ok) throw new ApiError("server_error", `Could not read the register: ${existing.error}`, 503);
  const have = new Set(existing.fills.map((f) => f.deskEntryId).filter(Boolean));
  const takenLines = new Set<string>();
  // Lines already linked to a fill can never be claimed again.
  const linked = await fetchAllPages<Record<string, unknown>>((from, to) =>
    sb
      .from("transport_fuel_fills")
      .select("id, voucher_line_id")
      .eq("tenant_id", tenantId)
      .not("voucher_line_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (linked.error) throw new ApiError("server_error", `Could not read linked vouchers: ${linked.error}`, 503);
  for (const r of linked.rows) takenLines.add(String(r.voucher_line_id));

  const book = await readFuelVoucherLines();
  if (!book.ok) throw new ApiError("server_error", `Could not read the Vehicle Fuel vouchers: ${book.error}`, 503);

  const vehicleById = new Map(input.vehicles.map((v) => [v.id, v]));
  const dealerNameById = new Map(input.dealers.map((d) => [d.id, d.name]));
  const result: ImportResult = {
    deskEntries: input.logs.length,
    imported: 0,
    alreadyImported: 0,
    linkedToAccounts: 0,
    notInAccounts: 0,
    skipped: [],
  };
  const rows: Record<string, unknown>[] = [];
  for (const log of input.logs) {
    const mapped = mapDeskFuelLog(log, vehicleById.get(String(log.vehicleId)), dealerNameById);
    if (!mapped.ok) {
      result.skipped.push({ deskEntryId: mapped.deskEntryId, reason: mapped.reason });
      continue;
    }
    const f = mapped.fill;
    if (have.has(f.deskEntryId)) {
      result.alreadyImported += 1;
      continue;
    }
    const vehicle = vehicleById.get(f.vehicleId)!;
    const line = matchExistingFuelLine(f, vehicle, book.lines, takenLines);
    if (line) {
      takenLines.add(line.lineId);
      result.linkedToAccounts += 1;
    } else {
      result.notInAccounts += 1;
    }
    rows.push({
      id: f.id,
      tenant_id: tenantId,
      vehicle_id: f.vehicleId,
      fill_date: f.fillDate,
      quantity: f.quantity,
      unit: f.unit,
      fuel_type: f.fuelType,
      amount_paise: f.amountPaise,
      odometer_km: f.odometerKm,
      note: f.note,
      dealer_name: f.dealerName,
      bill_no: f.billNo,
      payment_mode: f.paymentMode,
      entry_source: "desk_import",
      desk_entry_id: f.deskEntryId,
      created_by_name: f.createdByName.slice(0, 120),
      // Every row carries every column: a batch upsert sends the union of the
      // rows' keys and fills a missing one with NULL, so a "not in accounts"
      // row next to a linked one would send voucher_no = NULL and the whole
      // import was refused (found rehearsing 14 Oct 2026).
      voucher_id: null,
      voucher_no: "",
      voucher_line_id: null,
      voucher_origin: "",
      posted_by_name: "",
      ...(line
        ? {
            voucher_id: line.voucherId,
            voucher_no: line.voucherNo,
            voucher_line_id: line.lineId,
            voucher_origin: "adopted",
            posted_by_name: "Keyed in Accounts",
          }
        : {}),
    });
  }
  // One statement: either the whole batch lands or none of it does.
  if (rows.length > 0) {
    const { data, error } = await sb
      .from("transport_fuel_fills")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true })
      .select("id");
    if (error) throw new ApiError("server_error", `Could not import the old fuel entries: ${error.message}`, 502);
    result.imported = (data ?? []).length;
  }
  return result;
}

/* ─── Fleet Edge ───────────────────────────────────────────── */

/**
 * Fleet Edge distance and fuel used per desk vehicle for one IST month, read
 * from `details` events only, paged past the 1,000-row cap.
 */
export async function readFleetEdgeMonth(
  month: string,
  vehicles: { id: string; registrationNo: string }[],
): Promise<{ ok: true; byVehicle: Map<string, { km: number; fuelUsed: number; windows: number }> } | { ok: false; error: string }> {
  const { sb, tenantId } = await tenant();
  const [y, m] = month.split("-").map(Number) as [number, number];
  // A little either side of the IST month; the pure function keeps only the
  // windows whose start falls inside it.
  const from = new Date(Date.UTC(y, m - 1, 1) - 86_400_000).toISOString();
  const to = new Date(Date.UTC(y, m, 1) + 2 * 86_400_000).toISOString();
  const res = await fetchAllPages<Record<string, unknown>>(
    (a, b) =>
      sb
        .from("fleet_edge_events")
        .select(
          "id, vehicle_ref, registration_number, received_at, win_from:payload->>from, km:payload->vehiclePerformance->>distanceTravelled, fuel:payload->vehicleEfficiency->>fuelUsed",
        )
        .eq("tenant_id", tenantId)
        .eq("event_type", "details")
        .gte("received_at", from)
        .lt("received_at", to)
        .order("id", { ascending: true })
        .range(a, b),
    { maxRows: 100_000 },
  );
  if (res.error) return { ok: false, error: res.error };
  if (res.truncated) return { ok: false, error: "Fleet Edge sent more events than one read can hold" };
  const rows: FleetEdgeDetailsRow[] = res.rows.map((r) => ({
    vehicleRef: r.vehicle_ref == null ? null : String(r.vehicle_ref),
    registrationNumber: r.registration_number == null ? null : String(r.registration_number),
    windowFrom: r.win_from == null ? null : String(r.win_from),
    receivedAt: String(r.received_at ?? ""),
    km: r.km,
    fuelUsed: r.fuel,
  }));
  return { ok: true, byVehicle: fleetEdgeMonthByVehicle({ month, vehicles, rows, ignoreRefs: NON_FLEET_VEHICLE_REFS }) };
}

/* ─── one-transaction posting (migration 20261014150000) ───── */

type RpcLine = {
  accountCode: string;
  debitPaise: number;
  creditPaise: number;
  narration?: string;
  subledgerKind?: string;
  subledgerId?: string;
  costCentreCode?: string;
  party?: { kind: string; externalId: string; name?: string };
  instrument?: { mode?: string; ref?: string; date?: string };
};

/** The ledger_post row shape — same mapping as ledger.server's lineToRpc. */
function lineToRpc(line: RpcLine) {
  return {
    account_code: line.accountCode,
    debit_paise: Math.round(line.debitPaise || 0),
    credit_paise: Math.round(line.creditPaise || 0),
    narration: line.narration ?? "",
    subledger_kind: line.subledgerKind ?? "",
    subledger_id: line.subledgerId ?? "",
    cost_centre_code: line.costCentreCode ?? "",
    ...(line.party
      ? { party: { kind: line.party.kind, external_id: line.party.externalId, name: line.party.name ?? "" } }
      : {}),
    ...(line.instrument
      ? { instrument: { mode: line.instrument.mode ?? "", ref: line.instrument.ref ?? "", date: line.instrument.date ?? null } }
      : {}),
  };
}

export type FuelPostResult =
  | { ok: true; created: boolean; voucherId: string; voucherNo: string; fillIds: string[] }
  | { ok: false; error: string };

/**
 * transport_fuel_fill_post: ledger_post and the fills in one transaction.
 * `fills[].line_no` is the 1-based voucher line each fill sits on.
 */
async function rpcFuelPost(input: {
  voucher: {
    voucherType: string;
    date: string;
    narration?: string;
    sourceType?: string;
    sourceId?: string;
    createdBy?: string;
    lines: RpcLine[];
  };
  fills: Record<string, unknown>[];
  actor: string;
}): Promise<FuelPostResult> {
  const { sb, tenantId } = await tenant();
  const { data, error } = await sb.rpc("transport_fuel_fill_post", {
    p_tenant_id: tenantId,
    p_voucher: {
      voucher_type: input.voucher.voucherType,
      date: input.voucher.date,
      narration: input.voucher.narration ?? "",
      source_type: input.voucher.sourceType ?? "",
      source_id: input.voucher.sourceId ?? "",
      created_by: input.voucher.createdBy || input.actor,
      lines: input.voucher.lines.map(lineToRpc),
    },
    p_fills: input.fills,
    p_actor: input.actor.slice(0, 120),
  });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as { ok?: boolean; error?: string; created?: boolean; voucher_id?: string; voucher_no?: string; fill_ids?: string };
  if (!r.ok) {
    const msg = r.error || "the book refused the fuel voucher";
    return {
      ok: false,
      error: /no ledger account with code/i.test(msg)
        ? `${msg} — if it was recently added to the chart, run the ensure-masters action to install it`
        : msg,
    };
  }
  return {
    ok: true,
    created: r.created !== false,
    voucherId: String(r.voucher_id ?? ""),
    voucherNo: String(r.voucher_no ?? ""),
    fillIds: String(r.fill_ids ?? "").split(",").filter(Boolean),
  };
}

/** One fuel fill keyed in Accounts, as the register stores it. */
export type AccountsFuelFill = {
  id: string;
  /** 1-based voucher line the fill's debit sits on. */
  lineNo: number;
  vehicleId: string;
  fillDate: string;
  fuelType: FuelKind;
  quantity: number;
  ratePaise: number;
  odometerKm: number | null;
  dealerName: string;
  billNo: string;
  paymentMode: FuelPaymentMode;
  bankAccountId: string;
  paymentRef: string;
  note: string;
};

/**
 * Accounts → Quick / Multi-line expense with fuel: the voucher is the form's
 * (it may carry other heads), and each fuel line becomes a register fill in
 * the SAME transaction — so the book and Transport → Fuel never disagree about
 * what was bought. The amount is rate × qty (fuelAmountPaise), and the SQL
 * checks the voucher line carries exactly that.
 */
export async function postAccountsFuel(input: {
  voucher: { voucherType: string; date: string; narration?: string; createdBy?: string; lines: RpcLine[] };
  fills: AccountsFuelFill[];
  vehicles: { id: string; fuels: { fuelType: string }[] }[];
  actor: string;
  staffId: string;
}): Promise<FuelPostResult> {
  if (!input.fills.length) return { ok: false, error: "No fuel lines to post" };
  for (const f of input.fills) {
    const v = input.vehicles.find((x) => x.id === f.vehicleId);
    if (!v) return { ok: false, error: `Vehicle ${f.vehicleId || "(none chosen)"} is not on the fleet` };
    if (!v.fuels.some((o) => o.fuelType === f.fuelType)) {
      return { ok: false, error: `That vehicle runs on ${v.fuels.map((o) => o.fuelType).join(" or ")}, not ${f.fuelType || "this fuel"}` };
    }
    if (!(f.quantity > 0) || f.quantity > 2000) return { ok: false, error: "Enter the quantity filled" };
    if (!(f.ratePaise > 0)) return { ok: false, error: "Enter the rate per kg / litre" };
    if (f.paymentMode === "on_account" && !f.dealerName.trim()) {
      return { ok: false, error: "Fuel on credit is owed to someone — name the dealer." };
    }
  }
  return rpcFuelPost({
    voucher: input.voucher,
    actor: input.actor,
    fills: input.fills.map((f) => {
      const qty = Math.round(f.quantity * 100) / 100;
      return {
        id: f.id,
        line_no: f.lineNo,
        vehicle_id: f.vehicleId,
        fill_date: f.fillDate,
        quantity: qty,
        unit: unitForFuel(f.fuelType),
        fuel_type: f.fuelType,
        rate_paise: Math.round(f.ratePaise),
        amount_paise: fuelAmountPaise(f.ratePaise, qty),
        odometer_km: f.odometerKm,
        dealer_name: f.dealerName.trim(),
        bill_no: f.billNo.trim(),
        payment_mode: f.paymentMode,
        bank_account_id: f.paymentMode === "bank" || f.paymentMode === "upi" ? f.bankAccountId : "",
        payment_ref: f.paymentMode === "bank" || f.paymentMode === "upi" ? f.paymentRef.trim() : "",
        note: f.note.trim(),
        entry_source: "accounts",
        created_by_staff_id: input.staffId,
        created_by_name: input.actor,
      };
    }),
  });
}

/** The fills a voucher carries — amending or re-heading it would cut them loose. */
export async function fuelFillsOnVoucher(voucherId: string): Promise<{ id: string; vehicleId: string }[]> {
  const c = await getServerTenantContext();
  if (!c || !voucherId) return [];
  const { data } = await c.sb
    .from("transport_fuel_fills")
    .select("id, vehicle_id")
    .eq("tenant_id", c.tenantId)
    .eq("voucher_id", voucherId);
  return ((data ?? []) as { id: string; vehicle_id: string }[]).map((r) => ({ id: r.id, vehicleId: r.vehicle_id }));
}

/** The last odometer each vehicle showed at a live fill — the entry forms' sanity check. */
export async function lastOdometerByVehicle(): Promise<Record<string, number>> {
  const res = await readRegisterFills({});
  const out: Record<string, number> = {};
  if (!res.ok) return out;
  for (const f of res.fills) {
    if (f.voided || f.odometerKm == null) continue;
    out[f.vehicleId] = Math.max(out[f.vehicleId] ?? 0, f.odometerKm);
  }
  return out;
}

/* ─── reconcile: old desk refills ↔ the book ───────────────── */

export type FuelReconcileReport = Omit<FuelReconcilePlan, "lineOnly"> & {
  /** Live fuel lines with no fill — each with the fill it should be tied to, or why it cannot be created. */
  lineOnly: (ReconcileLine & { tieTo: string[]; refusal: string })[];
  deskEntries: number;
  liveLines: number;
  liveLinePaise: number;
  /** Imported from the old tab but in no voucher — candidates to void. */
  importedNotInAccounts: RegisterFill[];
};

/**
 * Read-only: the old desk fuel log, the register and every live Vehicle Fuel
 * line, paired by the import's own rule. Writes nothing.
 */
export async function fuelReconcileReport(input: {
  deskLogs: { id: string; vehicleId: string; filledAt: string; qty: number; amountPaise: number }[];
  vehicles: { id: string; registrationNo: string }[];
}): Promise<FuelReconcileReport> {
  const [fills, book] = await Promise.all([readRegisterFills({}), readFuelVoucherLines()]);
  if (!fills.ok) throw new ApiError("server_error", `Could not read the register: ${fills.error}`, 503);
  if (!book.ok) throw new ApiError("server_error", `Could not read the Vehicle Fuel vouchers: ${book.error}`, 503);
  const { sb, tenantId } = await tenant();
  const linkedRes = await fetchAllPages<Record<string, unknown>>((from, to) =>
    sb
      .from("transport_fuel_fills")
      .select("id, voucher_line_id")
      .eq("tenant_id", tenantId)
      .not("voucher_line_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (linkedRes.error) throw new ApiError("server_error", `Could not read linked vouchers: ${linkedRes.error}`, 503);
  const linked = new Set(linkedRes.rows.map((r) => String(r.voucher_line_id)));
  // A fill tied to a voucher by voucher_id alone (posted before line ids were
  // kept) still holds that voucher's fuel line.
  const linkedVouchers = new Set(fills.fills.filter((f) => f.voucherId && !f.voided).map((f) => f.voucherId!));
  const imported = new Set(fills.fills.map((f) => f.deskEntryId).filter(Boolean));
  const lines: ReconcileLine[] = book.lines.map((l) => ({
    ...l,
    linked: linked.has(l.lineId) || linkedVouchers.has(l.voucherId),
  }));
  const plan = planFuelReconcile({
    refills: input.deskLogs.map((d) => ({
      id: String(d.id),
      vehicleId: String(d.vehicleId),
      fillDate: istDayOf(String(d.filledAt ?? "")),
      qty: Number(d.qty) || 0,
      amountPaise: Math.round(Number(d.amountPaise) || 0),
      imported: imported.has(String(d.id)),
    })),
    lines,
    vehicles: input.vehicles,
  });
  const live = book.lines.filter((l) => !l.reversed);
  const unlinked = unlinkedFills(fills.fills);
  return {
    ...plan,
    lineOnly: plan.lineOnly.map((l) => {
      const near = tieCandidatesFor(l, unlinked, input.vehicles);
      return {
        ...l,
        tieTo: near.map((f) => f.id),
        refusal: near.length ? "" : createFromLineRefusal(l, unlinked, input.vehicles),
      };
    }),
    deskEntries: input.deskLogs.length,
    liveLines: live.length,
    liveLinePaise: live.reduce((n, l) => n + l.debitPaise, 0),
    importedNotInAccounts: fills.fills.filter((f) => f.entrySource === "desk_import" && !f.voucherId && !f.voided),
  };
}

/**
 * For live Vehicle Fuel lines that have no fill: write the fill from the
 * line itself — vehicle by the plate in the narration, fuel, quantity and
 * rate as the narration states them, the line's own amount — tied to that
 * line ('adopted': the money was keyed in Accounts and is not re-posted).
 * Refuses a line whose narration names no fleet vehicle, or whose rate ×
 * quantity does not give its amount.
 */
export async function createFillsFromVoucherLines(input: {
  lineIds: string[];
  vehicles: { id: string; registrationNo: string; name: string }[];
  actor: string;
}): Promise<{ done: number; failed: { key: string; error: string }[] }> {
  const [book, reg] = await Promise.all([readFuelVoucherLines(), readRegisterFills({})]);
  if (!book.ok) throw new ApiError("server_error", `Could not read the Vehicle Fuel vouchers: ${book.error}`, 503);
  if (!reg.ok) throw new ApiError("server_error", `Could not read the register: ${reg.error}`, 503);
  const { sb, tenantId } = await tenant();
  const failed: { key: string; error: string }[] = [];
  let done = 0;
  const unlinked = unlinkedFills(reg.fills);
  const tiedLines = new Set(reg.fills.filter((f) => f.voucherId && !f.voided).map((f) => f.voucherId!));
  for (const lineId of input.lineIds) {
    const l = book.lines.find((x) => x.lineId === lineId);
    if (!l || l.reversed) {
      failed.push({ key: lineId, error: "not a live Vehicle Fuel line" });
      continue;
    }
    if (tiedLines.has(l.voucherId)) {
      failed.push({ key: lineId, error: `${l.voucherNo} already carries a fill` });
      continue;
    }
    // Never a second fill for fuel the register already holds, never a fill
    // copied from a line whose rate × quantity is not its amount.
    const refusal = createFromLineRefusal(l, unlinked, input.vehicles);
    if (refusal) {
      failed.push({ key: lineId, error: refusal });
      continue;
    }
    const p = parseFuelNarration(l.narration);
    const key = p ? normalizeVehicleKey(p.plate) : "";
    const v = key ? input.vehicles.find((x) => normalizeVehicleKey(x.registrationNo) === key) : undefined;
    if (!p || !v) {
      failed.push({ key: lineId, error: `${l.voucherNo}: the narration does not name a fleet vehicle, fuel, quantity and rate` });
      continue;
    }
    const fuelType = p.fuelType === "cng" || p.fuelType === "petrol" || p.fuelType === "diesel" ? p.fuelType : "";
    const { error } = await sb.from("transport_fuel_fills").insert({
      id: `vl_${lineId.replace(/-/g, "").slice(0, 24)}`,
      tenant_id: tenantId,
      vehicle_id: v.id,
      fill_date: l.voucherDate,
      quantity: p.qty,
      unit: unitForFuel(fuelType),
      fuel_type: fuelType,
      rate_paise: p.ratePaise,
      amount_paise: l.debitPaise,
      payment_mode: "",
      entry_source: "accounts",
      note: `Created from ${l.voucherNo} in the fuel reconcile`,
      created_by_name: input.actor.slice(0, 120),
      voucher_id: l.voucherId,
      voucher_no: l.voucherNo,
      voucher_line_id: l.lineId,
      voucher_origin: "adopted",
      posted_by_name: "Keyed in Accounts",
    });
    if (error) failed.push({ key: lineId, error: error.message });
    else done += 1;
  }
  return { done, failed };
}

function unlinkedFills(fills: RegisterFill[]): UnlinkedFill[] {
  return fills.map((f) => ({
    id: f.id,
    vehicleId: f.vehicleId,
    fillDate: f.fillDate,
    quantity: f.quantity,
    amountPaise: f.amountPaise,
    voided: f.voided,
    linked: !!f.voucherId,
  }));
}

/**
 * Tie a fill already in the register (imported from the old tab, or saved
 * "not in the book yet") to the live Vehicle Fuel line that holds its money.
 * Only a plausible pair (same vehicle, day, and amount) and only to the
 * paisa: a fill whose amount differs from the line is refused — one of them
 * is wrong, and the office voids it and enters it again.
 */
export async function tieFillToVoucherLine(input: {
  fillId: string;
  lineId: string;
  vehicles: { id: string; registrationNo: string }[];
}): Promise<{ ok: true; voucherNo: string } | { ok: false; error: string }> {
  const [book, fill] = await Promise.all([readFuelVoucherLines(), readRegisterFill(input.fillId)]);
  if (!book.ok) return { ok: false, error: book.error };
  if (!fill) return { ok: false, error: "Fuel entry not found" };
  const l = book.lines.find((x) => x.lineId === input.lineId);
  if (!l || l.reversed) return { ok: false, error: "Not a live Vehicle Fuel line" };
  const [cand] = tieCandidatesFor(l, unlinkedFills([fill]), input.vehicles);
  if (!cand) return { ok: false, error: `${fill.id} is not this line's fill (vehicle, day and amount or quantity must match)` };
  if (fill.amountPaise !== l.debitPaise) {
    return { ok: false, error: `${fill.id} is ${fill.amountPaise / 100} but ${l.voucherNo} is ${l.debitPaise / 100} — void the wrong one and enter it again` };
  }
  const { sb, tenantId } = await tenant();
  const { data, error } = await sb
    .from("transport_fuel_fills")
    .update({
      voucher_id: l.voucherId,
      voucher_no: l.voucherNo,
      voucher_line_id: l.lineId,
      voucher_origin: "adopted",
      posted_by_name: "Keyed in Accounts",
    })
    .eq("tenant_id", tenantId)
    .eq("id", fill.id)
    .is("voucher_id", null)
    .is("voided_at", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!(data ?? []).length) return { ok: false, error: "That fill is already in the book or voided — reload" };
  return { ok: true, voucherNo: l.voucherNo };
}
