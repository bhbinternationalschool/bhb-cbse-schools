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
import { ledgerListAccounts, ledgerPost, ledgerReverse } from "@/lib/ledger/ledger.server";
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
} from "@/lib/transportFuelRegister";

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
  "id, vehicle_id, fill_date, quantity, unit, fuel_type, amount_paise, odometer_km, receipt_path, note, dealer_name, bill_no, payment_mode, bank_account_id, payment_ref, entry_source, desk_entry_id, voucher_id, voucher_no, voucher_origin, posted_at, posted_by_name, reversal_voucher_no, created_by_staff_id, created_by_name, created_at, voided_at, voided_by_name, void_reason";

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
    amountPaise: Number(r.amount_paise),
    odometerKm: numOrNull(r.odometer_km),
    receiptPath: String(r.receipt_path ?? ""),
    note: String(r.note ?? ""),
    dealerName: String(r.dealer_name ?? ""),
    billNo: String(r.bill_no ?? ""),
    paymentMode: mode === "cash" || mode === "bank" || mode === "upi" || mode === "on_account" ? mode : "",
    bankAccountId: String(r.bank_account_id ?? ""),
    paymentRef: String(r.payment_ref ?? ""),
    entrySource: src === "web" || src === "desk_import" ? src : "app",
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

  const res = await ledgerPost({ ...built.voucher, createdBy: input.actor });
  if (!res.ok) throw new ApiError("server_error", `The book refused the fuel voucher: ${res.error}`, 422);

  const { sb, tenantId } = await tenant();
  const { data, error } = await sb
    .from("transport_fuel_fills")
    .update({
      voucher_id: res.voucherId,
      voucher_no: res.voucherNo,
      voucher_origin: "posted",
      posted_at: new Date().toISOString(),
      posted_by_name: input.actor.slice(0, 120),
    })
    .eq("tenant_id", tenantId)
    .eq("id", fill.id)
    .is("voucher_id", null)
    .select(REGISTER_COLS);
  if (error) {
    // The voucher stands (it is real money and idempotent); the next Post
    // press lands on the same voucher and stamps the row.
    throw new ApiError(
      "server_error",
      `Posted ${res.voucherNo}, but the fill could not be marked: ${error.message}. Press Post again — it will not post twice.`,
      502,
    );
  }
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (row) return rowToFill(row);
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
  let reversalNo = "";
  let warning = "";
  if (fill.voucherId && fill.voucherOrigin === "posted") {
    const rev = await ledgerReverse({
      voucherId: fill.voucherId,
      reason: `Fuel entry voided in Transport — ${input.reason}`.slice(0, 300),
      createdBy: input.actor,
    });
    if (!rev.ok) throw new ApiError("server_error", `Could not reverse ${fill.voucherNo}: ${rev.error}. Nothing was voided.`, 422);
    reversalNo = rev.voucherNo;
  } else if (fill.voucherId && fill.voucherOrigin === "adopted") {
    warning = `${fill.voucherNo} was keyed in Accounts and is NOT reversed by this — correct it in Accounts.`;
  }
  const { sb, tenantId } = await tenant();
  const { data, error } = await sb
    .from("transport_fuel_fills")
    .update({
      voided_at: new Date().toISOString(),
      voided_by_name: input.actor.slice(0, 120),
      void_reason: input.reason.slice(0, 300),
      ...(reversalNo ? { reversal_voucher_no: reversalNo } : {}),
    })
    .eq("tenant_id", tenantId)
    .eq("id", fill.id)
    .is("voided_at", null)
    .select(REGISTER_COLS);
  if (error) {
    throw new ApiError(
      "server_error",
      reversalNo
        ? `Reversed ${fill.voucherNo} as ${reversalNo}, but the fill could not be marked void: ${error.message}. Void again — it will not reverse twice.`
        : `Could not void the fill: ${error.message}`,
      502,
    );
  }
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) throw new ApiError("conflict", "This entry was already voided.", 409);
  return { fill: rowToFill(row), warning };
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
  vehicles: { id: string; name: string; registrationNo: string; chassisNo?: string; fuelType?: string }[];
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
  vehicles: { id: string; registrationNo: string; chassisNo?: string }[],
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
