"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ACCOUNTS_REPORTS,
  runAccountsReport,
  type AccountsReportFormat,
  type AccountsReportId,
} from "@/lib/accountsReportCatalog";
import {
  HOMEWORK_REPORTS,
  runHomeworkReport,
  type HomeworkReportFormat,
  type HomeworkReportId,
} from "@/lib/homework";
import {
  loadAccounts,
  seedAccountsIfEmpty,
} from "@/lib/accountsStore";
import type { AccountsState } from "@/lib/accountsTypes";
import {
  TRANSPORT_REPORTS,
  runTransportReport,
  type TransportReportFormat,
} from "@/lib/transportReportCatalog";
import { loadTransport, migrateDemoFleetToReal, seedTransportIfEmpty } from "@/lib/transport";
import {
  TRUST_REPORTS,
  runTrustReport,
  type TrustReportFormat,
  type TrustReportId,
} from "@/lib/trustReportCatalog";
import { loadTrust, seedTrustIfEmpty } from "@/lib/trust";
import {
  TIMETABLE_REPORTS,
  runTimetableReport,
  type TimetableReportFormat,
  type TimetableReportId,
} from "@/lib/timetableReportCatalog";
import { WEEKDAY_SHORT } from "@/lib/timetable";
import {
  EXAM_REPORTS,
  runExamReport,
  type ExamReportFormat,
  type ExamReportId,
} from "@/lib/examReportCatalog";
import { listAllExamTerms } from "@/lib/exams";
import {
  LIBRARY_REPORT_GROUPS,
  libraryReportNeedsDateRange,
  loadLibrary,
  runLibraryReport,
  type LibraryReportFormat,
  type LibraryReportId,
} from "@/lib/library";
import {
  CERTIFICATES_REPORTS,
  runCertificatesReport,
  type CertificatesReportFormat,
  type CertificatesReportId,
} from "@/lib/certificatesReportCatalog";
import { CERTIFICATE_KINDS, type CertificateKind } from "@/lib/certificates";
import {
  COMMS_REPORTS,
  runCommsReport,
  type CommsReportFormat,
  type CommsReportId,
} from "@/lib/commsReportCatalog";
import type { CommsAudience } from "@/lib/schoolComms";
import { loadMasters } from "@/lib/masters";
import { loadSis } from "@/lib/sis";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Store reports moved into the module that owns the data.
 *
 * They used to be generated here from the browser-held register. They are now
 * run server-side against the stock ledger and the sale documents, so this
 * points at them rather than shipping a second, weaker copy.
 */
export function StoreReportsRunner() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--muted)]">
        Stock register, item margin, sales day book and purchases by vendor are
        run inside Store &amp; purchase, against the live ledger.
      </p>
      <Link href="/inventory?tab=reports" className={btnOutline}>
        Open store reports
      </Link>
    </div>
  );
}

