/**
 * Library lending — titles, copies, issues (localStorage + optional Supabase).
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { TENANT } from "@/lib/types";

export type LibraryCopyStatus =
  | "available"
  | "issued"
  | "lost"
  | "damaged"
  | "reserved";

export type LibraryTitle = {
  id: string;
  isbn: string;
  title: string;
  author: string;
  publisher: string;
  category: string;
  shelf: string;
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
  studentId: string;
  academicYearCode: string;
  issuedOn: string;
  dueOn: string;
  returnedOn?: string;
  finePaise: number;
  issuedBy: string;
  note: string;
};

export type LibraryState = {
  version: 1;
  titles: LibraryTitle[];
  copies: LibraryCopy[];
  issues: LibraryIssue[];
  settings: {
    maxBooksPerStudent: number;
    loanDays: number;
    finePaisePerDay: number;
  };
};

const STORAGE_KEY = "bhb_library_v1";

let serverLibraryCache: LibraryState | null = null;

function id(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyLibraryState(): LibraryState {
  return {
    version: 1,
    titles: [],
    copies: [],
    issues: [],
    settings: {
      maxBooksPerStudent: 2,
      loanDays: 14,
      finePaisePerDay: 500,
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
    const parsed = JSON.parse(raw) as LibraryState;
    if (parsed?.version !== 1) return emptyLibraryState();
    return {
      ...emptyLibraryState(),
      ...parsed,
      titles: parsed.titles ?? [],
      copies: parsed.copies ?? [],
      issues: parsed.issues ?? [],
    };
  } catch {
    return emptyLibraryState();
  }
}

export function writeLibraryLocalRaw(state: LibraryState) {
  if (typeof window === "undefined") {
    serverLibraryCache = state;
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function libraryStateIsEmpty(state: LibraryState): boolean {
  return (state.titles?.length ?? 0) === 0 && (state.issues?.length ?? 0) === 0;
}

export function saveLibrary(state: LibraryState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  void import("@/lib/libraryPersistence").then((m) => m.scheduleLibrarySync(state));
}

export function listActiveTitles(state = loadLibrary()): LibraryTitle[] {
  return state.titles.filter((t) => t.isActive);
}

export function copiesForTitle(titleId: string, state = loadLibrary()): LibraryCopy[] {
  return state.copies.filter((c) => c.titleId === titleId);
}

export function openIssuesForStudent(studentId: string, state = loadLibrary()): LibraryIssue[] {
  return state.issues.filter((i) => i.studentId === studentId && !i.returnedOn);
}

export function overdueIssues(state = loadLibrary(), asOf = new Date().toISOString().slice(0, 10)) {
  return state.issues.filter((i) => !i.returnedOn && i.dueOn < asOf);
}

export function issueBook(input: {
  copyId: string;
  studentId: string;
  academicYearCode: string;
  issuedBy: string;
  dueOn?: string;
  note?: string;
}): { ok: true; issue: LibraryIssue } | { ok: false; reason: string } {
  assertModulePermission("store", "create");
  const state = loadLibrary();
  const copy = state.copies.find((c) => c.id === input.copyId);
  if (!copy) return { ok: false, reason: "Copy not found" };
  if (copy.status !== "available") return { ok: false, reason: "Copy not available" };

  const open = openIssuesForStudent(input.studentId, state);
  if (open.length >= state.settings.maxBooksPerStudent) {
    return {
      ok: false,
      reason: `Student already has ${state.settings.maxBooksPerStudent} books issued`,
    };
  }

  const issuedOn = new Date().toISOString().slice(0, 10);
  const due = new Date(issuedOn);
  due.setDate(due.getDate() + state.settings.loanDays);
  const dueOn = input.dueOn || due.toISOString().slice(0, 10);

  const issue: LibraryIssue = {
    id: id("libi"),
    copyId: copy.id,
    studentId: input.studentId,
    academicYearCode: input.academicYearCode,
    issuedOn,
    dueOn,
    finePaise: 0,
    issuedBy: input.issuedBy,
    note: input.note || "",
  };

  copy.status = "issued";
  state.issues.push(issue);
  saveLibrary(state);
  return { ok: true, issue };
}

export function returnBook(input: {
  issueId: string;
  returnedOn?: string;
  finePaise?: number;
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

  const copy = state.copies.find((c) => c.id === issue.copyId);
  if (copy) copy.status = "available";

  saveLibrary(state);
  return { ok: true, issue };
}

export function upsertTitle(
  input: Omit<LibraryTitle, "id"> & { id?: string },
): LibraryTitle {
  assertModulePermission("store", "edit");
  const state = loadLibrary();
  const row: LibraryTitle = {
    id: input.id || id("libt"),
    isbn: input.isbn || "",
    title: input.title,
    author: input.author || "",
    publisher: input.publisher || "",
    category: input.category || "general",
    shelf: input.shelf || "",
    copiesTotal: input.copiesTotal || 1,
    isActive: input.isActive !== false,
  };
  const idx = state.titles.findIndex((t) => t.id === row.id);
  if (idx >= 0) state.titles[idx] = row;
  else state.titles.push(row);
  saveLibrary(state);
  return row;
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

export function libraryStats(state = loadLibrary()) {
  const titles = state.titles.filter((t) => t.isActive).length;
  const copies = state.copies.length;
  const issued = state.issues.filter((i) => !i.returnedOn).length;
  const overdue = overdueIssues(state).length;
  return { titles, copies, issued, overdue, school: TENANT.shortName };
}
