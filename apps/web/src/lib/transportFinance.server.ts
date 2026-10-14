import "server-only";

/**
 * Transport → Finance on the server: vehicle loans read from Ledger v2, the
 * loan ↔ vehicle links, and the vehicle documents store. Pure rules live in
 * lib/transportFinance.ts; this file only reads and writes.
 *
 * Both stores are module_local_state rows that NO browser route writes (they
 * are deliberately not in moduleStateRegistry): only
 * /api/transport/vehicle-loans and /api/transport/vehicle-docs touch them,
 * one change at a time, by compare-and-set on updated_at — a stale screen
 * can never put back an old copy of the whole list.
 *
 * Every read returns null on failure: unknown, never "none".
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { L_CASH } from "@/lib/ledger/coa";
import {
  DEFAULT_EMI_DUE_DAY,
  TRANSPORT_LOAN_LINKS_KEY,
  TRANSPORT_VEHICLE_DOCS_KEY,
  VEHICLE_DOC_FEE_SOURCE,
  VEHICLE_DOC_LABELS,
  isInterestAccount,
  isIsoDate,
  isVehicleLoanAccount,
  istToday,
  normalizeLoanLinks,
  normalizeVehicleDocs,
  pickVehicleDocExpenseAccount,
  summarizeLoan,
  validateVehicleDocInput,
  vehicleDocFeeLines,
  type LoanLink,
  type LoanLinksState,
  type LoanSummary,
  type LoanVoucherRow,
  type VehicleDoc,
  type VehicleDocsState,
} from "@/lib/transportFinance";

type Fail = { ok: false; error: string; status?: number; conflict?: boolean };

/* ─── module_local_state, one row, compare-and-set ─────────── */

async function readRow(key: string): Promise<{ state: unknown; updatedAt: string } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("module_local_state")
    .select("state, updated_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("module_key", key)
    .maybeSingle();
  if (error) {
    console.warn(`[transport-finance] ${key} read failed`, error.message);
    return null;
  }
  return { state: data?.state ?? null, updatedAt: data?.updated_at ? String(data.updated_at) : "" };
}

/**
 * Apply `change` to the freshest copy and write it only if nobody wrote in
 * between; on a lost race, re-read and re-apply (the change is per item, so
 * re-applying it is the right merge). `change` returns an error to refuse.
 */
async function casUpdate<S extends object>(
  key: string,
  normalize: (raw: unknown) => S,
  change: (current: S) => { ok: true; next: S } | Fail,
): Promise<{ ok: true; state: S; updatedAt: string } | Fail> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable", status: 503 };
  for (let attempt = 0; attempt < 6; attempt++) {
    const row = await readRow(key);
    if (!row) return { ok: false, error: "Could not read the saved copy — nothing was changed", status: 502 };
    const applied = change(normalize(row.state));
    if (!applied.ok) return applied;
    const now = new Date().toISOString();
    if (row.updatedAt) {
      const { data, error } = await ctx.sb
        .from("module_local_state")
        .update({ state: applied.next, updated_at: now })
        .eq("tenant_id", ctx.tenantId)
        .eq("module_key", key)
        .eq("updated_at", row.updatedAt)
        .select("updated_at");
      if (error) return { ok: false, error: error.message, status: 502 };
      if (data?.length) return { ok: true, state: applied.next, updatedAt: now };
    } else {
      const { error } = await ctx.sb
        .from("module_local_state")
        .insert({ tenant_id: ctx.tenantId, module_key: key, state: applied.next, updated_at: now });
      if (!error) return { ok: true, state: applied.next, updatedAt: now };
      if (!/duplicate|unique/i.test(error.message)) return { ok: false, error: error.message, status: 502 };
    }
    await new Promise((r) => setTimeout(r, 120 * (attempt + 1)));
  }
  return { ok: false, error: "Others kept saving at the same moment — try again", status: 409, conflict: true };
}

/* ─── The fleet, from the server desk ─────────────────────── */

export type FleetVehicleRef = { id: string; label: string; registrationNo: string; name: string; isActive: boolean };

