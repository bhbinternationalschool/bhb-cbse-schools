/**
 * Library counter on the server (11 Oct 2026): accession numbers, issue,
 * return, fine rule, and settling a fine. The browser's library desk still
 * holds the catalogue for display, but every change that matters at the
 * counter happens here, one copy at a time, inside a database function — so
 * two counters cannot lend the same copy and an old tab cannot un-return a
 * book (its desk save never carries loans or copy status any more).
 *
 * Fines: worked out at return by lib/libraryFine.ts from the rule stored
 * here (never an amount the browser sends), saved on the loan as "pending",
 * and then either COLLECTED — a Ledger v2 receipt, Dr Cash/Bank, Cr 4100
 * Other Income, idempotent on the loan id — or WAIVED with a reason. Nothing
 * else moves a fine, and none of it deletes anything.
 */

import { invCtx, InvError, type InvCtx } from "@/lib/inventory/db.server";
import { computeLateFine, canSettleFine, fineStatusOf, validateFineRule, type LibraryFineStatus } from "@/lib/libraryFine";
import {
  dueDateFor,
  fineDebitLine,
  libraryToday,
  type FineBankAccount,
  isCopySource,
  LIBRARY_FINE_INCOME_ACCOUNT,
  normalizeAccessionCode,
  type LibraryBorrowerRef,
  borrowerKey,
  isLibraryMigrationPending,
  LIBRARY_NOT_MIGRATED,
} from "@/lib/libraryCounter";
import { isoDayNumber } from "@/lib/libraryFine";
import { ledgerPost } from "@/lib/ledger/ledger.server";
import { fetchAllPages } from "@/lib/supabase/pageAll";

type Row = Record<string, unknown>;

/**
 * Run a library handler; a database error that only means "the migration
 * is not applied yet" becomes one clear message instead of a raw column
 * error (the build may reach production before its migration).
 */
export async function withLibraryDb<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isLibraryMigrationPending(msg)) throw new InvError(LIBRARY_NOT_MIGRATED, 503);
    throw e;
  }
}

export type LibraryRules = {
  maxBooksPerStudent: number;
  maxBooksPerStaff: number;
  loanDays: number;
  finePaisePerDay: number;
  graceDays: number;
  capPaise: number;
};

export type CounterCopy = {
  id: string;
  titleId: string;
  title: string;
  author: string;
  accessionNo: string;
  barcode: string;
  status: string;
  location: string;
};

export type CounterLoan = {
  id: string;
  copyId: string;
  accessionNo: string;
  title: string;
  borrowerType: "student" | "staff";
  borrowerId: string;
  borrowerName: string;
  issuedOn: string;
  dueOn: string;
  returnedOn: string | null;
  finePaise: number;
  fineStatus: LibraryFineStatus;
  fineVoucherNo: string;
};

function today(): string {
  return libraryToday();
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}


/** The rules as stored. A failed read throws — it never falls back to defaults. */
export async function readLibraryRules(c?: InvCtx): Promise<LibraryRules> {
  const { sb, tenantId } = c ?? (await invCtx());
  const { data, error } = await sb
    .from("library_desk_settings")
    .select("max_books_per_student, max_books_per_staff, loan_days, fine_paise_per_day, fine_grace_days, fine_cap_paise")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new InvError(`Could not read the library rules: ${error.message}`, 503);
  // No row = a school that never saved rules: the desk's own defaults, which
  // the screen shows and the school can change. A read that FAILED threw above.
  const r = (data ?? {}) as Row;
  return {
    maxBooksPerStudent: Number(r.max_books_per_student ?? 2),
    maxBooksPerStaff: Number(r.max_books_per_staff ?? 3),
    loanDays: Number(r.loan_days ?? 14),
    finePaisePerDay: Number(r.fine_paise_per_day ?? 500),
    graceDays: Number(r.fine_grace_days ?? 0),
    capPaise: Number(r.fine_cap_paise ?? 0),
  };
}

