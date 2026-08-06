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
  type StaffStream,
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
import {
  ErpBarChart,
  ErpPieChart,
  type ErpChartRow,
} from "@/components/ui/erp-charts";
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
import { field, btn } from "@/components/ui/erp-ui";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { StaffLeavePanel } from "@/components/staff/StaffLeavePanel";
import { StaffLeaveReportsPanel } from "@/components/staff/StaffLeaveReportsPanel";
import { StaffAppraisalPanel } from "@/components/staff/StaffAppraisalPanel";
import { StaffPayslipsPanel } from "@/components/staff/StaffPayslipsPanel";
import { StaffMyProfileDocs } from "@/components/staff/StaffMyProfileDocs";
import { StaffAgreementPanel, StaffAgreementSelfPanel } from "@/components/staff/StaffAgreementPanel";
import { DocVerificationQueuePanel } from "@/components/students/DocVerificationQueuePanel";
import { useDemoSession } from "@/components/shell/SessionContext";

type NamedCount = ErpChartRow;

type StaffMainTab =
  | "dashboard"
  | "roster"
  | "leave"
  | "appraisal"
  | "reports"
  | "payslips"
  | "my_docs"
  | "doc_verify"
  | "agreements";

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
      "leave",
      "appraisal",
      "reports",
      "payslips",
      "my_docs",
      "doc_verify",
      "agreements",
    ];
    if (raw && (allowed as string[]).includes(raw)) setTab(raw as StaffMainTab);
  }, []);
  const [state, setState] = useState<MastersState | null>(() =>
    typeof window !== "undefined" ? loadMasters() : null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [streamFilter, setStreamFilter] = useState<"" | StaffStream>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">(
    "active",
  );

  useEffect(() => {
    setState(loadMasters());
    void (async () => {
      const { ensureStaffHydrated } = await import("@/lib/staffPersistence");
      const did = await ensureStaffHydrated();
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
      const cur = deptMap.get(key) ?? { key, label, count: 0 };
      cur.count += 1;
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
      .map(([label, count]) => ({ key: label, label, count }));

    const teaching = staff.filter((s) => s.stream === "teaching").length;
    const nonTeaching = staff.filter((s) => s.stream === "non_teaching").length;
    const streamRows: NamedCount[] = [
      { key: "teaching", label: "Teaching", count: teaching },
      { key: "non_teaching", label: "Non-teaching", count: nonTeaching },
    ].filter((r) => r.count > 0);

    const casteMap = new Map<string, number>();
    for (const s of staff) {
      const c = s.casteCategory || "NOT SET";
      casteMap.set(c, (casteMap.get(c) ?? 0) + 1);
    }
    const casteRows = [...casteMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ key: label, label, count }));

    const desMap = new Map<string, NamedCount>();
    for (const s of staff) {
      const des = state.designations.find((d) => d.id === s.designationId);
      const label = des?.name ?? "Unassigned";
      const key = des?.id ?? "none";
      const cur = desMap.get(key) ?? { key, label, count: 0 };
      cur.count += 1;
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
    const q = query.trim().toLowerCase();
    return (state.staff ?? [])
      .filter((s) => {
        if (statusFilter === "active" && !isStaffActive(s)) return false;
        if (statusFilter === "inactive" && isStaffActive(s)) return false;
        if (streamFilter && s.stream !== streamFilter) return false;
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
  }, [state, query, streamFilter, statusFilter]);

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
          { id: "my_docs", label: "My docs", tone: "sky" },
          { id: "agreements", label: "Agreements", tone: "teal" },
          { id: "doc_verify", label: "Doc verify", tone: "amber" },
          { id: "leave", label: "Leave", tone: "teal" },
          { id: "appraisal", label: "Appraisal", tone: "violet" },
          { id: "payslips", label: "Payslips", tone: "green" },
          { id: "reports", label: "Reports", tone: "amber" },
        ]}
      />

      {tab === "dashboard" ? (
        <ModuleDashboardHost
          moduleId="staff"
          onNavigateTab={(t) => setTab(t as StaffMainTab)}
        />
      ) : null}

      {tab === "my_docs" ? (
        <ErpPanel>
          <StaffAgreementSelfPanel />
          <div className="mt-6 border-t border-[rgba(32,48,80,0.08)] pt-6">
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
          <ErpBarChart
            rows={stats.departmentRows}
            yLabel="No. Of Staffs"
            xLabel="Department"
            barColor="#f97316"
          />
        </ErpChartCard>
        <ErpChartCard title="Religion-wise Analysis">
          <ErpPieChart rows={stats.religionRows} />
        </ErpChartCard>
        <ErpChartCard title="Teaching vs Non-teaching">
          <ErpPieChart
            rows={stats.streamRows}
            colors={["#2563eb", "#f97316"]}
          />
        </ErpChartCard>
      </ErpChartGrid>

      <ErpChartGrid cols={2}>
        <ErpChartCard title="Caste-wise Analysis">
          <ErpPieChart rows={stats.casteRows} />
        </ErpChartCard>
        <ErpChartCard title="Designation-wise Analysis">
          <ErpBarChart
            rows={stats.designationRows}
            yLabel="No. Of Staffs"
            xLabel="Designation"
            barColor="#fb7185"
          />
        </ErpChartCard>
      </ErpChartGrid>

      <div id="staff-list" className="scroll-mt-24 space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[12rem] flex-1 text-xs font-semibold text-[var(--muted)]">
            Search
            <input
              className="field mt-1 w-full !py-2"
              placeholder="Code, name, mobile…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label className="text-xs font-semibold text-[var(--muted)]">
            Stream
            <select
              className="field mt-1 !py-2"
              value={streamFilter}
              onChange={(e) =>
                setStreamFilter(e.target.value as "" | StaffStream)
              }
            >
              <option value="">All</option>
              {STAFF_STREAMS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--muted)]">
            Status
            <select
              className="field mt-1 !py-2"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "all" | "active" | "inactive")
              }
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <Link
            href="/staff/new"
            className="rounded-xl bg-[var(--brand-deep)] px-4 py-2.5 text-sm font-bold text-white"
          >
            Add staff
          </Link>
        </div>

        <ErpTableShell>
          <ErpTable>
            <ErpTableHead>
              <tr>
                <th className="px-4 py-3 font-bold">Photo</th>
                <th className="px-4 py-3 font-bold">Code</th>
                <th className="px-4 py-3 font-bold">Name</th>
                <th className="px-4 py-3 font-bold">Role</th>
                <th className="px-4 py-3 font-bold">Stream</th>
                <th className="px-4 py-3 font-bold">Gender</th>
                <th className="px-4 py-3 font-bold">Mobile</th>
                <th className="px-4 py-3 font-bold">Status</th>
                <th className="px-4 py-3 font-bold" />
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {filtered.map((s) => {
                const dep = state.departments.find(
                  (d) => d.id === s.departmentId,
                );
                const des = state.designations.find(
                  (d) => d.id === s.designationId,
                );
                return (
                  <tr key={s.id} className="hover:bg-[rgba(32,48,80,0.02)]">
                    <td className="px-4 py-2">
                      {s.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.photoUrl}
                          alt=""
                          className="h-9 w-9 rounded-full object-cover"
                        />
                      ) : (
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(32,48,80,0.08)] text-[10px] font-bold text-[var(--muted)]">
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
                      <div className="inline-flex flex-col items-end gap-1">
                        <Link
                          href={`/staff/${s.id}/edit`}
                          className="text-xs font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
                        >
                          Manage
                        </Link>
                        <button
                          type="button"
                          className="text-xs font-medium text-[var(--brand-mid)]"
                          onClick={() => toggleStatus(s)}
                        >
                          {s.status === "active" ? "Inactivate" : "Activate"}
                        </button>
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
                    colSpan={9}
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
        <p className="text-sm font-medium text-[#b42318]">{localError}</p>
      ) : null}

      {preview ? (
        <div className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.02)] p-3 text-sm">
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
            <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-[11px] text-[#b42318]">
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