/** The vehicles slice only. null = could not read it. */
export async function readFleetVehicles(): Promise<FleetVehicleRef[] | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("transport_desk_slices")
    .select("payload")
    .eq("tenant_id", ctx.tenantId)
    .eq("slice_key", "vehicles")
    .maybeSingle();
  if (error) {
    console.warn("[transport-finance] vehicles read failed", error.message);
    return null;
  }
  const list = Array.isArray(data?.payload) ? (data.payload as Record<string, unknown>[]) : [];
  return list
    .filter((v) => v && typeof v.id === "string" && v._deleted !== true)
    .map((v) => {
      const reg = String(v.registrationNo ?? "").trim();
      const name = String(v.name ?? "").trim();
      return {
        id: String(v.id),
        registrationNo: reg,
        name,
        label: [name, reg].filter(Boolean).join(" · ") || String(v.id),
        isActive: v.isActive !== false && v.status !== "retired" && v.status !== "sold",
      };
    });
}

/* ─── Vehicle loans, from the books ───────────────────────── */

export type VehicleLoanView = {
  code: string;
  name: string;
  link: LoanLink | null;
  vehicleLabel: string;
  summary: LoanSummary;
};

type AccountRow = { id: string; code: string; name: string; kind: string; parent_code: string | null; is_active: boolean | null };

async function pageAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[] | null> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await run(from, from + 999);
    if (error) {
      console.warn("[transport-finance] read failed", error.message);
      return null;
    }
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function readLoanLinks(): Promise<{ state: LoanLinksState; updatedAt: string } | null> {
  const row = await readRow(TRANSPORT_LOAN_LINKS_KEY);
  return row ? { state: normalizeLoanLinks(row.state), updatedAt: row.updatedAt } : null;
}

export async function buildVehicleLoans(today = istToday()): Promise<
  | { ok: true; loans: VehicleLoanView[]; vehicles: FleetVehicleRef[]; today: string }
  | Fail
> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable", status: 503 };
  const [links, vehicles, accountsRes] = await Promise.all([
    readLoanLinks(),
    readFleetVehicles(),
    ctx.sb
      .from("ledger_accounts")
      .select("id, code, name, kind, parent_code, is_active")
      .eq("tenant_id", ctx.tenantId),
  ]);
  if (!links) return { ok: false, error: "Could not read the loan links", status: 502 };
  if (accountsRes.error) return { ok: false, error: `Could not read the chart of accounts: ${accountsRes.error.message}`, status: 502 };
  const accounts = (accountsRes.data ?? []) as AccountRow[];
  const linked = new Set(Object.keys(links.state.links));
  const loanAccounts = accounts.filter((a) =>
    isVehicleLoanAccount(
      { code: a.code, name: a.name, kind: a.kind, parentCode: a.parent_code ?? "", isActive: a.is_active !== false },
      linked,
    ),
  );
  const fleet = vehicles ?? [];
  if (loanAccounts.length === 0) return { ok: true, loans: [], vehicles: fleet, today };

  const interestIds = new Set(accounts.filter((a) => isInterestAccount(a)).map((a) => a.id));
  const loanIds = loanAccounts.map((a) => a.id);

  type LineRow = { voucher_id: string; account_id: string; debit_paise: number; credit_paise: number };
  const lines = await pageAll<LineRow>((from, to) =>
    ctx.sb
      .from("ledger_lines")
      .select("voucher_id, account_id, debit_paise, credit_paise")
      .eq("tenant_id", ctx.tenantId)
      .in("account_id", loanIds)
      .order("id")
      .range(from, to),
  );
  if (!lines) return { ok: false, error: "Could not read the loan accounts' lines", status: 502 };
  const voucherIds = [...new Set(lines.map((l) => l.voucher_id))];

  type VoucherRow = { id: string; voucher_no: string; voucher_type: string; voucher_date: string; reverses_voucher_id: string | null };
  const vouchers = new Map<string, VoucherRow>();
  const reversed = new Set<string>();
  const interestByVoucher = new Map<string, number>();
  for (let i = 0; i < voucherIds.length; i += 200) {
    const ids = voucherIds.slice(i, i + 200);
    const [vs, revs, ints] = await Promise.all([
      ctx.sb
        .from("ledger_vouchers")
        .select("id, voucher_no, voucher_type, voucher_date, reverses_voucher_id")
        .eq("tenant_id", ctx.tenantId)
        .in("id", ids),
      ctx.sb.from("ledger_vouchers").select("reverses_voucher_id").eq("tenant_id", ctx.tenantId).in("reverses_voucher_id", ids),
      interestIds.size
        ? ctx.sb
            .from("ledger_lines")
            .select("voucher_id, account_id, debit_paise, credit_paise")
            .eq("tenant_id", ctx.tenantId)
            .in("voucher_id", ids)
            .in("account_id", [...interestIds])
        : Promise.resolve({ data: [], error: null }),
    ]);
    const err = vs.error || revs.error || ints.error;
    if (err) return { ok: false, error: `Could not read the loan vouchers: ${err.message}`, status: 502 };
    for (const v of (vs.data ?? []) as VoucherRow[]) vouchers.set(v.id, v);
    for (const r of (revs.data ?? []) as { reverses_voucher_id: string | null }[]) if (r.reverses_voucher_id) reversed.add(r.reverses_voucher_id);
    for (const l of (ints.data ?? []) as LineRow[]) {
      interestByVoucher.set(l.voucher_id, (interestByVoucher.get(l.voucher_id) ?? 0) + Number(l.debit_paise || 0) - Number(l.credit_paise || 0));
    }
  }

  const loans: VehicleLoanView[] = loanAccounts
    .map((a) => {
      const byVoucher = new Map<string, LoanVoucherRow>();
      for (const l of lines) {
        if (l.account_id !== a.id) continue;
        const v = vouchers.get(l.voucher_id);
        if (!v) continue;
        const row =
          byVoucher.get(v.id) ??
          ({
            voucherId: v.id,
            voucherNo: v.voucher_no,
            voucherType: v.voucher_type,
            date: String(v.voucher_date).slice(0, 10),
            debitPaise: 0,
            creditPaise: 0,
            interestPaise: interestByVoucher.get(v.id) ?? 0,
            cancelled: !!v.reverses_voucher_id || reversed.has(v.id),
          } satisfies LoanVoucherRow);
        row.debitPaise += Number(l.debit_paise || 0);
        row.creditPaise += Number(l.credit_paise || 0);
        byVoucher.set(v.id, row);
      }
      const link = links.state.links[a.code] ?? null;
      const veh = link?.vehicleId ? fleet.find((v) => v.id === link.vehicleId) : undefined;
      return {
        code: a.code,
        name: a.name,
        link,
        vehicleLabel: veh ? veh.label : link?.vehicleId ? "(vehicle no longer in the fleet)" : "",
        summary: summarizeLoan({ rows: [...byVoucher.values()], today, dueDay: link?.emiDueDay ?? DEFAULT_EMI_DUE_DAY }),
      };
    })
    .sort((x, y) => x.code.localeCompare(y.code));
  return { ok: true, loans, vehicles: fleet, today };
}

