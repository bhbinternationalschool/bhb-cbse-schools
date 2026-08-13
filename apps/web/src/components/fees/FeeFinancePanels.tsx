"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  computeFeeKpis,
  formatInr,
  type FeeKpiSnapshot,
} from "@/lib/feeFinance";
import { preparePreviousSessionFeeSetup } from "@/lib/feeAdjustments";
import {
  FEE_REPORT_CATEGORIES,
  FEE_REPORTS,
  runAuxFeeExport,
  runFeeReport,
  type FeeReportFormat,
  type FeeReportId,
} from "@/lib/feeReportCatalog";
import {
  getPaymentGatewayConfig,
  paymentGatewayModeLabel,
} from "@/lib/paymentGateway";
import { loadFees, searchFeeStudents, type StudentSearchHit } from "@/lib/fees";
import { loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState, type SisStudent } from "@/lib/sis";
import { useDemoSession } from "@/components/shell/SessionContext";
import { SkeletonKpiRow } from "@/components/ui/skeleton";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function PdfLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <path
        fill="#E53935"
        d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
      />
      <path fill="#FFCDD2" d="M14 2v6h6" />
      <rect x="4.5" y="12.5" width="15" height="6.5" rx="1.2" fill="#B71C1C" />
      <text
        x="12"
        y="17.4"
        textAnchor="middle"
        fill="#fff"
        fontSize="5.2"
        fontWeight="800"
        fontFamily="system-ui,Segoe UI,sans-serif"
      >
        PDF
      </text>
    </svg>
  );
}

function ExcelLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <path
        fill="#217346"
        d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
      />
      <path fill="#C8E6C9" d="M14 2v6h6" />
      <rect x="4.5" y="12.5" width="15" height="6.5" rx="1.2" fill="#0D5C2E" />
      <text
        x="12"
        y="17.4"
        textAnchor="middle"
        fill="#fff"
        fontSize="4.6"
        fontWeight="800"
        fontFamily="system-ui,Segoe UI,sans-serif"
      >
        XLS
      </text>
    </svg>
  );
}

function ReportIcon({ kind }: { kind: "coins" | "dues" | "grad" | "doc" }) {
  const common = "h-7 w-7 text-white/95";
  if (kind === "coins") {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 2C8.7 2 6 3.8 6 6v1.1C4.2 8 3 9.8 3 12c0 2.2 1.2 4 3 4.9V18c0 2.2 2.7 4 6 4s6-1.8 6-4v-1.1c1.8-.9 3-2.7 3-4.9 0-2.2-1.2-4-3-4.9V6c0-2.2-2.7-4-6-4zm0 2c2.2 0 4 1 4 2s-1.8 2-4 2-4-1-4-2 1.8-2 4-2zm0 14c-2.2 0-4-1-4-2s1.8-2 4-2 4 1 4 2-1.8 2-4 2z" />
      </svg>
    );
  }
  if (kind === "dues") {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h10v2H4v-2zm14.5-1.5 1.4-1.4L22 16.2l-3.5 3.5-2.1-2.1 1.4-1.4.7.7 2.1-2.1z" />
      </svg>
    );
  }
  if (kind === "grad") {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 3 1 9l11 6 9-4.9V17h2V9L12 3zm0 12.2L4.5 11 12 7l7.5 4-7.5 4.2zM5 13.2v3.3c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7v-3.3l-7 3.8-7-3.8z" />
      </svg>
    );
  }
  return (
    <svg className={common} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 2h9l5 5v15H6V2zm8 1.5V8h4.5L14 3.5zM8 11h8v1.5H8V11zm0 3h8v1.5H8V14zm0 3h5v1.5H8V17z" />
    </svg>
  );
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-[var(--brand-deep)]">
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-[11px] text-[var(--muted)]">{hint}</div>
      ) : null}
    </div>
  );
}

