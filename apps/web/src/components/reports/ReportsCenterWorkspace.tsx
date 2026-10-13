"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { FileBarChart2, Search } from "lucide-react";
import { AdmissionReportsPanel } from "@/components/admissions/AdmissionReportsPanel";
import { StudentAttendanceReportsPanel } from "@/components/attendance/StudentAttendanceReportsPanel";
import { FeeReportsPanel } from "@/components/fees/FeeFinancePanels";
import { PayrollReportsPanel } from "@/components/payroll/PayrollReportsPanel";
import {
  AccountsReportsRunner,
  CertificatesReportsRunner,
  CommsReportsRunner,
  PtmReportsRunner,
  RteReportsRunner,
  StudentLeaveReportsRunner,
  VaultReportsRunner,
  ExamReportsRunner,
  HomeworkReportsRunner,
  LibraryReportsRunner,
  StoreReportsRunner,
  TimetableReportsRunner,
  TransportReportsRunner,
  TrustReportsRunner,
} from "@/components/reports/ModuleReportRunners";
import { useDemoSession } from "@/components/shell/SessionContext";
import { useMyTeaching } from "@/components/staff/useMyTeaching";
import {
  StaffAttendanceReportsPanel,
  StaffLeaveReportsPanel,
} from "@/components/staff/StaffLeaveReportsPanel";
import { SisReportsPanel } from "@/components/students/SisReportsPanel";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { currentAcademicYearCode, loadMasters } from "@/lib/masters";
import {
  canAccessModule,
  hasPermission,
  loadRbac,
} from "@/lib/rbac";
import {
  clearReportsCenterRecent,
  loadReportsCenterRecent,
  recordReportsCenterOpen,
  type ReportsCenterRecentItem,
} from "@/lib/reportsCenter";
import {
  allowedEntryRbac,
  filterReportsCenterEntries,
  isStaffRecordsEntry,
  listReportsCenterEntries,
  moduleLabel,
  REPORTS_CENTER_MODULES,
  type ReportsCenterModuleId,
} from "@/lib/reportsCenterCatalog";
import { isModuleEnabled } from "@/lib/moduleRegistry";
import { ReportDataGate } from "@/components/reports/ReportDataGate";
import type { ReportDesk } from "@/lib/reportDataGuard";
import { reportDesksFor, type ReportCatalog } from "@/lib/reportDesks";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";

type HubTab = "dashboard" | "catalog" | "recent" | ReportsCenterModuleId;