export async function saveLibraryRules(input: Partial<LibraryRules>): Promise<LibraryRules> {
  const c = await invCtx();
  const cur = await readLibraryRules(c);
  const next = { ...cur, ...input };
  const v = validateFineRule({
    finePaisePerDay: next.finePaisePerDay,
    graceDays: next.graceDays,
    capPaise: next.capPaise,
  });
  if (!v.ok) throw new InvError(v.error);
  for (const [k, n] of [
    ["Loan days", next.loanDays],
    ["Books per student", next.maxBooksPerStudent],
    ["Books per staff member", next.maxBooksPerStaff],
  ] as const) {
    if (!Number.isInteger(n) || n < 1 || n > 365) throw new InvError(`${k} must be a whole number from 1 to 365`);
  }
  const { error } = await c.sb.from("library_desk_settings").upsert(
    {
      tenant_id: c.tenantId,
      max_books_per_student: next.maxBooksPerStudent,
      max_books_per_staff: next.maxBooksPerStaff,
      loan_days: next.loanDays,
      fine_paise_per_day: v.rule.finePaisePerDay,
      fine_grace_days: v.rule.graceDays,
      fine_cap_paise: v.rule.capPaise,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) throw new InvError(`Could not save the library rules: ${error.message}`, 502);
  return readLibraryRules(c);
}

async function titlesById(c: InvCtx, ids: string[]): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 200) {
    const { data, error } = await c.sb
      .from("library_desk_titles")
      .select("id, title, author")
      .eq("tenant_id", c.tenantId)
      .in("id", uniq.slice(i, i + 200));
    if (error) throw new InvError(`Could not read titles: ${error.message}`, 503);
    for (const r of (data ?? []) as Row[]) out.set(str(r.id), r);
  }
  return out;
}

function toCopy(r: Row, titles: Map<string, Row>): CounterCopy {
  const t = titles.get(str(r.title_id));
  return {
    id: str(r.id),
    titleId: str(r.title_id),
    title: str(t?.title) || "(title missing)",
    author: str(t?.author),
    accessionNo: str(r.accession_no),
    barcode: str(r.barcode),
    status: str(r.status),
    location: str(r.location),
  };
}

/** The copy a scanned/typed code names (accession number or barcode), or null. */
export async function findCopyByCode(code: string, c?: InvCtx): Promise<CounterCopy | null> {
  const ctx = c ?? (await invCtx());
  const norm = normalizeAccessionCode(code);
  if (!norm) throw new InvError(`"${code}" is not an accession number`);
  const variants = [...new Set([norm, norm.toUpperCase()])];
  for (const col of ["accession_no", "barcode"] as const) {
    const { data, error } = await ctx.sb
      .from("library_desk_copies")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .in(col, variants)
      .limit(2);
    if (error) throw new InvError(`Could not look up ${norm}: ${error.message}`, 503);
    const rows = (data ?? []) as Row[];
    if (rows.length > 1) throw new InvError(`${norm} matches more than one copy — fix the duplicate in Copies & labels`, 409);
    if (rows.length === 1) {
      const titles = await titlesById(ctx, [str(rows[0]!.title_id)]);
      return toCopy(rows[0]!, titles);
    }
  }
  return null;
}

