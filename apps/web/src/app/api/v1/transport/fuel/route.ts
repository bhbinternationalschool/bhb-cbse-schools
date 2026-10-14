import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth, requestMeta, type ApiAuthContext } from "@/lib/api/v1/auth";
import { writeAudit } from "@/lib/audit.server";
import { sanitizeStoredMediaUrl } from "@/lib/media";
import { functionWriteAllowed } from "@/lib/moneyFunctionScope";
import { hasPermission } from "@/lib/rbac";
import { LEDGER_FUNCTION_WRITES } from "@/lib/rbacFeatureCatalog/money";
import { vehicleFuelOptions } from "@/lib/transport";
import {
  dayParam,
  loadTransportDesk,
  mayUseVehicle,
  readDayLogs,
  registerAccess,
} from "@/lib/transportBoardingLog.server";
import { dayKm, isMonth, istDate, monthDates, parseKm, rupeesToPaise } from "@/lib/transportBoardingLog";
import {
  accountsStatus,
  buildFuelVoucher,
  busMonthTotals,
  isPaymentMode,
  kmBetweenFills,
  rateWarning,
  unitForFuel,
  vehicleLabel,
  type FuelKind,
} from "@/lib/transportFuelRegister";
import {
  addOfficeFill,
  amendFillDetails,
  fuelBankChoices,
  createFillsFromVoucherLines,
  tieFillToVoucherLine,
  fuelReconcileReport,
  importDeskFuelLogs,
  lastOdometerByVehicle,
  postAccountsFuel,
  postFillToAccounts,
  readFleetEdgeMonth,
  readRegisterFill,
  readRegisterFills,
  readUnpostedFills,
  setFillPayment,
  voidFillWithVoucher,
  type RegisterFill,
} from "@/lib/transportFuelRegister.server";
import type { TransportDeskBundle } from "@/lib/transportNormalized.server";
import { fuelAmountPaise } from "@/lib/fuelExpenseLine";

export const runtime = "nodejs";

/* ─── permissions ──────────────────────────────────────────── */

function canEditTransport(ctx: ApiAuthContext): boolean {
  return hasPermission(ctx.session, ctx.masters, "transport", "edit", ctx.rbac);
}

/**
 * Posting a fuel voucher is entering an expense, so it needs exactly what the
 * Accounts expense forms need: the ledger route's "post" write (accounts.edit,
 * or the Voucher entry function).
 */
function canPostAccounts(ctx: ApiAuthContext): boolean {
  return functionWriteAllowed(ctx, "accounts", "edit", LEDGER_FUNCTION_WRITES, "post");
}

/** Reversing a posted voucher is a decision about the book — accounts.approve, as on /api/ledger. */
function canReverseAccounts(ctx: ApiAuthContext): boolean {
  return hasPermission(ctx.session, ctx.masters, "accounts", "approve", ctx.rbac);
}

/** Reading the book's vouchers — Accounts view, or the expense-entry right. */
function canViewAccounts(ctx: ApiAuthContext): boolean {
  return hasPermission(ctx.session, ctx.masters, "accounts", "view", ctx.rbac) || canPostAccounts(ctx);
}

function assertTransportEdit(ctx: ApiAuthContext) {
  if (!canEditTransport(ctx)) throw new ApiError("forbidden", "Missing permission transport.edit", 403);
}

function assertAccountsPost(ctx: ApiAuthContext) {
  if (!canPostAccounts(ctx)) {
    throw new ApiError("forbidden", "Posting to accounts needs the Accounts expense-entry permission (accounts.edit or Voucher entry).", 403);
  }
}

function actorOf(ctx: ApiAuthContext): string {
  return ctx.session.fullName || ctx.session.email || ctx.session.roleCode || "office";
}

/* ─── shaping ──────────────────────────────────────────────── */

function vehicleFor(transport: TransportDeskBundle, id: string) {
  return transport.vehicles.find((v) => v.id === id);
}

