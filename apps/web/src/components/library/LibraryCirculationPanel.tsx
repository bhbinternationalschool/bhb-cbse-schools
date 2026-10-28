"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import type { RowAction } from "@/components/ui/erp-grid";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import { formatInr } from "@/lib/masters";
import {
  bookCirculation,
  fineRuleOf,
  type BookCirculationRow,
  type LibraryIssue,
  type LibraryState,
} from "@/lib/library";
import { fineToDate, libraryToday } from "@/lib/libraryCounter";
import { computeLateFine } from "@/lib/libraryFine";
import { libraryApi, type CounterLoanDto } from "@/lib/libraryCounterClient";
import { LibraryFineSettle } from "@/components/library/LibraryFineSettle";

type View = "out" | "overdue" | "fines" | "student" | "book";

const VIEWS: { id: View; label: string }[] = [
  { id: "out", label: "Issued now" },
  { id: "overdue", label: "Overdue" },
  { id: "fines", label: "Fines to collect" },
  { id: "student", label: "Student-wise" },
  { id: "book", label: "Book-wise" },
];

type Person = { id: string; label: string; sub: string };

/** The school's calendar day (IST). */
function todayIso() {
  return libraryToday();
}

/** Circulation reports on screen, each exportable: what is out, what is late, who owes. */
export function LibraryCirculationPanel({
  state,
  students,
  staff,
  readOnly,
  onChanged,
  onError,
}: {
  state: LibraryState;
  students: Person[];
  staff: Person[];
  readOnly: boolean;
  onChanged: (msg: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [view, setView] = useState<View>("out");
  const [studentQuery, setStudentQuery] = useState("");
  const [studentId, setStudentId] = useState("");
  const [from, setFrom] = useState(`${todayIso().slice(0, 4)}-04-01`);
  const [to, setTo] = useState(todayIso());
  const [fines, setFines] = useState<CounterLoanDto[] | null>(null);
  const [finesError, setFinesError] = useState<string | null>(null);
  const today = todayIso();
  const rule = fineRuleOf(state);

  const copyById = useMemo(() => new Map(state.copies.map((c) => [c.id, c])), [state.copies]);
  const titleById = useMemo(() => new Map(state.titles.map((t) => [t.id, t])), [state.titles]);
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of students) m.set(`student:${s.id}`, `${s.label}${s.sub ? ` · ${s.sub}` : ""}`);
    for (const s of staff) m.set(`staff:${s.id}`, `${s.label}${s.sub ? ` · ${s.sub}` : ""}`);
    return m;
  }, [students, staff]);

  const who = (i: LibraryIssue) =>
    i.borrowerType === "staff"
      ? nameOf.get(`staff:${i.staffId}`) || `Staff ${i.staffId}`
      : nameOf.get(`student:${i.studentId}`) || `Student ${i.studentId}`;
  const titleOf = (i: LibraryIssue) => titleById.get(copyById.get(i.copyId)?.titleId || "")?.title || "—";
  const accOf = (i: LibraryIssue) => copyById.get(i.copyId)?.accessionNo || "—";

  const loadFines = useCallback(async () => {
    setFines(null);
    setFinesError(null);
    const r = await libraryApi.pendingFines();
    if (!r.ok) setFinesError(r.error);
    else setFines(r.fines);
  }, []);

  useEffect(() => {
    if (view === "fines") void loadFines();
  }, [view, loadFines]);

  const out = useMemo(
    () => state.issues.filter((i) => !i.returnedOn).sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
    [state.issues],
  );
  const overdue = useMemo(() => out.filter((i) => i.dueOn < today), [out, today]);

  const loanCols: DataTableColumn<LibraryIssue>[] = [
    { key: "accession", header: "Accession", value: accOf, sortable: true },
    { key: "title", header: "Title", value: titleOf, sortable: true },
    { key: "borrower", header: "Borrower", value: who, sortable: true },
    { key: "issued", header: "Issued", value: (i) => i.issuedOn, sortable: true },
    { key: "due", header: "Due", value: (i) => i.dueOn, sortable: true },
  ];
  const overdueCols: DataTableColumn<LibraryIssue>[] = [
    ...loanCols,
    {
      key: "late",
      header: "Days late",
      align: "right",
      value: (i) => {
        const r = computeLateFine(rule, i.dueOn, today);
        return r.ok ? r.daysLate : null;
      },
      sortable: true,
    },
    {
      key: "fine",
      header: "Fine to date (₹)",
      align: "right",
      value: (i) => {
        const owed = fineToDate(rule, i, today);
        return owed == null ? "?" : owed / 100;
      },
      render: (i) => {
        const owed = fineToDate(rule, i, today);
        return owed == null ? "?" : formatInr(owed);
      },
      sortable: true,
    },
  ];

  const historyCols: DataTableColumn<LibraryIssue>[] = [
    ...loanCols.filter((c) => c.key !== "borrower"),
    { key: "returned", header: "Returned", value: (i) => i.returnedOn || "Out", sortable: true },
    {
      key: "fine",
      header: "Fine",
      value: (i) => (i.finePaise ? i.finePaise / 100 : 0),
      render: (i) =>
        i.finePaise
          ? `${formatInr(i.finePaise)} · ${i.fineStatus === "collected" ? `paid ${i.fineVoucherNo || ""}` : i.fineStatus === "waived" ? "waived" : "owed"}`
          : "—",
    },
  ];

  const loanActions: RowAction<LibraryIssue>[] = [
    {
      id: "history",
      label: "Borrower's history",
      hidden: (i) => i.borrowerType !== "student",
      onSelect: (i) => {
        setStudentId(i.studentId);
        setView("student");
      },
    },
  ];

  const studentHits = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return students.filter((s) => s.label.toLowerCase().includes(q) || s.sub.toLowerCase().includes(q)).slice(0, 8);
  }, [studentQuery, students]);
  const studentLoans = useMemo(
    () => state.issues.filter((i) => i.borrowerType === "student" && i.studentId === studentId).sort((a, b) => b.issuedOn.localeCompare(a.issuedOn)),
    [state.issues, studentId],
  );

  const bookRows = useMemo(() => bookCirculation(state, from, to), [state, from, to]);
  const bookCols: DataTableColumn<BookCirculationRow>[] = [
    { key: "title", header: "Title", value: (r) => r.title, sortable: true },
    { key: "author", header: "Author", value: (r) => r.author, sortable: true },
    { key: "copies", header: "Copies", align: "right", value: (r) => r.copies, sortable: true },
    { key: "issues", header: "Times issued", align: "right", value: (r) => r.issues, sortable: true },
    { key: "out", header: "Out now", align: "right", value: (r) => r.out, sortable: true },
    { key: "last", header: "Last issued", value: (r) => r.lastIssued || "—", sortable: true },
  ];

  const fineCols: DataTableColumn<CounterLoanDto>[] = [
    { key: "borrower", header: "Borrower", value: (l) => l.borrowerName, sortable: true },
    { key: "title", header: "Book", value: (l) => `${l.title} (${l.accessionNo})`, sortable: true },
    { key: "due", header: "Due", value: (l) => l.dueOn, sortable: true },
    { key: "returned", header: "Returned", value: (l) => l.returnedOn || "", sortable: true },
    { key: "fine", header: "Fine (₹)", align: "right", value: (l) => l.finePaise / 100, render: (l) => formatInr(l.finePaise), sortable: true },
    {
      key: "settle",
      header: "",
      render: (l) => (
        <LibraryFineSettle
          issueId={l.id}
          finePaise={l.finePaise}
          collecting={l.fineStatus === "collecting"}
          readOnly={readOnly}
          onError={onError}
          onDone={async (msg) => {
            await onChanged(msg);
            await loadFines();
          }}
        />
      ),
    },
  ];
  const fineActions: RowAction<CounterLoanDto>[] = [
    {
      id: "student",
      label: "Borrower's history",
      hidden: (l) => l.borrowerType !== "student",
      onSelect: (l) => {
        setStudentId(l.borrowerId);
        setView("student");
      },
    },
  ];

  const selectedStudent = students.find((s) => s.id === studentId);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Issued now", value: String(out.length) },
          { label: "Overdue", value: String(overdue.length) },
          {
            label: "Overdue fines so far",
            value: formatInr(overdue.reduce((s, i) => s + (fineToDate(rule, i, today) ?? 0), 0)),
          },
        ].map((m) => (
          <div key={m.label} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="text-xs text-[var(--muted)]">{m.label}</p>
            <p className="mt-1 text-2xl font-bold text-[var(--brand-deep)]">{m.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Circulation view">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" role="tab" aria-selected={view === v.id} className={view === v.id ? btn : btnOutline} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>

      {view === "out" ? (
        <DataTable columns={loanCols} rows={out} rowKey={(i) => i.id} rowActions={loanActions} exportFileBaseName="library_issued_now" exportTitle="Library — issued now" emptyTitle="Nothing is out" />
      ) : null}

      {view === "overdue" ? (
        <DataTable
          columns={overdueCols}
          rows={overdue}
          rowKey={(i) => i.id}
          rowActions={loanActions}
          exportFileBaseName="library_overdue"
          exportTitle="Library — overdue with fine to date"
          exportFilterNote={`As of ${today}`}
          emptyTitle="Nothing overdue"
        />
      ) : null}

      {view === "fines" ? (
        finesError ? (
          <p className="text-sm text-[var(--danger)]">Could not load the fines: {finesError}</p>
        ) : !fines ? (
          <p className="text-sm text-[var(--muted)]">Loading fines…</p>
        ) : (
          <DataTable
            columns={fineCols}
            rows={fines}
            rowKey={(l) => l.id}
            rowActions={fineActions}
            minWidth="min-w-[64rem]"
            exportFileBaseName="library_fines_owed"
            exportTitle="Library — fines to collect"
            emptyTitle="No fines owed"
          />
        )
      ) : null}

      {view === "student" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input value={studentQuery} onChange={(e) => setStudentQuery(e.target.value)} className={`${field} max-w-xs`} placeholder="Find a student" aria-label="Find a student" />
            {selectedStudent ? (
              <span className="text-sm font-semibold">
                {selectedStudent.label} <span className="text-xs text-[var(--muted)]">{selectedStudent.sub}</span>
              </span>
            ) : null}
          </div>
          {studentHits.length ? (
            <ul className="max-w-md divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
              {studentHits.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-sunken)]"
                    onClick={() => {
                      setStudentId(s.id);
                      setStudentQuery("");
                    }}
                  >
                    {s.label} <span className="text-xs text-[var(--muted)]">{s.sub}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {studentId ? (
            <DataTable
              columns={historyCols}
              rows={studentLoans}
              rowKey={(i) => i.id}
              exportFileBaseName="library_student_history"
              exportTitle={`Library history — ${selectedStudent?.label ?? studentId}`}
              emptyTitle="This student has never borrowed"
            />
          ) : (
            <p className="text-sm text-[var(--muted)]">Choose a student to see every book they have borrowed.</p>
          )}
        </div>
      ) : null}

      {view === "book" ? (
        <DataTable
          columns={bookCols}
          rows={bookRows}
          rowKey={(r) => r.titleId}
          exportFileBaseName="library_book_circulation"
          exportTitle="Library — book-wise circulation"
          exportFilterNote={`${from} to ${to}`}
          emptyTitle="No titles yet"
          toolbar={
            <>
              <label className="text-xs text-[var(--muted)]">
                From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${field} ml-1 w-auto`} />
              </label>
              <label className="text-xs text-[var(--muted)]">
                To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${field} ml-1 w-auto`} />
              </label>
            </>
          }
        />
      ) : null}
    </div>
  );
}
