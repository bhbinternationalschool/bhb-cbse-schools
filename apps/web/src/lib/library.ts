/**
 * Library lending — titles, copies, issues, procurement (localStorage + optional Supabase).
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import {
  describeFilters,
  exportFilterReport,
  type ReportColumn,
} from "@/lib/reportExport";
import { TENANT } from "@/lib/types";

export type LibraryCopyStatus =
  | "available"
  | "issued"
  | "lost"
  | "damaged"
  | "reserved";

export type LibraryCategory =
  | "book"
  | "magazine"
  | "newspaper"
  | "project"
  | "other";

export type LibraryItemCondition = "good" | "fair" | "damaged" | "torn";

export type LibraryBorrowerType = "student" | "staff";

export const LIBRARY_CATEGORIES: { id: LibraryCategory; label: string }[] = [
  { id: "book", label: "Book" },
  { id: "magazine", label: "Magazine" },
  { id: "newspaper", label: "Newspaper" },
  { id: "project", label: "Project / reference" },
  { id: "other", label: "Other" },
];

export const LIBRARY_CONDITIONS: { id: LibraryItemCondition; label: string }[] = [
  { id: "good", label: "Good" },
  { id: "fair", label: "Fair / worn" },
  { id: "damaged", label: "Damaged" },
  { id: "torn", label: "Torn" },
];

export type LibraryTitle = {
  id: string;
  isbn: string;
  title: string;
  author: string;
  publisher: string;
  edition: string;
  category: LibraryCategory;
  /** Rack / shelf location */
  shelf: string;
  purchaseDate: string;
  pricePaise: number;
  copiesTotal: number;
  isActive: boolean;
};

export type LibraryCopy = {
  id: string;
  titleId: string;
  accessionNo: string;
  barcode: string;
  status: LibraryCopyStatus;
};

export type LibraryIssue = {
  id: string;
  copyId: string;
  borrowerType: LibraryBorrowerType;
  studentId: string;
  staffId: string;
  academicYearCode: string;
  issuedOn: string;
  dueOn: string;
  returnedOn?: string;
  finePaise: number;
  issuedBy: string;
  note: string;
  issueCondition: LibraryItemCondition;
  returnCondition?: LibraryItemCondition;
  damageNoteOnIssue: string;
  damageNoteOnReturn: string;
};

export type LibraryProcurementDoc = {
  id: string;
  label: string;
  vendor: string;
  billNo: string;
  purchaseDate: string;
  amountPaise: number;
  fileName: string;
  mimeType: string;
  fileUrl: string;
  size: number;
  uploadedAt: string;
  note: string;
  ocrJson?: Record<string, unknown>;
};

export type LibraryState = {
  version: 2;
  titles: LibraryTitle[];
  copies: LibraryCopy[];
  issues: LibraryIssue[];
  procurementDocs: LibraryProcurementDoc[];
  settings: {
    maxBooksPerStudent: number;
    maxBooksPerStaff: number;
    loanDays: number;
    finePaisePerDay: number;
  };
};

export type LibraryReportId =
  | "catalog"
  | "open_loans"
  | "transaction_history"
  | "overdue"
  | "issued_by_category"
  | "stock_by_shelf"
  | "damaged_copies"
  | "borrower_ledger_student"
  | "borrower_ledger_staff"
  | "fines_summary"
  | "procurement_register"
  | "copy_register"
  | "returns_in_period"
  | "never_returned_lost";

export type LibraryReportFormat = "excel" | "pdf";

export type LibraryReportCategory =
  | "Catalogue"
  | "Circulation"
  | "Borrowers"
  | "Stock"
  | "Finance"
  | "Procurement";

export const LIBRARY_REPORT_GROUPS: {
  category: LibraryReportCategory;
  reports: { id: LibraryReportId; label: string; hint?: string; dateRange?: boolean }[];
}[] = [
  {
    category: "Catalogue",
    reports: [
      { id: "catalog", label: "Catalogue", hint: "All active titles with stock" },
      { id: "copy_register", label: "Copy register", hint: "Every copy with accession and status" },
      {
        id: "issued_by_category",
        label: "Stock by category",
        hint: "Title and copy counts per category",
      },
      { id: "stock_by_shelf", label: "Stock by shelf", hint: "Rack-wise copy summary" },
    ],
  },
  {
    category: "Circulation",
    reports: [
      { id: "open_loans", label: "Open loans", hint: "Currently issued items" },
      { id: "overdue", label: "Overdue", hint: "Past due date, not returned" },
      {
        id: "transaction_history",
        label: "Issue / return history",
        hint: "All transactions in range",
        dateRange: true,
      },
      {
        id: "returns_in_period",
        label: "Returns in period",
        hint: "Books returned in date range with condition",
        dateRange: true,
      },
      {
        id: "never_returned_lost",
        label: "Never returned / lost",
        hint: "Long overdue or lost-copy candidates",
      },
    ],
  },
  {
    category: "Borrowers",
    reports: [
      {
        id: "borrower_ledger_student",
        label: "Student borrower ledger",
        hint: "Per-student issue history in range",
        dateRange: true,
      },
      {
        id: "borrower_ledger_staff",
        label: "Staff borrower ledger",
        hint: "Per-staff issue history in range",
        dateRange: true,
      },
    ],
  },
  {
    category: "Stock",
    reports: [
      {
        id: "damaged_copies",
        label: "Damaged copies",
        hint: "Copies or issues marked damaged / torn",
      },
    ],
  },
  {
    category: "Finance",
    reports: [
      {
        id: "fines_summary",
        label: "Fines summary",
        hint: "Fines collected in date range",
        dateRange: true,
      },
    ],
  },
  {
    category: "Procurement",
    reports: [
      {
        id: "procurement_register",
        label: "Procurement register",
        hint: "All bills/challans with amounts",
        dateRange: true,
      },
    ],
  },
];