function shapeFill(f: RegisterFill, transport: TransportDeskBundle, kmSince: Map<string, number>) {
  const v = vehicleFor(transport, f.vehicleId);
  return {
    ...f,
    vehicle: vehicleLabel(v ? { name: v.name, registrationNo: v.registrationNo } : null),
    kmSincePrevious: kmSince.get(f.id) ?? null,
    rateWarning: rateWarning(f.quantity, f.amountPaise, f.unit),
    status: accountsStatus(f),
  };
}

/**
 * GET /api/v1/transport/fuel?month=YYYY-MM&vehicleId=
 *
 * The fuel register for a month: every fill (IST dates, quantity with its
 * unit, ₹, odometer, dealer, payment, bill photo, who entered it, accounts
 * status), totals per bus with km only where a reading supports it, and
 * Fleet Edge distance / fuel used per bus beside them. Also the office's
 * queue — every fill, any month, not yet in accounts — and whether the old
 * desk fuel log still has entries to import.
 *
 * Crew see only their own bus and no queue.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const url = new URL(request.url);
    const today = istDate();

    // ?form=1 — what an entry form needs (Accounts → Quick / Multi-line keys
    // fuel too): the fleet with its fuels, the banks, each bus's last
    // odometer. Open to the Accounts expense-entry right as well as Transport.
    if (url.searchParams.get("form") === "1") {
      if (!canPostAccounts(ctx) && !hasPermission(ctx.session, ctx.masters, "transport", "view", ctx.rbac)) {
        throw new ApiError("forbidden", "Fuel entry needs Transport or the Accounts expense-entry permission", 403);
      }
      const desk = await loadTransportDesk();
      const [banks, lastOdometer] = await Promise.all([fuelBankChoices(), lastOdometerByVehicle()]);
      return apiOk({
        today,
        canPost: canPostAccounts(ctx),
        canEdit: canEditTransport(ctx),
        vehicles: desk.vehicles.map((v) => ({
          id: v.id,
          registrationNo: v.registrationNo,
          name: v.name,
          ...vehicleLabel({ name: v.name, registrationNo: v.registrationNo }),
          fuels: vehicleFuelOptions(v).map((o) => ({ fuelType: o.fuelType, unit: unitForFuel(o.fuelType) })),
          isActive: v.isActive !== false && v.status !== "sold",
        })),
        banks,
        lastOdometer,
      });
    }

    const month = (url.searchParams.get("month") || today.slice(0, 7)).trim();
    if (!isMonth(month)) throw new ApiError("bad_request", "month must be YYYY-MM", 400);
    const vehicleFilter = (url.searchParams.get("vehicleId") || "").trim();
    const dates = monthDates(month);
    // ?from&to — the fill list for any date range (Transport → Fuel table);
    // the per-bus totals and Fleet Edge stay the month's.
    const rangeFrom = (url.searchParams.get("from") || "").trim();
    const rangeTo = (url.searchParams.get("to") || "").trim();
    const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
    if ((rangeFrom && !isDay(rangeFrom)) || (rangeTo && !isDay(rangeTo))) {
      throw new ApiError("bad_request", "from / to must be YYYY-MM-DD", 400);
    }
    const listFrom = rangeFrom || dates[0]!;
    const listTo = rangeTo || dates[dates.length - 1]!;
    const from = dates[0]!;
    const to = dates[dates.length - 1]!;
    const readTo = listTo > to ? listTo : to;

    const transport = await loadTransportDesk();
    const access = registerAccess(ctx, transport, to < today ? to : today);
    const vehicles = transport.vehicles.filter(
      (v) => mayUseVehicle(access, v.id) && (!vehicleFilter || v.id === vehicleFilter),
    );
    const ids = new Set(vehicles.map((v) => v.id));

    const [allRes, logsRes, fleetEdge, queueRes, banks] = await Promise.all([
      // Everything up to the later end: the previous fill is needed for km.
      readRegisterFills({ to: readTo }),
      readDayLogs({ from, to }),
      readFleetEdgeMonth(
        month,
        vehicles.map((v) => ({ id: v.id, registrationNo: v.registrationNo })),
      ),
      access.fleetWide ? readUnpostedFills() : Promise.resolve({ ok: true as const, fills: [] as RegisterFill[] }),
      access.fleetWide ? fuelBankChoices() : Promise.resolve([]),
    ]);
    if (!allRes.ok) throw new ApiError("server_error", `Could not read fuel entries: ${allRes.error}`, 503);
    if (!logsRes.ok) throw new ApiError("server_error", `Could not read the log book: ${logsRes.error}`, 503);
    if (!queueRes.ok) throw new ApiError("server_error", `Could not read the office queue: ${queueRes.error}`, 503);

    const allFills = allRes.fills.filter((f) => ids.has(f.vehicleId));
    const kmSince = kmBetweenFills(allFills);
    const monthFills = allFills
      .filter((f) => f.fillDate >= listFrom && f.fillDate <= listTo)
      .sort((a, b) => b.fillDate.localeCompare(a.fillDate) || b.createdAt.localeCompare(a.createdAt));

    const dayLogKm = new Map<string, { km: number; days: number }>();
    for (const l of logsRes.logs) {
      if (!ids.has(l.vehicleId)) continue;
      const d = dayKm(l);
      if (!d.ok) continue;
      const cur = dayLogKm.get(l.vehicleId) ?? { km: 0, days: 0 };
      cur.km += d.km;
      cur.days += 1;
      dayLogKm.set(l.vehicleId, cur);
    }

    const totals = busMonthTotals({
      month,
      vehicleIds: vehicles.map((v) => v.id),
      fills: allFills.filter((f) => f.fillDate <= to),
      dayLogKm,
      fleetEdge: fleetEdge.ok ? new Map([...fleetEdge.byVehicle].map(([k, x]) => [k, { km: x.km, fuelUsed: x.fuelUsed }])) : new Map(),
    }).map((t) => {
      const v = vehicleFor(transport, t.vehicleId);
      return { ...t, vehicle: vehicleLabel(v ? { name: v.name, registrationNo: v.registrationNo } : null) };
    });

    const deskLogs = transport.fuelRefillLogs ?? [];
    const importedIds = new Set(allRes.fills.map((f) => f.deskEntryId).filter(Boolean));
    // The queue spans all months, so it needs every fill's km context; only the
    // label and status matter there.
    const queue = queueRes.fills
      .filter((f) => ids.has(f.vehicleId) || !vehicleFilter)
      .sort((a, b) => a.fillDate.localeCompare(b.fillDate))
      .map((f) => shapeFill(f, transport, kmSince));

    return apiOk({
      month,
      from: listFrom,
      to: listTo,
      today,
      fleetWide: access.fleetWide,
      canViewVouchers: canViewAccounts(ctx),
      canEdit: canEditTransport(ctx),
      canPost: canPostAccounts(ctx),
      canReverse: canReverseAccounts(ctx),
      vehicles: vehicles.map((v) => ({
        id: v.id,
        ...vehicleLabel({ name: v.name, registrationNo: v.registrationNo }),
        fuels: vehicleFuelOptions(v).map((o) => ({ fuelType: o.fuelType, unit: unitForFuel(o.fuelType) })),
        isActive: v.isActive !== false,
      })),
      fills: monthFills.map((f) => shapeFill(f, transport, kmSince)),
      totals,
      fleetEdge: fleetEdge.ok ? { ok: true } : { ok: false, error: fleetEdge.error },
      queue,
      banks,
      deskImport: {
        deskEntries: deskLogs.length,
        notYetImported: deskLogs.filter((l) => !importedIds.has(String(l.id))).length,
      },
    });
  } catch (e) {
    return apiErr(e);
  }
}

/* ─── writes ───────────────────────────────────────────────── */

