"use client";

import { useEffect, useMemo, useState } from "react";
import { ReportsTab } from "@/components/inventory/ReportsTab";
import { useInvBootstrap } from "@/lib/inventory/client";
import { PTM_REPORTS, loadPtm, runPtmReport, type PtmReportId } from "@/lib/ptm";
import { STUDENT_LEAVE_REPORTS, runStudentLeaveReport, type StudentLeaveReportId } from "@/lib/studentLeave";
import { VAULT_REPORTS, runVaultReport, type VaultReportId } from "@/lib/vault";
import { RTE_REPORTS, runRteReport, type RteReportId } from "@/lib/rteEws";
import { TEACHING_REPORTS, runTeachingReport, type TeachingReportId } from "@/lib/teachingReportCatalog";
import { COMPLAINTS_REPORTS, runComplaintsReport, type ComplaintsReportId } from "@/lib/complaintsReportCatalog";
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
import { loadAccounts } from "@/lib/accountsStore";
import type { AccountsState } from "@/lib/accountsTypes";
import {
  TRANSPORT_REPORTS,
  runTransportReport,
  TRANSPORT_REPORTS_NEEDING_COSTS,
  type TransportReportFormat,
} from "@/lib/transportReportCatalog";
import type { VehicleCosts } from "@/lib/transportVehicleCosts";
import { fetchVehicleCosts } from "@/lib/transportVehicleCostsClient";
import { loadTransport } from "@/lib/transport";
import {
  TRUST_REPORTS,
  runTrustReport,
  type TrustReportFormat,
  type TrustReportId,
} from "@/lib/trustReportCatalog";
import { loadTrust } from "@/lib/trust";
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
import { hasPermission } from "@/lib/rbac";
import { useDemoSession } from "@/components/shell/SessionContext";
import { isRestrictedTeacher, useMyTeaching } from "@/components/staff/useMyTeaching";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import type { RegisterDayMark } from "@/lib/transportBoardingLog";
import { fetchRegisterDayMarks } from "@/lib/transportRegisterClient";

function todayIso() {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10) /* IST */;
}

/**
 * Store reports moved into the module that owns the data.
 *
 * They used to be generated here from the browser-held register. They are now
 * run server-side against the stock ledger and the sale documents, so this
 * points at them rather than shipping a second, weaker copy.
 */