/** Flat list for backward-compatible selects */
export const LIBRARY_REPORTS = LIBRARY_REPORT_GROUPS.flatMap((g) => g.reports);

export function libraryReportNeedsDateRange(reportId: LibraryReportId): boolean {
  return LIBRARY_REPORTS.some((r) => r.id === reportId && r.dateRange);
}

const STORAGE_KEY = "bhb_library_v1";

let serverLibraryCache: LibraryState | null = null;

function id(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeCategory(raw: string | undefined): LibraryCategory {
  const v = (raw || "").toLowerCase();
  if (v === "magazine") return "magazine";
  if (v === "newspaper") return "newspaper";
  if (v === "project") return "project";
  if (v === "other") return "other";
  return "book";
}

function normalizeCondition(raw: string | undefined): LibraryItemCondition {
  const v = (raw || "").toLowerCase();
  if (v === "fair") return "fair";
  if (v === "damaged") return "damaged";
  if (v === "torn") return "torn";
  return "good";
}

function normalizeTitle(row: Partial<LibraryTitle> & { id: string }): LibraryTitle {
  return {
    id: row.id,
    isbn: row.isbn || "",
    title: row.title || "",
    author: row.author || "",
    publisher: row.publisher || "",
    edition: row.edition || "",
    category: normalizeCategory(row.category),
    shelf: row.shelf || "",
    purchaseDate: row.purchaseDate || "",
    pricePaise: row.pricePaise ?? 0,
    copiesTotal: row.copiesTotal ?? 1,
    isActive: row.isActive !== false,
  };
}

function normalizeIssue(row: Partial<LibraryIssue> & { id: string; copyId: string }): LibraryIssue {
  const borrowerType: LibraryBorrowerType =
    row.borrowerType === "staff" || (row.staffId && !row.studentId)
      ? "staff"
      : "student";
  return {
    id: row.id,
    copyId: row.copyId,
    borrowerType,
    studentId: borrowerType === "student" ? row.studentId || "" : "",
    staffId: borrowerType === "staff" ? row.staffId || "" : "",
    academicYearCode: row.academicYearCode || "",
    issuedOn: row.issuedOn || new Date().toISOString().slice(0, 10),
    dueOn: row.dueOn || new Date().toISOString().slice(0, 10),
    returnedOn: row.returnedOn,
    finePaise: row.finePaise ?? 0,
    issuedBy: row.issuedBy || "",
    note: row.note || "",
    issueCondition: normalizeCondition(row.issueCondition),
    returnCondition: row.returnCondition
      ? normalizeCondition(row.returnCondition)
      : undefined,
    damageNoteOnIssue: row.damageNoteOnIssue || "",
    damageNoteOnReturn: row.damageNoteOnReturn || "",
  };
}

export function emptyLibraryState(): LibraryState {
  return {
    version: 2,
    titles: [],
    copies: [],
    issues: [],
    procurementDocs: [],
    settings: {
      maxBooksPerStudent: 2,
      maxBooksPerStaff: 3,
      loanDays: 14,
      finePaisePerDay: 500,
    },
  };
}

function migrateLibraryState(raw: unknown): LibraryState {
  const base = emptyLibraryState();
  if (!raw || typeof raw !== "object") return base;
  const parsed = raw as Record<string, unknown>;
  const settings = (parsed.settings as LibraryState["settings"] | undefined) ?? base.settings;

  return {
    version: 2,
    titles: Array.isArray(parsed.titles)
      ? parsed.titles.map((t) =>
          normalizeTitle(t as Partial<LibraryTitle> & { id: string }),
        )
      : [],
    copies: Array.isArray(parsed.copies)
      ? (parsed.copies as LibraryCopy[]).map((c) => ({
          id: String(c.id),
          titleId: String(c.titleId),
          accessionNo: String(c.accessionNo || ""),
          barcode: String(c.barcode || c.accessionNo || ""),
          status:
            c.status === "issued" ||
            c.status === "lost" ||
            c.status === "damaged" ||
            c.status === "reserved"
              ? c.status
              : "available",
        }))
      : [],
    issues: Array.isArray(parsed.issues)
      ? parsed.issues.map((i) =>
          normalizeIssue(i as Partial<LibraryIssue> & { id: string; copyId: string }),
        )
      : [],
    procurementDocs: Array.isArray(parsed.procurementDocs)
      ? (parsed.procurementDocs as LibraryProcurementDoc[])
      : [],
    settings: {
      maxBooksPerStudent: settings.maxBooksPerStudent ?? 2,
      maxBooksPerStaff: settings.maxBooksPerStaff ?? 3,
      loanDays: settings.loanDays ?? 14,
      finePaisePerDay: settings.finePaisePerDay ?? 500,
    },
  };
}

export function loadLibrary(): LibraryState {
  if (typeof window === "undefined") {
    if (serverLibraryCache) return serverLibraryCache;
    return emptyLibraryState();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyLibraryState();
    return migrateLibraryState(JSON.parse(raw));
  } catch {
    return emptyLibraryState();
  }
}

export function writeLibraryLocalRaw(state: LibraryState) {
  const normalized = migrateLibraryState(state);
  if (typeof window === "undefined") {
    serverLibraryCache = normalized;
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

export function libraryStateIsEmpty(state: LibraryState): boolean {
  return (
    (state.titles?.length ?? 0) === 0 &&
    (state.issues?.length ?? 0) === 0 &&
    (state.procurementDocs?.length ?? 0) === 0
  );
}

export function saveLibrary(state: LibraryState) {
  const normalized = migrateLibraryState(state);
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  void import("@/lib/libraryPersistence").then((m) => m.scheduleLibrarySync(normalized));
}

export function categoryLabel(category: LibraryCategory): string {
  return LIBRARY_CATEGORIES.find((c) => c.id === category)?.label ?? category;
}

export function conditionLabel(condition: LibraryItemCondition | undefined): string {
  if (!condition) return "—";
  return LIBRARY_CONDITIONS.find((c) => c.id === condition)?.label ?? condition;
}

export function listActiveTitles(state = loadLibrary()): LibraryTitle[] {
  return state.titles.filter((t) => t.isActive);
}

export function copiesForTitle(titleId: string, state = loadLibrary()): LibraryCopy[] {
  return state.copies.filter((c) => c.titleId === titleId);
}

export function availableCopiesForTitle(titleId: string, state = loadLibrary()): LibraryCopy[] {
  return copiesForTitle(titleId, state).filter((c) => c.status === "available");
}

export function availableCountForTitle(titleId: string, state = loadLibrary()): number {
  return availableCopiesForTitle(titleId, state).length;
}

export function issuedCountForTitle(titleId: string, state = loadLibrary()): number {
  const openCopyIds = new Set(
    state.issues.filter((i) => !i.returnedOn).map((i) => i.copyId),
  );
  return copiesForTitle(titleId, state).filter((c) => openCopyIds.has(c.id)).length;
}

export function openIssuesForBorrower(
  borrowerType: LibraryBorrowerType,
  borrowerId: string,
  state = loadLibrary(),
): LibraryIssue[] {
  return state.issues.filter((i) => {
    if (i.returnedOn) return false;
    if (borrowerType === "student") return i.borrowerType === "student" && i.studentId === borrowerId;
    return i.borrowerType === "staff" && i.staffId === borrowerId;
  });
}

/** @deprecated use openIssuesForBorrower */
export function openIssuesForStudent(studentId: string, state = loadLibrary()): LibraryIssue[] {
  return openIssuesForBorrower("student", studentId, state);
}

export function overdueIssues(state = loadLibrary(), asOf = new Date().toISOString().slice(0, 10)) {
  return state.issues.filter((i) => !i.returnedOn && i.dueOn < asOf);
}

function nextAccessionNo(state: LibraryState, titleId: string): string {
  const title = state.titles.find((t) => t.id === titleId);
  const prefix = (title?.isbn || title?.title || "LIB")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 6)
    .toUpperCase();
  const existing = new Set(state.copies.map((c) => c.accessionNo));
  let n = state.copies.length + 1;
  while (existing.has(`${prefix}-${String(n).padStart(4, "0")}`)) n += 1;
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

function syncCopiesForTitle(state: LibraryState, titleId: string, target: number) {
  const copies = copiesForTitle(titleId, state);
  const openCopyIds = new Set(
    state.issues.filter((i) => !i.returnedOn).map((i) => i.copyId),
  );
  const current = copies.length;

  if (target > current) {
    for (let i = 0; i < target - current; i += 1) {
      const accessionNo = nextAccessionNo(state, titleId);
      state.copies.push({
        id: id("libc"),
        titleId,
        accessionNo,
        barcode: accessionNo,
        status: "available",
      });
    }
  } else if (target < current) {
    const removable = copies
      .filter((c) => c.status === "available" && !openCopyIds.has(c.id))
      .slice(0, current - target);
    const removeIds = new Set(removable.map((c) => c.id));
    state.copies = state.copies.filter((c) => !removeIds.has(c.id));
  }

  const title = state.titles.find((t) => t.id === titleId);
  if (title) title.copiesTotal = copiesForTitle(titleId, state).length;
}

export function issueBook(input: {
  copyId?: string;
  titleId?: string;
  accessionOrBarcode?: string;
  borrowerType: LibraryBorrowerType;
  studentId?: string;
  staffId?: string;
  academicYearCode: string;
  issuedBy: string;
  issuedOn?: string;
  dueOn?: string;
  note?: string;
  issueCondition?: LibraryItemCondition;
  damageNoteOnIssue?: string;
}):
  | { ok: true; issue: LibraryIssue }
  | { ok: false; reason: string } {
  assertModulePermission("store", "create");
  const state = loadLibrary();

  let copy: LibraryCopy | undefined;
  if (input.copyId) {
    copy = state.copies.find((c) => c.id === input.copyId);
  } else if (input.accessionOrBarcode?.trim()) {
    const key = input.accessionOrBarcode.trim();
    copy = state.copies.find((c) => c.accessionNo === key || c.barcode === key);
  } else if (input.titleId) {
    copy = availableCopiesForTitle(input.titleId, state)[0];
  }
  if (!copy) return { ok: false, reason: "Copy not found or not available" };
  if (copy.status !== "available") return { ok: false, reason: "Copy not available" };

  if (input.borrowerType === "student") {
    if (!input.studentId) return { ok: false, reason: "Select a student" };
    const open = openIssuesForBorrower("student", input.studentId, state);
    if (open.length >= state.settings.maxBooksPerStudent) {
      return {
        ok: false,
        reason: `Student already has ${state.settings.maxBooksPerStudent} books issued`,
      };
    }
  } else {
    if (!input.staffId) return { ok: false, reason: "Select a staff member" };
    const open = openIssuesForBorrower("staff", input.staffId, state);
    if (open.length >= state.settings.maxBooksPerStaff) {
      return {
        ok: false,
        reason: `Staff member already has ${state.settings.maxBooksPerStaff} books issued`,
      };
    }
  }

  const issuedOn = input.issuedOn || new Date().toISOString().slice(0, 10);
  const due = new Date(issuedOn);
  due.setDate(due.getDate() + state.settings.loanDays);
  const dueOn = input.dueOn || due.toISOString().slice(0, 10);

  const issue: LibraryIssue = {
    id: id("libi"),
    copyId: copy.id,
    borrowerType: input.borrowerType,
    studentId: input.borrowerType === "student" ? input.studentId || "" : "",
    staffId: input.borrowerType === "staff" ? input.staffId || "" : "",
    academicYearCode: input.academicYearCode,
    issuedOn,
    dueOn,
    finePaise: 0,
    issuedBy: input.issuedBy,
    note: input.note || "",
    issueCondition: input.issueCondition || "good",
    damageNoteOnIssue: input.damageNoteOnIssue || "",
    damageNoteOnReturn: "",
  };

  copy.status = "issued";
  if (issue.issueCondition === "damaged" || issue.issueCondition === "torn") {
    copy.status = "damaged";
  }
  state.issues.push(issue);
  saveLibrary(state);
  return { ok: true, issue };
}

export function returnBook(input: {
  issueId: string;
  returnedOn?: string;
  finePaise?: number;
  returnCondition?: LibraryItemCondition;
  damageNoteOnReturn?: string;
}): { ok: true; issue: LibraryIssue } | { ok: false; reason: string } {
  assertModulePermission("store", "edit");
  const state = loadLibrary();
  const issue = state.issues.find((i) => i.id === input.issueId);
  if (!issue) return { ok: false, reason: "Issue record not found" };
  if (issue.returnedOn) return { ok: false, reason: "Already returned" };

  const returnedOn = input.returnedOn || new Date().toISOString().slice(0, 10);
  let finePaise = input.finePaise ?? 0;
  if (finePaise === 0 && returnedOn > issue.dueOn) {
    const days = Math.ceil(
      (new Date(returnedOn).getTime() - new Date(issue.dueOn).getTime()) /
        86_400_000,
    );
    finePaise = days * state.settings.finePaisePerDay;
  }

  issue.returnedOn = returnedOn;
  issue.finePaise = finePaise;
  issue.returnCondition = input.returnCondition || "good";
  issue.damageNoteOnReturn = input.damageNoteOnReturn || "";

  const copy = state.copies.find((c) => c.id === issue.copyId);
  if (copy) {
    const cond = issue.returnCondition;
    copy.status =
      cond === "damaged" || cond === "torn" ? "damaged" : "available";
  }

  saveLibrary(state);
  return { ok: true, issue };
}

export function upsertTitle(
  input: Omit<LibraryTitle, "id"> & { id?: string },
): LibraryTitle {
  assertModulePermission("store", "edit");
  const state = loadLibrary();
  const row = normalizeTitle({
    id: input.id || id("libt"),
    isbn: input.isbn || "",
    title: input.title,
    author: input.author || "",
    publisher: input.publisher || "",
    edition: input.edition || "",
    category: input.category || "book",
    shelf: input.shelf || "",
    purchaseDate: input.purchaseDate || "",
    pricePaise: input.pricePaise ?? 0,
    copiesTotal: input.copiesTotal || 1,
    isActive: input.isActive !== false,
  });

  const idx = state.titles.findIndex((t) => t.id === row.id);
  if (idx >= 0) state.titles[idx] = row;
  else state.titles.push(row);

  const targetCopies = Math.max(1, row.copiesTotal);
  syncCopiesForTitle(state, row.id, targetCopies);
  row.copiesTotal = copiesForTitle(row.id, state).length;

  saveLibrary(state);
  return row;
}

export function deleteTitle(titleId: string): { ok: true } | { ok: false; reason: string } {
  assertModulePermission("store", "delete");
  const state = loadLibrary();
  const title = state.titles.find((t) => t.id === titleId);
  if (!title) return { ok: false, reason: "Title not found" };

  const open = state.issues.some((i) => {
    if (i.returnedOn) return false;
    const copy = state.copies.find((c) => c.id === i.copyId);
    return copy?.titleId === titleId;
  });
  if (open) return { ok: false, reason: "Cannot delete — copies are currently issued" };

  state.titles = state.titles.filter((t) => t.id !== titleId);
  state.copies = state.copies.filter((c) => c.titleId !== titleId);
  saveLibrary(state);
  return { ok: true };
}

export function addCopy(input: {
  titleId: string;
  accessionNo: string;
  barcode?: string;
}): LibraryCopy {
  assertModulePermission("store", "create");
  const state = loadLibrary();
  const copy: LibraryCopy = {
    id: id("libc"),
    titleId: input.titleId,
    accessionNo: input.accessionNo,
    barcode: input.barcode || input.accessionNo,
    status: "available",
  };
  state.copies.push(copy);
  const title = state.titles.find((t) => t.id === input.titleId);
  if (title) title.copiesTotal = copiesForTitle(input.titleId, state).length;
  saveLibrary(state);
  return copy;
}

export function upsertProcurementDoc(
  input: Omit<LibraryProcurementDoc, "id" | "uploadedAt"> & {
    id?: string;
    uploadedAt?: string;
  },
): LibraryProcurementDoc {
  assertModulePermission("store", "edit");
  const state = loadLibrary();
  const row: LibraryProcurementDoc = {
    id: input.id || id("libd"),
    label: input.label || "Procurement bill",
    vendor: input.vendor || "",
    billNo: input.billNo || "",
    purchaseDate: input.purchaseDate || "",
    amountPaise: input.amountPaise ?? 0,
    fileName: input.fileName || "",
    mimeType: input.mimeType || "",
    fileUrl: input.fileUrl || "",
    size: input.size ?? 0,
    uploadedAt: input.uploadedAt || new Date().toISOString(),
    note: input.note || "",
  };
  const idx = state.procurementDocs.findIndex((d) => d.id === row.id);
  if (idx >= 0) state.procurementDocs[idx] = row;
  else state.procurementDocs.push(row);
  saveLibrary(state);
  return row;
}

export function deleteProcurementDoc(docId: string): { ok: true } | { ok: false; reason: string } {
  assertModulePermission("store", "delete");
  const state = loadLibrary();
  if (!state.procurementDocs.some((d) => d.id === docId)) {
    return { ok: false, reason: "Document not found" };
  }
  state.procurementDocs = state.procurementDocs.filter((d) => d.id !== docId);
  saveLibrary(state);
  return { ok: true };
}

export function libraryStats(state = loadLibrary()) {
  const titles = state.titles.filter((t) => t.isActive).length;
  const copies = state.copies.length;
  const available = state.copies.filter((c) => c.status === "available").length;
  const issued = state.issues.filter((i) => !i.returnedOn).length;
  const overdue = overdueIssues(state).length;
  const damaged = state.copies.filter((c) => c.status === "damaged").length;
  return { titles, copies, available, issued, overdue, damaged, school: TENANT.shortName };
}

export function borrowerLabel(
  issue: LibraryIssue,
  opts?: {
    students?: { id: string; fullName: string; admissionNo: string }[];
    staff?: { id: string; fullName: string; empCode?: string }[];
  },
): string {
  if (issue.borrowerType === "staff") {
    const s = opts?.staff?.find((x) => x.id === issue.staffId);
    return s ? `${s.fullName}${s.empCode ? ` · ${s.empCode}` : ""}` : issue.staffId || "Staff";
  }
  const st = opts?.students?.find((x) => x.id === issue.studentId);
  return st ? `${st.fullName} · ${st.admissionNo}` : issue.studentId || "Student";
}

export function runLibraryReport(input: {
  reportId: LibraryReportId;
  format: LibraryReportFormat;
  fromDate?: string;
  toDate?: string;
  state?: LibraryState;
  students?: { id: string; fullName: string; admissionNo: string }[];
  staff?: { id: string; fullName: string; empCode?: string }[];
}): { ok: true } | { ok: false; error: string } {
  const state = input.state ?? loadLibrary();
  const from = input.fromDate || "2000-01-01";
  const to = input.toDate || new Date().toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const titles = listActiveTitles(state);
  const titleById = new Map(titles.map((t) => [t.id, t]));
  const labelOpts = { students: input.students, staff: input.staff };

  let columns: ReportColumn[] = [];
  let rows: Record<string, string | number>[] = [];
  let title = "Library report";

  const issueRowBase = (i: LibraryIssue) => {
    const copy = state.copies.find((c) => c.id === i.copyId);
    const t = copy ? titleById.get(copy.titleId) : undefined;
    return {
      title: t?.title || "—",
      accession: copy?.accessionNo || "—",
      borrower: borrowerLabel(i, labelOpts),
      type: i.borrowerType,
      issuedOn: i.issuedOn,
      dueOn: i.dueOn,
      returnedOn: i.returnedOn || "—",
      issueCondition: conditionLabel(i.issueCondition),
      returnCondition: conditionLabel(i.returnCondition),
      fine: (i.finePaise / 100).toFixed(2),
    };
  };

  if (input.reportId === "catalog") {
    title = "Library catalogue";
    columns = [
      { key: "title", header: "Title" },
      { key: "author", header: "Author" },
      { key: "category", header: "Category" },
      { key: "isbn", header: "ISBN" },
      { key: "shelf", header: "Rack" },
      { key: "copies", header: "Copies" },
      { key: "available", header: "Available" },
      { key: "purchaseDate", header: "Purchase date" },
    ];
    rows = titles.map((t) => ({
      title: t.title,
      author: t.author,
      category: categoryLabel(t.category),
      isbn: t.isbn,
      shelf: t.shelf,
      copies: t.copiesTotal,
      available: availableCountForTitle(t.id, state),
      purchaseDate: t.purchaseDate,
    }));
  } else if (input.reportId === "copy_register") {
    title = "Library copy register";
    columns = [
      { key: "accession", header: "Accession" },
      { key: "barcode", header: "Barcode" },
      { key: "title", header: "Title" },
      { key: "category", header: "Category" },
      { key: "shelf", header: "Rack" },
      { key: "status", header: "Status" },
    ];
    rows = state.copies.map((c) => {
      const t = titleById.get(c.titleId);
      return {
        accession: c.accessionNo,
        barcode: c.barcode,
        title: t?.title || "—",
        category: t ? categoryLabel(t.category) : "—",
        shelf: t?.shelf || "—",
        status: c.status,
      };
    });
  } else if (input.reportId === "issued_by_category") {
    title = "Stock by category";
    const counts = new Map<string, { titles: number; copies: number }>();
    for (const t of titles) {
      const key = categoryLabel(t.category);
      const cur = counts.get(key) || { titles: 0, copies: 0 };
      cur.titles += 1;
      cur.copies += copiesForTitle(t.id, state).length;
      counts.set(key, cur);
    }
    columns = [
      { key: "category", header: "Category" },
      { key: "titles", header: "Titles" },
      { key: "copies", header: "Copies" },
    ];
    rows = [...counts.entries()].map(([category, c]) => ({
      category,
      titles: c.titles,
      copies: c.copies,
    }));
  } else if (input.reportId === "stock_by_shelf") {
    title = "Stock by shelf";
    const shelfMap = new Map<
      string,
      { copies: number; available: number; issued: number; damaged: number }
    >();
    for (const c of state.copies) {
      const t = titleById.get(c.titleId);
      const shelf = t?.shelf?.trim() || "(unassigned)";
      const cur = shelfMap.get(shelf) || {
        copies: 0,
        available: 0,
        issued: 0,
        damaged: 0,
      };
      cur.copies += 1;
      if (c.status === "available") cur.available += 1;
      else if (c.status === "issued") cur.issued += 1;
      else if (c.status === "damaged") cur.damaged += 1;
      shelfMap.set(shelf, cur);
    }
    columns = [
      { key: "shelf", header: "Rack / shelf" },
      { key: "copies", header: "Copies" },
      { key: "available", header: "Available" },
      { key: "issued", header: "Issued" },
      { key: "damaged", header: "Damaged" },
    ];
    rows = [...shelfMap.entries()].map(([shelf, s]) => ({
      shelf,
      copies: s.copies,
      available: s.available,
      issued: s.issued,
      damaged: s.damaged,
    }));
  } else if (input.reportId === "damaged_copies") {
    title = "Damaged copies";
    columns = [
      { key: "accession", header: "Accession" },
      { key: "title", header: "Title" },
      { key: "status", header: "Copy status" },
      { key: "condition", header: "Last condition" },
      { key: "note", header: "Damage note" },
    ];
    const damagedCopyIds = new Set(
      state.copies.filter((c) => c.status === "damaged").map((c) => c.id),
    );
    const damagedIssues = state.issues.filter(
      (i) =>
        i.issueCondition === "damaged" ||
        i.issueCondition === "torn" ||
        i.returnCondition === "damaged" ||
        i.returnCondition === "torn",
    );
    for (const i of damagedIssues) damagedCopyIds.add(i.copyId);
    rows = [...damagedCopyIds].map((copyId) => {
      const copy = state.copies.find((c) => c.id === copyId);
      const t = copy ? titleById.get(copy.titleId) : undefined;
      const lastIssue = [...state.issues]
        .filter((i) => i.copyId === copyId)
        .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn))[0];
      const cond = lastIssue?.returnCondition || lastIssue?.issueCondition;
      const note = lastIssue?.damageNoteOnReturn || lastIssue?.damageNoteOnIssue || "";
      return {
        accession: copy?.accessionNo || "—",
        title: t?.title || "—",
        status: copy?.status || "—",
        condition: conditionLabel(cond),
        note,
      };
    });
  } else if (input.reportId === "open_loans" || input.reportId === "overdue") {
    const pool =
      input.reportId === "overdue" ? overdueIssues(state) : state.issues.filter((i) => !i.returnedOn);
    title = input.reportId === "overdue" ? "Overdue loans" : "Open loans";
    columns = [
      { key: "title", header: "Title" },
      { key: "accession", header: "Accession" },
      { key: "borrower", header: "Borrower" },
      { key: "type", header: "Type" },
      { key: "issuedOn", header: "Issued" },
      { key: "dueOn", header: "Due" },
      { key: "condition", header: "Issue condition" },
    ];
    rows = pool.map((i) => {
      const base = issueRowBase(i);
      return {
        title: base.title,
        accession: base.accession,
        borrower: base.borrower,
        type: base.type,
        issuedOn: base.issuedOn,
        dueOn: base.dueOn,
        condition: base.issueCondition,
      };
    });
  } else if (input.reportId === "transaction_history") {
    title = "Library transactions";
    columns = [
      { key: "title", header: "Title" },
      { key: "accession", header: "Accession" },
      { key: "borrower", header: "Borrower" },
      { key: "type", header: "Type" },
      { key: "issuedOn", header: "Issued" },
      { key: "returnedOn", header: "Returned" },
      { key: "issueCondition", header: "Issue condition" },
      { key: "returnCondition", header: "Return condition" },
      { key: "fine", header: "Fine (₹)" },
    ];
    rows = state.issues
      .filter((i) => i.issuedOn >= from && i.issuedOn <= to)
      .map((i) => issueRowBase(i));
  } else if (input.reportId === "returns_in_period") {
    title = "Returns in period";
    columns = [
      { key: "title", header: "Title" },
      { key: "accession", header: "Accession" },
      { key: "borrower", header: "Borrower" },
      { key: "returnedOn", header: "Returned" },
      { key: "returnCondition", header: "Return condition" },
      { key: "damageNote", header: "Damage note" },
      { key: "fine", header: "Fine (₹)" },
    ];
    rows = state.issues
      .filter(
        (i) =>
          i.returnedOn && i.returnedOn >= from && i.returnedOn <= to,
      )
      .map((i) => {
        const base = issueRowBase(i);
        return {
          title: base.title,
          accession: base.accession,
          borrower: base.borrower,
          returnedOn: base.returnedOn,
          returnCondition: base.returnCondition,
          damageNote: i.damageNoteOnReturn || "",
          fine: base.fine,
        };
      });
  } else if (input.reportId === "never_returned_lost") {
    title = "Never returned / lost candidates";
    const longOverdueDays = 30;
    columns = [
      { key: "title", header: "Title" },
      { key: "accession", header: "Accession" },
      { key: "borrower", header: "Borrower" },
      { key: "issuedOn", header: "Issued" },
      { key: "dueOn", header: "Due" },
      { key: "daysOverdue", header: "Days overdue" },
      { key: "copyStatus", header: "Copy status" },
      { key: "reason", header: "Flag" },
    ];
    const candidates: Record<string, string | number>[] = [];
    for (const i of state.issues) {
      if (i.returnedOn) continue;
      const copy = state.copies.find((c) => c.id === i.copyId);
      const t = copy ? titleById.get(copy.titleId) : undefined;
      const daysOverdue =
        today > i.dueOn
          ? Math.ceil(
              (new Date(today).getTime() - new Date(i.dueOn).getTime()) /
                86_400_000,
            )
          : 0;
      const lost = copy?.status === "lost";
      const longOverdue = daysOverdue >= longOverdueDays;
      if (!lost && !longOverdue) continue;
      candidates.push({
        title: t?.title || "—",
        accession: copy?.accessionNo || "—",
        borrower: borrowerLabel(i, labelOpts),
        issuedOn: i.issuedOn,
        dueOn: i.dueOn,
        daysOverdue,
        copyStatus: copy?.status || "—",
        reason: lost ? "Copy marked lost" : `Overdue ${daysOverdue}+ days`,
      });
    }
    rows = candidates;
  } else if (input.reportId === "borrower_ledger_student") {
    title = "Student borrower ledger";
    columns = [
      { key: "student", header: "Student" },
      { key: "title", header: "Title" },
      { key: "accession", header: "Accession" },
      { key: "issuedOn", header: "Issued" },
      { key: "returnedOn", header: "Returned" },
      { key: "fine", header: "Fine (₹)" },
    ];
    rows = state.issues
      .filter(
        (i) =>
          i.borrowerType === "student" &&
          i.issuedOn >= from &&
          i.issuedOn <= to,
      )
      .map((i) => {
        const base = issueRowBase(i);
        return {
          student: base.borrower,
          title: base.title,
          accession: base.accession,
          issuedOn: base.issuedOn,
          returnedOn: base.returnedOn,
          fine: base.fine,
        };
      });
  } else if (input.reportId === "borrower_ledger_staff") {
    title = "Staff borrower ledger";
    columns = [
      { key: "staff", header: "Staff" },
      { key: "title", header: "Title" },
      { key: "accession", header: "Accession" },
      { key: "issuedOn", header: "Issued" },
      { key: "returnedOn", header: "Returned" },
      { key: "fine", header: "Fine (₹)" },
    ];
    rows = state.issues
      .filter(
        (i) =>
          i.borrowerType === "staff" &&
          i.issuedOn >= from &&
          i.issuedOn <= to,
      )
      .map((i) => {
        const base = issueRowBase(i);
        return {
          staff: base.borrower,
          title: base.title,
          accession: base.accession,
          issuedOn: base.issuedOn,
          returnedOn: base.returnedOn,
          fine: base.fine,
        };
      });
  } else if (input.reportId === "fines_summary") {
    title = "Library fines summary";
    columns = [
      { key: "borrower", header: "Borrower" },
      { key: "title", header: "Title" },
      { key: "returnedOn", header: "Returned" },
      { key: "fine", header: "Fine (₹)" },
    ];
    const withFine = state.issues.filter(
      (i) =>
        i.returnedOn &&
        i.returnedOn >= from &&
        i.returnedOn <= to &&
        i.finePaise > 0,
    );
    rows = withFine.map((i) => {
      const base = issueRowBase(i);
      return {
        borrower: base.borrower,
        title: base.title,
        returnedOn: base.returnedOn,
        fine: base.fine,
      };
    });
    if (withFine.length > 0) {
      const totalPaise = withFine.reduce((s, i) => s + i.finePaise, 0);
      rows.push({
        borrower: "TOTAL",
        title: "",
        returnedOn: "",
        fine: (totalPaise / 100).toFixed(2),
      });
    }
  } else if (input.reportId === "procurement_register") {
    title = "Procurement register";
    columns = [
      { key: "label", header: "Label" },
      { key: "vendor", header: "Vendor" },
      { key: "billNo", header: "Bill no." },
      { key: "purchaseDate", header: "Date" },
      { key: "amount", header: "Amount (₹)" },
      { key: "note", header: "Note" },
    ];
    rows = (state.procurementDocs ?? [])
      .filter((d) => {
        const pd = d.purchaseDate || d.uploadedAt.slice(0, 10);
        return pd >= from && pd <= to;
      })
      .map((d) => ({
        label: d.label,
        vendor: d.vendor,
        billNo: d.billNo,
        purchaseDate: d.purchaseDate,
        amount: (d.amountPaise / 100).toFixed(2),
        note: d.note,
      }));
  } else {
    return { ok: false, error: "Unknown report" };
  }

  return exportFilterReport(
    {
      title,
      subtitle: TENANT.shortName,
      filterNote: describeFilters([
        libraryReportNeedsDateRange(input.reportId) && from !== "2000-01-01"
          ? `From ${from}`
          : null,
        libraryReportNeedsDateRange(input.reportId) && to ? `To ${to}` : null,
      ]),
      columns,
      rows,
      fileBaseName: `library_${input.reportId}_${to}`,
    },
    input.format,
  );
}

/** Encode extra issue fields for normalized DB sync (student_id holds staff: prefix). */
export function issueDbStudentId(issue: LibraryIssue): string {
  if (issue.borrowerType === "staff") return `staff:${issue.staffId}`;
  return issue.studentId;
}

export function parseIssueDbStudentId(raw: string): {
  borrowerType: LibraryBorrowerType;
  studentId: string;
  staffId: string;
} {
  if (raw.startsWith("staff:")) {
    return { borrowerType: "staff", studentId: "", staffId: raw.slice(6) };
  }
  return { borrowerType: "student", studentId: raw, staffId: "" };
}

export function serializeIssueNote(issue: LibraryIssue): string {
  const meta = {
    borrowerType: issue.borrowerType,
    staffId: issue.staffId,
    issueCondition: issue.issueCondition,
    returnCondition: issue.returnCondition,
    damageNoteOnIssue: issue.damageNoteOnIssue,
    damageNoteOnReturn: issue.damageNoteOnReturn,
    userNote: issue.note,
  };
  return JSON.stringify(meta);
}

export function parseIssueNote(raw: string): Partial<LibraryIssue> {
  try {
    const p = JSON.parse(raw) as Partial<LibraryIssue> & { userNote?: string };
    if (p && typeof p === "object" && ("issueCondition" in p || "borrowerType" in p)) {
      return {
        borrowerType: p.borrowerType,
        staffId: p.staffId,
        issueCondition: p.issueCondition,
        returnCondition: p.returnCondition,
        damageNoteOnIssue: p.damageNoteOnIssue,
        damageNoteOnReturn: p.damageNoteOnReturn,
        note: p.userNote || "",
      };
    }
  } catch {
    /* legacy plain note */
  }
  return { note: raw };
}