export function AccountsReportsRunner() {
  const [state, setState] = useState<AccountsState | null>(null);
  const [date, setDate] = useState(todayIso);
  const [fromDate, setFromDate] = useState(`${todayIso().slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(todayIso);
  const [asOf, setAsOf] = useState(todayIso);
  const [coaId, setCoaId] = useState("");
  const [format, setFormat] = useState<AccountsReportFormat>("excel");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = seedAccountsIfEmpty();
    setState(s);
    if (!coaId && s.coaAccounts[0]) setCoaId(s.coaAccounts[0].id);
  }, []);

  function run(id: AccountsReportId) {
    const r = runAccountsReport(id, {
      date,
      fromDate,
      toDate,
      asOf,
      coaId,
      format,
      accounts: state ?? loadAccounts(),
    });
    if (!r.ok) {
      setError(r.error);
      setNotice(null);
      return;
    }
    setError(null);
    setNotice(r.message);
  }

  if (!state) {
    return <p className="text-sm text-[var(--muted)]">Loading accounts…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          Date
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          From
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          To
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          As of
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Ledger account
          <select
            className={`${field} mt-1 block min-w-[180px]`}
            value={coaId}
            onChange={(e) => setCoaId(e.target.value)}
          >
            {state.coaAccounts
              .filter((c) => c.isActive)
              .sort((a, b) => a.code.localeCompare(b.code))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          Format
          <select
            className={`${field} mt-1 block`}
            value={format}
            onChange={(e) => setFormat(e.target.value as AccountsReportFormat)}
          >
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <Link href="/accounts?tab=reports" className={btnOutline}>
          Open in Accounts
        </Link>
      </div>
      {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
      {notice ? <p className="text-sm text-[#0f7a4c]">{notice}</p> : null}
      <ul className="space-y-1.5">
        {ACCOUNTS_REPORTS.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-[var(--brand-deep)]">
                {r.label}
              </p>
              {r.hint ? (
                <p className="text-xs text-[var(--muted)]">{r.hint}</p>
              ) : null}
            </div>
            <button type="button" className={btn} onClick={() => run(r.id)}>
              Export
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TransportReportsRunner() {
  const [format, setFormat] = useState<TransportReportFormat>("excel");
  const [date, setDate] = useState(todayIso);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    migrateDemoFleetToReal();
    seedTransportIfEmpty();
  }, []);

  function run(id: (typeof TRANSPORT_REPORTS)[number]["id"]) {
    const r = runTransportReport(id, {
      date,
      format,
      transport: loadTransport(),
      masters: loadMasters(),
      sis: loadSis(),
    });
    if (!r.ok) {
      setError(r.error);
      setNotice(null);
      return;
    }
    setError(null);
    setNotice(r.message);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          Date
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Format
          <select
            className={`${field} mt-1 block`}
            value={format}
            onChange={(e) => setFormat(e.target.value as TransportReportFormat)}
          >
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <Link href="/transport?tab=reports" className={btnOutline}>
          Open in Transport
        </Link>
      </div>
      {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
      {notice ? <p className="text-sm text-[#0f7a4c]">{notice}</p> : null}
      <ul className="space-y-1.5">
        {TRANSPORT_REPORTS.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-[var(--brand-deep)]">
                {r.label}
              </p>
              {r.hint ? (
                <p className="text-xs text-[var(--muted)]">{r.hint}</p>
              ) : null}
            </div>
            <button type="button" className={btn} onClick={() => run(r.id)}>
              Export
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TrustReportsRunner() {
  const [format, setFormat] = useState<TrustReportFormat>("excel");
  const [projectId, setProjectId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projects = useMemo(() => {
    const t = seedTrustIfEmpty();
    return t.projects;
  }, []);

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);

  function run(id: TrustReportId) {
    const r = runTrustReport(id, {
      projectId: projectId || undefined,
      format,
      trust: loadTrust(),
    });
    if (!r.ok) {
      setError(r.error);
      setNotice(null);
      return;
    }
    setError(null);
    setNotice(r.message);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          Project
          <select
            className={`${field} mt-1 block min-w-[14rem]`}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          Format
          <select
            className={`${field} mt-1 block`}
            value={format}
            onChange={(e) => setFormat(e.target.value as TrustReportFormat)}
          >
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <Link href="/trust?tab=reports" className={btnOutline}>
          Open in Trust
        </Link>
      </div>
      {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
      {notice ? <p className="text-sm text-[#0f7a4c]">{notice}</p> : null}
      <ul className="space-y-1.5">
        {TRUST_REPORTS.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-[var(--brand-deep)]">
                {r.label}
              </p>
              {r.hint ? (
                <p className="text-xs text-[var(--muted)]">{r.hint}</p>
              ) : null}
            </div>
            <button type="button" className={btn} onClick={() => run(r.id)}>
              Export
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HomeworkReportsRunner({ ay }: { ay: string }) {
  const [format, setFormat] = useState<HomeworkReportFormat>("excel");
  const [fromDate, setFromDate] = useState(`${todayIso().slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(todayIso);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(id: HomeworkReportId) {
    const r = runHomeworkReport(id, {
      academicYearCode: ay,
      fromDate,
      toDate,
      format,
    });
    if (!r.ok) {
      setError(r.error);
      setNotice(null);
      return;
    }
    setError(null);
    setNotice(r.message);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          From
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          To
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Format
          <select
            className={`${field} mt-1 block`}
            value={format}
            onChange={(e) => setFormat(e.target.value as HomeworkReportFormat)}
          >
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <Link href="/homework?tab=reports" className={btnOutline}>
          Open in Homework
        </Link>
      </div>
      {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
      {notice ? <p className="text-sm text-[#0f7a4c]">{notice}</p> : null}
      <ul className="space-y-1.5">
        {HOMEWORK_REPORTS.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-[var(--brand-deep)]">
                {r.label}
              </p>
              {r.hint ? (
                <p className="text-xs text-[var(--muted)]">{r.hint}</p>
              ) : null}
            </div>
            <button type="button" className={btn} onClick={() => run(r.id)}>
              Export
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExamReportsRunner({ ay }: { ay: string }) {
  const [format, setFormat] = useState<ExamReportFormat>("excel");
  const [examTermId, setExamTermId] = useState("");
  const [classId, setClassId] = useState("");
  const [topN, setTopN] = useState(10);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const terms = useMemo(() => listAllExamTerms(ay), [ay]);
  const classes = useMemo(() => loadMasters().classes.filter((c) => c.isActive), []);

  useEffect(() => {
    if (!examTermId && terms[0]) setExamTermId(terms[0].id);
  }, [examTermId, terms]);

  function run(id: ExamReportId) {
    if (!examTermId) {
      setError("Pick an exam term first");
      setNotice(null);
      return;
    }
    const r = runExamReport(id, {
      examTermId,
      classId: classId || undefined,
      academicYearCode: ay,
      topN,
      format,
    });
    if (!r.ok) {
      setError(r.error);
      setNotice(null);
      return;
    }
    setError(null);
    setNotice(r.message);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          Exam term
          <select
            className={`${field} mt-1 block min-w-[10rem]`}
            value={examTermId}
            onChange={(e) => setExamTermId(e.target.value)}
          >
            <option value="">Select…</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          Class
          <select
            className={`${field} mt-1 block`}
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
          >
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          Toppers per class
          <input
            type="number"
            min={1}
            className={`${field} mt-1 block w-20`}
            value={topN}
            onChange={(e) => setTopN(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Format
          <select
            className={`${field} mt-1 block`}
            value={format}
            onChange={(e) => setFormat(e.target.value as ExamReportFormat)}
          >
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <Link href="/exams?tab=result_reports" className={btnOutline}>
          Open in Exams
        </Link>
      </div>
      {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
      {notice ? <p className="text-sm text-[#0f7a4c]">{notice}</p> : null}
      <ul className="space-y-1.5">
        {EXAM_REPORTS.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-[var(--brand-deep)]">
                {r.label}
              </p>
              {r.hint ? (
                <p className="text-xs text-[var(--muted)]">{r.hint}</p>
              ) : null}
            </div>
            <button type="button" className={btn} onClick={() => run(r.id)}>
              Export
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LibraryReportsRunner() {
  const [format, setFormat] = useState<LibraryReportFormat>("excel");
  const [fromDate, setFromDate] = useState(`${todayIso().slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(todayIso);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(id: LibraryReportId, label: string) {
    const sis = loadSis();
    const masters = loadMasters();
    const r = runLibraryReport({
      reportId: id,
      format,
      fromDate: libraryReportNeedsDateRange(id) ? fromDate : undefined,
      toDate: libraryReportNeedsDateRange(id) ? toDate : undefined,
      state: loadLibrary(),
      students: sis.students.map((s) => ({
        id: s.id,
        fullName: s.fullName,
        admissionNo: s.admissionNo,
      })),
      staff: (masters.staff ?? [])
        .filter((s) => s.status === "active")
        .map((s) => ({ id: s.id, fullName: s.fullName, empCode: s.empCode })),
    });
    if (!r.ok) {
      setError(r.error);
      setNotice(null);
      return;
    }
    setError(null);
    setNotice(`${label} · ${format.toUpperCase()} exported`);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          From (date-range reports)
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          To
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Format
          <select
            className={`${field} mt-1 block`}
            value={format}
            onChange={(e) => setFormat(e.target.value as LibraryReportFormat)}
          >
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <Link href="/library?tab=reports" className={btnOutline}>
          Open in Library
        </Link>
      </div>
      {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
      {notice ? <p className="text-sm text-[#0f7a4c]">{notice}</p> : null}
      {LIBRARY_REPORT_GROUPS.map((g) => (
        <div key={g.category} className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            {g.category}
          </p>
          <ul className="space-y-1.5">
            {g.reports.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--brand-deep)]">
                    {r.label}
                  </p>
                  {r.hint ? (
                    <p className="text-xs text-[var(--muted)]">{r.hint}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={btn}
                  onClick={() => run(r.id, r.label)}
                >
                  Export
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function CertificatesReportsRunner() {
  const [format, setFormat] = useState<CertificatesReportFormat>("excel");
  const [kind, setKind] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState(todayIso);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(id: CertificatesReportId) {
    const r = runCertificatesReport(id, {
      kind: (kind || undefined) as CertificateKind | undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      format,
    });
    if (!r.ok) {
      setError(r.error);
      setNotice(null);
      return;
    }
    setError(null);
    setNotice(r.message);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          Kind
          <select
            className={`${field} mt-1 block`}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">All kinds</option>
            {CERTIFICATE_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          From
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          To
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Format
          <select
            className={`${field} mt-1 block`}
            value={format}
            onChange={(e) => setFormat(e.target.value as CertificatesReportFormat)}
          >
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <Link href="/certificates?tab=reports" className={btnOutline}>
          Open in Certificates
        </Link>
      </div>
      {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
      {notice ? <p className="text-sm text-[#0f7a4c]">{notice}</p> : null}
      <ul className="space-y-1.5">
        {CERTIFICATES_REPORTS.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-[var(--brand-deep)]">
                {r.label}
              </p>
              {r.hint ? (
                <p className="text-xs text-[var(--muted)]">{r.hint}</p>
              ) : null}
            </div>
            <button type="button" className={btn} onClick={() => run(r.id)}>
              Export
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CommsReportsRunner() {
  const [format, setFormat] = useState<CommsReportFormat>("excel");
  const [audience, setAudience] = useState("");
  const [fromDate, setFromDate] = useState(`${todayIso().slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(todayIso);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(id: CommsReportId) {
    const r = runCommsReport(id, {
      audience: (audience || undefined) as CommsAudience | undefined,
      fromDate,
      toDate,
      format,
    });
    if (!r.ok) {
      setError(r.error);
      setNotice(null);
      return;
    }
    setError(null);
    setNotice(r.message);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          Audience (notices only)
          <select
            className={`${field} mt-1 block`}
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
          >
            <option value="">All audiences</option>
            <option value="all">Everyone</option>
            <option value="staff">Staff</option>
            <option value="parents">Parents</option>
            <option value="students">Students</option>
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          From
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          To
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Format
          <select
            className={`${field} mt-1 block`}
            value={format}
            onChange={(e) => setFormat(e.target.value as CommsReportFormat)}
          >
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <Link href="/comms?tab=reports" className={btnOutline}>
          Open in Comms
        </Link>
      </div>
      {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
      {notice ? <p className="text-sm text-[#0f7a4c]">{notice}</p> : null}
      <ul className="space-y-1.5">
        {COMMS_REPORTS.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-[var(--brand-deep)]">
                {r.label}
              </p>
              {r.hint ? (
                <p className="text-xs text-[var(--muted)]">{r.hint}</p>
              ) : null}
            </div>
            <button type="button" className={btn} onClick={() => run(r.id)}>
              Export
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TimetableReportsRunner({ ay }: { ay: string }) {
  const [format, setFormat] = useState<TimetableReportFormat>("excel");
  const [weekday, setWeekday] = useState("");
  const [fromDate, setFromDate] = useState(`${todayIso().slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(todayIso);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(id: TimetableReportId) {
    const r = runTimetableReport(id, {
      academicYearCode: ay,
      weekday: weekday ? Number(weekday) : undefined,
      fromDate,
      toDate,
      format,
    });
    if (!r.ok) {
      setError(r.error);
      setNotice(null);
      return;
    }
    setError(null);
    setNotice(r.message);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          Weekday (free periods)
          <select
            className={`${field} mt-1 block`}
            value={weekday}
            onChange={(e) => setWeekday(e.target.value)}
          >
            <option value="">Every working day</option>
            {WEEKDAY_SHORT.map((d, i) => (
              <option key={i} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          From (substitutions)
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          To
          <input
            type="date"
            className={`${field} mt-1 block`}
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Format
          <select
            className={`${field} mt-1 block`}
            value={format}
            onChange={(e) => setFormat(e.target.value as TimetableReportFormat)}
          >
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <Link href="/timetable?tab=reports" className={btnOutline}>
          Open in Timetable
        </Link>
      </div>
      {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
      {notice ? <p className="text-sm text-[#0f7a4c]">{notice}</p> : null}
      <ul className="space-y-1.5">
        {TIMETABLE_REPORTS.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-[var(--brand-deep)]">
                {r.label}
              </p>
              {r.hint ? (
                <p className="text-xs text-[var(--muted)]">{r.hint}</p>
              ) : null}
            </div>
            <button type="button" className={btn} onClick={() => run(r.id)}>
              Export
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

