"use client";

import { useEffect, useMemo, useState } from "react";
import { loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import {
  CUSTOM_DOWNLOAD_COLUMNS,
  SIS_REPORT_CATEGORIES,
  SIS_REPORTS,
  runSisReport,
  type SisReportFormat,
  type SisReportId,
} from "@/lib/sisReportCatalog";
import { useDemoSession } from "@/components/shell/SessionContext";

export function SisReportsPanel({
  tick = 0,
  onNotice,
}: {
  tick?: number;
  onNotice?: (msg: string) => void;
}) {
  const session = useDemoSession();
  const ay = session.academicYearCode;
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("active");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [month, setMonth] = useState("");
  const [customCols, setCustomCols] = useState<string[]>([
    "admissionNo",
    "fullName",
    "tags",
    "className",
    "section",
    "rollNo",
    "gender",
    "dob",
    "category",
    "studentType",
    "srn",
    "joinedOn",
  ]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  useEffect(() => {
    setMasters(loadMasters());
    setSis(loadSis());
  }, [tick, ay]);

  const sections = useMemo(() => {
    if (!masters || !classId) return [];
    return masters.sections.filter(
      (s) => s.isActive && s.classId === classId,
    );
  }, [masters, classId]);

  const byCat = useMemo(() => {
    const map: Record<string, typeof SIS_REPORTS> = {
      downloads: [],
      registers: [],
      analytics: [],
    };
    for (const r of SIS_REPORTS) map[r.category]?.push(r);
    return map;
  }, []);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    onNotice?.(msg);
    window.setTimeout(() => setNotice(null), 3600);
  }

  function onRun(id: SisReportId, format: SisReportFormat) {
    const key = `${id}:${format}`;
    setRunning(key);
    const result = runSisReport(id, {
      academicYearCode: ay,
      classId: classId || undefined,
      sectionId: sectionId || undefined,
      status,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      month: month || undefined,
      customColumns: id === "custom_download" ? customCols : undefined,
      masters: masters ?? undefined,
      sis: sis ?? undefined,
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

  if (!masters || !sis) {
    return (
      <p className="mt-4 text-sm text-[var(--muted)]">Loading reports…</p>
    );
  }

  return (
    <div className="mt-4 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--brand-deep)]">
            SIS reports
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Class · section · date · month filters apply to every download ·{" "}
            {ay}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Class
            </span>
            <select
              className="field !py-1.5"
              value={classId}
              onChange={(e) => {
                setClassId(e.target.value);
                setSectionId("");
              }}
            >
              <option value="">All</option>
              {masters.classes
                .filter((c) => c.isActive)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Section
            </span>
            <select
              className="field !py-1.5"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              disabled={!classId}
            >
              <option value="">All</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Status
            </span>
            <select
              className="field !py-1.5"
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as "all" | "active" | "inactive")
              }
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </select>
          </label>
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
              To
            </span>
            <input
              type="date"
              className="field !py-1.5"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Month
            </span>
            <input
              type="month"
              className="field !py-1.5"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              title="Used by monthly admission report"
            />
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
          Custom download — columns
        </h3>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          Tick fields, then use Excel / PDF on Custom download below
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {CUSTOM_DOWNLOAD_COLUMNS.map((c) => {
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {SIS_REPORT_CATEGORIES.map((cat) => (
          <section
            key={cat.id}
            className="overflow-hidden rounded-md border border-[rgba(32,48,80,0.08)] bg-[#f3f4f6] shadow-sm"
          >
            <header
              className={`${cat.headerClass} px-4 py-3 text-white`}
            >
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