export function StoreReportsRunner({ initialReport }: { initialReport?: string }) {
  // The store's own reports, run server-side against the stock ledger and
  // the sale documents — embedded here rather than a second, weaker copy.
  const boot = useInvBootstrap();
  if (boot.loading && !boot.data) {
    return <p className="text-sm text-[var(--muted)]">Loading the store from the server…</p>;
  }
  if (boot.error || !boot.data) {
    return (
      <p className="text-sm text-[var(--danger)]">
        {boot.error || "Could not load the store."}{" "}
        <button type="button" className="underline" onClick={() => boot.reload()}>
          Try again
        </button>
      </p>
    );
  }
  return <ReportsTab boot={boot.data} initialReport={initialReport} />;
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

  // Read only: the Reports Center loads the desk first (ReportDataGate).
  // This used to seed a chart of accounts when the desk looked empty — a
  // report screen must never write the school's books.
  useEffect(() => {
    const s = loadAccounts();
    setState(s);
    if (s.coaAccounts[0]) setCoaId((cur) => cur || s.coaAccounts[0]!.id);
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
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {notice ? <p className="text-sm text-[var(--success)]">{notice}</p> : null}
      <ul className="space-y-1.5">
        {ACCOUNTS_REPORTS.map((r) => (
          <li
            key={r.id} data-report-id={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2"
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

  async function run(id: (typeof TRANSPORT_REPORTS)[number]["id"]) {
    // The boarding day sheet reads the bus register (server truth).
    let registerMarks: RegisterDayMark[] | null = null;
    if (id === "boarding_day_sheet") {
      try {
        registerMarks = await fetchRegisterDayMarks(date);
      } catch (e) {
        setError(`Bus register could not be read — ${e instanceof Error ? e.message : "try again"}`);
        setNotice(null);
        return;
      }
    }
    // Fuel, papers, loans and TCO read the server stores, not the desk.
    let costs: VehicleCosts | null = null;
    if (TRANSPORT_REPORTS_NEEDING_COSTS.has(id)) {
      try {
        costs = await fetchVehicleCosts();
      } catch (e) {
        setError(`Fuel, vehicle papers and loans could not be read — ${e instanceof Error ? e.message : "try again"}`);
        setNotice(null);
        return;
      }
    }
    const r = runTransportReport(id, {
      date,
      format,
      transport: loadTransport(),
      masters: loadMasters(),
      sis: loadSis(),
      registerMarks,
      costs,
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
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {notice ? <p className="text-sm text-[var(--success)]">{notice}</p> : null}
      <ul className="space-y-1.5">
        {TRANSPORT_REPORTS.map((r) => (
          <li
            key={r.id} data-report-id={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-[var(--brand-deep)]">
                {r.label}
              </p>
              {r.hint ? (
                <p className="text-xs text-[var(--muted)]">{r.hint}</p>
              ) : null}
            </div>
            <button type="button" className={btn} onClick={() => void run(r.id)}>
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
  // Read only (loaded first by ReportDataGate).
  const projects = useMemo(() => loadTrust().projects, []);

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
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {notice ? <p className="text-sm text-[var(--success)]">{notice}</p> : null}
      <ul className="space-y-1.5">
        {TRUST_REPORTS.map((r) => (
          <li
            key={r.id} data-report-id={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2"
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
  const session = useDemoSession();
  const [format, setFormat] = useState<HomeworkReportFormat>("excel");
  const [fromDate, setFromDate] = useState(`${todayIso().slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(todayIso);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "" = all of the teacher's own sections; otherwise one "classId|sectionId".
  const [mySection, setMySection] = useState("");

  // A teacher exports their own sections only (2026-09-29); every export
  // here used to cover the whole school.
  const { my } = useMyTeaching();
  const teacherMode = isRestrictedTeacher(my);
  const canExport = useMemo(
    () => hasPermission(session, loadMasters(), "homework", "export"),
    [session],
  );

  function run(id: HomeworkReportId) {
    if (!canExport) {
      setError("Your role can view homework but not download reports");
      setNotice(null);
      return;
    }
    const sectionKeys = teacherMode
      ? new Set(
          mySection
            ? [mySection]
            : my.teaching.map((t) => `${t.classId}|${t.sectionId}`),
        )
      : undefined;
    const r = runHomeworkReport(id, {
      academicYearCode: ay,
      fromDate,
      toDate,
      format,
      sectionKeys,
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
        {teacherMode ? (
          <label className="text-xs text-[var(--muted)]">
            Class
            <select
              className={`${field} mt-1 block`}
              value={mySection}
              onChange={(e) => setMySection(e.target.value)}
            >
              <option value="">All my classes</option>
              {my.teaching.map((t) => (
                <option key={`${t.classId}|${t.sectionId}`} value={`${t.classId}|${t.sectionId}`}>
                  {t.className} {t.sectionName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Link href="/homework?tab=reports" className={btnOutline}>
          Open in Homework
        </Link>
      </div>
      {teacherMode && my.teaching.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No classes are linked to you yet — ask the office to add them (Staff → Duties).
        </p>
      ) : null}
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {notice ? <p className="text-sm text-[var(--success)]">{notice}</p> : null}
      <ul className="space-y-1.5">
        {HOMEWORK_REPORTS.map((r) => (
          <li
            key={r.id} data-report-id={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2"
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
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {notice ? <p className="text-sm text-[var(--success)]">{notice}</p> : null}
      <ul className="space-y-1.5">
        {EXAM_REPORTS.map((r) => (
          <li
            key={r.id} data-report-id={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2"
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
        <Link href="/library?tab=lib_reports" className={btnOutline}>
          Open in Library
        </Link>
      </div>
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {notice ? <p className="text-sm text-[var(--success)]">{notice}</p> : null}
      {LIBRARY_REPORT_GROUPS.map((g) => (
        <div key={g.category} className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            {g.category}
          </p>
          <ul className="space-y-1.5">
            {g.reports.map((r) => (
              <li
                key={r.id} data-report-id={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2"
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
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {notice ? <p className="text-sm text-[var(--success)]">{notice}</p> : null}
      <ul className="space-y-1.5">
        {CERTIFICATES_REPORTS.map((r) => (
          <li
            key={r.id} data-report-id={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2"
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
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {notice ? <p className="text-sm text-[var(--success)]">{notice}</p> : null}
      <ul className="space-y-1.5">
        {COMMS_REPORTS.map((r) => (
          <li
            key={r.id} data-report-id={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2"
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
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {notice ? <p className="text-sm text-[var(--success)]">{notice}</p> : null}
      <ul className="space-y-1.5">
        {TIMETABLE_REPORTS.map((r) => (
          <li
            key={r.id} data-report-id={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2"
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


/* ── Runners for modules that only had a link (14 Oct 2026) ─────────── */

function ExportList<T extends { id: string; label: string; hint?: string }>({
  reports,
  onRun,
}: {
  reports: readonly T[];
  onRun: (id: T["id"]) => void;
}) {
  return (
    <ul className="space-y-1.5">
      {reports.map((r) => (
        <li
          key={r.id}
          data-report-id={r.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2"
        >
          <div>
            <p className="text-sm font-medium text-[var(--brand-deep)]">{r.label}</p>
            {r.hint ? <p className="text-xs text-[var(--muted)]">{r.hint}</p> : null}
          </div>
          <button type="button" className={btn} onClick={() => onRun(r.id)}>
            Export
          </button>
        </li>
      ))}
    </ul>
  );
}

function FormatPicker({ value, onChange }: { value: "excel" | "pdf"; onChange: (v: "excel" | "pdf") => void }) {
  return (
    <label className="text-xs text-[var(--muted)]">
      Format
      <select className={`${field} mt-1 block`} value={value} onChange={(e) => onChange(e.target.value as "excel" | "pdf")}>
        <option value="excel">Excel</option>
        <option value="pdf">PDF</option>
      </select>
    </label>
  );
}

function useRunResult() {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const show = (r: { ok: true; message: string } | { ok: false; error: string }) => {
    if (r.ok) {
      setError(null);
      setNotice(r.message);
    } else {
      setNotice(null);
      setError(r.error);
    }
  };
  const view = (
    <>
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {notice ? <p className="text-sm text-[var(--success)]">{notice}</p> : null}
    </>
  );
  return { show, view };
}

export function PtmReportsRunner() {
  const [format, setFormat] = useState<"excel" | "pdf">("excel");
  const events = useMemo(
    () => [...loadPtm().events].sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    [],
  );
  const [eventId, setEventId] = useState(() => events[0]?.id ?? "");
  const { show, view } = useRunResult();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          PTM
          <select className={`${field} mt-1 block`} value={eventId} onChange={(e) => setEventId(e.target.value)}>
            {events.length === 0 ? <option value="">No PTM yet</option> : null}
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.date ? ` · ${e.date}` : ""}
              </option>
            ))}
          </select>
        </label>
        <FormatPicker value={format} onChange={setFormat} />
        <Link href="/ptm?tab=reports" className={btnOutline}>
          Open in PTM
        </Link>
      </div>
      {view}
      <ExportList
        reports={PTM_REPORTS}
        onRun={(id) => show(runPtmReport(id as PtmReportId, { eventId: eventId || undefined, format }))}
      />
    </div>
  );
}

export function StudentLeaveReportsRunner({ ay }: { ay: string }) {
  const [format, setFormat] = useState<"excel" | "pdf">("excel");
  const [fromDate, setFromDate] = useState(`${ay.slice(0, 4)}-04-01`);
  const [toDate, setToDate] = useState(todayIso);
  const { show, view } = useRunResult();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          From
          <input type="date" className={`${field} mt-1 block`} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label className="text-xs text-[var(--muted)]">
          To
          <input type="date" className={`${field} mt-1 block`} value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <FormatPicker value={format} onChange={setFormat} />
        <Link href="/attendance?tab=leave" className={btnOutline}>
          Open student leave
        </Link>
      </div>
      {view}
      <ExportList
        reports={STUDENT_LEAVE_REPORTS}
        onRun={(id) =>
          show(runStudentLeaveReport(id as StudentLeaveReportId, { academicYearCode: ay, fromDate, toDate, format }))
        }
      />
    </div>
  );
}

export function VaultReportsRunner() {
  const [format, setFormat] = useState<"excel" | "pdf">("excel");
  const { show, view } = useRunResult();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <FormatPicker value={format} onChange={setFormat} />
        <Link href="/vault?tab=reports" className={btnOutline}>
          Open the vault
        </Link>
      </div>
      {view}
      <ExportList reports={VAULT_REPORTS} onRun={(id) => show(runVaultReport(id as VaultReportId, { format }))} />
    </div>
  );
}

export function RteReportsRunner({ ay }: { ay: string }) {
  const [format, setFormat] = useState<"excel" | "pdf">("excel");
  const { show, view } = useRunResult();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <FormatPicker value={format} onChange={setFormat} />
        <Link href="/admissions?tab=rte" className={btnOutline}>
          Open RTE / EWS
        </Link>
      </div>
      {view}
      <ExportList
        reports={RTE_REPORTS}
        onRun={(id) => show(runRteReport(id as RteReportId, { format, academicYearCode: ay }))}
      />
    </div>
  );
}

export function TeachingReportsRunner({ ay }: { ay: string }) {
  const session = useDemoSession();
  const { my } = useMyTeaching();
  // A teacher's period delivery is their own; leadership sees everyone's.
  const ownOnly = isRestrictedTeacher(my);
  const [format, setFormat] = useState<"excel" | "pdf">("excel");
  const classes = useMemo(() => loadMasters().classes.filter((c) => c.isActive !== false), []);
  const [classId, setClassId] = useState("");
  const [fromDate, setFromDate] = useState(`${todayIso().slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(todayIso);
  const { show, view } = useRunResult();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          Class
          <select className={`${field} mt-1 block`} value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          From (delivery)
          <input type="date" className={`${field} mt-1 block`} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label className="text-xs text-[var(--muted)]">
          To
          <input type="date" className={`${field} mt-1 block`} value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <FormatPicker value={format} onChange={setFormat} />
        <Link href="/teaching" className={btnOutline}>
          Open Teaching
        </Link>
      </div>
      {ownOnly ? <p className="text-xs text-[var(--muted)]">Period delivery shows your own periods.</p> : null}
      {view}
      <ExportList
        reports={TEACHING_REPORTS}
        onRun={(id) =>
          show(
            runTeachingReport(id as TeachingReportId, {
              academicYearCode: ay,
              classId: classId || undefined,
              fromDate,
              toDate,
              staffId: ownOnly ? session.staffId || "__none__" : undefined,
              format,
            }),
          )
        }
      />
    </div>
  );
}

export function ComplaintsReportsRunner() {
  const [format, setFormat] = useState<"excel" | "pdf">("excel");
  const [fromDate, setFromDate] = useState(`${todayIso().slice(0, 4)}-04-01`);
  const [toDate, setToDate] = useState(todayIso);
  const { show, view } = useRunResult();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          From
          <input type="date" className={`${field} mt-1 block`} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label className="text-xs text-[var(--muted)]">
          To
          <input type="date" className={`${field} mt-1 block`} value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <FormatPicker value={format} onChange={setFormat} />
        <Link href="/complaints" className={btnOutline}>
          Open Complaints
        </Link>
      </div>
      {view}
      <ExportList
        reports={COMPLAINTS_REPORTS}
        onRun={(id) => show(runComplaintsReport(id as ComplaintsReportId, { fromDate, toDate, format }))}
      />
    </div>
  );
}
