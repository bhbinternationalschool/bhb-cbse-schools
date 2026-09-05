"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Download,
  FileUp,
  List,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import {
  STAFF_STREAMS,
  isStaffActive,
  type StaffRecord,
} from "@/lib/foundationMasters";
import { loadMasters, saveMasters, currentAcademicYearCode, type MastersState } from "@/lib/masters";
import {
  applyStaffImport,
  downloadStaffImportTemplate,
  downloadStaffRosterCsv,
  previewStaffImport,
  workbookToStaffImportCsv,
  type StaffImportPreview,
} from "@/lib/staffImport";
import {
  checkStaffRemoval,
  removeStaff,
  resolveSessionStaff,
} from "@/lib/staffResolve";
import { RemoveControl } from "@/components/masters/RemoveControl";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { useModuleFilters } from "@/lib/moduleFilters";
import { FilterBar } from "@/components/ui/filter-bar";
import {
  ErpBar,
  ErpDonut,
  type ErpChartRow,
} from "@/components/ui/erp-chart-lazy";
import {
  ErpChartCard,
  ErpChartGrid,
  ErpMetricCard,
  ErpMetricGrid,
  ErpPanel,
  ErpStatusBadge,
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
  ErpToolbar,
  ErpToolbarBtn,
} from "@/components/ui/erp-roster";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";
import {
  BulkActionBar,
  ExportMenu,
  RowActionMenu,
  RowCheckbox,
  useRowSelection,
} from "@/components/ui/erp-grid";
import { openWaMe } from "@/lib/waMe";
import { field, btn } from "@/components/ui/erp-ui";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { StaffLeavePanel } from "@/components/staff/StaffLeavePanel";
import { StaffRequestsPanel } from "@/components/staff/StaffRequestsPanel";
import { StaffOutdoorDutyPanel } from "@/components/staff/StaffOutdoorDutyPanel";
import { StaffLeaveReportsPanel } from "@/components/staff/StaffLeaveReportsPanel";
import { StaffAppraisalPanel } from "@/components/staff/StaffAppraisalPanel";
import { StaffPayslipsPanel } from "@/components/staff/StaffPayslipsPanel";
import { StaffMyProfileDocs } from "@/components/staff/StaffMyProfileDocs";
import { StaffAgreementPanel, StaffAgreementSelfPanel } from "@/components/staff/StaffAgreementPanel";
import { DutyRosterPanel } from "@/components/staff/DutyRosterPanel";
import { TeacherAssignmentsPanel } from "@/components/staff/TeacherAssignmentsPanel";
import { TeachingAllocationPanel } from "@/components/staff/TeachingAllocationPanel";
import { DocVerificationQueuePanel } from "@/components/students/DocVerificationQueuePanel";
import { useDemoSession } from "@/components/shell/SessionContext";
import { StaffPresenceCard } from "@/components/staff/StaffPresenceCard";
import { StaffGeoAdminPanel } from "@/components/staff/StaffGeoAdminPanel";
import { hasPermission } from "@/lib/rbac";

type NamedCount = ErpChartRow;

type StaffFilters = {
  query: string;
  stream: string;
  status: string;
  department: string;
  designation: string;
  joinedFrom: string;
  joinedTo: string;
};

const EMPTY_STAFF_FILTERS: StaffFilters = {
  query: "",
  stream: "",
  status: "active",
  department: "",
  designation: "",
  joinedFrom: "",
  joinedTo: "",
};

type StaffMainTab =
  | "dashboard"
  | "roster"
  | "duty_roster"
  | "allocate"
  | "assignments"
  | "leave"
  | "requests"
  | "outdoor_duty"
  | "appraisal"
  | "reports"
  | "payslips"
  | "my_docs"
  | "doc_verify"
  | "agreements"
  | "presence"
  | "gps";