export function ReportsCenterWorkspace() {
  const session = useDemoSession();
  const [tab, setTab] = useState<HubTab>("dashboard");
  const [query, setQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState<
    ReportsCenterModuleId | "all"
  >("all");
  const [recent, setRecent] = useState<ReportsCenterRecentItem[]>([]);
  const [ay, setAy] = useState("");
  // The report "Run here" / a ?report= link asked for: the module panel
  // scrolls to it and highlights it (it opened the module and left the
  // person to find the report again).
  const [focusReport, setFocusReport] = useState("");

  // Teacher mode (2026-09-29): no reports about colleagues (staff leave,
  // staff attendance), and the class-based runners narrow to the teacher's
  // own sections (each runner reads "my classes" itself). Principal /
  // office come back unrestricted — unchanged. Colleagues' records stay
  // hidden until that answer confirms a school-wide login, failing closed
  // while it loads so a teacher never gets a moment with the Staff tab.
  const { my } = useMyTeaching();
  const hideStaffRecords = !my?.unrestricted;

  const { allowedModules, allowedRbac } = useMemo(() => {
    const masters = loadMasters();
    const rbac = loadRbac();
    const mods = REPORTS_CENTER_MODULES.filter((m) => {
      if (!canAccessModule(session, masters, m.rbacModule, rbac)) return false;
      if (hideStaffRecords && m.id === "staff") return false;
      if (m.id === "rte") return isModuleEnabled("rte_ews");
      return true;
    });
    // Every module an entry is gated by, not only the tabs' own: the news
    // register is gated by "news" and was filtered out for everyone.
    const set = allowedEntryRbac(mods, listReportsCenterEntries(), (m) =>
      canAccessModule(session, masters, m, rbac),
    );
    return { allowedModules: mods, allowedRbac: set };
  }, [session, hideStaffRecords]);

  const canExport = useMemo(() => {
    const masters = loadMasters();
    const rbac = loadRbac();
    return [...allowedRbac].some((m) =>
      hasPermission(session, masters, m, "export", rbac),
    );
  }, [session, allowedRbac]);

  useEffect(() => {
    setRecent(loadReportsCenterRecent());
    setAy(session.academicYearCode || currentAcademicYearCode() || "");
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("module");
    if (
      raw &&
      REPORTS_CENTER_MODULES.some((m) => m.id === raw) &&
      allowedModules.some((m) => m.id === raw)
    ) {
      setTab(raw as ReportsCenterModuleId);
      setFocusReport(params.get("report") || "");
      return;
    }
    const tabRaw = new URLSearchParams(window.location.search).get("tab");
    if (tabRaw === "dashboard" || tabRaw === "catalog" || tabRaw === "recent") {
      setTab(tabRaw as HubTab);
    }
  }, [session.academicYearCode, allowedModules]);

  const allEntries = useMemo(() => listReportsCenterEntries(), []);
  const filtered = useMemo(
    () =>
      filterReportsCenterEntries(allEntries, {
        query,
        moduleId: moduleFilter,
        allowedRbac,
      }).filter((e) => !hideStaffRecords || !isStaffRecordsEntry(e)),
    [allEntries, query, moduleFilter, allowedRbac, hideStaffRecords],
  );

  const hubTabs: ModuleTabItem[] = useMemo(() => {
    const base: ModuleTabItem[] = [
      { id: "dashboard", label: "Dashboard", tone: "navy" },
      { id: "catalog", label: "Catalog", tone: "navy" },
      { id: "recent", label: "Recent", tone: "slate" },
    ];
    for (const m of allowedModules) {
      base.push({
        id: m.id,
        label: m.label,
        tone: "teal",
      });
    }
    return base;
  }, [allowedModules]);

  function openEntry(entry: (typeof filtered)[number], e?: MouseEvent) {
    recordReportsCenterOpen(entry);
    setRecent(loadReportsCenterRecent());
    if (e?.metaKey || e?.ctrlKey) return;
  }

  if (allowedModules.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold text-[var(--brand-deep)]">
          Reports Center
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Your role has no module export access. Ask Admin to grant view/export
          on Fees, Students, or another module.
        </p>
      </div>
    );
  }

  return (
    <ErpWorkspaceShell
      title="Reports Center"
      subtitle={
        <>
          Search every module report · run exports here · or open the module Reports tab
          {ay ? ` · Session ${ay}` : ""}
          {!canExport ? " · view only (no export on your roles)" : ""}
        </>
      }
      icon={<FileBarChart2 className="size-6" aria-hidden />}
      actions={
        <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          <span className="font-semibold">{filtered.length}</span> report
          {filtered.length === 1 ? "" : "s"}
          {moduleFilter !== "all" || query
            ? " matching"
            : ` · ${allowedModules.length} modules`}
        </p>
      }
    >
      <ModuleTabs
        items={hubTabs}
        value={tab}
        onChange={(id) => setTab(id as HubTab)}
      />

      {tab === "dashboard" ? (
        <ModuleDashboardHost
          moduleId="reports"
          onNavigateTab={(t) => setTab(t as HubTab)}
        />
      ) : null}

      {tab === "catalog" ? (
        <section className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[16rem] flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"
                aria-hidden
              />
              <input
                className={`${field} w-full pl-9`}
                placeholder="Search reports (defaulters, CWIP, payroll…)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select
              className={field}
              value={moduleFilter}
              onChange={(e) =>
                setModuleFilter(
                  e.target.value as ReportsCenterModuleId | "all",
                )
              }
            >
              <option value="all">All modules</option>
              {allowedModules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <ErpTableShell>
            <div className="overflow-x-auto">
            <ErpTable>
              <ErpTableHead>
                <tr>
                  <th className="px-3 py-2 font-medium">Report</th>
                  <th className="px-3 py-2 font-medium">Module</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {filtered.map((e) => (
                  <tr key={e.key}>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-[var(--brand-deep)]">
                        {e.label}
                      </p>
                      {e.hint ? (
                        <p className="text-xs text-[var(--muted)]">{e.hint}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--muted)]">
                      {moduleLabel(e.moduleId)}
                    </td>
                    <td className="px-3 py-2.5 capitalize text-[var(--muted)]">
                      {e.category.replace(/_/g, " ")}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {e.runHere ? (
                          <button
                            type="button"
                            className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--brand-deep)]"
                            onClick={() => {
                              recordReportsCenterOpen(e);
                              setRecent(loadReportsCenterRecent());
                              setFocusReport(e.reportId);
                              setTab(e.moduleId);
                            }}
                          >
                            Run here
                          </button>
                        ) : null}
                        {/* Entries that only run here (accounts desk registers) point
                            back at /reports — a same-page link would do nothing. */}
                        {e.href.startsWith("/reports") ? null : (
                          <Link
                            href={e.href}
                            className="rounded-lg bg-[var(--primary)] px-2.5 py-1 text-xs font-medium text-[var(--primary-foreground)]"
                            onClick={(ev) => openEntry(e, ev)}
                          >
                            {e.runHere ? "Open module" : "Open"}
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-8 text-center text-sm text-[var(--muted)]"
                    >
                      No reports match this search.
                    </td>
                  </tr>
                ) : null}
              </ErpTableBody>
            </ErpTable>
            </div>
          </ErpTableShell>
        </section>
      ) : null}

      {tab === "recent" ? (
        <section className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--muted)]">
              Last reports you opened from this hub (this browser).
            </p>
            {recent.length > 0 ? (
              <button
                type="button"
                className="text-xs text-[var(--muted)] underline"
                onClick={() => {
                  clearReportsCenterRecent();
                  setRecent([]);
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
          {recent.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]">
              Nothing yet — pick a report from Catalog.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {recent
                .filter(
                  (r) =>
                    allowedModules.some((m) => m.id === r.moduleId) &&
                    (!hideStaffRecords || !isStaffRecordsEntry(r)),
                )
                .map((r) => (
                  <li
                    key={`${r.key}_${r.at}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-[var(--brand-deep)]">
                        {r.label}
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        {moduleLabel(r.moduleId as ReportsCenterModuleId)} ·{" "}
                        {new Date(r.at).toLocaleString("en-IN")}
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      {allEntries.find((x) => x.key === r.key)?.runHere !== false ? (
                        <button
                          type="button"
                          className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium"
                          onClick={() => {
                            setFocusReport(r.reportId);
                            setTab(r.moduleId as ReportsCenterModuleId);
                          }}
                        >
                          Run here
                        </button>
                      ) : null}
                      {r.href.startsWith("/reports") ? null : (
                        <Link
                          href={r.href}
                          className="rounded-lg bg-[var(--primary)] px-2.5 py-1 text-xs font-medium text-[var(--primary-foreground)]"
                        >
                          Open
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab !== "dashboard" && tab !== "catalog" && tab !== "recent" ? (
        <section className="mt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-[var(--muted)]">
              {REPORTS_CENTER_MODULES.find((m) => m.id === tab)?.blurb}
            </p>
            <Link
              href={
                REPORTS_CENTER_MODULES.find((m) => m.id === tab)?.href ||
                "/reports"
              }
              className="text-sm font-medium text-[var(--brand-deep)] underline"
            >
              Open full module →
            </Link>
          </div>
          {/* Each module's panel mounts only once the records its reports
              read have loaded — keyed by tab so switching modules re-gates. */}
          <ReportDataGate key={tab} desks={moduleReportDesks(tab, hideStaffRecords)}>
            <FocusReport reportId={focusReport} onDone={() => setFocusReport("")}>
              <ModuleRunner id={tab} ay={ay} hideStaffRecords={hideStaffRecords} focusReportId={focusReport} />
            </FocusReport>
          </ReportDataGate>
          <LinkedReports
            entries={allEntries.filter(
              (e) =>
                e.moduleId === tab &&
                !e.runHere &&
                allowedRbac.has(e.rbacModule) &&
                (!hideStaffRecords || !isStaffRecordsEntry(e)),
            )}
            onOpen={(e) => {
              recordReportsCenterOpen(e);
              setRecent(loadReportsCenterRecent());
            }}
          />
        </section>
      ) : null}
    </ErpWorkspaceShell>
  );
}

/**
 * The stores a Reports Center module tab reads (lib/reportDesks). Link-only
 * tabs and the store (server reports) need none.
 */
function moduleReportDesks(id: ReportsCenterModuleId, hideStaffRecords: boolean): ReportDesk[] {
  const cats: Partial<Record<ReportsCenterModuleId, ReportCatalog[]>> = {
    fees: ["fees"],
    students: ["sis"],
    admissions: ["admissions"],
    staff: ["staff_leave"],
    attendance: hideStaffRecords ? ["student_attendance"] : ["student_attendance", "staff_leave"],
    homework: ["homework"],
    ptm: ["ptm"],
    student_leave: ["student_leave"],
    vault: ["vault"],
    rte: ["rte"],
    payroll: ["payroll"],
    transport: ["transport"],
    accounts: ["accounts"],
    trust: ["trust"],
    timetable: ["timetable"],
    exams: ["exams"],
    library: ["library"],
    certificates: ["certificates"],
    comms: ["comms"],
  };
  return [...new Set((cats[id] ?? []).flatMap((c) => reportDesksFor(c)))];
}

/**
 * Scroll to and highlight the report a "Run here" asked for, once the
 * module's panel has drawn it (the panels tag each report row with
 * data-report-id).
 */
function FocusReport({ reportId, onDone, children }: { reportId: string; onDone: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!reportId) return;
    let tries = 0;
    let cleanup: (() => void) | null = null;
    const timer = window.setInterval(() => {
      tries += 1;
      const el = box.current?.querySelector<HTMLElement>(`[data-report-id="${CSS.escape(reportId)}"]`);
      if (!el && tries < 40) return;
      window.clearInterval(timer);
      if (!el) return onDone();
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-[var(--primary)]", "ring-offset-2");
      const off = window.setTimeout(() => {
        el.classList.remove("ring-2", "ring-[var(--primary)]", "ring-offset-2");
        onDone();
      }, 4000);
      cleanup = () => window.clearTimeout(off);
    }, 150);
    return () => {
      window.clearInterval(timer);
      cleanup?.();
    };
    // onDone is a fresh closure each render; the report id drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);
  return <div ref={box}>{children}</div>;
}

/** Reports of this module that live on its own screen — listed with "Open". */
function LinkedReports({
  entries,
  onOpen,
}: {
  entries: ReturnType<typeof listReportsCenterEntries>;
  onOpen: (e: ReturnType<typeof listReportsCenterEntries>[number]) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="mt-6">
      <h3 className="mb-2 text-sm font-semibold text-[var(--brand-deep)]">On the module&apos;s own screen</h3>
      <ul className="space-y-1.5">
        {entries.map((e) => (
          <li
            key={e.key}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-[var(--brand-deep)]">{e.label}</p>
              {e.hint ? <p className="text-xs text-[var(--muted)]">{e.hint}</p> : null}
            </div>
            <Link href={e.href} className={btnOutline} onClick={() => onOpen(e)}>
              Open
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ModuleRunner({
  id,
  ay,
  hideStaffRecords,
  focusReportId,
}: {
  id: ReportsCenterModuleId;
  ay: string;
  hideStaffRecords: boolean;
  focusReportId: string;
}) {
  switch (id) {
    case "fees":
      return <FeeReportsPanel academicYearCode={ay} />;
    case "students":
      return <SisReportsPanel />;
    case "admissions":
      return <AdmissionReportsPanel />;
    case "staff":
      // Unreachable for a teacher (the tab is not offered); belt and braces
      // for a stale ?module=staff link.
      return hideStaffRecords ? null : <StaffLeaveReportsPanel ay={ay} scope="leave" />;
    case "attendance":
      // A teacher gets their own classes' student attendance only — the
      // staff attendance report is every colleague's punches.
      if (hideStaffRecords) return <StudentAttendanceReportsPanel ay={ay} />;
      return (
        <div className="space-y-8">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-[var(--brand-deep)]">
              Student attendance
            </h3>
            <StudentAttendanceReportsPanel ay={ay} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-[var(--brand-deep)]">
              Staff attendance
            </h3>
            <StaffAttendanceReportsPanel ay={ay} />
          </div>
        </div>
      );
    case "homework":
      return <HomeworkReportsRunner ay={ay} />;
    case "ptm":
      return <PtmReportsRunner />;
    case "student_leave":
      return <StudentLeaveReportsRunner ay={ay} />;
    case "vault":
      return <VaultReportsRunner />;
    case "rte":
      return <RteReportsRunner ay={ay} />;
    case "payroll":
      return <PayrollReportsPanel academicYearCode={ay} />;
    case "store":
      return <StoreReportsRunner initialReport={focusReportId || undefined} />;
    case "transport":
      return <TransportReportsRunner />;
    case "accounts":
      return <AccountsReportsRunner />;
    case "trust":
      return <TrustReportsRunner />;
    case "timetable":
      return <TimetableReportsRunner ay={ay} />;
    case "exams":
      return <ExamReportsRunner ay={ay} />;
    case "library":
      return <LibraryReportsRunner />;
    case "certificates":
      return <CertificatesReportsRunner />;
    case "comms":
      return <CommsReportsRunner />;
    default:
      return null;
  }
}