async function borrowerNames(c: InvCtx, refs: LibraryBorrowerRef[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const students = [...new Set(refs.filter((r) => r.type === "student").map((r) => r.id))];
  const staff = [...new Set(refs.filter((r) => r.type === "staff").map((r) => r.id))];
  for (let i = 0; i < students.length; i += 200) {
    const { data, error } = await c.sb
      .from("sis_students")
      .select("id, full_name, admission_no")
      .eq("tenant_id", c.tenantId)
      .in("id", students.slice(i, i + 200));
    if (error) throw new InvError(`Could not read students: ${error.message}`, 503);
    for (const r of (data ?? []) as Row[]) {
      out.set(`student:${str(r.id)}`, `${str(r.full_name)}${r.admission_no ? ` · ${str(r.admission_no)}` : ""}`);
    }
  }
  for (let i = 0; i < staff.length; i += 200) {
    const { data, error } = await c.sb
      .from("sis_staff")
      .select("id, full_name, emp_code")
      .eq("tenant_id", c.tenantId)
      .in("id", staff.slice(i, i + 200));
    if (error) throw new InvError(`Could not read staff: ${error.message}`, 503);
    for (const r of (data ?? []) as Row[]) {
      out.set(`staff:${str(r.id)}`, `${str(r.full_name)}${r.emp_code ? ` · ${str(r.emp_code)}` : ""}`);
    }
  }
  return out;
}

function refOfIssue(r: Row): LibraryBorrowerRef {
  const sid = str(r.student_id);
  if (str(r.borrower_type) === "staff" || sid.startsWith("staff:")) {
    return { type: "staff", id: str(r.staff_id) || sid.replace(/^staff:/, "") };
  }
  return { type: "student", id: sid };
}

async function toLoans(c: InvCtx, rows: Row[]): Promise<CounterLoan[]> {
  if (!rows.length) return [];
  const copyIds = [...new Set(rows.map((r) => str(r.copy_id)))];
  const copies = new Map<string, Row>();
  for (let i = 0; i < copyIds.length; i += 200) {
    const { data, error } = await c.sb
      .from("library_desk_copies")
      .select("id, title_id, accession_no")
      .eq("tenant_id", c.tenantId)
      .in("id", copyIds.slice(i, i + 200));
    if (error) throw new InvError(`Could not read copies: ${error.message}`, 503);
    for (const r of (data ?? []) as Row[]) copies.set(str(r.id), r);
  }
  const titles = await titlesById(c, [...copies.values()].map((r) => str(r.title_id)));
  const refs = rows.map(refOfIssue);
  const names = await borrowerNames(c, refs);
  return rows.map((r, i) => {
    const copy = copies.get(str(r.copy_id));
    const ref = refs[i]!;
    return {
      id: str(r.id),
      copyId: str(r.copy_id),
      accessionNo: str(copy?.accession_no) || "—",
      title: str(titles.get(str(copy?.title_id))?.title) || "(title missing)",
      borrowerType: ref.type,
      borrowerId: ref.id,
      borrowerName: names.get(`${ref.type}:${ref.id}`) || ref.id,
      issuedOn: str(r.issued_on).slice(0, 10),
      dueOn: str(r.due_on).slice(0, 10),
      returnedOn: r.returned_on ? str(r.returned_on).slice(0, 10) : null,
      finePaise: Number(r.fine_paise ?? 0),
      fineStatus: fineStatusOf(r.fine_status),
      fineVoucherNo: str(r.fine_voucher_no),
    };
  });
}

/** What the counter shows when a code is scanned: the copy, and its open loan if any. */
export async function lookupForCounter(code: string): Promise<{ copy: CounterCopy | null; openLoan: CounterLoan | null }> {
  const c = await invCtx();
  const copy = await findCopyByCode(code, c);
  if (!copy) return { copy: null, openLoan: null };
  const { data, error } = await c.sb
    .from("library_desk_issues")
    .select("*")
    .eq("tenant_id", c.tenantId)
    .eq("copy_id", copy.id)
    .is("returned_on", null)
    .limit(2);
  if (error) throw new InvError(`Could not read loans: ${error.message}`, 503);
  const loans = await toLoans(c, (data ?? []) as Row[]);
  return { copy, openLoan: loans[0] ?? null };
}

/** A borrower's loans still out and fines still owed. */
export async function borrowerAccount(ref: LibraryBorrowerRef): Promise<{ open: CounterLoan[]; finesDue: CounterLoan[] }> {
  const c = await invCtx();
  if (!ref.id) throw new InvError("Choose a borrower");
  const r = await fetchAllPages<Row>((from, to) =>
    c.sb
      .from("library_desk_issues")
      .select("*")
      .eq("tenant_id", c.tenantId)
      .eq("student_id", borrowerKey(ref))
      .or("returned_on.is.null,fine_status.in.(pending,collecting)")
      .order("id")
      .range(from, to),
  );
  if (r.error) throw new InvError(`Could not read loans: ${r.error}`, 503);
  const loans = await toLoans(c, r.rows);
  return {
    open: loans.filter((l) => !l.returnedOn).sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
    finesDue: loans.filter((l) => l.returnedOn && (l.fineStatus === "pending" || l.fineStatus === "collecting")),
  };
}

async function assertBorrowerExists(c: InvCtx, ref: LibraryBorrowerRef): Promise<string> {
  const names = await borrowerNames(c, [ref]);
  const name = names.get(`${ref.type}:${ref.id}`);
  if (!name) throw new InvError(ref.type === "staff" ? "That staff member is not on the roster" : "That student is not on the roll", 404);
  return name;
}

export type IssueResult = { code: string; ok: boolean; error?: string; issueId?: string; title?: string; dueOn?: string };

/**
 * Issue several books to one borrower in one go. Each copy is its own
 * all-or-nothing database call; the answer says, per code, what happened —
 * so a counter that scanned five books knows exactly which four went out.
 */
export async function issueBooks(input: {
  borrower: LibraryBorrowerRef;
  codes: string[];
  issuedOn?: string;
  dueOn?: string;
  academicYearCode: string;
  issuedBy: string;
  note?: string;
  issueCondition?: string;
  damageNote?: string;
}): Promise<{ results: IssueResult[]; borrowerName: string }> {
  const c = await invCtx();
  if (!input.codes.length) throw new InvError("Scan or type at least one accession number");
  if (input.codes.length > 20) throw new InvError("Issue at most 20 books at a time");
  const borrowerName = await assertBorrowerExists(c, input.borrower);
  const rules = await readLibraryRules(c);
  const issuedOn = input.issuedOn || today();
  if (isoDayNumber(issuedOn) == null) throw new InvError("Issue date is not a date");
  const dueOn = input.dueOn || dueDateFor(issuedOn, rules.loanDays);
  if (!dueOn || isoDayNumber(dueOn) == null) throw new InvError("Due date is not a date");
  const cond = ["good", "fair", "damaged", "torn"].includes(String(input.issueCondition)) ? String(input.issueCondition) : "good";
  const max = input.borrower.type === "staff" ? rules.maxBooksPerStaff : rules.maxBooksPerStudent;

  const results: IssueResult[] = [];
  for (const code of input.codes) {
    try {
      const copy = await findCopyByCode(code, c);
      if (!copy) {
        results.push({ code, ok: false, error: "No copy has this accession number" });
        continue;
      }
      const { data, error } = await c.sb.rpc("library_issue_copy", {
        p_tenant_id: c.tenantId,
        p_copy_id: copy.id,
        p_borrower_type: input.borrower.type,
        p_borrower_id: input.borrower.id,
        p_academic_year_code: input.academicYearCode,
        p_issued_on: issuedOn,
        p_due_on: dueOn,
        p_issued_by: input.issuedBy,
        p_note: input.note ?? "",
        p_issue_condition: cond,
        p_damage_note: cond === "damaged" || cond === "torn" ? input.damageNote ?? "" : "",
        p_max_open: max,
      });
      if (error) {
        if (isLibraryMigrationPending(error.message)) throw new InvError(LIBRARY_NOT_MIGRATED, 503);
        results.push({ code, ok: false, error: error.message });
        continue;
      }
      const r = (data ?? {}) as Row;
      if (r.ok !== true) {
        results.push({ code, ok: false, error: str(r.error) || "Not issued" });
        continue;
      }
      results.push({ code, ok: true, issueId: str(r.issue_id), title: copy.title, dueOn });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === LIBRARY_NOT_MIGRATED || isLibraryMigrationPending(msg)) throw new InvError(LIBRARY_NOT_MIGRATED, 503);
      results.push({ code, ok: false, error: msg });
    }
  }
  return { results, borrowerName };
}

