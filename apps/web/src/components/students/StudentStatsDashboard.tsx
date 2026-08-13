"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useDemoSession } from "@/components/shell/SessionContext";
import {
  currentAcademicYearCode,
  type MastersState,
} from "@/lib/masters";
import { type SisState, type SisStudent } from "@/lib/sis";
import { isMissing } from "@/lib/studentFilters";
import { loadTransport } from "@/lib/transport";
import { FilterExportButtons } from "@/components/reports/FilterExportButtons";
import { describeFilters } from "@/lib/reportExport";
import { TENANT } from "@/lib/types";
import { ErpTable, ErpTableBody, ErpTableHead } from "@/components/ui/erp-roster";

function StatIcon({
  tone,
  children,
}: {
  tone: "green" | "red" | "amber" | "sky" | "blue" | "indigo" | "slate";
  children: React.ReactNode;
}) {
  const bg: Record<typeof tone, string> = {
    green: "bg-[#e8f5e9] text-[#2e7d32]",
    red: "bg-[#ffebee] text-[#c62828]",
    amber: "bg-[#fff8e1] text-[#f9a825]",
    sky: "bg-[#e1f5fe] text-[#0288d1]",
    blue: "bg-[#e3f2fd] text-[#1565c0]",
    indigo: "bg-[#e8eaf6] text-[#3949ab]",
    slate: "bg-[#eceff1] text-[#455a64]",
  };
  return (
    <span
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${bg[tone]}`}
    >
      {children}
    </span>
  );
}

type StatTone = "green" | "red" | "amber" | "sky" | "blue" | "indigo" | "slate";

type StatCell = {
  label: string;
  value: number;
  tone: StatTone;
  icon: React.ReactNode;
  onClick?: () => void;
};

function StatRow({ cell, bordered }: { cell: StatCell; bordered?: boolean }) {
  const clickable = !!cell.onClick && cell.value > 0;
  return (
    <button
      type="button"
      onClick={clickable ? cell.onClick : undefined}
      disabled={!clickable}
      className={`flex w-full items-center gap-3 px-3 py-3 text-left transition ${
        bordered ? "border-b border-[var(--border)]" : ""
      } ${clickable ? "cursor-pointer hover:bg-[#f5f8fb]" : "cursor-default"}`}
      title={clickable ? `View ${cell.label}` : undefined}
    >
      <StatIcon tone={cell.tone}>{cell.icon}</StatIcon>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-[var(--muted)]">{cell.label}</div>
        <div className="text-lg font-semibold tabular-nums text-[#263238]">
          {cell.value}
        </div>
      </div>
      {clickable ? (
        <span className="text-[#b0bec5]" aria-hidden>
          ›
        </span>
      ) : null}
    </button>
  );
}

function PairCard({ left, right }: { left: StatCell; right: StatCell }) {
  return (
    <div className="overflow-hidden rounded-md border border-[var(--border)] bg-[var(--card)] shadow-sm">
      <StatRow cell={left} bordered />
      <StatRow cell={right} />
    </div>
  );
}

function BreakdownTable({
  title,
  colA,
  colB,
  rows,
  empty,
  showTotal = true,
  onRowClick,
}: {
  title: string;
  colA: string;
  colB: string;
  rows: { key: string; label: string; count: number }[];
  empty?: string;
  showTotal?: boolean;
  onRowClick?: (key: string, label: string) => void;
}) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div className="overflow-hidden rounded-md border border-[var(--border)] bg-[var(--card)] shadow-sm">
      <div className="border-b border-[#90caf9] bg-[#e3f2fd] px-3 py-2 text-sm font-semibold text-[#1565c0]">
        {title}
      </div>
      <div className="max-h-72 overflow-auto">
        <ErpTable className="text-[13px]">
          <ErpTableHead>
            <tr>
              <th className="px-3 py-2 font-semibold">{colA}</th>
              <th className="px-3 py-2 text-right font-semibold">{colB}</th>
            </tr>
          </ErpTableHead>
          <ErpTableBody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-2 py-2">
                  <div className="rounded bg-[#ffebee] px-3 py-2 text-center text-[12px] font-medium text-[#c62828]">
                    {empty || "No record found."}
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const clickable = !!onRowClick && r.count > 0;
                return (
                  <tr
                    key={r.key}
                    onClick={
                      clickable ? () => onRowClick!(r.key, r.label) : undefined
                    }
                    className={
                      clickable ? "cursor-pointer hover:bg-[#f5f8fb]" : ""
                    }
                    title={clickable ? `View ${r.label}` : undefined}
                  >
                    <td className="px-3 py-1.5">
                      {clickable ? (
                        <span className="text-[#1565c0]">{r.label}</span>
                      ) : (
                        r.label
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                      {r.count}
                    </td>
                  </tr>
                );
              })
            )}
            {showTotal && rows.length > 0 ? (
              <tr className="bg-[var(--accent)] font-semibold text-[var(--foreground)]">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{total}</td>
              </tr>
            ) : null}
          </ErpTableBody>
        </ErpTable>
      </div>
    </div>
  );
}

function StudentListDrawer({
  title,
  students,
  masters,
  onClose,
}: {
  title: string;
  students: SisStudent[];
  masters: MastersState;
  onClose: () => void;
}) {
  const classSec = (s: SisStudent) => {
    const cls = masters.classes.find((c) => c.id === s.classId)?.name ?? "—";
    const sec = masters.sections.find((x) => x.id === s.sectionId)?.name ?? "";
    return sec ? `${cls}-${sec}` : cls;
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--overlay)] p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
          <div className="text-sm font-semibold text-[var(--brand-deep)]">
            {title}
            <span className="ml-2 text-xs font-normal text-[var(--muted)]">
              {students.length} student{students.length === 1 ? "" : "s"}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs font-semibold text-[var(--muted)] hover:bg-[var(--surface-sunken)]"
          >
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <ErpTable className="text-[13px]">
            <ErpTableHead sticky>
              <tr>
                <th className="px-4 py-2 font-semibold">#</th>
                <th className="px-4 py-2 font-semibold">Student</th>
                <th className="px-4 py-2 font-semibold">Class</th>
                <th className="px-4 py-2 font-semibold">Admission</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {students.map((s, i) => (
                <tr key={s.id}>
                  <td className="px-4 py-2 tabular-nums text-[#90a4ae]">
                    {i + 1}
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/students/${s.id}/edit`}
                      className="font-medium text-[var(--brand-deep)] hover:underline"
                    >
                      {s.fullName}
                    </Link>
                    {s.status !== "active" ? (
                      <span className="ml-2 text-[10px] text-[#c62828]">
                        inactive
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-[var(--muted)]">
                    {classSec(s)}
                    {s.rollNo ? ` · ${s.rollNo}` : ""}
                  </td>
                  <td className="px-4 py-2 text-[var(--muted)]">{s.admissionNo}</td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </div>
      </div>
    </div>
  );
}

/**
 * Compliance readiness.
 *
 * Every other tile on this dashboard counts what the roster *is*. These
 * count what still needs doing, and each one links into the register
 * already filtered to exactly those students — so the number is the
 * start of the work, not a fact to write down and act on elsewhere.
 */
function ComplianceCard({
  activeCount,
  udiseReady,
  qualityPct,
  missingCounts,
  sessionAy,
}: {
  activeCount: number;
  udiseReady: number;
  qualityPct: number;
  missingCounts: Record<string, number>;
  sessionAy: string;
}) {
  const readyPct =
    activeCount === 0 ? 100 : Math.round((udiseReady / activeCount) * 100);

  const gaps: { field: string; label: string; count: number }[] = [
    { field: "apaar", label: "APAAR ID", count: missingCounts.apaar ?? 0 },
    { field: "pen", label: "PEN", count: missingCounts.pen ?? 0 },
    { field: "aadhaar", label: "Aadhaar", count: missingCounts.aadhaar ?? 0 },
    { field: "dob", label: "Date of birth", count: missingCounts.dob ?? 0 },
    { field: "household", label: "Household link", count: missingCounts.household ?? 0 },
    { field: "photo", label: "Photo", count: missingCounts.photo ?? 0 },
  ].sort((a, b) => b.count - a.count);

  const tone =
    readyPct >= 90 ? "#2e7d32" : readyPct >= 50 ? "#f9a825" : "#c62828";

  return (
    <div className="overflow-hidden rounded-md border border-[var(--border)] bg-[var(--card)] shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ffcc80] bg-[#fff8e1] px-3 py-2">
        <span className="text-sm font-semibold text-[#e65100]">
          Compliance &amp; data quality · {sessionAy}
        </span>
        <span className="text-[11px] text-[#8d6e63]">
          Active roster only · UDISE+ needs PEN, APAAR, Aadhaar and DOB
        </span>
      </div>

      <div className="grid gap-4 px-3 py-3 md:grid-cols-[minmax(0,18rem)_1fr]">
        <div>
          <div className="text-[12px] text-[var(--muted)]">UDISE+ ready</div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span
              className="text-2xl font-semibold tabular-nums"
              style={{ color: tone }}
            >
              {udiseReady}
            </span>
            <span className="text-sm text-[var(--muted)]">
              of {activeCount} students
            </span>
          </div>
          <div
            className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]"
            role="progressbar"
            aria-valuenow={readyPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="UDISE+ readiness"
          >
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${readyPct}%`, background: tone }}
            />
          </div>
          <div className="mt-1.5 text-[11px] text-[var(--muted)]">
            {readyPct}% filing-ready · {qualityPct}% of all tracked fields present
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {gaps.map((g) => {
            const clean = g.count === 0;
            return (
              <Link
                key={g.field}
                href={`/students?tab=register&missingFilter=${g.field}&sortBy=name`}
                className={`rounded-md border px-2.5 py-2 transition ${
                  clean
                    ? "border-[#c8e6c9] bg-[#f1f8e9]"
                    : "border-[#ffcdd2] bg-[#fff5f5] hover:bg-[#ffebee]"
                }`}
                title={
                  clean
                    ? `Every active student has ${g.label}`
                    : `Open the ${g.count} student(s) missing ${g.label}`
                }
              >
                <div
                  className="text-lg font-semibold tabular-nums"
                  style={{ color: clean ? "#2e7d32" : "#c62828" }}
                >
                  {g.count}
                </div>
                <div className="text-[11px] leading-tight text-[var(--muted)]">
                  missing {g.label}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function StudentStatsDashboard({
  sis,
  masters,
}: {
  sis: SisState;
  masters: MastersState;
}) {
  const session = useDemoSession();
  const ay =
    session.academicYearCode || currentAcademicYearCode(masters);
  const transport = useMemo(() => loadTransport(), [sis.students.length]);

  const stats = useMemo(() => {
    const normalizeAy = (code: string) => {
      const t = (code || "").trim().replace(/\s+/g, "").replace(/–/g, "-");
      const full = t.match(/^(20\d{2})-(20\d{2})$/);
      if (full) return `${full[1]}-${full[2]!.slice(2)}`;
      return t || ay;
    };
    const sessionAy = normalizeAy(ay);

    const inSession = (s: (typeof sis.students)[number]) =>
      normalizeAy(s.academicYearCode || ay) === sessionAy;

    const sessionStudents = sis.students.filter(inSession);
    const active = sessionStudents.filter((s) => s.status === "active");
    const inactive = sessionStudents.filter((s) => s.status === "inactive");

    /** New = not enrolled in any earlier session; Old = continuing from prior year. */
    const earlierAdmissions = new Set(
      sis.students
        .filter(
          (s) => normalizeAy(s.academicYearCode || "") < sessionAy,
        )
        .map((s) => s.admissionNo.trim().toUpperCase()),
    );
    const newCount = active.filter(
      (s) => !earlierAdmissions.has(s.admissionNo.trim().toUpperCase()),
    ).length;
    const oldCount = active.filter((s) =>
      earlierAdmissions.has(s.admissionNo.trim().toUpperCase()),
    ).length;

    const male = active.filter((s) => s.gender === "M").length;
    const female = active.filter((s) => s.gender === "F").length;

    const today = new Date().toISOString().slice(0, 10);
    const transportStudentIds = new Set(
      transport.assignments
        .filter((a) => !a.effectiveTo || a.effectiveTo >= today)
        .map((a) => a.studentId),
    );
    const transportCount = active.filter((s) =>
      transportStudentIds.has(s.id),
    ).length;

    const boarding = 0;

    const classRows = masters.classes
      .filter((c) => c.isActive !== false)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => ({
        key: c.id,
        label: c.name,
        count: active.filter((s) => s.classId === c.id).length,
      }))
      .filter((r) => r.count > 0);

    /**
     * Session-wise ADMISSION: count each student once in the year they were
     * first admitted (earliest enrollment), so promoted students are not
     * double-counted across every session.
     */
    const firstSessionByAdm = new Map<string, string>();
    for (const s of sis.students) {
      const adm = s.admissionNo.trim().toUpperCase();
      if (!adm) continue;
      const code = normalizeAy(s.academicYearCode || ay);
      const prev = firstSessionByAdm.get(adm);
      if (!prev || code < prev) firstSessionByAdm.set(adm, code);
    }
    const admissionMap = new Map<string, number>();
    for (const code of firstSessionByAdm.values()) {
      admissionMap.set(code, (admissionMap.get(code) ?? 0) + 1);
    }
    const admissionRows = [...admissionMap.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([label, count]) => ({ key: label, label, count }));

    const religionMap = new Map<string, number>();
    for (const s of active) {
      const rel = (s.religion || "").trim().toUpperCase() || "NOT SET";
      religionMap.set(rel, (religionMap.get(rel) ?? 0) + 1);
    }
    const religionRows = [...religionMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ key: label, label, count }));

    const categoryMap = new Map<string, number>();
    for (const s of active) {
      const cat = (s.category || "").trim().toUpperCase() || "NOT SET";
      categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + 1);
    }
    const categoryRows = [...categoryMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ key: label, label, count }));

    /**
     * Compliance readiness for the active roster.
     *
     * PEN and APAAR are UDISE+/CBSE requirements and were invisible on
     * this dashboard, which reported gender splits and transport counts
     * while 98% of the roster had no APAAR ID. Counted against active
     * students only — inactive records are not filed.
     */
    const COMPLIANCE_FIELDS = [
      "apaar",
      "pen",
      "aadhaar",
      "dob",
      "household",
      "photo",
    ] as const;

    const missingCounts = Object.fromEntries(
      COMPLIANCE_FIELDS.map((f) => [
        f,
        active.filter((s) => isMissing(s, f)).length,
      ]),
    ) as Record<(typeof COMPLIANCE_FIELDS)[number], number>;

    /** UDISE+ filing needs PEN, APAAR, Aadhaar and DOB on every child. */
    const udiseReady = active.filter(
      (s) =>
        !isMissing(s, "pen") &&
        !isMissing(s, "apaar") &&
        !isMissing(s, "aadhaar") &&
        !isMissing(s, "dob"),
    ).length;

    /** Share of all tracked fields present across the active roster. */
    const totalChecks = active.length * COMPLIANCE_FIELDS.length;
    const filledChecks =
      totalChecks -
      COMPLIANCE_FIELDS.reduce((sum, f) => sum + missingCounts[f], 0);
    const qualityPct =
      totalChecks === 0 ? 100 : Math.round((filledChecks / totalChecks) * 100);

    return {
      missingCounts,
      udiseReady,
      qualityPct,
      active: active.length,
      inactive: inactive.length,
      oldCount,
      newCount,
      male,
      female,
      boarding,
      transportCount,
      classRows,
      admissionRows,
      firstSessionByAdm,
      categoryRows,
      religionRows,
      sessionAy,
      // Base data for click-through lists
      activeList: active,
      inactiveList: inactive,
      sessionStudents,
      earlierAdmissions,
      transportStudentIds,
      normalizeAy,
    };
  }, [sis, masters, ay, transport]);

  const [drawer, setDrawer] = useState<{
    title: string;
    students: SisStudent[];
  } | null>(null);

  const openDrawer = (title: string, students: SisStudent[]) => {
    if (students.length === 0) return;
    setDrawer({
      title,
      students: [...students].sort((a, b) => {
        const roll = Number(a.rollNo) - Number(b.rollNo);
        if (Number.isFinite(roll) && roll !== 0) return roll;
        return a.fullName.localeCompare(b.fullName);
      }),
    });
  };

  const exportRows = useMemo(() => {
    const rows: Record<string, string | number>[] = [];
    for (const r of stats.classRows) {
      rows.push({ kind: "Class", name: r.label, students: r.count });
    }
    for (const r of stats.admissionRows) {
      rows.push({ kind: "Admission (session)", name: r.label, students: r.count });
    }
    for (const r of stats.categoryRows) {
      rows.push({ kind: "Category", name: r.label, students: r.count });
    }
    for (const r of stats.religionRows) {
      rows.push({ kind: "Religion", name: r.label, students: r.count });
    }
    return rows;
  }, [stats]);

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm">
        <span className="font-medium text-[var(--muted)]">
          Student overview · {stats.sessionAy} only (not combined years)
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/students/new"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] font-semibold text-[#1565c0] hover:bg-[#e3f2fd]"
          >
            <span aria-hidden>+</span> Add
          </Link>
          <FilterExportButtons
            title="Student statistics"
            subtitle={`${TENANT.shortName} · ${ay}`}
            filterNote={describeFilters([
              `Active ${stats.active}`,
              `Inactive ${stats.inactive}`,
            ])}
            fileBaseName="student_statistics"
            columns={[
              { key: "kind", header: "Breakup" },
              { key: "name", header: "Name" },
              { key: "students", header: "Students", align: "right" },
            ]}
            rows={exportRows}
            className="!gap-1"
          />
        </div>
      </div>

      <ComplianceCard
        activeCount={stats.active}
        udiseReady={stats.udiseReady}
        qualityPct={stats.qualityPct}
        missingCounts={stats.missingCounts}
        sessionAy={stats.sessionAy}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <PairCard
          left={{
            label: "Active Students",
            value: stats.active,
            tone: "green",
            onClick: () =>
              openDrawer(
                `Active students · ${stats.sessionAy}`,
                stats.activeList,
              ),
            icon: (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
              </svg>
            ),
          }}
          right={{
            label: "InActive Students",
            value: stats.inactive,
            tone: "red",
            onClick: () =>
              openDrawer(
                `Inactive students · ${stats.sessionAy}`,
                stats.inactiveList,
              ),
            icon: (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
              </svg>
            ),
          }}
        />
        <PairCard
          left={{
            label: "Continuing (in prior year)",
            value: stats.oldCount,
            tone: "amber",
            onClick: () =>
              openDrawer(
                `Continuing students · ${stats.sessionAy}`,
                stats.activeList.filter((s) =>
                  stats.earlierAdmissions.has(
                    s.admissionNo.trim().toUpperCase(),
                  ),
                ),
              ),
            icon: (
              <span className="text-[9px] font-extrabold tracking-wide">OLD</span>
            ),
          }}
          right={{
            label: "New admissions (this year)",
            value: stats.newCount,
            tone: "sky",
            onClick: () =>
              openDrawer(
                `New admissions · ${stats.sessionAy}`,
                stats.activeList.filter(
                  (s) =>
                    !stats.earlierAdmissions.has(
                      s.admissionNo.trim().toUpperCase(),
                    ),
                ),
              ),
            icon: (
              <span className="text-[9px] font-extrabold tracking-wide">NEW</span>
            ),
          }}
        />
        <PairCard
          left={{
            label: "Male Student",
            value: stats.male,
            tone: "blue",
            onClick: () =>
              openDrawer(
                `Boys · ${stats.sessionAy}`,
                stats.activeList.filter((s) => s.gender === "M"),
              ),
            icon: (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-6 1.7-6 3.5V17h12v-2.5C15 12.7 12.3 11 9 11zm9-7v2h2.6l-3.8 3.8A5 5 0 0 1 9 16a5 5 0 1 1 4.2-7.7L17 4.4V7h2V2h-5z" />
              </svg>
            ),
          }}
          right={{
            label: "Female Student",
            value: stats.female,
            tone: "sky",
            onClick: () =>
              openDrawer(
                `Girls · ${stats.sessionAy}`,
                stats.activeList.filter((s) => s.gender === "F"),
              ),
            icon: (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 10c-3.3 0-6 1.8-6 4v2h4v4h4v-4h4v-2c0-2.2-2.7-4-6-4z" />
              </svg>
            ),
          }}
        />
        <PairCard
          left={{
            label: "Boarding",
            value: stats.boarding,
            tone: "indigo",
            icon: (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4 11V4h16v7H4zm0 2h16v7H4v-7zm2 2v3h3v-3H6zm5 0v3h3v-3h-3zm5 0v3h3v-3h-3z" />
              </svg>
            ),
          }}
          right={{
            label: "Transport",
            value: stats.transportCount,
            tone: "blue",
            onClick: () =>
              openDrawer(
                `Transport students · ${stats.sessionAy}`,
                stats.activeList.filter((s) =>
                  stats.transportStudentIds.has(s.id),
                ),
              ),
            icon: (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5 11V6h14v5H5zm-1 2h16l1 4v3h-2v-1H5v1H3v-3l1-4zm3 1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm10 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" />
              </svg>
            ),
          }}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <BreakdownTable
          title={`Class Wise Students · ${stats.sessionAy}`}
          colA="Class"
          colB="Students"
          rows={stats.classRows}
          onRowClick={(key, label) =>
            openDrawer(
              `Class ${label} · ${stats.sessionAy}`,
              stats.activeList.filter(
                (s) =>
                  s.classId === key ||
                  masters.sections.find((sec) => sec.id === s.sectionId)
                    ?.classId === key,
              ),
            )
          }
        />
        <BreakdownTable
          title="Session Wise Admission"
          colA="Session"
          colB="Admissions"
          rows={stats.admissionRows}
          empty="No admissions recorded."
          onRowClick={(key, label) => {
            const admittedIn = new Set(
              [...stats.firstSessionByAdm.entries()]
                .filter(([, code]) => code === key)
                .map(([adm]) => adm),
            );
            openDrawer(
              `Admitted in ${label}`,
              sis.students.filter(
                (s) =>
                  admittedIn.has(s.admissionNo.trim().toUpperCase()) &&
                  stats.normalizeAy(s.academicYearCode || ay) === key,
              ),
            );
          }}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <BreakdownTable
          title="Category Wise Students"
          colA="Category"
          colB="Students"
          rows={stats.categoryRows}
          empty="No record found."
          onRowClick={(key, label) =>
            openDrawer(
              `Category ${label} · ${stats.sessionAy}`,
              stats.activeList.filter(
                (s) =>
                  ((s.category || "").trim().toUpperCase() || "NOT SET") ===
                  key,
              ),
            )
          }
        />
        <BreakdownTable
          title="Religion Wise Students"
          colA="Religion"
          colB="Students"
          rows={stats.religionRows}
          onRowClick={(key, label) =>
            openDrawer(
              `Religion ${label} · ${stats.sessionAy}`,
              stats.activeList.filter(
                (s) =>
                  ((s.religion || "").trim().toUpperCase() || "NOT SET") ===
                  key,
              ),
            )
          }
        />
      </div>

      {drawer ? (
        <StudentListDrawer
          title={drawer.title}
          students={drawer.students}
          masters={masters}
          onClose={() => setDrawer(null)}
        />
      ) : null}
    </div>
  );
}

