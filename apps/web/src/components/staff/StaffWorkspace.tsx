"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { STAFF_STREAMS, type StaffStream, type StaffRecord } from "@/lib/foundationMasters";
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
} from "@/lib/staffResolve";
import { RemoveControl } from "@/components/masters/RemoveControl";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { StaffLeavePanel } from "@/components/staff/StaffLeavePanel";
import { StaffLeaveReportsPanel } from "@/components/staff/StaffLeaveReportsPanel";
import { StaffAppraisalPanel } from "@/components/staff/StaffAppraisalPanel";
import { StaffPayslipsPanel } from "@/components/staff/StaffPayslipsPanel";
import { useDemoSession } from "@/components/shell/SessionContext";

const CHART_COLORS = [
  "#2563eb",
  "#ef4444",
  "#f97316",
  "#16a34a",
  "#8b5cf6",
  "#0891b2",
  "#e11d48",
  "#ca8a04",
];

type NamedCount = { key: string; label: string; count: number };

type StaffMainTab =
  | "dashboard"
  | "roster"
  | "leave"
  | "appraisal"
  | "reports"
  | "payslips";

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
    ];
    if (raw && (allowed as string[]).includes(raw)) setTab(raw as StaffMainTab);
  }, []);
  const [state, setState] = useState<MastersState | null>(null);
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
    const active = staff.filter((s) => s.status === "active");
    const inactive = staff.filter((s) => s.status === "inactive");
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
        if (statusFilter !== "all" && s.status !== statusFilter) return false;
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--brand-deep)]">
            Staff
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Roster · leave · appraisal · {stats.active} active ·{" "}
            <Link
              href="/masters"
              className="font-medium text-[var(--brand-deep)] underline-offset-2 hover:underline"
            >
              Departments & designations in Masters
            </Link>
          </p>
        </div>
        {notice ? (
          <span className="rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-1.5 text-xs font-medium text-[var(--brand-deep)]">
            {notice}
          </span>
        ) : null}
      </div>

      <ModuleTabs
        aria-label="Staff"
        value={tab}
        onChange={(id) => setTab(id as StaffMainTab)}
        items={[
          { id: "dashboard", label: "Dashboard", tone: "navy" },
          { id: "roster", label: "Roster", tone: "navy" },
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

      {tab === "leave" ? <StaffLeavePanel ay={ay} /> : null}
      {tab === "reports" ? (
        <StaffLeaveReportsPanel ay={ay} scope="leave" />
      ) : null}
      {tab === "appraisal" ? <StaffAppraisalPanel ay={ay} /> : null}
      {tab === "payslips" ? <StaffPayslipsPanel /> : null}

      {tab === "roster" ? (
      <>
      <div className="flex flex-wrap justify-end gap-2">
        <ToolbarBtn
          icon={<UserPlus className="h-4 w-4" />}
          label="Add"
          onClick={() => router.push("/staff/new")}
        />
        <ToolbarBtn
          icon={<List className="h-4 w-4" />}
          label="Staff"
          onClick={() => scrollTo("staff-list")}
        />
        <ToolbarBtn
          icon={<Download className="h-4 w-4" />}
          label="Download"
          onClick={() => downloadStaffRosterCsv(state)}
        />
        <ToolbarBtn
          icon={<FileUp className="h-4 w-4" />}
          label="Import"
          onClick={() => scrollTo("staff-import")}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Active Staff"
          value={stats.active}
          tone="green"
          icon={<UserRound className="h-7 w-7" />}
        />
        <MetricCard
          title="InActive Staff"
          value={stats.inactive}
          tone="rose"
          icon={<UserRound className="h-7 w-7" />}
        />
        <MetricCard
          title="Male"
          value={stats.male}
          tone="sky"
          icon={<Users className="h-7 w-7" />}
        />
        <MetricCard
          title="Female"
          value={stats.female}
          tone="violet"
          icon={<Users className="h-7 w-7" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Department-wise Analysis">
          <BarChart
            rows={stats.departmentRows}
            yLabel="No. Of Staffs"
            xLabel="Department"
            barColor="#f97316"
          />
        </ChartCard>
        <ChartCard title="Religion-wise Analysis">
          <PieChart rows={stats.religionRows} />
        </ChartCard>
        <ChartCard title="Teaching vs Non-teaching">
          <PieChart
            rows={stats.streamRows}
            colors={["#2563eb", "#f97316"]}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Caste-wise Analysis">
          <PieChart rows={stats.casteRows} />
        </ChartCard>
        <ChartCard title="Designation-wise Analysis">
          <BarChart
            rows={stats.designationRows}
            yLabel="No. Of Staffs"
            xLabel="Designation"
            barColor="#fb7185"
          />
        </ChartCard>
      </div>

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

        <div className="overflow-hidden rounded-2xl border border-[rgba(32,48,80,0.12)] bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] text-[11px] uppercase tracking-wide text-[var(--muted)]">
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
            </thead>
            <tbody className="divide-y divide-[rgba(32,48,80,0.08)]">
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
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-black uppercase ${
                          s.status === "active"
                            ? "bg-[rgba(21,128,61,0.12)] text-[#15803d]"
                            : "bg-[rgba(32,48,80,0.08)] text-[var(--muted)]"
                        }`}
                      >
                        {s.status}
                      </span>
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
            </tbody>
          </table>
        </div>
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
    </div>
  );
}

function ToolbarBtn({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white px-3.5 py-2 text-sm font-semibold text-[var(--brand-deep)] shadow-sm transition hover:border-[rgba(37,99,235,0.35)] hover:bg-[#eff6ff]"
    >
      <span className="text-[#2563eb]">{icon}</span>
      {label}
    </button>
  );
}

function MetricCard({
  title,
  value,
  tone,
  icon,
}: {
  title: string;
  value: number;
  tone: "green" | "rose" | "sky" | "violet";
  icon: ReactNode;
}) {
  const tones = {
    green: {
      title: "text-[#2563eb]",
      icon: "bg-[#dcfce7] text-[#15803d]",
    },
    rose: {
      title: "text-[#2563eb]",
      icon: "bg-[#fee2e2] text-[#b91c1c]",
    },
    sky: {
      title: "text-[#2563eb]",
      icon: "bg-[#dbeafe] text-[#1d4ed8]",
    },
    violet: {
      title: "text-[#2563eb]",
      icon: "bg-[#ede9fe] text-[#6d28d9]",
    },
  }[tone];

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[rgba(32,48,80,0.1)] bg-white px-5 py-4 shadow-sm">
      <div>
        <div className={`text-sm font-semibold ${tones.title}`}>{title}</div>
        <div className="mt-1 text-3xl font-bold tabular-nums text-[#0f172a]">
          {value}
        </div>
      </div>
      <span
        className={`inline-flex h-14 w-14 items-center justify-center rounded-full ${tones.icon}`}
      >
        {icon}
      </span>
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[rgba(32,48,80,0.1)] bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-[#2563eb]">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function BarChart({
  rows,
  yLabel,
  xLabel,
  barColor,
}: {
  rows: NamedCount[];
  yLabel: string;
  xLabel: string;
  barColor: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const niceMax = Math.ceil(max / 2) * 2 || 2;
  const w = 420;
  const h = 220;
  const padL = 42;
  const padR = 12;
  const padT = 12;
  const padB = 58;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const gap = 8;
  const barW =
    rows.length > 0 ? Math.max(10, (plotW - gap * rows.length) / rows.length) : 20;

  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-[var(--muted)]">
        No staff data yet
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="mx-auto h-auto w-full min-w-[280px] max-w-full"
        role="img"
        aria-label={`${xLabel} bar chart`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + plotH * (1 - t);
          const val = Math.round(niceMax * t);
          return (
            <g key={t}>
              <line
                x1={padL}
                x2={w - padR}
                y1={y}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
              <text
                x={padL - 8}
                y={y + 3}
                textAnchor="end"
                className="fill-[#64748b]"
                fontSize={10}
              >
                {val}
              </text>
            </g>
          );
        })}
        {rows.map((r, i) => {
          const bh = (r.count / niceMax) * plotH;
          const x = padL + gap / 2 + i * (barW + gap);
          const y = padT + plotH - bh;
          return (
            <g key={r.key}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(bh, 1)}
                fill={barColor}
                rx={3}
              />
              <text
                x={x + barW / 2}
                y={h - 28}
                textAnchor="middle"
                className="fill-[#475569]"
                fontSize={9}
                transform={`rotate(-28 ${x + barW / 2} ${h - 28})`}
              >
                {r.label.length > 12 ? `${r.label.slice(0, 11)}…` : r.label}
              </text>
              {r.count > 0 ? (
                <text
                  x={x + barW / 2}
                  y={y - 4}
                  textAnchor="middle"
                  className="fill-[#334155]"
                  fontSize={10}
                  fontWeight={600}
                >
                  {r.count}
                </text>
              ) : null}
            </g>
          );
        })}
        <text
          x={16}
          y={h / 2}
          textAnchor="middle"
          className="fill-[#64748b]"
          fontSize={10}
          transform={`rotate(-90 16 ${h / 2})`}
        >
          {yLabel}
        </text>
        <text
          x={padL + plotW / 2}
          y={h - 6}
          textAnchor="middle"
          className="fill-[#64748b]"
          fontSize={10}
        >
          {xLabel}
        </text>
      </svg>
    </div>
  );
}

function PieChart({
  rows,
  colors = CHART_COLORS,
}: {
  rows: NamedCount[];
  colors?: string[];
}) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (total === 0) {
    return (
      <p className="py-10 text-center text-sm text-[var(--muted)]">
        No staff data yet
      </p>
    );
  }

  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = 68;
  let angle = -Math.PI / 2;

  const slices = rows.map((row, i) => {
    const frac = row.count / total;
    const start = angle;
    const sweep = frac * Math.PI * 2;
    angle += sweep;
    const end = angle;
    const large = sweep > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const mid = start + sweep / 2;
    const lx = cx + r * 0.62 * Math.cos(mid);
    const ly = cy + r * 0.62 * Math.sin(mid);
    const path =
      frac >= 0.999
        ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
        : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    return {
      ...row,
      path,
      color: colors[i % colors.length]!,
      pct: Math.round(frac * 1000) / 10,
      lx,
      ly,
      showLabel: frac >= 0.08,
    };
  });

  return (
    <div className="flex flex-wrap items-center justify-center gap-4">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="h-44 w-44"
        role="img"
        aria-label="Pie chart"
      >
        {slices.map((s) => (
          <g key={s.key}>
            <path d={s.path} fill={s.color} />
            {s.showLabel ? (
              <text
                x={s.lx}
                y={s.ly}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize={11}
                fontWeight={700}
              >
                {s.pct}%
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <ul className="min-w-[7rem] space-y-1.5 text-sm">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-[#334155]">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: s.color }}
            />
            <span>
              {s.label}{" "}
              <span className="tabular-nums text-[var(--muted)]">
                ({s.count})
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
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
    <div className="space-y-4 rounded-2xl border border-[rgba(32,48,80,0.12)] bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Import staff
          </h2>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            CSV or Teacher.xlsx · maps vendor columns (Biometric, Job Type,
            Basic Pay, OASIS ID, …). Open each profile afterward for photo &
            docs.
          </p>
        </div>
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
    </div>
  );
}
