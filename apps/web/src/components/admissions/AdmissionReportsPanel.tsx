"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ADMISSION_SOURCES,
  ADMISSION_STAGES,
  listAcademicYearCodes,
  listCaptureYears,
  loadAdmissions,
  type AdmissionsState,
  type AdmissionSource,
  type AdmissionStage,
  type LeadFollowUpBucket,
} from "@/lib/admissions";
import {
  ADMISSION_REPORT_CATEGORIES,
  ADMISSION_REPORTS,
  CUSTOM_LEAD_COLUMNS,
  filterAdmissionLeads,
  listAssigneeOptions,
  runAdmissionReport,
  type AdmissionFeeFilter,
  type AdmissionReportFormat,
  type AdmissionReportId,
} from "@/lib/admissionReportCatalog";
import { loadMasters, type MastersState } from "@/lib/masters";

const field =
  "rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-2.5 py-1.5 text-sm text-[var(--brand-deep)]";

export function AdmissionReportsPanel({
  tick = 0,
  onNotice,
}: {
  tick?: number;
  onNotice?: (msg: string) => void;
}) {
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [admissions, setAdmissions] = useState<AdmissionsState | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [surveyDate, setSurveyDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [stage, setStage] = useState<AdmissionStage | "all" | "open">("all");
  const [source, setSource] = useState<AdmissionSource | "all">("all");
  const [academicYearCode, setAcademicYearCode] = useState("");
  const [captureYear, setCaptureYear] = useState("");
  const [classSoughtId, setClassSoughtId] = useState("");
  const [beatId, setBeatId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [feeStatus, setFeeStatus] = useState<AdmissionFeeFilter>("any");
  const [followUpBucket, setFollowUpBucket] = useState<
    LeadFollowUpBucket | "any"
  >("any");
  const [localityContains, setLocalityContains] = useState("");
  const [includeLost, setIncludeLost] = useState(false);
  const [customCols, setCustomCols] = useState<string[]>([
    "enquiryNo",
    "leadDate",
    "stage",
    "source",
    "childName",
    "classSought",
    "guardianName",
    "mobile",
    "locality",
    "assignedTo",
    "nextFollowUpAt",
    "feeStatus",
  ]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  useEffect(() => {
    setMasters(loadMasters());
    setAdmissions(loadAdmissions());
  }, [tick]);

  const captureYears = useMemo(
    () => (admissions ? listCaptureYears(admissions) : []),
    [admissions],
  );
  const academicYears = useMemo(
    () => (admissions ? listAcademicYearCodes(admissions) : []),
    [admissions],
  );
  const assignees = useMemo(
    () => (admissions ? listAssigneeOptions(admissions) : []),
    [admissions],
  );
  const beats = useMemo(
    () =>
      (admissions?.surveyBeats || []).filter(
        (b) => b.isActive || admissions?.leads.some((l) => l.surveyBeatId === b.id),
      ),
    [admissions],
  );

  const matchedCount = useMemo(() => {
    if (!admissions) return 0;
    return filterAdmissionLeads(admissions, {
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      surveyDate: surveyDate || undefined,
      stage,
      source,
      academicYearCode: academicYearCode || undefined,
      captureYear: captureYear || undefined,
      classSoughtId: classSoughtId || undefined,
      beatId: beatId || undefined,
      assignedTo: assignedTo || undefined,
      feeStatus,
      followUpBucket,
      localityContains: localityContains.trim() || undefined,
      includeLost,
    }).length;
  }, [
    admissions,
    fromDate,
    toDate,
    surveyDate,
    stage,
    source,
    academicYearCode,
    captureYear,
    classSoughtId,
    beatId,
    assignedTo,
    feeStatus,
    followUpBucket,
    localityContains,
    includeLost,
  ]);

  const byCat = useMemo(() => {
    const map: Record<string, typeof ADMISSION_REPORTS> = {
      downloads: [],
      analytics: [],
      crm: [],
      survey: [],
      registration: [],
    };
    for (const r of ADMISSION_REPORTS) map[r.category]?.push(r);
    return map;
  }, []);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    onNotice?.(msg);
    window.setTimeout(() => setNotice(null), 4000);
  }

  function onRun(id: AdmissionReportId, format: AdmissionReportFormat) {
    const key = `${id}:${format}`;
    setRunning(key);
    const result = runAdmissionReport(id, {
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      surveyDate: surveyDate || undefined,
      stage,
      source,
      academicYearCode: academicYearCode || undefined,
      captureYear: captureYear || undefined,
      classSoughtId: classSoughtId || undefined,
      beatId: beatId || undefined,
      assignedTo: assignedTo || undefined,
      feeStatus,
      followUpBucket,
      localityContains: localityContains.trim() || undefined,
      includeLost,
      customColumns: id === "custom_download" ? customCols : undefined,
      admissions: admissions ?? undefined,
      masters: masters ?? undefined,
      format,
    });
    setRunning(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    flash(result.message);
  }

  function toggleCol(key: string) {
    setCustomCols((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function clearFilters() {
    setFromDate("");
    setToDate("");
    setSurveyDate(new Date().toISOString().slice(0, 10));
    setStage("all");
    setSource("all");
    setAcademicYearCode("");
    setCaptureYear("");
    setClassSoughtId("");
    setBeatId("");
    setAssignedTo("");
    setFeeStatus("any");
    setFollowUpBucket("any");
    setLocalityContains("");
    setIncludeLost(false);
  }

  if (!masters || !admissions) {
    return (
      <p className="mt-4 text-sm text-[var(--muted)]">Loading reports…</p>
    );
  }

  return (
    <div className="mt-4 space-y-5">
      <div className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--brand-deep)]">
              Admissions reports
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Filters apply to downloads ·{" "}
              <strong className="text-[var(--brand-deep)]">
                {matchedCount}
              </strong>{" "}
              lead(s) match · Survey date drives field-day reports
            </p>
          </div>
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-lg border border-[rgba(32,48,80,0.15)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--muted)] hover:bg-[rgba(32,48,80,0.04)]"
          >
            Clear filters
          </button>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Lead from
            </span>
            <input
              type="date"
              className={`field w-full ${field}`}
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Lead to
            </span>
            <input
              type="date"
              className={`field w-full ${field}`}
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Survey date
            </span>
            <input
              type="date"
              className={`field w-full ${field}`}
              value={surveyDate}
              onChange={(e) => setSurveyDate(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Stage
            </span>
            <select
              className={`field w-full ${field}`}
              value={stage}
              onChange={(e) =>
                setStage(e.target.value as AdmissionStage | "all" | "open")
              }
            >
              <option value="all">All stages</option>
              <option value="open">Open pipeline</option>
              {ADMISSION_STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Source
            </span>
            <select
              className={`field w-full ${field}`}
              value={source}
              onChange={(e) =>
                setSource(e.target.value as AdmissionSource | "all")
              }
            >
              <option value="all">All sources</option>
              {ADMISSION_SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Capture year
            </span>
            <select
              className={`field w-full ${field}`}
              value={captureYear}
              onChange={(e) => setCaptureYear(e.target.value)}
            >
              <option value="">All years</option>
              {captureYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Academic year
            </span>
            <select
              className={`field w-full ${field}`}
              value={academicYearCode}
              onChange={(e) => setAcademicYearCode(e.target.value)}
            >
              <option value="">All AY</option>
              {academicYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Class sought
            </span>
            <select
              className={`field w-full ${field}`}
              value={classSoughtId}
              onChange={(e) => setClassSoughtId(e.target.value)}
            >
              <option value="">All classes</option>
              {masters.classes
                .filter((c) => c.isActive !== false)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Survey beat
            </span>
            <select
              className={`field w-full ${field}`}
              value={beatId}
              onChange={(e) => setBeatId(e.target.value)}
            >
              <option value="">All beats</option>
              {beats.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code ? `${b.code} · ` : ""}
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Counsellor
            </span>
            <select
              className={`field w-full ${field}`}
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
            >
              <option value="">All assignees</option>
              {assignees.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Reg. fee status
            </span>
            <select
              className={`field w-full ${field}`}
              value={feeStatus}
              onChange={(e) =>
                setFeeStatus(e.target.value as AdmissionFeeFilter)
              }
            >
              <option value="any">Any</option>
              <option value="unpaid">Unpaid / due</option>
              <option value="partial">Partial</option>
              <option value="pending">Pending link</option>
              <option value="paid">Paid</option>
              <option value="waived">Waived</option>
              <option value="none">None set</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Follow-up
            </span>
            <select
              className={`field w-full ${field}`}
              value={followUpBucket}
              onChange={(e) =>
                setFollowUpBucket(
                  e.target.value as LeadFollowUpBucket | "any",
                )
              }
            >
              <option value="any">Any</option>
              <option value="overdue">Overdue</option>
              <option value="due_today">Due today</option>
              <option value="scheduled">Scheduled</option>
              <option value="none">No date</option>
            </select>
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Locality contains
            </span>
            <input
              type="text"
              className={`field w-full ${field}`}
              placeholder="Area / address / campaign note"
              value={localityContains}
              onChange={(e) => setLocalityContains(e.target.value)}
            />
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={includeLost}
              onChange={(e) => setIncludeLost(e.target.checked)}
              className="size-4 rounded border-[rgba(32,48,80,0.25)]"
            />
            <span className="text-[12px] text-[var(--brand-deep)]">
              Include lost leads
            </span>
          </label>
        </div>
      </div>

      {notice ? (
        <p className="rounded-lg bg-[rgba(67,160,71,0.12)] px-3 py-2 text-sm text-[#2e7d32]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-[#dc2626]/10 px-3 py-2 text-sm text-[#dc2626]">
          {error}
        </p>
      ) : null}

      <div className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[#f8faf8] p-4">
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
          Custom lead download — columns
        </h3>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          Tick fields, then Excel / PDF on Custom lead download
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {CUSTOM_LEAD_COLUMNS.map((c) => {
            const on = customCols.includes(c.key);
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => toggleCol(c.key)}
                className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                  on
                    ? "border-[var(--brand-deep)] bg-[var(--brand-deep)] text-white"
                    : "border-[rgba(32,48,80,0.15)] bg-white text-[var(--muted)]"
                }`}
              >
                {c.header}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          {customCols.length} column(s) selected
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {ADMISSION_REPORT_CATEGORIES.map((cat) => (
          <section
            key={cat.id}
            className="overflow-hidden rounded-md border border-[rgba(32,48,80,0.08)] bg-[#f3f4f6] shadow-sm"
          >
            <header className={`${cat.headerClass} px-4 py-3 text-white`}>
              <h3 className="text-lg font-semibold tracking-wide">
                {cat.title}
              </h3>
            </header>
            <ul className="divide-y divide-[rgba(32,48,80,0.06)]">
              {(byCat[cat.id] ?? []).map((r) => (
                <li
                  key={r.id}
                  className="flex items-start justify-between gap-2 bg-white px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--brand-deep)]">
                      {r.label}
                    </div>
                    {r.hint ? (
                      <div className="text-[10px] text-[var(--muted)]">
                        {r.hint}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {(["excel", "pdf"] as const).map((fmt) => {
                      const key = `${r.id}:${fmt}`;
                      return (
                        <button
                          key={fmt}
                          type="button"
                          disabled={running === key}
                          onClick={() => onRun(r.id, fmt)}
                          className="rounded bg-[var(--brand-deep)] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white disabled:opacity-50"
                        >
                          {fmt}
                        </button>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