export function FeeDashboardPanel({ tick = 0 }: { tick?: number }) {
  const session = useDemoSession();
  const ay = session.academicYearCode;
  const [kpi, setKpi] = useState<FeeKpiSnapshot | null>(null);
  const [pgLabel, setPgLabel] = useState("");

  useEffect(() => {
    setKpi(computeFeeKpis({ academicYearCode: ay }));
    setPgLabel(paymentGatewayModeLabel(getPaymentGatewayConfig().mode));
  }, [tick, ay]);

  if (!kpi) {
    return (
      <div className="mt-6">
        <SkeletonKpiRow />
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <p className="text-sm text-[var(--muted)]">
        Session {kpi.academicYearCode} · as of {kpi.asOf} · gateway: {pgLabel}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Collected"
          value={formatInr(kpi.collectedPaise)}
          hint={`${kpi.voucherCount} receipts · ${kpi.collectionRatePct}% of net billed`}
        />
        <KpiCard
          label="Open dues"
          value={formatInr(kpi.openPaise)}
          hint={`${kpi.studentsWithOpenDues} of ${kpi.activeStudents} active students`}
        />
        <KpiCard
          label="Today"
          value={formatInr(kpi.todayCollectedPaise)}
          hint="Counter + confirmed pay links"
        />
        <KpiCard
          label="Arrears (CF)"
          value={formatInr(kpi.arrearsPaise)}
          hint={`Concessions / waivers ${formatInr(kpi.waivedPaise)}`}
        />
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link
          href="/fees/defaulters"
          className="text-[var(--brand-deep)] underline-offset-2 hover:underline"
        >
          Open defaulters playbook
        </Link>
        <Link
          href="/mpd"
          className="text-[var(--brand-deep)] underline-offset-2 hover:underline"
          target="_blank"
        >
          Public fee disclosure (MPD)
        </Link>
      </div>
    </div>
  );
}

export function FeeReportsPanel({
  tick = 0,
  academicYearCode,
  onMastersChanged,
}: {
  tick?: number;
  academicYearCode?: string;
  onMastersChanged?: () => void;
}) {
  const session = useDemoSession();
  const ay = academicYearCode || session.academicYearCode;
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState(() => todayIso());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [studentQuery, setStudentQuery] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(
    null,
  );
  /** When true, student-column reports that need a student export the whole school */
  const [allStudents, setAllStudents] = useState(false);

  useEffect(() => {
    setMasters(loadMasters());
    setSis(loadSis());
  }, [tick, ay]);

  const selectedStudent: SisStudent | null = useMemo(() => {
    if (!sis || !selectedStudentId) return null;
    return sis.students.find((s) => s.id === selectedStudentId) ?? null;
  }, [sis, selectedStudentId]);

  const studentHits = useMemo(() => {
    if (!sis || !masters) return [] as StudentSearchHit[];
    const q = studentQuery.trim();
    if (q.length < 1) return [];
    return searchFeeStudents(q, sis, masters, loadFees(), {
      includeInactive: true,
      academicYearCode: ay,
    }).slice(0, 8);
  }, [sis, masters, studentQuery, ay]);

  const byCategory = useMemo(() => {
    const map: Record<string, typeof FEE_REPORTS> = {
      collection: [],
      dues: [],
      student: [],
      general: [],
    };
    for (const r of FEE_REPORTS) {
      map[r.category]?.push(r);
    }
    return map;
  }, []);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 3600);
  }

  function onRun(id: FeeReportId, format: FeeReportFormat) {
    const def = FEE_REPORTS.find((r) => r.id === id);
    const key = `${id}:${format}`;
    setRunning(key);
    const result = runFeeReport(id, {
      academicYearCode: ay,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      asOf: toDate || todayIso(),
      masters: masters ?? undefined,
      sis: sis ?? undefined,
      format,
      studentId: selectedStudentId || undefined,
      studentScope:
        def?.requiresStudent && allStudents
          ? "all"
          : def?.requiresStudent
            ? "one"
            : undefined,
    });
    setRunning(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    flash(result.message);
  }

  function onAux(
    kind: "rte" | "inactive" | "tally",
    format: FeeReportFormat,
  ) {
    const r = runAuxFeeExport(kind, {
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      format,
    });
    if (r.ok) flash(r.message);
    else setError(r.error);
  }

  function pickStudent(hit: StudentSearchHit) {
    setSelectedStudentId(hit.student.id);
    setStudentQuery("");
    setAllStudents(false);
    setError(null);
  }

  return (
    <div className="mt-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--brand-deep)]">
            Fee reports
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Download any report as Excel or PDF from the live Fee Take ledger
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              From
            </span>
            <input
              type="date"
              className="field !py-1.5"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              To / as of
            </span>
            <input
              type="date"
              className="field !py-1.5"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
        </div>
      </div>

      {notice ? (
        <p className="rounded-lg bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {FEE_REPORT_CATEGORIES.map((cat) => (
          <section
            key={cat.id}
            className="overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-sunken)] shadow-sm"
          >
            <header
              className={`${cat.headerClass} flex items-center justify-between px-4 py-3 text-white`}
            >
              <h3 className="text-lg font-semibold tracking-wide">{cat.title}</h3>
              <ReportIcon kind={cat.icon} />
            </header>

            {cat.id === "student" ? (
              <div className="border-b border-[var(--border)] bg-[var(--accent)] px-2.5 py-2.5">
                <p className="mb-1.5 text-[11px] font-semibold text-[var(--brand-deep)]">
                  Select student for ledger / payments / agreement
                </p>
                {selectedStudent && !allStudents ? (
                  <div className="mb-2 flex items-start justify-between gap-2 rounded bg-[var(--card)] px-2 py-1.5 text-xs">
                    <div className="min-w-0">
                      <div className="font-semibold text-[var(--brand-deep)]">
                        {selectedStudent.fullName}
                      </div>
                      <div className="text-[var(--muted)]">
                        {selectedStudent.admissionNo} ·{" "}
                        {masters?.classes.find(
                          (c) => c.id === selectedStudent.classId,
                        )?.name ?? "—"}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 text-[11px] font-semibold text-[#b71c1c]"
                      onClick={() => setSelectedStudentId(null)}
                    >
                      Clear
                    </button>
                  </div>
                ) : null}
                {allStudents ? (
                  <div className="mb-2 flex items-center justify-between rounded bg-[var(--card)] px-2 py-1.5 text-xs font-semibold text-[var(--brand-deep)]">
                    All students (school-wide)
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-[#b71c1c]"
                      onClick={() => setAllStudents(false)}
                    >
                      Clear
                    </button>
                  </div>
                ) : null}
                <input
                  className="field !bg-[var(--card)] !py-1.5 text-sm"
                  value={studentQuery}
                  onChange={(e) => {
                    setStudentQuery(e.target.value);
                    setAllStudents(false);
                  }}
                  placeholder="Search name / admission no…"
                  autoComplete="off"
                />
                {studentHits.length > 0 ? (
                  <ul className="mt-1 max-h-40 overflow-auto rounded border border-[var(--border)] bg-[var(--card)] text-sm">
                    {studentHits.map((hit) => (
                      <li key={hit.student.id}>
                        <button
                          type="button"
                          className="w-full px-2 py-1.5 text-left hover:bg-[rgba(32,48,80,0.06)]"
                          onClick={() => pickStudent(hit)}
                        >
                          <span className="font-medium text-[var(--brand-deep)]">
                            {hit.student.fullName}
                          </span>
                          <span className="block text-[11px] text-[var(--muted)]">
                            {hit.student.admissionNo} · {hit.classLabel}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <button
                  type="button"
                  className="mt-2 text-[11px] font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
                  onClick={() => {
                    setAllStudents(true);
                    setSelectedStudentId(null);
                    setStudentQuery("");
                    setError(null);
                  }}
                >
                  Or export all students
                </button>
              </div>
            ) : null}

            <ul className="space-y-1.5 p-2.5">
              {(byCategory[cat.id] ?? []).map((report) => {
                const busyExcel = running === `${report.id}:excel`;
                const busyPdf = running === `${report.id}:pdf`;
                return (
                  <li
                    key={report.id}
                    className="flex items-center gap-1 rounded-sm bg-[#eceff1] px-2 py-1.5"
                  >
                    <span className="min-w-0 flex-1 px-1 text-[13px] font-medium leading-snug text-[#37474f]">
                      {report.label}
                      {report.requiresStudent ? (
                        <span className="mt-0.5 block text-[10px] font-normal text-[var(--muted)]">
                          {allStudents
                            ? "All students"
                            : selectedStudent
                              ? selectedStudent.admissionNo
                              : "Pick student first"}
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      title="Download PDF"
                      aria-label={`${report.label} PDF`}
                      disabled={!!running}
                      onClick={() => onRun(report.id, "pdf")}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[#E53935]/30 bg-[#FFF5F5] transition hover:bg-[#FFEBEE] disabled:opacity-40"
                    >
                      {busyPdf ? (
                        <span className="text-[9px] font-bold text-[#B71C1C]">
                          …
                        </span>
                      ) : (
                        <PdfLogo className="h-5 w-5" />
                      )}
                    </button>
                    <button
                      type="button"
                      title="Download Excel"
                      aria-label={`${report.label} Excel`}
                      disabled={!!running}
                      onClick={() => onRun(report.id, "excel")}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[#1D6F42]/30 bg-[#F1F8F4] transition hover:bg-[#E8F5E9] disabled:opacity-40"
                    >
                      {busyExcel ? (
                        <span className="text-[9px] font-bold text-[#0B5C2E]">
                          …
                        </span>
                      ) : (
                        <ExcelLogo className="h-5 w-5" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-[var(--brand-deep)]"
          onClick={() => setToolsOpen((o) => !o)}
        >
          More exports & setup
          <span className="text-xs font-normal text-[var(--muted)]">
            {toolsOpen ? "Hide" : "Show"} · RTE · Tally · MPD · prior session
          </span>
        </button>
        {toolsOpen ? (
          <div className="border-t border-[rgba(32,48,80,0.08)] px-4 py-4">
            <div className="space-y-2">
              {(
                [
                  ["rte", "RTE / EWS"],
                  ["inactive", "Inactive dues"],
                  ["tally", "Tally day book"],
                ] as const
              ).map(([kind, label]) => (
                <div
                  key={kind}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--surface-sunken)] px-3 py-2"
                >
                  <span className="text-sm font-medium text-[var(--brand-deep)]">
                    {label}
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      className="inline-flex h-8 items-center gap-1 rounded border border-[#E53935]/35 bg-[#FFF5F5] px-2 text-[11px] font-bold text-[#B71C1C]"
                      onClick={() => onAux(kind, "pdf")}
                    >
                      <PdfLogo className="h-4 w-4" />
                      PDF
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-8 items-center gap-1 rounded border border-[#1D6F42]/35 bg-[#F1F8F4] px-2 text-[11px] font-bold text-[#0B5C2E]"
                      onClick={() => onAux(kind, "excel")}
                    >
                      <ExcelLogo className="h-4 w-4" />
                      Excel
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/mpd"
                target="_blank"
                className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)]"
              >
                Public MPD
              </Link>
              <button
                type="button"
                className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-xs font-semibold"
                onClick={() => {
                  const r = preparePreviousSessionFeeSetup(
                    masters ?? undefined,
                  );
                  if (!r.ok) {
                    setError(r.error);
                    return;
                  }
                  setMasters(r.state);
                  onMastersChanged?.();
                  flash(
                    r.cloned
                      ? `Cloned fee setup into ${r.fromAy}`
                      : `${r.fromAy} already had fee groups`,
                  );
                }}
              >
                Prepare previous session
              </button>
            </div>
            <p className="mt-3 text-[11px] text-[var(--muted)]">
              Hostel / wallet reports download an empty template until those
              modules are enabled. All other reports use live collections and
              dues.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