type Body = Record<string, unknown>;

function idOf(raw: unknown): string {
  const id = String(raw ?? "").trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new ApiError("bad_request", "A valid entry id is required", 400);
  return id;
}

function paymentOf(body: Body, banks: { bankAccountId: string }[]) {
  const mode = body.paymentMode;
  if (!isPaymentMode(mode)) throw new ApiError("bad_request", "Choose how it was paid: cash, bank, UPI or on account", 400);
  const bankAccountId = String(body.bankAccountId ?? "").trim();
  if ((mode === "bank" || mode === "upi") && !banks.some((b) => b.bankAccountId === bankAccountId)) {
    throw new ApiError("bad_request", "Choose which bank account paid", 400);
  }
  return { paymentMode: mode, bankAccountId, paymentRef: String(body.paymentRef ?? "").trim() };
}

async function audit(request: Request, ctx: ApiAuthContext, action: string, entityId: string, summary: string, after?: unknown) {
  const meta = requestMeta(request);
  const res = await writeAudit({
    session: ctx.session,
    module: "transport",
    action,
    entityType: "transport_fuel_fill",
    entityId,
    summary,
    after,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return res.ok ? "" : "The change is saved, but the audit log did not record it.";
}

/**
 * POST /api/v1/transport/fuel — the office's actions on the register.
 *
 *   { action: "add", id, vehicleId, date, fuelType, quantity, amountRupees,
 *     odometerKm?, dealerName?, billNo?, receiptUrl?, note?,
 *     paymentMode?, bankAccountId?, paymentRef? }
 *        Saves the fill; with a payment mode (and accounts permission) also
 *        posts its Vehicle Fuel voucher.
 *   { action: "post", id, paymentMode, bankAccountId?, paymentRef?, dealerName? }
 *        Sets how an unposted fill was paid and posts it.
 *   { action: "post-many", ids[], paymentMode, bankAccountId?, paymentRef? }
 *        The same for several fills (bulk "Post to accounts").
 *   { action: "amend", id, quantity, odometerKm?, dealerName?, billNo?, note? }
 *        Corrects non-money facts. Amount, date and vehicle never change here.
 *   { action: "void", id, reason }
 *        Voids; a voucher this register posted is reversed (accounts.approve).
 *   { action: "import-desk" }
 *        One-time, idempotent copy of the old desk fuel log.
 *
 * Every write needs transport.edit; posting adds the Accounts expense-entry
 * permission. Every write leaves an audit entry.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    let body: Body;
    try {
      body = (await request.json()) as Body;
    } catch {
      throw new ApiError("bad_request", "Invalid JSON", 400);
    }
    // Accounts keys fuel through "add-accounts" with its own right; every
    // other action is the register's and needs transport.edit.
    if (body.action !== "add-accounts") assertTransportEdit(ctx);
    const actor = actorOf(ctx);
    const today = istDate();
    const transport = await loadTransportDesk();
    const vehicleOf = (id: string) => {
      const v = vehicleFor(transport, id);
      if (!v) throw new ApiError("not_found", "Vehicle not found", 404);
      return { name: v.name, registrationNo: v.registrationNo };
    };
    const kmNone = new Map<string, number>();

    switch (body.action) {
      case "add": {
        const id = idOf(body.id);
        const date = dayParam(body.date, today);
        const vehicleId = String(body.vehicleId ?? "").trim();
        const v = vehicleFor(transport, vehicleId);
        if (!v) throw new ApiError("not_found", "Vehicle not found", 404);
        const options = vehicleFuelOptions(v);
        const fuelRaw = String(body.fuelType ?? options[0]?.fuelType ?? "").toLowerCase();
        if (!options.some((o) => o.fuelType === fuelRaw)) {
          throw new ApiError("bad_request", `This vehicle runs on ${options.map((o) => o.fuelType).join(" or ")}`, 400);
        }
        const fuelType = (fuelRaw === "cng" || fuelRaw === "petrol" || fuelRaw === "diesel" ? fuelRaw : "") as FuelKind;
        const quantity = Number(String(body.quantity ?? "").trim());
        if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 2000) {
          throw new ApiError("bad_request", "Enter the quantity filled", 400);
        }
        // Rate × quantity when the rate is given (the amount is then derived,
        // to the paisa, the same way Accounts and the SQL check derive it);
        // a typed amount only when no rate was entered.
        const ratePaise = body.ratePaise == null || body.ratePaise === "" ? null : Math.round(Number(body.ratePaise));
        if (ratePaise != null && (!Number.isFinite(ratePaise) || ratePaise <= 0)) {
          throw new ApiError("bad_request", "Enter the rate per kg / litre", 400);
        }
        const amountPaise =
          ratePaise != null ? fuelAmountPaise(ratePaise, Math.round(quantity * 100) / 100) : rupeesToPaise(body.amountRupees);
        if (amountPaise == null || amountPaise <= 0) throw new ApiError("bad_request", "Enter the amount paid in ₹", 400);
        const odo = parseKm(body.odometerKm);
        if (odo === "invalid") throw new ApiError("bad_request", "Odometer must be a number of km (or blank)", 400);
        const receiptUrl = sanitizeStoredMediaUrl(String(body.receiptUrl ?? ""), "fuel-receipt");
        if (receiptUrl && !receiptUrl.startsWith("/api/file/")) {
          throw new ApiError("bad_request", "Upload the bill photo first", 400);
        }
        const wantsPost = body.paymentMode != null && body.paymentMode !== "";
        const banks = wantsPost ? await fuelBankChoices() : [];
        const pay = wantsPost ? paymentOf(body, banks) : { paymentMode: "" as const, bankAccountId: "", paymentRef: "" };

        let fill = await addOfficeFill({
          id,
          vehicleId,
          fillDate: date,
          quantity: Math.round(quantity * 100) / 100,
          unit: unitForFuel(fuelType),
          fuelType,
          ratePaise,
          amountPaise,
          odometerKm: odo,
          receiptPath: receiptUrl,
          note: String(body.note ?? ""),
          dealerName: String(body.dealerName ?? "").trim(),
          billNo: String(body.billNo ?? "").trim(),
          ...pay,
          staffId: (ctx.session.staffId || "").trim(),
          name: actor,
        });
        let notice = "";
        if (wantsPost && !fill.voucherId) {
          if (canPostAccounts(ctx)) {
            try {
              fill = await postFillToAccounts({ fill, vehicle: vehicleOf(vehicleId), actor });
            } catch (e) {
              notice = `Saved, but not posted to accounts: ${e instanceof Error ? e.message : "the book refused it"}`;
            }
          } else {
            notice = "Saved. Not posted — posting needs the Accounts expense-entry permission.";
          }
        }
        const auditWarn = await audit(request, ctx, "fuel_add", fill.id, `Fuel ${fill.quantity} ${fill.unit} ₹${fill.amountPaise / 100} for ${vehicleOf(vehicleId).name}${fill.voucherNo ? ` → ${fill.voucherNo}` : ""}`, fill);
        return apiOk({ fill: shapeFill(fill, transport, kmNone), notice: [notice, auditWarn].filter(Boolean).join(" ") });
      }

      case "post":
      case "post-many": {
        assertAccountsPost(ctx);
        const ids = body.action === "post" ? [idOf(body.id)] : Array.isArray(body.ids) ? body.ids.map(idOf) : [];
        if (ids.length === 0) throw new ApiError("bad_request", "Choose the fills to post", 400);
        if (ids.length > 200) throw new ApiError("bad_request", "Post at most 200 at a time", 400);
        const banks = await fuelBankChoices();
        const pay = paymentOf(body, banks);
        const dealerName = typeof body.dealerName === "string" ? body.dealerName : undefined;
        const posted: ReturnType<typeof shapeFill>[] = [];
        const failed: { id: string; error: string }[] = [];
        for (const id of ids) {
          try {
            let fill = await readRegisterFill(id);
            if (!fill) throw new ApiError("not_found", "Fuel entry not found", 404);
            if (fill.voided) throw new ApiError("conflict", "Voided", 409);
            if (!fill.voucherId) {
              fill = await setFillPayment({ id, ...pay, dealerName });
              fill = await postFillToAccounts({ fill, vehicle: vehicleOf(fill.vehicleId), actor });
              await audit(request, ctx, "fuel_post", id, `Fuel fill posted to accounts as ${fill.voucherNo} (${pay.paymentMode})`, {
                voucherNo: fill.voucherNo,
                paymentMode: pay.paymentMode,
              });
            }
            posted.push(shapeFill(fill, transport, kmNone));
          } catch (e) {
            failed.push({ id, error: e instanceof Error ? e.message : "could not post" });
          }
        }
        if (body.action === "post" && failed.length) {
          throw new ApiError("server_error", failed[0]!.error, 422);
        }
        return apiOk({ posted, failed });
      }

      case "amend": {
        const id = idOf(body.id);
        const before = await readRegisterFill(id);
        if (!before) throw new ApiError("not_found", "Fuel entry not found", 404);
        const quantity = Number(String(body.quantity ?? "").trim());
        if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 2000) {
          throw new ApiError("bad_request", "Enter the quantity filled", 400);
        }
        const odo = parseKm(body.odometerKm);
        if (odo === "invalid") throw new ApiError("bad_request", "Odometer must be a number of km (or blank)", 400);
        const fill = await amendFillDetails({
          id,
          quantity: Math.round(quantity * 100) / 100,
          odometerKm: odo,
          dealerName: String(body.dealerName ?? before.dealerName),
          billNo: String(body.billNo ?? before.billNo),
          note: String(body.note ?? before.note),
          name: actor,
        });
        const auditWarn = await audit(request, ctx, "fuel_amend", id, `Fuel fill corrected (qty ${before.quantity} → ${fill.quantity}, odometer ${before.odometerKm ?? "—"} → ${fill.odometerKm ?? "—"})`, {
          before: { quantity: before.quantity, odometerKm: before.odometerKm, dealerName: before.dealerName, billNo: before.billNo },
          after: { quantity: fill.quantity, odometerKm: fill.odometerKm, dealerName: fill.dealerName, billNo: fill.billNo },
        });
        return apiOk({ fill: shapeFill(fill, transport, kmNone), notice: auditWarn });
      }

      case "void": {
        const id = idOf(body.id);
        const reason = String(body.reason ?? "").trim();
        if (!reason) throw new ApiError("bad_request", "Say why this entry is wrong", 400);
        const fill = await readRegisterFill(id);
        if (!fill) throw new ApiError("not_found", "Fuel entry not found", 404);
        if (fill.voucherId && !fill.reversalVoucherNo && !canReverseAccounts(ctx)) {
          throw new ApiError("forbidden", `This fill is in accounts as ${fill.voucherNo}; voiding reverses it, which needs accounts.approve.`, 403);
        }
        const out = await voidFillWithVoucher({ fill, reason, actor });
        const auditWarn = await audit(request, ctx, "fuel_void", id, `Fuel fill voided — ${reason}${out.fill.reversalVoucherNo ? ` (reversed ${fill.voucherNo} as ${out.fill.reversalVoucherNo})` : ""}`, out.fill);
        return apiOk({ fill: shapeFill(out.fill, transport, kmNone), notice: [out.warning, auditWarn].filter(Boolean).join(" ") });
      }

      case "import-desk": {
        const logs = transport.fuelRefillLogs ?? [];
        const result = await importDeskFuelLogs({
          logs: logs.map((l) => ({
            id: l.id,
            vehicleId: l.vehicleId,
            filledAt: l.filledAt,
            odometerKm: l.odometerKm,
            qty: l.qty,
            amountPaise: l.amountPaise,
            dealerId: l.dealerId,
            billNo: l.billNo,
            filledBy: l.filledBy,
            paymentStatus: l.paymentStatus,
          })),
          vehicles: transport.vehicles.map((v) => ({ id: v.id, name: v.name, registrationNo: v.registrationNo, fuelType: v.fuelType })),
          dealers: transport.dealers.map((d) => ({ id: d.id, name: d.name })),
        });
        const auditWarn = await audit(
          request,
          ctx,
          "fuel_import_desk",
          "desk_fuel_refill_logs",
          `Imported ${result.imported} old fuel entries (${result.linkedToAccounts} already in accounts, ${result.notInAccounts} not in accounts, ${result.alreadyImported} imported before, ${result.skipped.length} skipped)`,
          result,
        );
        return apiOk({ result, notice: auditWarn });
      }

      case "reconcile-report": {
        // Read-only: what the import would tie, what has no live voucher,
        // and which live fuel lines have no fill. Writes nothing — but it
        // shows voucher numbers and the book's fuel money, so it needs the
        // Accounts read right as well as Transport.
        if (!canViewAccounts(ctx)) throw new ApiError("forbidden", "The fuel reconcile shows the book — it needs Accounts (view)", 403);
        const report = await fuelReconcileReport({
          deskLogs: (transport.fuelRefillLogs ?? []).map((l) => ({
            id: l.id,
            vehicleId: l.vehicleId,
            filledAt: l.filledAt,
            qty: l.qty,
            amountPaise: l.amountPaise,
          })),
          vehicles: transport.vehicles.map((v) => ({ id: v.id, registrationNo: v.registrationNo })),
        });
        return apiOk({
          report: {
            ...report,
            importedNotInAccounts: report.importedNotInAccounts.map((f) => shapeFill(f, transport, kmNone)),
          },
        });
      }

      case "reconcile-create": {
        // Writing fills against money already in the book is a decision about
        // the book — the director confirms it (accounts.approve).
        if (!canReverseAccounts(ctx)) throw new ApiError("forbidden", "Creating fills from vouchers needs accounts.approve", 403);
        const lineIds = Array.isArray(body.lineIds) ? body.lineIds.map((x) => String(x)).filter(Boolean).slice(0, 500) : [];
        if (!lineIds.length) throw new ApiError("bad_request", "Choose the voucher lines", 400);
        const out = await createFillsFromVoucherLines({
          lineIds,
          vehicles: transport.vehicles.map((v) => ({ id: v.id, registrationNo: v.registrationNo, name: v.name })),
          actor,
        });
        const auditWarn = await audit(request, ctx, "fuel_reconcile_create", "fuel_reconcile", `Fuel reconcile: ${out.done} fill(s) created from vouchers already in the book (${out.failed.length} refused)`, out);
        return apiOk({ ...out, notice: auditWarn });
      }

      case "reconcile-tie": {
        // A fill already in the register belongs to a live fuel line: tie it.
        if (!canReverseAccounts(ctx)) throw new ApiError("forbidden", "Tying fills to vouchers needs accounts.approve", 403);
        const out = await tieFillToVoucherLine({
          fillId: idOf(body.fillId),
          lineId: String(body.lineId ?? ""),
          vehicles: transport.vehicles.map((v) => ({ id: v.id, registrationNo: v.registrationNo })),
        });
        if (!out.ok) throw new ApiError("conflict", out.error, 409);
        const auditWarn = await audit(request, ctx, "fuel_reconcile_tie", String(body.fillId), `Fuel reconcile: fill tied to ${out.voucherNo}`, out);
        return apiOk({ done: 1, failed: [], notice: auditWarn });
      }

      case "reconcile-void": {
        // Old-tab entries no voucher holds: kept, struck through — never deleted.
        const ids = Array.isArray(body.ids) ? body.ids.map(idOf) : [];
        if (!ids.length) throw new ApiError("bad_request", "Choose the fills", 400);
        const reason = String(body.reason ?? "").trim() || "No live voucher in the book (cleared in the 13 Oct 2026 clean-up) — confirmed in the fuel reconcile";
        let done = 0;
        const failed: { key: string; error: string }[] = [];
        for (const id of ids) {
          try {
            const fill = await readRegisterFill(id);
            if (!fill) throw new ApiError("not_found", "not found", 404);
            if (fill.voucherId) throw new ApiError("conflict", `in the book as ${fill.voucherNo}`, 409);
            await voidFillWithVoucher({ fill, reason, actor });
            done += 1;
          } catch (e) {
            failed.push({ key: id, error: e instanceof Error ? e.message : "could not void" });
          }
        }
        const auditWarn = await audit(request, ctx, "fuel_reconcile_void", "fuel_reconcile", `Fuel reconcile: ${done} old entr(ies) with no voucher voided`, { done, failed });
        return apiOk({ done, failed, notice: auditWarn });
      }

      case "add-accounts": {
        // Accounts → Quick expense with a fuel head: one fill, one voucher,
        // one transaction. Needs only what the Accounts expense forms need.
        assertAccountsPost(ctx);
        const id = idOf(body.id);
        const date = dayParam(body.date, today);
        const vehicleId = String(body.vehicleId ?? "").trim();
        const v = vehicleFor(transport, vehicleId);
        if (!v) throw new ApiError("not_found", "Vehicle not found", 404);
        const fuelRaw = String(body.fuelType ?? "").toLowerCase();
        const fuelType = (fuelRaw === "cng" || fuelRaw === "petrol" || fuelRaw === "diesel" ? fuelRaw : "") as FuelKind;
        const quantity = Math.round(Number(String(body.quantity ?? "").trim()) * 100) / 100;
        const ratePaise = Math.round(Number(body.ratePaise));
        const odo = parseKm(body.odometerKm);
        if (odo === "invalid") throw new ApiError("bad_request", "Odometer must be a number of km (or blank)", 400);
        const banks = await fuelBankChoices();
        const pay = paymentOf(body, banks);
        const dealerName = String(body.dealerName ?? "").trim();
        const billNo = String(body.billNo ?? "").trim();
        const amountPaise = fuelAmountPaise(ratePaise, quantity);
        const bank = banks.find((b) => b.bankAccountId === pay.bankAccountId);
        const built = buildFuelVoucher({
          fillId: id,
          fillDate: date,
          vehicle: { name: v.name, registrationNo: v.registrationNo },
          fuelType,
          quantity,
          unit: unitForFuel(fuelType),
          amountPaise,
          odometerKm: odo,
          dealerName,
          billNo,
          payment:
            pay.paymentMode === "bank" || pay.paymentMode === "upi"
              ? { mode: pay.paymentMode, bankAccountCode: bank?.code ?? "", bankAccountId: pay.bankAccountId, ref: pay.paymentRef }
              : { mode: pay.paymentMode },
        });
        if (!built.ok) throw new ApiError("bad_request", built.error, 400);
        const res = await postAccountsFuel({
          voucher: { ...built.voucher, narration: built.voucher.narration.replace("(Transport fuel register)", "(keyed in Accounts)"), createdBy: actor },
          fills: [
            {
              id,
              lineNo: 1,
              vehicleId,
              fillDate: date,
              fuelType,
              quantity,
              ratePaise,
              odometerKm: odo,
              dealerName,
              billNo,
              ...pay,
              note: String(body.note ?? ""),
            },
          ],
          vehicles: transport.vehicles.map((x) => ({ id: x.id, fuels: vehicleFuelOptions(x) })),
          actor,
          staffId: (ctx.session.staffId || "").trim(),
        });
        if (!res.ok) throw new ApiError("bad_request", res.error, 422);
        const fill = await readRegisterFill(id);
        if (!fill) throw new ApiError("not_found", "Fuel entry not found", 404);
        const auditWarn = await audit(request, ctx, "fuel_add_accounts", id, `Fuel ${fill.quantity} ${fill.unit} ₹${fill.amountPaise / 100} for ${v.name} keyed in Accounts → ${fill.voucherNo}`, fill);
        return apiOk({ fill: shapeFill(fill, transport, kmNone), notice: auditWarn });
      }

      default:
        throw new ApiError("bad_request", "action must be add, add-accounts, post, post-many, amend, void, import-desk or reconcile-report / -create / -void", 400);
    }
  } catch (e) {
    return apiErr(e);
  }
}
