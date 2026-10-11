/**
 * Browser calls to the library counter routes. Every call answers
 * { ok: true, ... } or { ok: false, error } — a failed request is never
 * turned into an empty result.
 */

import type { LibraryBorrowerRef } from "@/lib/libraryCounter";

export type CounterLoanDto = {
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
  fineStatus: "none" | "pending" | "collected" | "waived";
  fineVoucherNo: string;
};

export type LibraryRulesDto = {
  maxBooksPerStudent: number;
  maxBooksPerStaff: number;
  loanDays: number;
  finePaisePerDay: number;
  graceDays: number;
  capPaise: number;
};

export type IssueResultDto = { code: string; ok: boolean; error?: string; issueId?: string; title?: string; dueOn?: string };
export type ReturnResultDto = {
  code: string;
  ok: boolean;
  error?: string;
  issueId?: string;
  title?: string;
  borrowerName?: string;
  daysLate?: number;
  finePaise?: number;
};

type Fail = { ok: false; error: string };

async function call<T>(url: string, init?: RequestInit): Promise<({ ok: true } & T) | Fail> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const body = (await res.json().catch(() => null)) as ({ ok?: boolean; error?: string } & T) | null;
    if (!res.ok || !body || body.ok !== true) {
      return { ok: false, error: body?.error || `The server said ${res.status}` };
    }
    return body as { ok: true } & T;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

function post<T>(url: string, body: Record<string, unknown>) {
  return call<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const COUNTER = "/api/library/counter";
const FINES = "/api/library/fines";

export const libraryApi = {
  rules: () => call<{ rules: LibraryRulesDto }>(`${COUNTER}?view=rules`),
  saveRules: (rules: Partial<LibraryRulesDto>) => post<{ rules: LibraryRulesDto }>(COUNTER, { action: "save_rules", rules }),
  borrower: (b: LibraryBorrowerRef) =>
    call<{ open: CounterLoanDto[]; finesDue: CounterLoanDto[] }>(
      `${COUNTER}?view=borrower&type=${encodeURIComponent(b.type)}&id=${encodeURIComponent(b.id)}`,
    ),
  issue: (input: {
    borrower: LibraryBorrowerRef;
    codes: string[];
    issuedOn?: string;
    dueOn?: string;
    academicYearCode: string;
    note?: string;
    issueCondition?: string;
    damageNote?: string;
  }) => post<{ results: IssueResultDto[]; borrowerName: string }>(COUNTER, { action: "issue", ...input }),
  returnBooks: (input: { codes: string[]; returnedOn?: string; returnCondition?: string; damageNote?: string }) =>
    post<{ results: ReturnResultDto[] }>(COUNTER, { action: "return", ...input }),
  addCopies: (input: {
    titleId: string;
    count: number;
    location?: string;
    source?: string;
    acquiredOn?: string;
    procurementDocId?: string;
  }) => post<{ copies: { id: string; accessionNo: string }[] }>(COUNTER, { action: "add_copies", ...input }),
  updateCopy: (input: { copyId: string; location?: string; status?: string }) =>
    post<Record<string, unknown>>(COUNTER, { action: "update_copy", ...input }),
  pendingFines: () => call<{ fines: CounterLoanDto[] }>(FINES),
  collectFine: (input: { issueId: string; mode: string; ref?: string; date?: string }) =>
    post<{ voucherNo: string; finePaise: number }>(FINES, { action: "collect", ...input }),
  waiveFine: (input: { issueId: string; reason: string }) =>
    post<{ finePaise: number }>(FINES, { action: "waive", ...input }),
};