export function StaffWorkspace() {
  const router = useRouter();
  const session = useDemoSession();
  const ay = session.academicYearCode || currentAcademicYearCode();
  const [tab, setTab] = useState<StaffMainTab>("dashboard");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("tab");
    const allowed: StaffMainTab[] = [
      "dashboard",
      "roster",
      "duty_roster",
      "allocate",
      "assignments",
      "leave",
      "requests",
      "outdoor_duty",
      "appraisal",
      "reports",
      "payslips",
      "my_docs",
      "doc_verify",
      "agreements",
      "presence",
      "gps",
    ];
    if (raw && (allowed as string[]).includes(raw)) setTab(raw as StaffMainTab);
  }, []);
  const [state, setState] = useState<MastersState | null>(() =>
    typeof window !== "undefined" ? loadMasters() : null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const {
    filters: staffFilters,
    patch: patchStaffFilters,
    reset: resetStaffFilters,
    activeCount: staffActiveFilterCount,
  } = useModuleFilters({
    empty: EMPTY_STAFF_FILTERS,
    storageKey: "bhb_staff_filters_v1",
    defaults: { status: "active" },
  });

  useEffect(() => {
    setState(loadMasters());
    void (async () => {
      const [{ ensureStaffHydrated }, { withHydrationSlot }] = await Promise.all([
        import("@/lib/staffPersistence"),
        import("@/lib/deskHydrateGuard"),
      ]);
      const did = await withHydrationSlot(() => ensureStaffHydrated());
      if (did) setState(loadMasters());
    })();
  }, []);

  function commit(next: MastersState, msg?: string) {
    setState(next);
    saveMasters(next);
    if (msg) {
      setNotice(msg);
      window.setTimeout(() => setNotice(null), 2400);
    }
  }

  function toggleStatus(s: StaffRecord) {
    if (!state) return;
    const nextStatus = s.status === "active" ? "inactive" : "active";
    commit(
      {
        ...state,
        staff: state.staff.map((row) =>
          row.id === s.id ? { ...row, status: nextStatus } : row,
        ),
      },
      nextStatus === "active" ? `${s.empCode} activated` : `${s.empCode} inactivated`,
    );
  }

  function onRemove(s: StaffRecord) {
    if (!state) return;
    const result = removeStaff(state, s.id);
    if (!result.ok) {
      setNotice(result.reason);
      window.setTimeout(() => setNotice(null), 3200);
      return;
    }
    commit(result.state, `${s.empCode} removed`);
  }

  const stats = useMemo(() => {
    if (!state) return null;
    const staff = state.staff ?? [];
    const active = staff.filter(isStaffActive);
    const inactive = staff.filter((s) => !isStaffActive(s));
    const male = staff.filter((s) => s.gender === "M").length;
    const female = staff.filter((s) => s.gender === "F").length;

    const deptMap = new Map<string, NamedCount>();
    for (const s of staff) {
      const dep = state.departments.find((d) => d.id === s.departmentId);
      const label = dep?.name ?? "Unassigned";
      const key = dep?.id ?? "none";
      const cur = deptMap.get(key) ?? { key, label, value: 0 };
      cur.value += 1;
      deptMap.set(key, cur);
    }
    const departmentRows = [...deptMap.values()].sort((a, b) =>
      a.label.localeCompare(b.label),
    );

    const religionMap = new Map<string, number>();
    for (const s of staff) {
      const rel = (s.religion || "").trim().toUpperCase() || "NOT SET";
      religionMap.set(rel, (religionMap.get(rel) ?? 0) + 1);
    }
    const religionRows = [...religionMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ key: label, label, value }));

    const teaching = staff.filter((s) => s.stream === "teaching").length;
    const nonTeaching = staff.filter((s) => s.stream === "non_teaching").length;
    const streamRows: NamedCount[] = [
      { key: "teaching", label: "Teaching", value: teaching },
      { key: "non_teaching", label: "Non-teaching", value: nonTeaching },
    ].filter((r) => r.value > 0);

    const casteMap = new Map<string, number>();
    for (const s of staff) {
      const c = s.casteCategory || "NOT SET";
      casteMap.set(c, (casteMap.get(c) ?? 0) + 1);
    }
    const casteRows = [...casteMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ key: label, label, value }));

    const desMap = new Map<string, NamedCount>();
    for (const s of staff) {
      const des = state.designations.find((d) => d.id === s.designationId);
      const label = des?.name ?? "Unassigned";
      const key = des?.id ?? "none";
      const cur = desMap.get(key) ?? { key, label, value: 0 };
      cur.value += 1;
      desMap.set(key, cur);
    }
    const designationRows = [...desMap.values()].sort((a, b) =>
      a.label.localeCompare(b.label),
    );

    return {
      active: active.length,
      inactive: inactive.length,
      male,
      female,
      departmentRows,
      religionRows,
      streamRows,
      casteRows,
      designationRows,
    };
  }, [state]);

  const filtered = useMemo(() => {
    if (!state) return [];
    const q = staffFilters.query.trim().toLowerCase();
    return (state.staff ?? [])
      .filter((s) => {
        if (staffFilters.status === "active" && !isStaffActive(s)) return false;
        if (staffFilters.status === "inactive" && isStaffActive(s)) return false;
        if (staffFilters.stream && s.stream !== staffFilters.stream) return false;
        if (staffFilters.department && s.departmentId !== staffFilters.department) {
          return false;
        }
        if (
          staffFilters.designation &&
          s.designationId !== staffFilters.designation
        ) {
          return false;
        }
        if (
          staffFilters.joinedFrom &&
          (!s.joiningDate || s.joiningDate < staffFilters.joinedFrom)
        ) {
          return false;
        }
        if (
          staffFilters.joinedTo &&
          (!s.joiningDate || s.joiningDate > staffFilters.joinedTo)
        ) {
          return false;
        }
        if (!q) return true;
        const dep = state.departments.find((d) => d.id === s.departmentId);
        const des = state.designations.find((d) => d.id === s.designationId);
        const hay = [
          s.empCode,
          s.fullName,
          s.mobile,
          s.religion,
          s.casteCategory,
          dep?.name,
          des?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => a.empCode.localeCompare(b.empCode));
  }, [state, staffFilters]);

  // Role and status render as composed text / a badge, so they sort on the
  // underlying values rather than on what the cell happens to show.
  const rosterKeys = useMemo(() => filtered.map((s) => s.id), [filtered]);
  const rosterSelection = useRowSelection(rosterKeys);
  const staffSort = useTableSort(
    filtered,
    {
      code: (s) => s.empCode || null,
      name: (s) => s.fullName,
      role: (s) => {
        const des = state?.designations.find((d) => d.id === s.designationId);
        const dep = state?.departments.find((d) => d.id === s.departmentId);
        return [des?.name, dep?.name].filter(Boolean).join(" · ") || null;
      },
      stream: (s) => s.stream,
      gender: (s) => s.gender || null,
      mobile: (s) => s.mobile || null,
      status: (s) => s.status,
    },
    "name",
  );

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  if (!state || !stats) {
    return <p className="text-sm text-[var(--muted)]">Loading staff…</p>;
  }

  return (
    <ErpWorkspaceShell
      title="Staff"
      subtitle={
        <>
          Roster · leave · appraisal · {stats.active} active ·{" "}
          <Link
            href="/masters"
            className="font-medium text-[var(--brand-deep)] underline-offset-2 hover:underline"
          >
            Departments & designations in Masters
          </Link>
        </>
      }
      notice={notice}
    >
      <ModuleTabs
        aria-label="Staff"
        value={tab}
        onChange={(id) => setTab(id as StaffMainTab)}
        items={[
          { id: "dashboard", label: "Dashboard", tone: "navy" },
          { id: "roster", label: "Roster", tone: "navy" },
          { id: "duty_roster", label: "Duty roster", tone: "coral" },
          { id: "allocate", label: "Allocate teaching", tone: "violet" },
          { id: "assignments", label: "Who teaches what", tone: "sky" },
          { id: "my_docs", label: "My docs", tone: "sky" },
          { id: "agreements", label: "Agreements", tone: "teal" },
          { id: "doc_verify", label: "Doc verify", tone: "amber" },
          { id: "leave", label: "Leave", tone: "teal" },
          { id: "requests", label: "Requests", tone: "coral" },
          { id: "outdoor_duty", label: "Outdoor duty", tone: "sky" },
          { id: "appraisal", label: "Appraisal", tone: "violet" },
          { id: "payslips", label: "Payslips", tone: "green" },
          { id: "reports", label: "Reports", tone: "amber" },
          { id: "presence", label: "My presence", tone: "green" },
          { id: "gps", label: "GPS presence", tone: "coral" },
        ]}
      />

      {tab === "dashboard" ? (
        <ModuleDashboardHost
          moduleId="staff"
          onNavigateTab={(t) => setTab(t as StaffMainTab)}
        />
      ) : null}

      {tab === "allocate" ? (
        <ErpPanel
          title="Allocate teaching"
          description="Pick a teacher, then give them a class-teacher section and the subjects they teach."
        >
          <TeachingAllocationPanel masters={state} ay={ay} onCommit={commit} />
        </ErpPanel>
      ) : null}

      {tab === "assignments" ? (
        <ErpPanel title="Who teaches what">
          <TeacherAssignmentsPanel masters={state} ay={ay} />
        </ErpPanel>
      ) : null}

      {tab === "duty_roster" ? (
        <ErpPanel title="Duty roster">
          <DutyRosterPanel masters={state} />
        </ErpPanel>
      ) : null}

      {tab === "my_docs" ? (
        <ErpPanel>
          <StaffAgreementSelfPanel />
          <div className="mt-6 border-t border-[var(--border)] pt-6">
            <StaffMyProfileDocs
              staffId={
                state ? resolveSessionStaff(session, state)?.id || "" : ""
              }
              actorName={session.fullName || ""}
            />
          </div>
        </ErpPanel>
      ) : null}

      {tab === "agreements" ? (
        <ErpPanel title="Employment agreements">
          <StaffAgreementPanel mode="hr" />
        </ErpPanel>
      ) : null}

      {tab === "doc_verify" ? (
        <ErpPanel className="bg-[rgba(246,245,239,0.6)]">
          <DocVerificationQueuePanel
            mode="staff"
            onChanged={() => setState(loadMasters())}
          />
        </ErpPanel>
      ) : null}

      {tab === "leave" ? <StaffLeavePanel ay={ay} /> : null}
      {tab === "requests" ? <StaffRequestsPanel /> : null}
      {tab === "outdoor_duty" ? <StaffOutdoorDutyPanel /> : null}
      {tab === "presence" ? (
        <div className="mt-4 max-w-xl">
          <StaffPresenceCard />
        </div>
      ) : null}
      {tab === "gps" ? (
        <StaffGeoAdminPanel canEdit={hasPermission(session, state ?? loadMasters(), "staff", "edit")} />
      ) : null}
      {tab === "reports" ? (
        <StaffLeaveReportsPanel ay={ay} scope="leave" />
      ) : null}
      {tab === "appraisal" ? <StaffAppraisalPanel ay={ay} /> : null}
      {tab === "payslips" ? <StaffPayslipsPanel /> : null}

      {tab === "roster" ? (
      <>
      <ErpToolbar>
        <ErpToolbarBtn
          icon={<UserPlus className="h-4 w-4" />}
          label="Add"
          onClick={() => router.push("/staff/new")}
        />
        <ErpToolbarBtn
          icon={<List className="h-4 w-4" />}
          label="Staff"
          onClick={() => scrollTo("staff-list")}
        />
        <ErpToolbarBtn
          icon={<Download className="h-4 w-4" />}
          label="Download"
          onClick={() => downloadStaffRosterCsv(state)}
        />
        <ErpToolbarBtn
          icon={<FileUp className="h-4 w-4" />}
          label="Import"
          onClick={() => scrollTo("staff-import")}
        />
      </ErpToolbar>

      <ErpMetricGrid>
        <ErpMetricCard
          title="Active Staff"
          value={stats.active}
          tone="green"
          icon={<UserRound className="h-7 w-7" />}
        />
        <ErpMetricCard
          title="InActive Staff"
          value={stats.inactive}
          tone="rose"
          icon={<UserRound className="h-7 w-7" />}
        />
        <ErpMetricCard
          title="Male"
          value={stats.male}
          tone="sky"
          icon={<Users className="h-7 w-7" />}
        />
        <ErpMetricCard
          title="Female"
          value={stats.female}
          tone="violet"
          icon={<Users className="h-7 w-7" />}
        />
      </ErpMetricGrid>

      <ErpChartGrid cols={3}>
        <ErpChartCard title="Department-wise Analysis">
          <ErpBar rows={stats.departmentRows} color="var(--chart-3)" />
        </ErpChartCard>
        <ErpChartCard title="Religion-wise Analysis">
          <ErpDonut rows={stats.religionRows} />
        </ErpChartCard>
        <ErpChartCard title="Teaching vs Non-teaching">
          <ErpDonut
            rows={stats.streamRows}
            colors={["var(--chart-1)", "var(--chart-3)"]}
          />
        </ErpChartCard>
      </ErpChartGrid>

      <ErpChartGrid cols={2}>
        <ErpChartCard title="Caste-wise Analysis">
          <ErpDonut rows={stats.casteRows} />
        </ErpChartCard>
        <ErpChartCard title="Designation-wise Analysis">
          <ErpBar rows={stats.designationRows} color="#fb7185" />
        </ErpChartCard>
      </ErpChartGrid>

      <div id="staff-list" className="scroll-mt-24 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <FilterBar
            query={staffFilters.query}
            onQueryChange={(v) => patchStaffFilters({ query: v })}
            queryPlaceholder="Code, name, mobile…"
            activeCount={staffActiveFilterCount}
            onReset={resetStaffFilters}
            facets={[
              {
                key: "stream",
                label: "Stream",
                value: staffFilters.stream,
                onChange: (v) => patchStaffFilters({ stream: v }),
                options: STAFF_STREAMS.map((s) => ({
                  value: s.value,
                  label: s.label,
                })),
              },
              {
                key: "status",
                label: "Status",
                value: staffFilters.status === "active" ? "" : staffFilters.status,
                allLabel: "Active (default)",
                onChange: (v) =>
                  patchStaffFilters({ status: v === "" ? "active" : v }),
                options: [
                  { value: "all", label: "All" },
                  { value: "inactive", label: "Inactive" },
                ],
              },
              {
                key: "department",
                label: "Department",
                value: staffFilters.department,
                onChange: (v) => patchStaffFilters({ department: v }),
                options: state.departments
                  .filter((d) => d.isActive)
                  .map((d) => ({ value: d.id, label: d.name })),
              },
              {
                key: "designation",
                label: "Designation",
                value: staffFilters.designation,
                onChange: (v) => patchStaffFilters({ designation: v }),
                options: state.designations
                  .filter((d) => d.isActive)
                  .map((d) => ({ value: d.id, label: d.name })),
              },
            ]}
          >
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--muted)]">
              Joined
              <input
                type="date"
                className="field !py-1.5"
                value={staffFilters.joinedFrom}
                onChange={(e) => patchStaffFilters({ joinedFrom: e.target.value })}
                aria-label="Joined from"
              />
              <span>–</span>
              <input
                type="date"
                className="field !py-1.5"
                value={staffFilters.joinedTo}
                onChange={(e) => patchStaffFilters({ joinedTo: e.target.value })}
                aria-label="Joined to"
              />
            </label>
          </FilterBar>
          <div className="flex shrink-0 items-center gap-2">
            <ExportMenu
              title="Staff register"
              subtitle={`${filtered.length} staff · ${staffFilters.status === "active" ? "active" : staffFilters.status}`}
              fileBaseName="staff_register"
              columns={[
                { key: "code", header: "Code" },
                { key: "name", header: "Name", width: 2 },
                { key: "designation", header: "Designation", width: 1.5 },
                { key: "department", header: "Department", width: 1.5 },
                { key: "stream", header: "Stream" },
                { key: "gender", header: "Gender" },
                { key: "mobile", header: "Mobile" },
                { key: "status", header: "Status" },
              ]}
              rows={() =>
                staffSort.rows.map((r) => ({
                  code: r.empCode,
                  name: r.fullName,
                  designation: state.designations.find((d) => d.id === r.designationId)?.name ?? "",
                  department: state.departments.find((d) => d.id === r.departmentId)?.name ?? "",
                  stream: r.stream.replace("_", " "),
                  gender: r.gender === "M" ? "Male" : r.gender === "F" ? "Female" : r.gender === "O" ? "Other" : "",
                  mobile: r.mobile || "",
                  status: r.status,
                }))
              }
              onMessage={(msg) => {
                setNotice(msg);
                window.setTimeout(() => setNotice(null), 2400);
              }}
            />
            <Link
              href="/staff/new"
              className="shrink-0 rounded-xl bg-[var(--brand-deep)] px-4 py-2.5 text-sm font-bold text-white"
            >
              Add staff
            </Link>
          </div>
        </div>

        <BulkActionBar
          selection={rosterSelection}
          noun="staff member"
          actions={[
            {
              id: "activate",
              label: "Mark active",
              onRun: (ids) => {
                const picked = new Set(ids);
                const next = {
                  ...state,
                  staff: state.staff.map((r) =>
                    picked.has(r.id) && r.status !== "active" ? { ...r, status: "active" as const } : r,
                  ),
                };
                commit(next, `${ids.length} staff marked active`);
                rosterSelection.clear();
              },
            },
            {
              id: "inactivate",
              label: "Mark inactive",
              onRun: (ids) => {
                const picked = new Set(ids);
                const next = {
                  ...state,
                  staff: state.staff.map((r) =>
                    picked.has(r.id) && r.status === "active" ? { ...r, status: "inactive" as const } : r,
                  ),
                };
                commit(next, `${ids.length} staff marked inactive`);
                rosterSelection.clear();
              },
            },
            {
              id: "wa",
              label: "Send WhatsApp",
              title: "Opens WhatsApp for each selected member with a mobile (12 per click)",
              onRun: (ids) => {
                const text = window.prompt("Message to send on WhatsApp:", "Namaste, this is a message from the school office.");
                if (!text) return;
                const picked = new Set(ids);
                const withMobile = state.staff.filter((r) => picked.has(r.id) && r.mobile);
                for (const r of withMobile.slice(0, 12)) openWaMe(r.mobile, text);
                setNotice(`Opened WhatsApp for ${Math.min(12, withMobile.length)} of ${ids.length} selected`);
                window.setTimeout(() => setNotice(null), 2800);
              },
            },
          ]}
        />

        <ErpTableShell>
          <ErpTable>
            <ErpTableHead>
              <tr>
                <th className="w-10 px-3 py-3">
                  <RowCheckbox
                    checked={rosterSelection.allSelected(staffSort.rows.map((r) => r.id))}
                    indeterminate={rosterSelection.someSelected(staffSort.rows.map((r) => r.id))}
                    onChange={() => rosterSelection.toggleAll(staffSort.rows.map((r) => r.id))}
                    label="Select all staff shown"
                  />
                </th>
                <th className="px-4 py-3 font-bold">Photo</th>
                <ErpSortTh sort={staffSort} field="code">Code</ErpSortTh>
                <ErpSortTh sort={staffSort} field="name">Name</ErpSortTh>
                <ErpSortTh sort={staffSort} field="role">Role</ErpSortTh>
                <ErpSortTh sort={staffSort} field="stream">Stream</ErpSortTh>
                <ErpSortTh sort={staffSort} field="gender">Gender</ErpSortTh>
                <ErpSortTh sort={staffSort} field="mobile">Mobile</ErpSortTh>
                <ErpSortTh sort={staffSort} field="status">Status</ErpSortTh>
                <th className="px-4 py-3 font-bold" />
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {staffSort.rows.map((s) => {
                const dep = state.departments.find(
                  (d) => d.id === s.departmentId,
                );
                const des = state.designations.find(
                  (d) => d.id === s.designationId,
                );
                return (
                  <tr
                    key={s.id}
                    className={`hover:bg-[var(--surface-sunken)] ${
                      rosterSelection.isSelected(s.id) ? "bg-[var(--accent)]" : ""
                    }`}
                  >
                    <td className="w-10 px-3 py-2">
                      <RowCheckbox
                        checked={rosterSelection.isSelected(s.id)}
                        onChange={() => rosterSelection.toggle(s.id)}
                        label={`Select ${s.fullName}`}
                      />
                    </td>
                    <td className="px-4 py-2">
                      {s.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.photoUrl}
                          alt=""
                          className="h-9 w-9 rounded-full object-cover"
                        />
                      ) : (
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[10px] font-bold text-[var(--muted)]">
                          {s.fullName
                            .split(/\s+/)
                            .slice(0, 2)
                            .map((p) => p[0])
                            .join("")
                            .toUpperCase() || "?"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold text-[var(--brand-deep)]">
                      {s.empCode}
                    </td>
                    <td className="px-4 py-3">{s.fullName}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {[des?.name, dep?.name].filter(Boolean).join(" · ") ||
                        "—"}
                    </td>
                    <td className="px-4 py-3 capitalize">
                      {s.stream.replace("_", " ")}
                    </td>
                    <td className="px-4 py-3">
                      {s.gender === "M"
                        ? "Male"
                        : s.gender === "F"
                          ? "Female"
                          : s.gender === "O"
                            ? "Other"
                            : "—"}
                    </td>
                    <td className="px-4 py-3">{s.mobile || "—"}</td>
                    <td className="px-4 py-3">
                      <ErpStatusBadge
                        active={s.status === "active"}
                        activeLabel={s.status}
                        inactiveLabel={s.status}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <RowActionMenu
                          row={s}
                          label={`Actions for ${s.fullName}`}
                          actions={[
                            {
                              id: "view",
                              label: "View & edit details",
                              onSelect: (r) => router.push(`/staff/${r.id}/edit`),
                            },
                            {
                              id: "attendance",
                              label: "Attendance history",
                              onSelect: (r) =>
                                router.push(`/attendance?tab=staff&staff=${encodeURIComponent(r.id)}`),
                            },
                            {
                              id: "payslips",
                              label: "Salary & payslips",
                              onSelect: (r) =>
                                router.push(`/payroll?staff=${encodeURIComponent(r.id)}`),
                            },
                            {
                              id: "wa",
                              label: "Send WhatsApp",
                              disabled: (r) => !r.mobile,
                              onSelect: (r) =>
                                openWaMe(r.mobile, `Namaste ${r.fullName}, this is a message from the school office.`),
                            },
                            {
                              id: "status",
                              label: s.status === "active" ? "Mark inactive" : "Mark active",
                              separatorAbove: true,
                              onSelect: (r) => toggleStatus(r),
                            },
                          ]}
                        />
                        <RemoveControl
                          compact
                          check={checkStaffRemoval(state, s.id)}
                          onRemove={() => onRemove(s)}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-10 text-center text-sm text-[var(--muted)]"
                  >
                    No staff match these filters.{" "}
                    <Link
                      href="/staff/new"
                      className="font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
                    >
                      Add staff
                    </Link>
                  </td>
                </tr>
              ) : null}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      </div>

      <div id="staff-import" className="scroll-mt-24">
        <StaffImportPanel
          state={state}
          onApplied={(next, msg) => {
            commit(next, msg);
          }}
        />
      </div>
      </>
      ) : null}
    </ErpWorkspaceShell>
  );
}

function StaffImportPanel({
  state,
  onApplied,
}: {
  state: MastersState;
  onApplied: (next: MastersState, message: string) => void;
}) {
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [upsert, setUpsert] = useState(true);
  const [replaceAll, setReplaceAll] = useState(false);
  const [preview, setPreview] = useState<StaffImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  function refreshPreview(text: string, nextUpsert: boolean, nextReplace: boolean) {
    if (!text) {
      setPreview(null);
      return;
    }
    setPreview(previewStaffImport(text, state, nextUpsert, nextReplace));
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setFileName(file.name);
    setLocalError(null);
    setBusy(true);
    try {
      const isXlsx =
        /\.xlsx?$/i.test(file.name) ||
        file.type.includes("sheet") ||
        file.type.includes("excel");
      let text = "";
      if (isXlsx) {
        const buf = await file.arrayBuffer();
        const converted = await workbookToStaffImportCsv(buf);
        text = converted.csv;
      } else {
        text = await file.text();
      }
      setCsvText(text);
      refreshPreview(text, upsert, replaceAll);
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : "Could not read file",
      );
      setCsvText("");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  function runImport() {
    if (!csvText) {
      setLocalError("Choose a CSV or Excel file first");
      return;
    }
    if (
      replaceAll &&
      !window.confirm(
        "Replace the entire staff roster with this file? Existing staff rows will be removed.",
      )
    ) {
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      const result = applyStaffImport(csvText, state, {
        upsert,
        replaceAll,
        dryRun: false,
      });
      if (result.created + result.updated === 0 && result.errors.length > 0) {
        setPreview(result);
        setLocalError("No rows imported — fix errors below");
        return;
      }
      setPreview(result);
      onApplied(
        result.state,
        (replaceAll ? "Replaced roster · " : "") +
          `Imported ${result.created} new, updated ${result.updated}` +
          (result.skipped ? `, skipped ${result.skipped}` : ""),
      );
      setCsvText("");
      setFileName("");
      setReplaceAll(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ErpPanel title="Import staff" description="CSV or Teacher.xlsx · maps vendor columns (Biometric, Job Type, Basic Pay, OASIS ID, …). Open each profile afterward for photo & docs.">
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          className="text-xs font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
          onClick={downloadStaffImportTemplate}
        >
          Download template
        </button>
      </div>
      <label className="block text-xs font-semibold text-[var(--muted)]">
        Staff file
        <input
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="mt-1 block w-full text-sm"
          onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
        />
        {fileName ? (
          <span className="mt-1 block text-[11px] text-[var(--muted)]">
            {fileName}
          </span>
        ) : null}
      </label>

      <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
        <input
          type="checkbox"
          checked={upsert}
          disabled={replaceAll}
          onChange={(e) => {
            setUpsert(e.target.checked);
            refreshPreview(csvText, e.target.checked, replaceAll);
          }}
        />
        Update existing rows with the same emp_code
      </label>

      <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
        <input
          type="checkbox"
          checked={replaceAll}
          onChange={(e) => {
            setReplaceAll(e.target.checked);
            refreshPreview(csvText, upsert, e.target.checked);
          }}
        />
        Clear current roster and import this file only
      </label>

      {localError ? (
        <p className="text-sm font-medium text-[var(--danger)]">{localError}</p>
      ) : null}

      {preview ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-sm">
          <p>
            {replaceAll ? (
              <>
                Will replace roster · create <strong>{preview.created}</strong>
              </>
            ) : (
              <>
                Will create <strong>{preview.created}</strong>, update{" "}
                <strong>{preview.updated}</strong>
              </>
            )}
            {preview.skipped ? (
              <>
                , skip <strong>{preview.skipped}</strong>
              </>
            ) : null}
          </p>
          {preview.errors.length > 0 ? (
            <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-[11px] text-[var(--danger)]">
              {preview.errors.slice(0, 20).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        disabled={busy || !csvText}
        className="rounded-xl bg-[var(--brand-deep)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
        onClick={runImport}
      >
        {busy ? "Importing…" : replaceAll ? "Replace & import" : "Import staff"}
      </button>
    </ErpPanel>
  );
}