export type ReturnResult = {
  code: string;
  ok: boolean;
  error?: string;
  issueId?: string;
  title?: string;
  borrowerName?: string;
  daysLate?: number;
  finePaise?: number;
};

/** Return books by scanning them. The fine is worked out here, from the stored rule. */
export async function returnBooks(input: {
  codes: string[];
  returnedOn?: string;
  returnCondition?: string;
  damageNote?: string;
  returnedBy: string;
}): Promise<{ results: ReturnResult[] }> {
  const c = await invCtx();
  if (!input.codes.length) throw new InvError("Scan or type at least one accession number");
  if (input.codes.length > 20) throw new InvError("Return at most 20 books at a time");
  const rules = await readLibraryRules(c);
  const returnedOn = input.returnedOn || today();
  if (isoDayNumber(returnedOn) == null) throw new InvError("Return date is not a date");
  const cond = ["good", "fair", "damaged", "torn"].includes(String(input.returnCondition)) ? String(input.returnCondition) : "good";

  const results: ReturnResult[] = [];
  for (const code of input.codes) {
    try {
      const { copy, openLoan } = await lookupForCounter(code);
      if (!copy) {
        results.push({ code, ok: false, error: "No copy has this accession number" });
        continue;
      }
      if (!openLoan) {
        results.push({ code, ok: false, error: `${copy.accessionNo} is not on loan`, title: copy.title });
        continue;
      }
      const fine = computeLateFine(rules, openLoan.dueOn, returnedOn);
      if (!fine.ok) {
        // Not returned: a fine we could not work out must not become ₹0.
        results.push({ code, ok: false, error: `Fine could not be worked out (${fine.error}) — not returned`, title: copy.title });
        continue;
      }
      const { data, error } = await c.sb.rpc("library_return_issue", {
        p_tenant_id: c.tenantId,
        p_issue_id: openLoan.id,
        p_returned_on: returnedOn,
        p_fine_paise: fine.finePaise,
        p_return_condition: cond,
        p_damage_note: cond === "damaged" || cond === "torn" ? input.damageNote ?? "" : "",
        p_returned_by: input.returnedBy,
      });
      if (error) {
        if (isLibraryMigrationPending(error.message)) throw new InvError(LIBRARY_NOT_MIGRATED, 503);
        results.push({ code, ok: false, error: error.message, title: copy.title });
        continue;
      }
      const r = (data ?? {}) as Row;
      if (r.ok !== true) {
        results.push({ code, ok: false, error: str(r.error) || "Not returned", title: copy.title });
        continue;
      }
      results.push({
        code,
        ok: true,
        issueId: openLoan.id,
        title: copy.title,
        borrowerName: openLoan.borrowerName,
        daysLate: fine.daysLate,
        finePaise: fine.finePaise,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === LIBRARY_NOT_MIGRATED || isLibraryMigrationPending(msg)) throw new InvError(LIBRARY_NOT_MIGRATED, 503);
      results.push({ code, ok: false, error: msg });
    }
  }
  return { results };
}

/** New copies of a title, each with the next accession number. */
export async function addCopies(input: {
  titleId: string;
  count: number;
  location?: string;
  source?: string;
  acquiredOn?: string;
  procurementDocId?: string;
}): Promise<{ copies: { id: string; accessionNo: string }[] }> {
  const c = await invCtx();
  const count = Number(input.count);
  if (!input.titleId) throw new InvError("Choose a title");
  if (!Number.isInteger(count) || count < 1 || count > 200) throw new InvError("Copies must be 1 to 200");
  const source = input.source || "purchase";
  if (!isCopySource(source)) throw new InvError("Source must be purchased, donated or in-house");
  if (input.acquiredOn && isoDayNumber(input.acquiredOn) == null) throw new InvError("Acquired date is not a date");
  const { data, error } = await c.sb.rpc("library_add_copies", {
    p_tenant_id: c.tenantId,
    p_title_id: input.titleId,
    p_count: count,
    p_location: (input.location ?? "").trim().slice(0, 120),
    p_source: source,
    p_acquired_on: input.acquiredOn || null,
    p_procurement_doc_id: input.procurementDocId ?? "",
  });
  if (error) {
    const msg = error.message.includes("not found")
      ? "That title is not saved on the server yet — wait a moment after adding it and try again"
      : error.message;
    throw new InvError(`Copies not added: ${msg}`, 502);
  }
  const rows = (data ?? []) as Row[];
  if (rows.length !== count) throw new InvError(`Expected ${count} copies, the database added ${rows.length}`, 502);
  return { copies: rows.map((r) => ({ id: str(r.id), accessionNo: str(r.accession_no) })) };
}

/**
 * Move a copy, or mark it lost / damaged / back in stock. Never while it is
 * on loan — checked inside library_update_copy with the copy row locked, so
 * a book issued at the same moment cannot be marked lost under the borrower.
 */
export async function updateCopy(input: { copyId: string; location?: string; status?: string }): Promise<{ copy: CounterCopy }> {
  const c = await invCtx();
  if (input.status !== undefined && !["available", "lost", "damaged"].includes(input.status)) {
    throw new InvError("Status can be set to available, lost or damaged — issuing is done at the counter");
  }
  const { data, error } = await c.sb.rpc("library_update_copy", {
    p_tenant_id: c.tenantId,
    p_copy_id: input.copyId,
    p_location: typeof input.location === "string" ? input.location.trim().slice(0, 120) : null,
    p_status: input.status ?? null,
  });
  if (error) throw new InvError(`Copy not saved: ${error.message}`, 502);
  const r = (data ?? {}) as Row;
  if (r.ok !== true) throw new InvError(str(r.error) || "Copy not saved", r.code === "not_found" ? 404 : 409);
  const { data: row, error: readErr } = await c.sb
    .from("library_desk_copies")
    .select("*")
    .eq("tenant_id", c.tenantId)
    .eq("id", input.copyId)
    .maybeSingle();
  if (readErr || !row) throw new InvError(`Copy saved, but could not be read back${readErr ? `: ${readErr.message}` : ""}`, 502);
  const titles = await titlesById(c, [str((row as Row).title_id)]);
  return { copy: toCopy(row as Row, titles) };
}

async function readIssue(c: InvCtx, issueId: string): Promise<Row> {
  const { data, error } = await c.sb
    .from("library_desk_issues")
    .select("*")
    .eq("tenant_id", c.tenantId)
    .eq("id", issueId)
    .maybeSingle();
  if (error) throw new InvError(`Could not read the loan: ${error.message}`, 503);
  if (!data) throw new InvError("Loan not found", 404);
  return data as Row;
}

/** The school's bank accounts a fine can be paid into: ledger sub-accounts of 1010 tied to a desk bank account. */
export async function fineBankAccounts(c?: InvCtx): Promise<FineBankAccount[]> {
  const ctx = c ?? (await invCtx());
  const { data, error } = await ctx.sb
    .from("ledger_accounts")
    .select("code, name, bank_account_id, is_bank, is_active")
    .eq("tenant_id", ctx.tenantId)
    .eq("is_bank", true)
    .eq("is_active", true)
    .order("code");
  if (error) throw new InvError(`Could not read the bank accounts: ${error.message}`, 503);
  return ((data ?? []) as Row[])
    .filter((r) => str(r.code) !== "1010" && str(r.bank_account_id))
    .map((r) => ({ code: str(r.code), name: str(r.name), bankAccountId: str(r.bank_account_id) }));
}

/** The receipt already booked for this loan's fine, if any (ledger_post is keyed on it). */
async function fineVoucherFor(c: InvCtx, issueId: string): Promise<{ id: string; voucherNo: string } | null> {
  const { data, error } = await c.sb
    .from("ledger_vouchers")
    .select("id, voucher_no")
    .eq("tenant_id", c.tenantId)
    .eq("source_type", "library_fine")
    .eq("source_id", issueId)
    .limit(1);
  if (error) throw new InvError(`Could not check the accounts for this fine: ${error.message}`, 503);
  const r = ((data ?? []) as Row[])[0];
  return r ? { id: str(r.id), voucherNo: str(r.voucher_no) } : null;
}

/**
 * Collect a fine, in three guarded steps so nothing can slip between them:
 *  1. CLAIM: pending → collecting (a Waive from now on is refused);
 *  2. BOOK: a Ledger v2 receipt — Dr Cash 1000 or the chosen bank account,
 *     Cr 4100 Other Income — for exactly the amount stored on the loan,
 *     keyed on the loan id, so a retry finds the same voucher;
 *  3. LINK: collecting → collected with the voucher number.
 * A retry of a half-finished Collect (status still "collecting") skips the
 * claim and finishes the job. If the accounts refuse and no voucher exists,
 * the claim is released back to pending.
 */
export async function collectFine(input: {
  issueId: string;
  mode: string;
  bankCode?: string;
  ref?: string;
  date?: string;
  collectedBy: string;
}): Promise<{ voucherNo: string; finePaise: number }> {
  const c = await invCtx();
  const banks = input.mode === "cash" ? [] : await fineBankAccounts(c);
  const debit = fineDebitLine(input.mode, input.bankCode, banks);
  if (!debit.ok) throw new InvError(debit.error);
  const date = input.date || today();
  if (isoDayNumber(date) == null) throw new InvError("Date is not a date");
  const issue = await readIssue(c, input.issueId);
  const finePaise = Number(issue.fine_paise ?? 0);
  const status = fineStatusOf(issue.fine_status);
  if (status === "collected") {
    throw new InvError(`Already collected${issue.fine_voucher_no ? ` — receipt ${str(issue.fine_voucher_no)}` : ""}`, 409);
  }
  const can = canSettleFine(status, finePaise, "collect");
  if (!can.ok) throw new InvError(can.error, 409);

  if (status === "pending") {
    const { data: claimed, error: claimErr } = await c.sb
      .from("library_desk_issues")
      .update({ fine_status: "collecting", fine_mode: input.mode, fine_settled_by: input.collectedBy, updated_at: new Date().toISOString() })
      .eq("tenant_id", c.tenantId)
      .eq("id", input.issueId)
      .eq("fine_status", "pending")
      .select("id");
    if (claimErr) throw new InvError(`Fine not collected: ${claimErr.message}`, 502);
    if (!(claimed ?? []).length) throw new InvError("This fine changed meanwhile (waived or collected elsewhere) — reload", 409);
  }

  const ref = refOfIssue(issue);
  const names = await borrowerNames(c, [ref]);
  const party = { kind: ref.type, externalId: ref.id, name: names.get(`${ref.type}:${ref.id}`) ?? "" } as const;
  const posted = await ledgerPost({
    voucherType: "receipt",
    date,
    narration: `Library late fine — ${party.name || ref.id}`,
    sourceType: "library_fine",
    sourceId: input.issueId,
    createdBy: input.collectedBy,
    lines: [
      {
        accountCode: debit.accountCode,
        debitPaise: finePaise,
        creditPaise: 0,
        narration: input.mode.toUpperCase(),
        party,
        instrument: { mode: input.mode, ref: (input.ref ?? "").slice(0, 80) },
        ...(debit.subledger ? { subledgerKind: debit.subledger.kind, subledgerId: debit.subledger.id } : {}),
      },
      {
        accountCode: LIBRARY_FINE_INCOME_ACCOUNT,
        debitPaise: 0,
        creditPaise: finePaise,
        narration: "Library late fine",
        party,
      },
    ],
  });
  if (!posted.ok) {
    // Release the claim only when the accounts hold no receipt for it — an
    // ambiguous failure stays "collecting", and a retry finishes it.
    const existing = await fineVoucherFor(c, input.issueId).catch(() => undefined);
    if (existing === null) {
      await c.sb
        .from("library_desk_issues")
        .update({ fine_status: "pending", updated_at: new Date().toISOString() })
        .eq("tenant_id", c.tenantId)
        .eq("id", input.issueId)
        .eq("fine_status", "collecting");
    }
    throw new InvError(`Fine not collected — the accounts refused the receipt: ${posted.error}`, 502);
  }

  const { data, error } = await c.sb
    .from("library_desk_issues")
    .update({
      fine_status: "collected",
      fine_mode: input.mode,
      fine_voucher_id: posted.voucherId,
      fine_voucher_no: posted.voucherNo,
      fine_settled_at: new Date().toISOString(),
      fine_settled_by: input.collectedBy,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", c.tenantId)
    .eq("id", input.issueId)
    .eq("fine_status", "collecting")
    .select("id");
  if (error || !(data ?? []).length) {
    throw new InvError(
      `Receipt ${posted.voucherNo} is booked, but the loan was not marked collected${error ? `: ${error.message}` : ""}. Press Collect again to finish — it will not book twice.`,
      502,
    );
  }
  return { voucherNo: posted.voucherNo, finePaise };
}

/** Waive a pending fine, with the reason on record. Refused once a Collect has claimed it or a receipt exists. */
export async function waiveFine(input: { issueId: string; reason: string; waivedBy: string }): Promise<{ finePaise: number }> {
  const c = await invCtx();
  const reason = input.reason.trim();
  if (reason.length < 3) throw new InvError("Say why the fine is waived");
  const issue = await readIssue(c, input.issueId);
  const finePaise = Number(issue.fine_paise ?? 0);
  const voucher = await fineVoucherFor(c, input.issueId);
  const can = canSettleFine(fineStatusOf(issue.fine_status), finePaise, "waive", !!voucher);
  if (!can.ok) throw new InvError(can.error, 409);
  const { data, error } = await c.sb
    .from("library_desk_issues")
    .update({
      fine_status: "waived",
      fine_waive_reason: reason.slice(0, 300),
      fine_settled_at: new Date().toISOString(),
      fine_settled_by: input.waivedBy,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", c.tenantId)
    .eq("id", input.issueId)
    .eq("fine_status", "pending")
    .select("id");
  if (error) throw new InvError(`Fine not waived: ${error.message}`, 502);
  if (!(data ?? []).length) throw new InvError("This fine changed meanwhile — reload and try again", 409);
  return { finePaise };
}

/** Every fine still owed (or half-collected), oldest first — the office's "collect these" list. */
export async function pendingFines(): Promise<CounterLoan[]> {
  const c = await invCtx();
  const r = await fetchAllPages<Row>((from, to) =>
    c.sb
      .from("library_desk_issues")
      .select("*")
      .eq("tenant_id", c.tenantId)
      .in("fine_status", ["pending", "collecting"])
      .order("id")
      .range(from, to),
  );
  if (r.error) throw new InvError(`Could not read fines: ${r.error}`, 503);
  const loans = await toLoans(c, r.rows);
  return loans.sort((a, b) => (a.returnedOn ?? "").localeCompare(b.returnedOn ?? ""));
}
