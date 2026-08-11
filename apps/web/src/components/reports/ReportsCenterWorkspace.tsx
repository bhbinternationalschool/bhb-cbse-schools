"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
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
  ExamReportsRunner,
  HomeworkReportsRunner,
  LibraryReportsRunner,
  StoreReportsRunner,
  TimetableReportsRunner,
  TransportReportsRunner,
  TrustReportsRunner,
} from "@/components/reports/ModuleReportRunners";
import { useDemoSession } from "@/components/shell/SessionContext";
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
  type RbacModule,
} from "@/lib/rbac";
import {
  clearReportsCenterRecent,
  loadReportsCenterRecent,
  recordReportsCenterOpen,
  type ReportsCenterRecentItem,
} from "@/lib/reportsCenter";
import {
  filterReportsCenterEntries,
  listReportsCenterEntries,
  moduleLabel,
  REPORTS_CENTER_MODULES,
  type ReportsCenterModuleId,
} from "@/lib/reportsCenterCatalog";
import { isModuleEnabled } from "@/lib/moduleRegistry";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";

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

  const { allowedModules, allowedRbac } = useMemo(() => {
    const masters = loadMasters();
    const rbac = loadRbac();
    const mods = REPORTS_CENTER_MODULES.filter((m) => {
      if (!canAccessModule(session, masters, m.rbacModule, rbac)) return false;
      if (m.id === "rte") return isModuleEnabled("rte_ews");
      return true;
    });
    const set = new Set<RbacModule>(mods.map((m) => m.rbacModule));
    return { allowedModules: mods, allowedRbac: set };
  }, [session]);

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
    const raw = new URLSearchParams(window.location.search).get("module");
    if (
      raw &&
      REPORTS_CENTER_MODULES.some((m) => m.id === raw) &&
      allowedModules.some((m) => m.id === raw)
    ) {
      setTab(raw as ReportsCenterModuleId);
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
      }),
    [allEntries, query, moduleFilter, allowedRbac],
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
        <p className="rounded-lg bg-[rgba(32,48,80,0.06)] px-3 py-2 text-sm text-[var(--brand-deep)]">
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

          <div className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.1)] bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-[rgba(32,48,80,0.04)] text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Report</th>
                  <th className="px-3 py-2 font-medium">Module</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr
                    key={e.key}
                    className="border-t border-[rgba(32,48,80,0.06)]"
                  >
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
                        <button
                          type="button"
                          className="rounded-lg border border-[rgba(32,48,80,0.15)] px-2.5 py-1 text-xs font-medium text-[var(--brand-deep)]"
                          onClick={() => {
                            recordReportsCenterOpen(e);
                            setRecent(loadReportsCenterRecent());
                            setTab(e.moduleId);
                          }}
                        >
                          Run here
                        </button>
                        <Link
                          href={e.href}
                          className="rounded-lg bg-[var(--brand-deep)] px-2.5 py-1 text-xs font-medium text-white"
                          onClick={(ev) => openEntry(e, ev)}
                        >
                          Open module
                        </Link>
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
              </tbody>
            </table>
          </div>
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
            <p className="rounded-xl border border-dashed border-[rgba(32,48,80,0.15)] px-4 py-8 text-center text-sm text-[var(--muted)]">
              Nothing yet — pick a report from Catalog.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {recent
                .filter((r) =>
                  allowedModules.some((m) => m.id === r.moduleId),
                )
                .map((r) => (
                  <li
                    key={`${r.key}_${r.at}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
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
                      <button
                        type="button"
                        className="rounded-lg border border-[rgba(32,48,80,0.15)] px-2.5 py-1 text-xs font-medium"
                        onClick={() =>
                          setTab(r.moduleId as ReportsCenterModuleId)
                        }
                      >
                        Run here
                      </button>
                      <Link
                        href={r.href}
                        className="rounded-lg bg-[var(--brand-deep)] px-2.5 py-1 text-xs font-medium text-white"
                      >
                        Open
                      </Link>
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
          <ModuleRunner id={tab} ay={ay} />
        </section>
      ) : null}
    </ErpWorkspaceShell>
  );
}

function ModuleRunner({
  id,
  ay,
}: {
  id: ReportsCenterModuleId;
  ay: string;
}) {
  switch (id) {
    case "fees":
      return <FeeReportsPanel academicYearCode={ay} />;
    case "students":
      return <SisReportsPanel />;
    case "admissions":
      return <AdmissionReportsPanel />;
    case "staff":
      return <StaffLeaveReportsPanel ay={ay} scope="leave" />;
    case "attendance":
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
      return (
        <p className="text-sm text-[var(--muted)]">
          Open{" "}
          <Link href="/ptm?tab=reports" className="underline">
            PTM → Reports
          </Link>{" "}
          to export bookings, slot fill, and feedback.
        </p>
      );
    case "student_leave":
      return (
        <p className="text-sm text-[var(--muted)]">
          Open{" "}
          <Link href="/attendance?tab=leave" className="underline">
            Attendance → Student leave
          </Link>{" "}
          (Reports sub-tab) to export the leave register and alerts.
        </p>
      );
    case "vault":
      return (
        <p className="text-sm text-[var(--muted)]">
          Open{" "}
          <Link href="/vault?tab=reports" className="underline">
            Vault → Reports
          </Link>{" "}
          for inventory and expiry calendar.
        </p>
      );
    case "rte":
      return (
        <p className="text-sm text-[var(--muted)]">
          Open{" "}
          <Link href="/admissions?tab=rte" className="underline">
            Admissions → RTE / EWS → Reports
          </Link>{" "}
          for quota dashboard, applications, and enrolled students.
        </p>
      );
    case "payroll":
      return <PayrollReportsPanel academicYearCode={ay} />;
    case "store":
      return <StoreReportsRunner />;
    case "purchase":
      return (
        <p className="text-sm text-[var(--muted)]">
          Open{" "}
          <Link href="/store?tab=purchase" className="underline">
            Store → Purchase → Reports
          </Link>{" "}
          for indent register, open POs, and GRNs.
        </p>
      );
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