/** Accounts · edit: which bus a loan account is for, and its EMI day. */
export async function saveLoanLink(input: {
  code: string;
  vehicleId: string;
  emiDueDay: number;
  paidBy: string;
  by: string;
}): Promise<{ ok: true } | Fail> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable", status: 503 };
  const code = String(input.code ?? "").trim();
  const { data: acct, error } = await ctx.sb
    .from("ledger_accounts")
    .select("code, kind, parent_code")
    .eq("tenant_id", ctx.tenantId)
    .eq("code", code)
    .maybeSingle();
  if (error) return { ok: false, error: error.message, status: 502 };
  if (!acct || (acct as { kind: string }).kind !== "liability" || !(acct as { parent_code: string | null }).parent_code) {
    return { ok: false, error: "Only a liability account (not a heading) can be a vehicle loan", status: 400 };
  }
  const vehicleId = String(input.vehicleId ?? "").trim();
  if (vehicleId) {
    const fleet = await readFleetVehicles();
    if (!fleet) return { ok: false, error: "Could not read the fleet — nothing was changed", status: 502 };
    if (!fleet.some((v) => v.id === vehicleId)) return { ok: false, error: "That vehicle is not in the fleet", status: 400 };
  }
  const day = Math.round(Number(input.emiDueDay));
  if (!(day >= 1 && day <= 31)) return { ok: false, error: "EMI day must be 1–31", status: 400 };
  const r = await casUpdate(TRANSPORT_LOAN_LINKS_KEY, normalizeLoanLinks, (cur) => ({
    ok: true,
    next: {
      links: {
        ...cur.links,
        [code]: {
          vehicleId,
          emiDueDay: day,
          paidBy: String(input.paidBy ?? "").trim().slice(0, 80),
          updatedAt: new Date().toISOString(),
          updatedBy: input.by,
        },
      },
    },
  }));
  return r.ok ? { ok: true } : r;
}

/* ─── Vehicle documents ───────────────────────────────────── */

export async function readVehicleDocs(): Promise<{ state: VehicleDocsState; updatedAt: string } | null> {
  const row = await readRow(TRANSPORT_VEHICLE_DOCS_KEY);
  return row ? { state: normalizeVehicleDocs(row.state), updatedAt: row.updatedAt } : null;
}

