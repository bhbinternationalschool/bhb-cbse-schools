"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Library } from "lucide-react";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import {
  addCopy,
  issueBook,
  libraryStats,
  listActiveTitles,
  loadLibrary,
  overdueIssues,
  returnBook,
  upsertTitle,
  type LibraryIssue,
  type LibraryTitle,
} from "@/lib/library";
import { ensureLibraryHydrated } from "@/lib/libraryPersistence";
import { formatInr } from "@/lib/masters";
import { loadSis } from "@/lib/sis";
import { useDemoSession } from "@/components/shell/SessionContext";

type LibTab = "desk" | "catalog" | "overdue" | "reports";

export function LibraryWorkspace() {
  const session = useDemoSession();
  const [tab, setTab] = useState<LibTab>("desk");
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [accession, setAccession] = useState("");
  const [studentQuery, setStudentQuery] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");

  useEffect(() => {
    void ensureLibraryHydrated().then((changed) => {
      if (changed) setTick((n) => n + 1);
    });
  }, []);

  const state = useMemo(() => {
    void tick;
    return loadLibrary();
  }, [tick]);

  const sis = useMemo(() => loadSis(), [tick]);
  const stats = libraryStats(state);
  const titles = listActiveTitles(state);
  const overdue = overdueIssues(state);

  const studentHits = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return sis.students
      .filter((s) => s.status === "active")
      .filter(
        (s) =>
          s.fullName.toLowerCase().includes(q) ||
          s.admissionNo.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [sis.students, studentQuery]);

  function refresh(msg?: string) {
    setTick((n) => n + 1);
    if (msg) setNotice(msg);
  }

  function handleIssue() {
    const copy = state.copies.find(
      (c) =>
        c.accessionNo === accession.trim() ||
        c.barcode === accession.trim(),
    );
    if (!copy) {
      setNotice("Accession / barcode not found");
      return;
    }
    if (!selectedStudentId) {
      setNotice("Select a student");
      return;
    }
    const result = issueBook({
      copyId: copy.id,
      studentId: selectedStudentId,
      academicYearCode: session.academicYearCode,
      issuedBy: session.fullName,
    });
    if (!result.ok) {
      setNotice(result.reason);
      return;
    }
    setAccession("");
    refresh(`Issued · due ${result.issue.dueOn}`);
  }

  function handleReturn(issue: LibraryIssue) {
    const result = returnBook({ issueId: issue.id });
    if (!result.ok) {
      setNotice(result.reason);
      return;
    }
  refresh(
      result.issue.finePaise
        ? `Returned · fine ${formatInr(result.issue.finePaise)}`
        : "Returned",
    );
  }

  function seedDemoTitle() {
    const t = upsertTitle({
      title: "NCERT Mathematics Class VIII",
      author: "NCERT",
      isbn: "978-81-7450-814-0",
      publisher: "NCERT",
      category: "textbook",
      shelf: "A-12",
      copiesTotal: 1,
      isActive: true,
    });
    addCopy({ titleId: t.id, accessionNo: `LIB-${Date.now().toString().slice(-5)}` });
    refresh("Demo title added");
  }

  return (
    <ErpWorkspaceShell
      title="Library"
      subtitle={`${stats.titles} titles · ${stats.issued} issued · ${stats.overdue} overdue`}
      icon={<Library className="size-6" aria-hidden />}
      notice={notice}
      actions={
        <button
          type="button"
          onClick={seedDemoTitle}
          className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]"
        >
          + Demo book
        </button>
      }
    >
        <ModuleTabs
          value={tab}
          onChange={(id) => setTab(id as LibTab)}
          items={[
            { id: "desk", label: "Issue / Return" },
            { id: "catalog", label: "Catalog" },
            { id: "overdue", label: "Overdue" },
            { id: "reports", label: "Reports" },
          ]}
        />

        {tab === "desk" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-4">
              <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
                Issue book
              </h2>
              <label className="mt-3 block text-xs text-[var(--muted)]">
                Accession / barcode
                <input
                  value={accession}
                  onChange={(e) => setAccession(e.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  placeholder="Scan or type"
                />
              </label>
              <label className="mt-3 block text-xs text-[var(--muted)]">
                Student
                <input
                  value={studentQuery}
                  onChange={(e) => setStudentQuery(e.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  placeholder="Name or admission no"
                />
              </label>
              {studentHits.length > 0 ? (
                <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg border text-sm">
                  {studentHits.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedStudentId(s.id);
                          setStudentQuery(s.fullName);
                        }}
                        className={`w-full px-3 py-2 text-left hover:bg-[rgba(32,48,80,0.04)] ${
                          selectedStudentId === s.id ? "bg-[rgba(197,160,40,0.12)]" : ""
                        }`}
                      >
                        {s.fullName} · {s.admissionNo}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <button
                type="button"
                onClick={handleIssue}
                className="mt-4 rounded-lg bg-[var(--brand-deep)] px-4 py-2 text-sm font-semibold text-white"
              >
                Issue
              </button>
            </div>

            <div className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-4">
              <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
                Open loans
              </h2>
              <ErpTableShell className="mt-3">
                <ul className="divide-y divide-[rgba(32,48,80,0.08)] text-sm">
                {state.issues
                  .filter((i) => !i.returnedOn)
                  .slice(0, 12)
                  .map((issue) => {
                    const st = sis.students.find((s) => s.id === issue.studentId);
                    const copy = state.copies.find((c) => c.id === issue.copyId);
                    const title = titles.find((t) => t.id === copy?.titleId);
                    return (
                      <li
                        key={issue.id}
                        className="flex items-center justify-between gap-2 px-4 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{title?.title || "Book"}</p>
                          <p className="text-xs text-[var(--muted)]">
                            {st?.fullName} · due {issue.dueOn}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleReturn(issue)}
                          className="shrink-0 text-xs font-semibold text-[var(--brand-deep)] underline"
                        >
                          Return
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </ErpTableShell>
            </div>
          </div>
        ) : null}

        {tab === "catalog" ? (
          <ErpTableShell>
            <div className="overflow-x-auto">
              <ErpTable minWidth="min-w-full">
                <ErpTableHead>
                  <tr>
                    <th className="px-4 py-2.5 font-bold">Title</th>
                    <th className="px-4 py-2.5 font-bold">Author</th>
                    <th className="px-4 py-2.5 font-bold">Shelf</th>
                    <th className="px-4 py-2.5 font-bold">Copies</th>
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {titles.map((t: LibraryTitle) => (
                    <tr key={t.id} className="hover:bg-[rgba(32,48,80,0.02)]">
                      <td className="px-4 py-2 font-medium">{t.title}</td>
                      <td className="px-4 py-2">{t.author}</td>
                      <td className="px-4 py-2">{t.shelf}</td>
                      <td className="px-4 py-2">{t.copiesTotal}</td>
                    </tr>
                  ))}
                </ErpTableBody>
              </ErpTable>
            </div>
          </ErpTableShell>
        ) : null}

        {tab === "overdue" ? (
          overdue.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No overdue books</p>
          ) : (
            <ErpTableShell>
              <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
              {overdue.map((issue) => {
                const st = sis.students.find((s) => s.id === issue.studentId);
                return (
                  <li
                    key={issue.id}
                    className="px-4 py-3 text-sm"
                  >
                    <span className="font-medium">{st?.fullName}</span>
                    <span className="text-[var(--muted)]"> · due {issue.dueOn}</span>
                    <Link
                      href="/comms"
                      className="ml-2 text-xs font-semibold text-[var(--brand-deep)] underline"
                    >
                      Remind on WA
                    </Link>
                  </li>
                );
              })}
              </ul>
            </ErpTableShell>
          )
        ) : null}

        {tab === "reports" ? (
          <p className="text-sm text-[var(--muted)]">
            Export overdue list from Reports Center (library catalog coming next sprint).
          </p>
        ) : null}
    </ErpWorkspaceShell>
  );
}