function newDocId(): string {
  return `vdoc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Create a document, or edit one at the version the screen loaded
 * (`baseUpdatedAt` = that document's updatedAt): two people editing the same
 * paper at once must not silently overwrite each other. Once its fee is in
 * the books, the fee and the vehicle are fixed — void it and enter it again.
 */
export async function saveVehicleDoc(input: {
  id?: string;
  baseUpdatedAt?: string;
  doc: unknown;
  by: string;
}): Promise<{ ok: true; doc: VehicleDoc } | Fail> {
  const fleet = await readFleetVehicles();
  if (!fleet) return { ok: false, error: "Could not read the fleet — nothing was saved", status: 502 };
  const v = validateVehicleDocInput(input.doc, new Set(fleet.map((f) => f.id)));
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const now = new Date().toISOString();
  let saved: VehicleDoc | null = null;
  const r = await casUpdate(TRANSPORT_VEHICLE_DOCS_KEY, normalizeVehicleDocs, (cur) => {
    if (!input.id) {
      saved = {
        id: newDocId(),
        ...v.input,
        status: "active",
        voidReason: "",
        fee: null,
        createdAt: now,
        createdBy: input.by,
        updatedAt: now,
        updatedBy: input.by,
      };
      return { ok: true, next: { docs: [...cur.docs, saved] } };
    }
    const was = cur.docs.find((d) => d.id === input.id);
    if (!was) return { ok: false, error: "That document is no longer there — reload", status: 404 };
    if (was.status === "void") return { ok: false, error: "A voided document cannot be changed", status: 409 };
    if ((input.baseUpdatedAt ?? "") !== was.updatedAt) {
      return { ok: false, conflict: true, error: `${was.updatedBy || "Someone"} changed this document meanwhile — reload and try again`, status: 409 };
    }
    if (was.fee && (v.input.feePaise !== was.feePaise || v.input.vehicleId !== was.vehicleId)) {
      return { ok: false, error: `The fee is in the books (${was.fee.voucherNo}). To change the fee or vehicle, void this document and enter it again.`, status: 409 };
    }
    saved = { ...was, ...v.input, updatedAt: now, updatedBy: input.by };
    return { ok: true, next: { docs: cur.docs.map((d) => (d.id === was.id ? saved! : d)) } };
  });
  if (!r.ok) return r;
  return { ok: true, doc: saved! };
}

/** The expense head and banks a fee can be booked against. */
export async function vehicleDocPostingTargets(): Promise<{
  expense: { code: string; name: string } | null;
  banks: { code: string; name: string }[];
}> {
  const { ledgerListAccounts } = await import("@/lib/ledger/ledger.server");
  const accounts = await ledgerListAccounts();
  const expense = pickVehicleDocExpenseAccount(accounts);
  return {
    expense: expense ? { code: expense.code, name: expense.name } : null,
    banks: accounts.filter((a) => a.bankAccountId).map((a) => ({ code: a.code, name: a.name })),
  };
}

/** Write the fee posting onto the document, retried — the voucher is already in. */
async function stampFee(docId: string, patch: (d: VehicleDoc) => VehicleDoc): Promise<{ ok: true; doc: VehicleDoc } | Fail> {
  let saved: VehicleDoc | null = null;
  const r = await casUpdate(TRANSPORT_VEHICLE_DOCS_KEY, normalizeVehicleDocs, (cur) => {
    const was = cur.docs.find((d) => d.id === docId);
    if (!was) return { ok: false, error: "The document disappeared", status: 404 };
    saved = patch(was);
    return { ok: true, next: { docs: cur.docs.map((d) => (d.id === docId ? saved! : d)) } };
  });
  return r.ok ? { ok: true, doc: saved! } : r;
}

/**
 * Book a document's fee: Dr the vehicle-papers head / Cr cash box or bank.
 * One voucher per document, ever (source transport_vehicle_doc:<id>): a
 * repeat after a failed stamp gets the same voucher back, never a second.
 */
export async function postVehicleDocFee(input: {
  id: string;
  mode: "cash" | "bank";
  bankCode?: string;
  paidOn: string;
  ref?: string;
  by: string;
}): Promise<{ ok: true; doc: VehicleDoc; voucherNo: string; replay: boolean } | Fail> {
  if (!isIsoDate(input.paidOn) || input.paidOn > istToday()) return { ok: false, error: "Enter the date it was paid (not in the future)", status: 400 };
  const docs = await readVehicleDocs();
  if (!docs) return { ok: false, error: "Could not read the documents", status: 502 };
  const doc = docs.state.docs.find((d) => d.id === input.id);
  if (!doc) return { ok: false, error: "No such document", status: 404 };
  if (doc.status === "void") return { ok: false, error: "This document is void", status: 409 };
  if (doc.fee) return { ok: false, error: `Already in the books as ${doc.fee.voucherNo}`, status: 409 };
  if (!(doc.feePaise > 0)) return { ok: false, error: "Enter the fee on the document first", status: 400 };

  const targets = await vehicleDocPostingTargets();
  if (!targets.expense) {
    return { ok: false, error: "No expense head for vehicle insurance / permits in the chart — add one in Accounts → Masters, then book the fee", status: 422 };
  }
  let bankAccountId = "";
  if (input.mode === "bank") {
    const { ledgerListAccounts } = await import("@/lib/ledger/ledger.server");
    const bank = (await ledgerListAccounts()).find((a) => a.code === input.bankCode && a.bankAccountId);
    if (!bank) return { ok: false, error: "Choose the school bank the money left", status: 400 };
    bankAccountId = bank.bankAccountId;
  }
  const fleet = await readFleetVehicles();
  const vehicle = fleet?.find((v) => v.id === doc.vehicleId);
  const what = `${VEHICLE_DOC_LABELS[doc.type]}${doc.number ? ` ${doc.number}` : ""}${doc.type === "insurance" && doc.policyNo ? ` (policy ${doc.policyNo})` : ""}`;
  const narration = `${what} — ${vehicle?.label || doc.vehicleId}, valid to ${doc.expiresOn}`.slice(0, 240);
  const lines = vehicleDocFeeLines({
    feePaise: doc.feePaise,
    expenseCode: targets.expense.code,
    mode: input.mode,
    cashCode: L_CASH,
    bankCode: input.bankCode,
    bankAccountId,
    narration,
    ref: input.ref,
    date: input.paidOn,
  });
  if (!lines.ok) return { ok: false, error: lines.error, status: 400 };
  const { ledgerPost } = await import("@/lib/ledger/ledger.server");
  const posted = await ledgerPost({
    voucherType: "payment",
    date: input.paidOn,
    narration,
    sourceType: VEHICLE_DOC_FEE_SOURCE,
    sourceId: doc.id,
    createdBy: input.by,
    lines: lines.lines,
  });
  if (!posted.ok) return { ok: false, error: `The books refused the fee: ${posted.error}`, status: 422 };
  const stamped = await stampFee(doc.id, (d) => ({
    ...d,
    fee: {
      voucherId: posted.voucherId,
      voucherNo: posted.voucherNo,
      mode: input.mode,
      bankCode: input.mode === "bank" ? String(input.bankCode ?? "") : "",
      paidOn: input.paidOn,
      expenseCode: targets.expense!.code,
      postedAt: new Date().toISOString(),
      postedBy: input.by,
      reversalVoucherNo: "",
    },
    updatedAt: new Date().toISOString(),
    updatedBy: input.by,
  }));
  if (!stamped.ok) {
    return { ok: false, error: `Voucher ${posted.voucherNo} is in the books, but the document could not be marked (${stamped.error}). Book the fee again — it will not post twice.`, status: 502 };
  }
  return { ok: true, doc: stamped.doc, voucherNo: posted.voucherNo, replay: !posted.created };
}

/**
 * Void a document. A fee already in the books is reversed FIRST (the voucher
 * stays, a reversal cancels it): a void that left the expense standing would
 * be money spent on a paper the register says never existed.
 */
export async function voidVehicleDoc(input: {
  id: string;
  reason: string;
  by: string;
  /** May this person reverse a voucher (Accounts · approve)? */
  canReverse: boolean;
}): Promise<{ ok: true; doc: VehicleDoc; reversalVoucherNo: string } | Fail> {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 4) return { ok: false, error: "Say why it is being voided", status: 400 };
  const docs = await readVehicleDocs();
  if (!docs) return { ok: false, error: "Could not read the documents", status: 502 };
  const doc = docs.state.docs.find((d) => d.id === input.id);
  if (!doc) return { ok: false, error: "No such document", status: 404 };
  if (doc.status === "void") return { ok: true, doc, reversalVoucherNo: doc.fee?.reversalVoucherNo ?? "" };

  let reversalVoucherNo = doc.fee?.reversalVoucherNo ?? "";
  if (doc.fee && !reversalVoucherNo) {
    if (!input.canReverse) {
      return { ok: false, error: `Its fee is in the books (${doc.fee.voucherNo}); voiding reverses that voucher, which needs Accounts · approve`, status: 403 };
    }
    const { ledgerVoidVoucher } = await import("@/lib/ledger/reports.server");
    const rev = await ledgerVoidVoucher({ voucherId: doc.fee.voucherId, reason: `Vehicle document voided: ${reason}`, actor: input.by });
    // A retry after a reversal whose stamp failed: the voucher is already
    // cancelled, which is exactly the state wanted.
    if (!rev.ok && !/already voided/i.test(rev.error ?? "")) {
      return { ok: false, error: `Could not reverse ${doc.fee.voucherNo}: ${rev.error ?? "refused"}`, status: 422 };
    }
    reversalVoucherNo = (rev.ok && rev.voucherNo) || "reversed";
  }
  const now = new Date().toISOString();
  const r = await stampFee(doc.id, (d) => ({
    ...d,
    status: "void",
    voidReason: reason.slice(0, 300),
    fee: d.fee ? { ...d.fee, reversalVoucherNo: reversalVoucherNo || d.fee.reversalVoucherNo } : null,
    updatedAt: now,
    updatedBy: input.by,
  }));
  if (!r.ok) {
    return { ok: false, error: reversalVoucherNo ? `Fee reversed (${reversalVoucherNo}) but the document could not be marked void (${r.error}) — void it again; the voucher will not be reversed twice.` : r.error, status: r.status ?? 502 };
  }
  return { ok: true, doc: r.doc, reversalVoucherNo };
}
