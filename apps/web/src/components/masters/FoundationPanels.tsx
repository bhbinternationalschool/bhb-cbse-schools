"use client";
// ratchet-allow: grids_without_row_menu — a weekly-off preview table (read-only settings preview)

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CLOSURE_REASONS, type ClosureReasonCode } from "@/lib/holidayNotice";
import Link from "next/link";
import {
  BOARD_MODES,
  HOLIDAY_APPLIES_TO,
  HOLIDAY_DAY_TYPES,
  HOLIDAY_KINDS,
  HOLIDAY_MODES,
  HOLIDAY_SCOPES,
  mastersCompleteness,
  newFoundationId,
  normalizeHoliday,
  type AcademicTerm,
  type AcademicYearMaster,
  type AyStatus,
  type BoardMode,
  type Department,
  type Designation,
  type Holiday,
  type HolidayAppliesTo,
  type HolidayDayType,
  type HolidayKind,
  type HolidayMode,
  type HolidayScope,
  type NumberSeries,
} from "@/lib/foundationMasters";
import { formatSeriesNumber } from "@/lib/numberSeries";
import {
  UP_HOLIDAY_CALENDAR,
  UP_HOLIDAY_CALENDAR_SESSION,
  type UpCalendarEntry,
} from "@/lib/upHolidayCalendar";
import {
  appliesToIncludesNonTeaching,
  appliesToIncludesStudents,
  appliesToIncludesTeaching,
  classifyHolidayDay,
  describeHolidayRule,
  previewHolidayDates,
  WEEKDAY_LABELS,
} from "@/lib/holidayPolicy";
import { syncWorkspaceAcademicYear, type MastersState } from "@/lib/masters";
import { WORKSPACE_AY_ALIGNED_KEY } from "@/lib/workspaceSession";
import {
  CLASS_GROUPS,
  type ClassGroupCode,
} from "@/lib/masters";
import { useRouter } from "next/navigation";
import { EditControl } from "@/components/masters/EditControl";
import { RemoveControl } from "@/components/masters/RemoveControl";
import { HolidayMonthTable } from "@/components/masters/HolidayMonthTable";
import { SchoolTimingPanel } from "@/components/masters/SchoolTimingPanel";
import { StatutoryConfigPanel } from "@/components/masters/StatutoryConfigPanel";
import { LeaveApprovalSettingsPanel } from "@/components/masters/LeaveApprovalSettingsPanel";
import { StaffAttendanceSettingsPanel } from "@/components/masters/StaffAttendanceSettingsPanel";
import { StaffLeaveTypesPanel } from "@/components/masters/StaffLeaveTypesPanel";
import { StaffAttendanceRulesPanel } from "@/components/masters/StaffAttendanceRulesPanel";
import { StepTabs, type StepDef } from "@/components/ui/StepTabs";
import { useDemoSession } from "@/components/shell/SessionContext";
import {
  MastersEmptyRow,
  MastersTabStack,
  MastersTableCard,
  MastersTablesRow,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
} from "@/components/ui/erp-roster";
import {
  loadSalarySetup,
  salarySetupCompleteness,
} from "@/lib/salarySetup";
import { completeMastersSetup } from "@/lib/mastersCompleteSetup";
import { forgetSchoolIdentity } from "@/lib/schoolIdentity";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import type { RowAction } from "@/components/ui/erp-grid";

type Commit = (s: MastersState, msg?: string) => void;

export function CompletenessDashboard({
  state,
  onGo,
  commit,
}: {
  state: MastersState;
  onGo: (tab: string) => void;
  commit?: Commit;
}) {
  const [salaryTick, setSalaryTick] = useState(0);
  const [lastActions, setLastActions] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const base = useMemo(() => mastersCompleteness(state), [state]);
  const salaryItem = useMemo(() => {
    const c = salarySetupCompleteness(loadSalarySetup());
    return {
      id: "salary",
      label: "Salary structures & bank",
      ok: c.ok,
      detail: c.detail,
      tab: "salary",
    };
  }, [state, salaryTick]);

  const items = useMemo(
    () => [...base.items, salaryItem],
    [base.items, salaryItem],
  );
  const okCount = items.filter((i) => i.ok).length;
  const total = items.length;
  const percent = Math.round((okCount / total) * 100);
  const remaining = items.filter((i) => !i.ok);

  function downloadCsv() {
    const lines = [
      "id,label,ok,detail",
      ...items.map(
        (i) =>
          `${i.id},"${i.label.replace(/"/g, '""')}",${i.ok ? "yes" : "no"},"${i.detail.replace(/"/g, '""')}"`,
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `masters_completeness_${percent}pct.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function runComplete() {
    if (!commit || busy) return;
    setBusy(true);
    try {
      const { state: next, actions } = completeMastersSetup(state, "Setup");
      commit(next, "Masters setup completed");
      setLastActions(actions);
      setSalaryTick((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Masters completeness
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            Foundation checklist before go-live — {okCount}/{total} ready
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {commit ? (
            <button
              type="button"
              disabled={busy}
              onClick={runComplete}
              className="rounded-lg bg-[var(--primary)] px-3 py-2 text-[11px] font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
            >
              {busy ? "Completing…" : "Complete masters setup"}
            </button>
          ) : null}
          <button
            type="button"
            className="text-[11px] font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
            onClick={downloadCsv}
          >
            Export CSV
          </button>
          <div className="text-right">
            <div className="text-2xl font-semibold text-[var(--brand-deep)]">
              {percent}%
            </div>
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
              <div
                className="h-full rounded-full bg-[var(--brand-gold)]"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        </div>
      </div>
      {lastActions && lastActions.length > 0 ? (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2">
          <p className="text-[11px] font-semibold text-[var(--brand-deep)]">
            Last complete run
          </p>
          <ul className="mt-1 list-inside list-disc text-[11px] text-[var(--muted)]">
            {lastActions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          {remaining.length > 0 ? (
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              Still open: {remaining.map((r) => r.label).join(" · ")} — enter
              UDISE on School profile and salary a/c on Salary setup if listed.
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-[var(--ok)]">
              Checklist complete.
            </p>
          )}
        </div>
      ) : null}
      <ul className="mt-4 divide-y divide-[var(--border)]">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-2 py-2.5"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    item.ok ? "bg-[var(--ok)]" : "bg-[var(--danger)]"
                  }`}
                />
                <span className="text-sm font-medium text-[var(--brand-deep)]">
                  {item.label}
                </span>
              </div>
              <p className="ml-4 mt-0.5 text-[11px] text-[var(--muted)]">
                {item.detail}
              </p>
            </div>
            {item.tab && !item.ok ? (
              <button
                type="button"
                className="text-[11px] font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
                onClick={() => onGo(item.tab!)}
              >
                Fix →
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SchoolProfileTextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block text-[11px] text-[var(--muted)]">{label}</span>
      <input
        className="field !py-1.5"
        type={type}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/**
 * School setup, in the order it is used: the profile first (its name and
 * identity print on everything), then the school day (attendance for
 * students and staff reads it), then EPF/ESIC (payroll only, set once).
 * The order is advice — none of these reads another.
 */
type SchoolStep = "profile" | "timings" | "statutory";

const SCHOOL_STEPS: StepDef<SchoolStep>[] = [
  {
    id: "profile",
    title: "Profile",
    what: "Legal name, board and affiliation, address, contact numbers, website, social links and the collections UPI — printed on certificates, receipts and parent messages.",
  },
  {
    id: "timings",
    title: "Timings",
    what: "School day hours for students and staff: a school default, then class-group and class-wise overrides where they differ.",
  },
  {
    id: "statutory",
    title: "EPF / ESIC",
    what: "Establishment IDs, contribution rates, wage ceilings and estimated late-payment penalty slabs used by payroll.",
  },
];

export function SchoolProfilePanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const p = state.schoolProfile;
  const [draft, setDraft] = useState(p);
  const [schoolStep, setSchoolStep] = useState<SchoolStep>("profile");

  function set<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <StepTabs
      aria-label="School setup steps"
      steps={SCHOOL_STEPS}
      value={schoolStep}
      onChange={setSchoolStep}
    >
    {/* Every step stays mounted: Timings and EPF/ESIC hold unsaved drafts in
        their own state, which a step switch must not throw away. */}
    <div className={schoolStep === "profile" ? "" : "hidden"}>
    <MastersTabStack
      intro="Legal identity, contact numbers, social links, and school day timing — used on certificates, receipts, attendance (students & staff), and parent communications."
      tables={
        <MastersTablesRow>
          <MastersTableCard title="Identity & address">
            <dl className="divide-y divide-[var(--border)] text-sm">
              {(
                [
                  ["Legal name", draft.legalName],
                  ["Display", draft.displayName],
                  ["UDISE", draft.udiseCode || "—"],
                  ["Board", `${BOARD_MODES.find((b) => b.value === draft.boardMode)?.label || draft.boardMode}${
                    draft.cbseAffiliationInProcess ? " · CBSE affiliation under process" : ""
                  }`],
                  ["Affiliation", draft.affiliationNo || "—"],
                  ["Address", [draft.address, draft.city, draft.state, draft.pincode].filter(Boolean).join(", ") || "—"],
                ] as const
              ).map(([k, v]) => (
                <div
                  key={k}
                  className="flex justify-between gap-3 px-4 py-2.5"
                >
                  <dt className="text-[11px] text-[var(--muted)]">{k}</dt>
                  <dd className="text-right font-medium text-[var(--brand-deep)]">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </MastersTableCard>
          <MastersTableCard title="Contact & social">
            <dl className="divide-y divide-[var(--border)] text-sm">
              {(
                [
                  ["Office phone", draft.phone || "—"],
                  ["Mobile", draft.mobile || "—"],
                  ["WhatsApp", draft.whatsapp || "—"],
                  ["Email", draft.email || "—"],
                  ["Website", draft.website || "—"],
                  ["Facebook", draft.facebook || "—"],
                  ["Instagram", draft.instagram || "—"],
                  ["Google", draft.google || "—"],
                  ["YouTube", draft.youtube || "—"],
                  ["Collections UPI", draft.collectionsUpiVpa || "—"],
                ] as const
              ).map(([k, v]) => (
                <div
                  key={k}
                  className="flex justify-between gap-3 px-4 py-2.5"
                >
                  <dt className="shrink-0 text-[11px] text-[var(--muted)]">
                    {k}
                  </dt>
                  <dd className="truncate text-right font-medium text-[var(--brand-deep)]">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </MastersTableCard>
        </MastersTablesRow>
      }
      work={
        <MastersWorkCard title="Edit school profile" hint="Working form — save to update tables above">
          <div className="space-y-5">
            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                Identity
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <SchoolProfileTextField label="Legal name" value={draft.legalName} onChange={(v) => set("legalName", v)} />
                <SchoolProfileTextField label="Display name" value={draft.displayName} onChange={(v) => set("displayName", v)} />
                <SchoolProfileTextField label="Short name" value={draft.shortName} onChange={(v) => set("shortName", v)} />
                <SchoolProfileTextField label="Tagline" value={draft.tagline} onChange={(v) => set("tagline", v)} />
                <SchoolProfileTextField label="UDISE code" value={draft.udiseCode} onChange={(v) => set("udiseCode", v)} />
                <SchoolProfileTextField label="Affiliation no." value={draft.affiliationNo} onChange={(v) => set("affiliationNo", v)} />
                <SchoolProfileTextField label="School code" value={draft.schoolCode} onChange={(v) => set("schoolCode", v)} />
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Board mode
                  </span>
                  <select
                    className="field !py-1.5"
                    value={draft.boardMode}
                    onChange={(e) =>
                      set("boardMode", e.target.value as BoardMode)
                    }
                  >
                    {BOARD_MODES.map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={draft.cbseAffiliationInProcess}
                    onChange={(e) => set("cbseAffiliationInProcess", e.target.checked)}
                  />
                  <span>
                    CBSE affiliation under process
                    <span className="block text-[11px] text-[var(--muted)]">
                      Applied for, not yet granted. Certificates say &quot;CBSE affiliation under process&quot; — never &quot;affiliated&quot; — until a real affiliation number is entered.
                    </span>
                  </span>
                </label>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                Address
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <SchoolProfileTextField
                  label="Address"
                  value={draft.address}
                  onChange={(v) => set("address", v)}
                  className="sm:col-span-2"
                />
                <SchoolProfileTextField label="City" value={draft.city} onChange={(v) => set("city", v)} />
                <SchoolProfileTextField label="State" value={draft.state} onChange={(v) => set("state", v)} />
                <SchoolProfileTextField label="PIN" value={draft.pincode} onChange={(v) => set("pincode", v)} />
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                Contact
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <SchoolProfileTextField
                  label="Office phone"
                  value={draft.phone}
                  onChange={(v) => set("phone", v)}
                  placeholder="Landline"
                  type="tel"
                />
                <SchoolProfileTextField
                  label="Mobile number"
                  value={draft.mobile}
                  onChange={(v) => set("mobile", v)}
                  placeholder="10-digit mobile"
                  type="tel"
                />
                <SchoolProfileTextField
                  label="WhatsApp number"
                  value={draft.whatsapp}
                  onChange={(v) => set("whatsapp", v)}
                  placeholder="WhatsApp number"
                  type="tel"
                />
                <SchoolProfileTextField
                  label="Email"
                  value={draft.email}
                  onChange={(v) => set("email", v)}
                  type="email"
                />
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                Website & social
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <SchoolProfileTextField
                  label="Website"
                  value={draft.website}
                  onChange={(v) => set("website", v)}
                  placeholder="https://…"
                  className="sm:col-span-2"
                />
                <SchoolProfileTextField
                  label="Facebook"
                  value={draft.facebook}
                  onChange={(v) => set("facebook", v)}
                  placeholder="https://facebook.com/…"
                />
                <SchoolProfileTextField
                  label="Instagram"
                  value={draft.instagram}
                  onChange={(v) => set("instagram", v)}
                  placeholder="https://instagram.com/…"
                />
                <SchoolProfileTextField
                  label="Google (Business / Maps)"
                  value={draft.google}
                  onChange={(v) => set("google", v)}
                  placeholder="https://maps.google.com/…"
                />
                <SchoolProfileTextField
                  label="YouTube"
                  value={draft.youtube}
                  onChange={(v) => set("youtube", v)}
                  placeholder="https://youtube.com/@…"
                />
                <SchoolProfileTextField
                  label="Collections UPI VPA"
                  value={draft.collectionsUpiVpa}
                  onChange={(v) => set("collectionsUpiVpa", v)}
                  placeholder="school@upi"
                  className="sm:col-span-2"
                />
              </div>
            </section>

            <button
              type="button"
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)]"
              onClick={() => {
                // Receipts memoise the printed identity — drop it so the very
                // next receipt shows what was just saved.
                forgetSchoolIdentity();
                commit(
                  { ...state, schoolProfile: draft },
                  "School profile saved",
                );
              }}
            >
              Save profile
            </button>
          </div>
        </MastersWorkCard>
      }
    />
    </div>
    <div className={schoolStep === "timings" ? "" : "hidden"}>
      <SchoolTimingPanel state={state} commit={commit} />
    </div>
    <div className={schoolStep === "statutory" ? "" : "hidden"}>
      <StatutoryConfigPanel state={state} commit={commit} />
    </div>
    </StepTabs>
  );
}

export function AcademicPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const router = useRouter();
  const session = useDemoSession();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [status, setStatus] = useState<AyStatus>("upcoming");
  const [termAy, setTermAy] = useState(
    () => session.academicYearCode,
  );
  const [termCode, setTermCode] = useState("");
  const [termLabel, setTermLabel] = useState("");
  const [termStart, setTermStart] = useState("");
  const [termEnd, setTermEnd] = useState("");

  useEffect(() => {
    setTermAy(session.academicYearCode);
  }, [session.academicYearCode]);

  async function applyWorkspaceSession(ayCode: string) {
    const ok = await syncWorkspaceAcademicYear(ayCode);
    if (ok) {
      sessionStorage.setItem(WORKSPACE_AY_ALIGNED_KEY, "1");
      router.refresh();
    }
  }

  function addYear() {
    if (!code.trim() || !startsOn || !endsOn) return;
    const row: AcademicYearMaster = {
      id: newFoundationId("ay"),
      code: code.trim(),
      label: label.trim() || code.trim(),
      startsOn,
      endsOn,
      status,
      isActive: true,
    };
    let years = [...state.academicYears, row];
    if (status === "current") {
      years = years.map((y) =>
        y.id === row.id ? y : { ...y, status: y.status === "current" ? "closed" : y.status },
      );
    }
    commit({ ...state, academicYears: years }, `Added AY ${row.code}`);
    if (status === "current") {
      void applyWorkspaceSession(row.code);
    }
    setCode("");
    setLabel("");
  }


  /**
   * The year and term registers, as registers. Four rows each, but they are
   * read across — which year is current, when each term starts and ends —
   * and that is a table's job even when it is short.
   */
  const sortedTerms = state.academicTerms
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const yearCols: DataTableColumn<(typeof state.academicYears)[number]>[] = [
    {
      key: "label", header: "Year", sortable: true,
      value: (y) => y.label,
      render: (y) => <span className="font-semibold text-[var(--brand-deep)]">{y.label}</span>,
    },
    {
      key: "status", header: "Status", sortable: true,
      value: (y) => y.status,
      render: (y) =>
        y.status === "current" ? (
          <span className="rounded bg-[rgba(197,160,40,0.2)] px-2 py-0.5 text-[10px] font-bold text-[var(--brand-deep)]">
            CURRENT
          </span>
        ) : (
          <span className="text-[var(--muted)]">{y.status}</span>
        ),
    },
    { key: "from", header: "Starts", sortable: true, value: (y) => y.startsOn },
    { key: "to", header: "Ends", sortable: true, value: (y) => y.endsOn },
  ];

  const yearActions: RowAction<(typeof state.academicYears)[number]>[] = [
    {
      id: "current", label: "Set current",
      hidden: (y) => y.status === "current",
      onSelect: (y) => setCurrent(y.id),
    },
  ];

  const termCols: DataTableColumn<(typeof sortedTerms)[number]>[] = [
    { key: "year", header: "Year", sortable: true, value: (t) => t.academicYearCode },
    {
      key: "code", header: "Term", sortable: true,
      value: (t) => t.code,
      render: (t) => (
        <span>
          <span className="font-semibold text-[var(--brand-deep)]">{t.code}</span> {t.label}
        </span>
      ),
    },
    { key: "from", header: "Starts", sortable: true, value: (t) => t.startsOn },
    { key: "to", header: "Ends", sortable: true, value: (t) => t.endsOn },
  ];

  function setCurrent(id: string) {
    const years = state.academicYears.map((y) => ({
      ...y,
      status:
        y.id === id
          ? ("current" as const)
          : y.status === "current"
            ? ("closed" as const)
            : y.status,
    }));
    const nextCode = years.find((y) => y.id === id)?.code;
    commit(
      {
        ...state,
        academicYears: years,
      },
      "Current academic year updated — workspace session synced",
    );
    if (nextCode) void applyWorkspaceSession(nextCode);
  }

  function addTerm() {
    if (!termCode.trim() || !termStart || !termEnd) return;
    const row: AcademicTerm = {
      id: newFoundationId("trm"),
      academicYearCode: termAy,
      code: termCode.trim(),
      label: termLabel.trim() || termCode.trim(),
      startsOn: termStart,
      endsOn: termEnd,
      sortOrder: state.academicTerms.filter((t) => t.academicYearCode === termAy)
        .length + 1,
    };
    commit(
      { ...state, academicTerms: [...state.academicTerms, row] },
      `Added term ${row.code}`,
    );
    setTermCode("");
    setTermLabel("");
  }

  return (
    <MastersTabStack
      tables={
        <MastersTablesRow>
          <MastersTableCard title="Academic years">
            <DataTable
              columns={yearCols}
              rows={state.academicYears}
              rowKey={(y) => y.id}
              rowActions={yearActions}
              rowActionsLabel="Year actions"
              minWidth="min-w-[440px]"
              emptyTitle="No academic years"
            />
          </MastersTableCard>
          <MastersTableCard title="Terms">
            <DataTable
              columns={termCols}
              rows={sortedTerms}
              rowKey={(t) => t.id}
              minWidth="min-w-[480px]"
              emptyTitle="No terms"
            />
          </MastersTableCard>
        </MastersTablesRow>
      }
      work={
        <div className="grid gap-4 lg:grid-cols-2">
          <MastersWorkCard title="Add academic year">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className="field !py-1.5"
                placeholder="Code e.g. 2026-27"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <input
                className="field !py-1.5"
                placeholder="Label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <input
                className="field !py-1.5"
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
              />
              <input
                className="field !py-1.5"
                type="date"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
              />
              <select
                className="field !py-1.5 sm:col-span-2"
                value={status}
                onChange={(e) => setStatus(e.target.value as AyStatus)}
              >
                <option value="upcoming">Upcoming</option>
                <option value="current">Current</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <button
              type="button"
              className="mt-3 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
              onClick={addYear}
            >
              Add academic year
            </button>
          </MastersWorkCard>
          <MastersWorkCard title="Add term">
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                className="field !py-1.5"
                value={termAy}
                onChange={(e) => setTermAy(e.target.value)}
              >
                {state.academicYears.map((y) => (
                  <option key={y.id} value={y.code}>
                    {y.code}
                  </option>
                ))}
              </select>
              <input
                className="field !py-1.5"
                placeholder="Code T1"
                value={termCode}
                onChange={(e) => setTermCode(e.target.value)}
              />
              <input
                className="field !py-1.5 sm:col-span-2"
                placeholder="Label"
                value={termLabel}
                onChange={(e) => setTermLabel(e.target.value)}
              />
              <input
                className="field !py-1.5"
                type="date"
                value={termStart}
                onChange={(e) => setTermStart(e.target.value)}
              />
              <input
                className="field !py-1.5"
                type="date"
                value={termEnd}
                onChange={(e) => setTermEnd(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="mt-3 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
              onClick={addTerm}
            >
              Add term
            </button>
          </MastersWorkCard>
        </div>
      }
    />
  );
}

export function NumberSeriesPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const session = useDemoSession();
  const ayCode = session.academicYearCode;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [prefix, setPrefix] = useState("");
  const [nextNumber, setNextNumber] = useState(1);
  const [padWidth, setPadWidth] = useState(4);
  const [resetOnAy, setResetOnAy] = useState(false);
  const [includeSessionInPrefix, setIncludeSessionInPrefix] = useState(false);

  const editingSeries = editingId
    ? state.numberSeries.find((s) => s.id === editingId)
    : null;

  const previewDraft: NumberSeries | null = editingSeries
    ? {
        ...editingSeries,
        prefix,
        nextNumber,
        padWidth,
        resetOnAy,
        includeSessionInPrefix,
      }
    : null;

  function startEdit(s: NumberSeries) {
    setEditingId(s.id);
    setPrefix(s.prefix);
    setNextNumber(s.nextNumber);
    setPadWidth(s.padWidth);
    setResetOnAy(s.resetOnAy);
    setIncludeSessionInPrefix(s.includeSessionInPrefix);
  }

  function saveEdit() {
    if (!editingId) return;
    commit(
      {
        ...state,
        numberSeries: state.numberSeries.map((s) =>
          s.id === editingId
            ? {
                ...s,
                prefix,
                nextNumber,
                padWidth,
                resetOnAy,
                includeSessionInPrefix,
              }
            : s,
        ),
      },
      "Number series updated",
    );
    setEditingId(null);
  }

  return (
    <MastersTabStack
      intro="Prefix and counter for admission, registration, receipts, SRN, TC, staff ID, and expense vouchers. Yearly reset and session-in-prefix are optional — counters can continue across academic years."
      tables={
        <MastersTablesRow cols={1}>
          <MastersTableCard title="Numbering series">
            <ul className="divide-y divide-[var(--border)]">
              {state.numberSeries.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-[var(--brand-deep)]">
                      {s.label}
                    </div>
                    <p className="text-[11px] text-[var(--muted)]">
                      Next: {formatSeriesNumber(s, ayCode)}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.resetOnAy ? (
                        <span className="rounded-full bg-[rgba(15,118,110,0.12)] px-2 py-0.5 text-[10px] font-semibold text-[var(--tone-teal)]">
                          resets each AY
                        </span>
                      ) : null}
                      {s.includeSessionInPrefix ? (
                        <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)]">
                          session in prefix
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <EditControl
                    active={editingId === s.id}
                    onEdit={() => startEdit(s)}
                  />
                </li>
              ))}
            </ul>
          </MastersTableCard>
        </MastersTablesRow>
      }
      work={
        <MastersWorkCard
          title={
            editingId
              ? `Edit · ${state.numberSeries.find((s) => s.id === editingId)?.label ?? ""}`
              : "Select a series to edit"
          }
          hint="Working form"
        >
          {editingId && previewDraft ? (
            <div className="flex max-w-xl flex-col gap-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Prefix
                  </span>
                  <input
                    className="field !py-1.5"
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Next #
                  </span>
                  <input
                    className="field !py-1.5 w-24"
                    type="number"
                    value={nextNumber}
                    onChange={(e) => setNextNumber(Number(e.target.value) || 1)}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Pad
                  </span>
                  <input
                    className="field !py-1.5 w-20"
                    type="number"
                    value={padWidth}
                    onChange={(e) => setPadWidth(Number(e.target.value) || 4)}
                  />
                </label>
              </div>
              <div className="flex flex-col gap-2 text-[11px] text-[var(--brand-deep)]">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={resetOnAy}
                    onChange={(e) => setResetOnAy(e.target.checked)}
                  />
                  <span>
                    <span className="font-semibold">Reset counter each academic year</span>
                    <span className="mt-0.5 block text-[var(--muted)]">
                      Optional — when off, the same series continues across sessions.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={includeSessionInPrefix}
                    onChange={(e) => setIncludeSessionInPrefix(e.target.checked)}
                  />
                  <span>
                    <span className="font-semibold">Include session in prefix</span>
                    <span className="mt-0.5 block text-[var(--muted)]">
                      Inserts {ayCode} into the prefix (e.g. BHB-{ayCode}-).
                    </span>
                  </span>
                </label>
              </div>
              <p className="text-sm font-semibold text-[var(--brand-deep)]">
                Preview: {formatSeriesNumber(previewDraft, ayCode)}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
                  onClick={saveEdit}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="text-xs text-[var(--muted)]"
                  onClick={() => setEditingId(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Click Edit on a series above.
            </p>
          )}
        </MastersWorkCard>
      }
    />
  );
}

/**
 * "Notify families": announce a published holiday on WhatsApp (with the
 * app-push mirror). For an unplanned closure the office picks the cause
 * and names who ordered it, so the message reads as an order the school
 * is following, not a whim. Always previews the reach first.
 */
function HolidayNotifyButton({ holiday }: { holiday: Holiday }) {
  const [open, setOpen] = useState(false);
  const closure = holiday.kind === "emergency" || holiday.kind === "other";
  const [reason, setReason] = useState<ClosureReasonCode>("heat_wave");
  const [orderedBy, setOrderedBy] = useState("the District Magistrate, Varanasi");
  const [reopenDate, setReopenDate] = useState("");
  const [note, setNote] = useState(holiday.note || "");
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [preview, setPreview] = useState<{
    recipientCount: number;
    via: string;
    warning: string | null;
    en: string;
    hi: string;
  } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function call(dryRun: boolean) {
    setBusy(dryRun ? "preview" : "send");
    try {
      const res = await fetch("/api/masters/holidays/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holiday: { id: holiday.id, title: holiday.title, startsOn: holiday.startsOn, endsOn: holiday.endsOn, kind: holiday.kind, note: holiday.note },
          reason: closure ? reason : undefined,
          orderedBy: closure ? orderedBy : undefined,
          reopenDate: reopenDate || undefined,
          note,
          dryRun,
        }),
      });
      const j = (await res.json()) as {
        error?: string;
        recipientCount?: number;
        via?: string;
        warning?: string | null;
        preview?: { en: string; hi: string };
        sent?: number;
        failed?: number;
      };
      if (!res.ok) {
        setDone(j.error || "Could not send");
        return;
      }
      if (dryRun) {
        setPreview({
          recipientCount: j.recipientCount ?? 0,
          via: j.via ?? "text",
          warning: j.warning ?? null,
          en: j.preview?.en ?? "",
          hi: j.preview?.hi ?? "",
        });
      } else {
        setDone(`Sent to ${j.sent ?? 0} families${j.failed ? `, ${j.failed} failed` : ""}.`);
      }
    } catch {
      setDone("Could not reach the server");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button
        type="button"
        className="rounded-lg bg-[#25D366] px-2.5 py-1 text-[11px] font-semibold text-white"
        onClick={() => {
          setOpen(true);
          setPreview(null);
          setDone(null);
        }}
      >
        Notify families
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl bg-[var(--card)] p-5 shadow-xl">
            <div className="text-base font-bold text-[var(--brand-deep)]">
              {closure ? "Announce closure" : "Announce holiday"} · {holiday.title}
            </div>
            <div className="mt-1 text-xs text-[var(--muted)]">
              {holiday.startsOn}{holiday.endsOn !== holiday.startsOn ? ` → ${holiday.endsOn}` : ""} · WhatsApp to every family, plus an app notification.
            </div>
            {closure ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="text-xs">
                  <span className="font-semibold">Reason</span>
                  <select className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm" value={reason} onChange={(e) => setReason(e.target.value as ClosureReasonCode)}>
                    {CLOSURE_REASONS.map((r) => (
                      <option key={r.code} value={r.code}>{r.en} · {r.hi}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  <span className="font-semibold">Ordered by</span>
                  <input className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm" value={orderedBy} onChange={(e) => setOrderedBy(e.target.value)} placeholder="the District Magistrate, Varanasi" />
                </label>
              </div>
            ) : null}
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="text-xs">
                <span className="font-semibold">School reopens on</span>
                <input type="date" className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm" value={reopenDate} onChange={(e) => setReopenDate(e.target.value)} />
                <span className="text-[10px] text-[var(--muted)]">Blank = the next working day after the holiday</span>
              </label>
              <label className="text-xs sm:col-span-2">
                <span className="font-semibold">Note to families (optional)</span>
                <textarea className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={closure ? "e.g. Homework for these days is in the parent app." : "e.g. Fee counter stays open on Saturday."} />
              </label>
            </div>
            {preview ? (
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-xs">
                <div className="font-semibold">
                  Reach: {preview.recipientCount} families · via {preview.via === "template" ? "approved template" : "free text"}
                </div>
                {preview.warning ? <div className="mt-1 text-[var(--warning)]">{preview.warning}</div> : null}
                <pre className="mt-2 whitespace-pre-wrap font-sans text-[11px] leading-relaxed">{preview.en}</pre>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-[11px] leading-relaxed">{preview.hi}</pre>
              </div>
            ) : null}
            {done ? <div className="mt-3 text-sm font-semibold text-[var(--brand-deep)]">{done}</div> : null}
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button type="button" className="rounded-lg px-3 py-1.5 text-xs font-semibold" onClick={() => setOpen(false)}>
                Close
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
                disabled={busy !== null}
                onClick={() => void call(true)}
              >
                {busy === "preview" ? "Checking…" : "Preview reach"}
              </button>
              <button
                type="button"
                className="rounded-lg bg-[#25D366] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                disabled={busy !== null || !preview}
                onClick={() => void call(false)}
              >
                {busy === "send" ? "Sending…" : `Send to ${preview?.recipientCount ?? "…"} families`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function HolidayRuleRow({
  h,
  trailing,
}: {
  h: Holiday;
  trailing: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-[var(--brand-deep)]">
          {h.title}{" "}
          <span className="text-[10px] font-medium uppercase text-[var(--muted)]">
            {h.kind}
            {h.workingOverride ? " · working" : ""}
          </span>
        </div>
        <p className="text-[11px] text-[var(--muted)]">
          {describeHolidayRule(h)} · {h.academicYearCode}
        </p>
      </div>
      {trailing}
    </li>
  );
}

/**
 * Holidays, in the order a session's calendar is built: take the government
 * calendar first (approved rows land published), then draft the school's own
 * rules on top (weekly offs, class-group days, working-day overrides), then
 * publish the drafts — attendance only uses published rules — and review
 * what is live.
 */
type HolidaysStep = "import" | "build" | "publish" | "review";

export function HolidaysPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const [holStep, setHolStep] = useState<HolidaysStep>("import");
  const session = useDemoSession();
  const ayBounds = useMemo(() => {
    const code = session.academicYearCode;
    const y = state.academicYears.find((a) => a.code === code);
    return {
      code,
      startsOn: y?.startsOn || "2025-04-01",
      endsOn: y?.endsOn || "2026-03-31",
    };
  }, [state, session.academicYearCode]);

  const [title, setTitle] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [kind, setKind] = useState<HolidayKind>("school");
  const sessionAy = session.academicYearCode;
  const [scope, setScope] = useState<HolidayScope>("school");
  const [appliesTo, setAppliesTo] = useState<HolidayAppliesTo>("everyone");
  const [groupCode, setGroupCode] = useState<ClassGroupCode>("PRIMARY");
  const [classIds, setClassIds] = useState<string[]>([]);
  const [mode, setMode] = useState<HolidayMode>("one_off");
  const [weekday, setWeekday] = useState(6);
  const [dayType, setDayType] = useState<HolidayDayType>("full");
  const [paidForStaff, setPaidForStaff] = useState(true);
  const [workingOverride, setWorkingOverride] = useState(false);
  const [exceptionText, setExceptionText] = useState("");
  const [previewFilter, setPreviewFilter] = useState<ClassGroupCode | "">("");

  const includesStaff =
    appliesToIncludesTeaching(appliesTo) ||
    appliesToIncludesNonTeaching(appliesTo);
  const includesStudents = appliesToIncludesStudents(appliesTo);

  const draftPreview = useMemo(() => {
    const row = normalizeHoliday({
      id: "preview",
      academicYearCode: sessionAy,
      title: title.trim() || "Preview",
      startsOn: startsOn || ayBounds.startsOn,
      endsOn: endsOn || startsOn || ayBounds.endsOn,
      kind,
      scope,
      appliesTo,
      groupCode: scope === "class_group" ? groupCode : "",
      classIds: scope === "class" ? classIds : [],
      mode,
      weekday: mode === "weekly" ? weekday : null,
      dayType,
      paidForStaff,
      workingOverride,
      exceptionDates: exceptionText
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      isPublished: true,
      publishedAt: null,
      publishedBy: "",
      note: "",
    });
    return previewHolidayDates(row, 10);
  }, [
    sessionAy,
    ayBounds,
    title,
    startsOn,
    endsOn,
    kind,
    scope,
    appliesTo,
    groupCode,
    classIds,
    mode,
    weekday,
    dayType,
    paidForStaff,
    workingOverride,
    exceptionText,
  ]);

  function add() {
    if (!title.trim()) return;
    if (mode === "one_off" && !startsOn) return;
    if (includesStudents && scope === "class_group" && !groupCode) return;
    if (includesStudents && scope === "class" && classIds.length === 0) return;
    const from =
      mode === "weekly"
        ? startsOn || ayBounds.startsOn
        : startsOn;
    const to =
      mode === "weekly"
        ? endsOn || ayBounds.endsOn
        : endsOn || startsOn;
    if (!from) return;
    const effectiveScope: HolidayScope =
      !includesStudents && includesStaff ? "school" : scope;
    const row = normalizeHoliday({
      id: newFoundationId("hol"),
      academicYearCode: sessionAy,
      title: title.trim(),
      startsOn: from,
      endsOn: to || from,
      kind,
      scope: effectiveScope,
      appliesTo,
      groupCode: effectiveScope === "class_group" ? groupCode : "",
      classIds: effectiveScope === "class" ? classIds : [],
      mode,
      weekday: mode === "weekly" ? weekday : null,
      dayType: workingOverride ? "full" : dayType,
      paidForStaff: includesStaff ? paidForStaff : false,
      workingOverride,
      exceptionDates: exceptionText
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      isPublished: false,
      publishedAt: null,
      publishedBy: "",
      note: "",
    });
    commit(
      { ...state, holidays: [...state.holidays, row] },
      "Holiday policy draft added",
    );
    setTitle("");
    setExceptionText("");
    setWorkingOverride(false);
  }

  function publish(id: string) {
    commit(
      {
        ...state,
        holidays: state.holidays.map((h) =>
          h.id === id
            ? {
                ...h,
                isPublished: true,
                publishedAt: new Date().toISOString(),
                publishedBy: "Principal",
              }
            : h,
        ),
      },
      "Holiday published — attendance uses this policy",
    );
  }

  function unpublish(id: string) {
    commit({
      ...state,
      holidays: state.holidays.map((h) =>
        h.id === id
          ? { ...h, isPublished: false, publishedAt: null, publishedBy: "" }
          : h,
      ),
    });
  }

  function remove(id: string) {
    commit({
      ...state,
      holidays: state.holidays.filter((h) => h.id !== id),
    });
  }

  function toggleClass(id: string) {
    setClassIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const sessionHolidays = useMemo(
    () =>
      (state.holidays ?? []).filter((h) => h.academicYearCode === sessionAy),
    [state.holidays, sessionAy],
  );
  const published = sessionHolidays.filter((h) => h.isPublished);
  const drafts = sessionHolidays.filter((h) => !h.isPublished);

  /**
   * The UP government calendar, offered for one-click approval. An entry is
   * hidden once ANY existing one-off holiday already covers its start date —
   * matching by date, not by name, so "Deepawali" typed by hand still
   * suppresses the suggestion.
   */
  const upSuggestions = useMemo(() => {
    if (sessionAy !== UP_HOLIDAY_CALENDAR_SESSION) return [];
    const covered = (d: string) =>
      sessionHolidays.some(
        (h) =>
          h.mode === "one_off" &&
          !h.workingOverride &&
          h.startsOn <= d &&
          d <= (h.endsOn || h.startsOn),
      );
    return UP_HOLIDAY_CALENDAR.filter(
      (e) =>
        e.date >= ayBounds.startsOn &&
        e.date <= ayBounds.endsOn &&
        !covered(e.date),
    );
  }, [sessionAy, sessionHolidays, ayBounds.startsOn, ayBounds.endsOn]);

  const approveUpEntries = useCallback(
    (entries: UpCalendarEntry[]) => {
      if (entries.length === 0) return;
      const now = new Date().toISOString();
      const rows = entries.map((e) =>
        normalizeHoliday({
          id: newFoundationId("hol"),
          academicYearCode: sessionAy,
          title: e.title,
          startsOn: e.date,
          endsOn: e.endDate || e.date,
          kind: e.kind === "national" ? "national" : e.kind,
          scope: "school",
          appliesTo: "everyone",
          mode: "one_off",
          weekday: null,
          dayType: "full",
          paidForStaff: true,
          exceptionDates: [],
          workingOverride: false,
          isPublished: true,
          publishedAt: now,
          publishedBy: "Principal",
          note: [
            "UP govt calendar",
            e.tentative ? "tentative — confirm on notification" : "",
            e.note || "",
          ]
            .filter(Boolean)
            .join(" · "),
        }),
      );
      commit(
        { ...state, holidays: [...state.holidays, ...rows] },
        rows.length === 1
          ? `${rows[0].title} approved from the UP calendar`
          : `${rows.length} holidays approved from the UP calendar`,
      );
    },
    [sessionAy, state, commit],
  );

  const matrixGroups = CLASS_GROUPS;
  const matrixMonth = useMemo(() => {
    const start = ayBounds.startsOn.slice(0, 10);
    const end = ayBounds.endsOn.slice(0, 10);
    const nowIso = new Date().toISOString().slice(0, 10);
    const anchor =
      start && end && nowIso >= start && nowIso <= end
        ? nowIso
        : start || nowIso;
    const [yStr, mStr] = anchor.split("-");
    const y = Number(yStr);
    const m = Number(mStr) - 1;
    const days: string[] = [];
    const last = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= last; d++) {
      const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (start && iso < start) continue;
      if (end && iso > end) continue;
      days.push(iso);
    }
    const label = new Date(y, m, 1).toLocaleString("en-IN", {
      month: "long",
      year: "numeric",
    });
    return { label: `${label} · ${sessionAy}`, days };
  }, [ayBounds.startsOn, ayBounds.endsOn, sessionAy]);

  const holidaySteps: StepDef<HolidaysStep>[] = [
    {
      id: "import",
      title: "Govt calendar",
      what: "The UP government holiday calendar for this session — approve a row (or all gazetted & national) and it lands published, straight onto attendance.",
      badge: upSuggestions.length || undefined,
    },
    {
      id: "build",
      title: "Build policy",
      what: "Draft a holiday rule: who it applies to, school / class-group / class scope, one-off or weekly, full or half day, paid for staff, working-day overrides.",
    },
    {
      id: "publish",
      title: "Publish drafts",
      what: "Publish a draft so attendance uses it, or remove it.",
      badge: drafts.length || undefined,
    },
    {
      id: "review",
      title: "Published",
      what: "Holidays live on attendance this session — notify families of a one-off holiday, or unpublish a rule.",
      badge: published.length || undefined,
    },
  ];

  return (
    <MastersTabStack
      intro={`Holiday policy for session ${sessionAy}: lists and matrix follow the header session selector. Choose who it applies to (students / teachers / non-teaching / both), then school or class-group scope · one-off or weekly · publish to apply on attendance.`}
      tables={
        <StepTabs
          aria-label="Holiday steps"
          steps={holidaySteps}
          value={holStep}
          onChange={setHolStep}
        >
          {holStep === "import" && upSuggestions.length === 0 ? (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-3 text-sm text-[var(--muted)]">
              Nothing pending from the UP government calendar
              {sessionAy === UP_HOLIDAY_CALENDAR_SESSION
                ? " — every date is already covered."
                : ` — it is loaded for ${UP_HOLIDAY_CALENDAR_SESSION} only.`}
            </p>
          ) : null}
          {holStep === "import" && upSuggestions.length > 0 ? (
            <MastersTableCard
              title={`UP government calendar ${UP_HOLIDAY_CALENDAR_SESSION} (${upSuggestions.length} pending)`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
                <p className="text-xs text-[var(--muted)]">
                  Verified against the UP list — approve a row and it lands
                  published, straight onto attendance. Moon-dependent dates
                  are marked and worth a re-check when the official
                  notification arrives.
                </p>
                <button
                  type="button"
                  className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-[11px] font-semibold text-[var(--primary-foreground)]"
                  onClick={() =>
                    approveUpEntries(
                      upSuggestions.filter((e) => e.kind !== "restricted"),
                    )
                  }
                  disabled={
                    upSuggestions.filter((e) => e.kind !== "restricted")
                      .length === 0
                  }
                >
                  Approve all gazetted & national (
                  {upSuggestions.filter((e) => e.kind !== "restricted").length}
                  )
                </button>
              </div>
              <ul className="divide-y divide-[var(--border)]">
                {upSuggestions.map((e) => (
                  <li
                    key={e.date + e.title}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                  >
                    <div>
                      <span className="text-sm font-medium">{e.title}</span>
                      <span className="ml-2 text-xs text-[var(--muted)]">
                        {e.date}
                        {e.endDate && e.endDate !== e.date
                          ? ` → ${e.endDate}`
                          : ""}
                      </span>
                      <span
                        className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          e.kind === "restricted"
                            ? "bg-amber-500/15 text-amber-700"
                            : e.kind === "national"
                              ? "bg-sky-500/15 text-sky-700"
                              : "bg-emerald-500/15 text-emerald-700"
                        }`}
                      >
                        {e.kind}
                      </span>
                      {e.tentative ? (
                        <span className="ml-1.5 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                          tentative
                        </span>
                      ) : null}
                      {e.note ? (
                        <div className="text-[11px] text-[var(--muted)]">
                          {e.note}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold hover:bg-[var(--muted-bg,rgba(0,0,0,0.04))]"
                      onClick={() => approveUpEntries([e])}
                    >
                      Approve
                    </button>
                  </li>
                ))}
              </ul>
            </MastersTableCard>
          ) : null}
          {holStep === "review" ? (
            <MastersTableCard title={`Published (${published.length}) · month-wise`}>
              <HolidayMonthTable
                holidays={published}
                sessionStart={ayBounds.startsOn}
                sessionEnd={ayBounds.endsOn}
                emptyText="No published holidays"
                extra={(h) => (h.mode !== "weekly" ? <HolidayNotifyButton holiday={h} /> : null)}
                actions={() => [
                  { id: "unpublish", label: "Unpublish (back to drafts)", onSelect: (h) => unpublish(h.id) },
                ]}
              />
            </MastersTableCard>
          ) : null}
          {holStep === "publish" ? (
            <MastersTableCard title={`Drafts (${drafts.length}) · month-wise`}>
              <HolidayMonthTable
                holidays={drafts}
                sessionStart={ayBounds.startsOn}
                sessionEnd={ayBounds.endsOn}
                emptyText="No drafts"
                actions={() => [
                  { id: "publish", label: "Publish", onSelect: (h) => publish(h.id) },
                  {
                    id: "remove",
                    label: "Remove",
                    tone: "danger",
                    separatorAbove: true,
                    onSelect: (h) => {
                      if (window.confirm(`Remove the holiday rule "${h.title}"?`)) remove(h.id);
                    },
                  },
                ]}
              />
            </MastersTableCard>
          ) : null}
          {holStep === "build" ? (
          <MastersTableCard
            title={`Group matrix · ${matrixMonth.label}`}
            className="mt-3"
          >
            <div className="overflow-x-auto px-3 py-2">
              <ErpTable minWidth="min-w-[480px]" className="text-[10px]">
                <ErpTableHead>
                  <tr className="text-[var(--muted)]">
                    <th className="py-1 pr-2 font-medium">Group</th>
                    <th className="py-1 font-medium">Off days this month (published)</th>
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {matrixGroups.map((g) => {
                    const offs = matrixMonth.days.filter((d) => {
                      const c = classifyHolidayDay(state, d, sessionAy, {
                        kind: "group",
                        groupCode: g.code,
                      });
                      return c.status === "holiday" || c.status === "half_holiday";
                    });
                    if (previewFilter && previewFilter !== g.code) {
                      return null;
                    }
                    return (
                      <tr key={g.code}>
                        <td className="py-1.5 pr-2 font-semibold text-[var(--brand-deep)]">
                          {g.label}
                        </td>
                        <td className="py-1.5 text-[var(--muted)]">
                          {offs.length === 0
                            ? "—"
                            : offs.slice(0, 8).join(", ") +
                              (offs.length > 8 ? ` +${offs.length - 8}` : "")}
                        </td>
                      </tr>
                    );
                  })}
                </ErpTableBody>
              </ErpTable>
            </div>
            <p className="border-t border-[var(--border)] px-3 py-2 text-[10px] text-[var(--muted)]">
              Filter preview by group when building weekly rules. Student attendance
              resolves per class → group; staff uses school-wide rules only.
            </p>
          </MastersTableCard>
          ) : null}
        </StepTabs>
      }
      work={
        holStep !== "build" ? null : (
        <MastersWorkCard
          title="Holiday policy builder"
          hint="Draft → Principal publish"
        >
          <div className="grid max-w-4xl gap-2 sm:grid-cols-3">
            <div className="field !flex !items-center !py-1.5 text-[12px] font-semibold text-[var(--brand-deep)]">
              Session {sessionAy}
            </div>
            <input
              className="field !py-1.5 sm:col-span-2"
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <select
              className="field !py-1.5"
              value={kind}
              onChange={(e) => setKind(e.target.value as HolidayKind)}
            >
              {HOLIDAY_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <select
              className="field !py-1.5 sm:col-span-2"
              value={appliesTo}
              onChange={(e) =>
                setAppliesTo(e.target.value as HolidayAppliesTo)
              }
            >
              {HOLIDAY_APPLIES_TO.map((a) => (
                <option key={a.value} value={a.value}>
                  Applies to: {a.label}
                </option>
              ))}
            </select>
            {includesStudents ? (
              <select
                className="field !py-1.5"
                value={scope}
                onChange={(e) => setScope(e.target.value as HolidayScope)}
              >
                {HOLIDAY_SCOPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            ) : (
              <div className="field !flex !items-center !py-1.5 text-[11px] text-[var(--muted)]">
                Staff calendar · school-wide
              </div>
            )}
            <select
              className="field !py-1.5"
              value={mode}
              onChange={(e) => setMode(e.target.value as HolidayMode)}
            >
              {HOLIDAY_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            {includesStudents && scope === "class_group" ? (
              <select
                className="field !py-1.5"
                value={groupCode}
                onChange={(e) =>
                  setGroupCode(e.target.value as ClassGroupCode)
                }
              >
                {CLASS_GROUPS.map((g) => (
                  <option key={g.code} value={g.code}>
                    {g.label}
                  </option>
                ))}
              </select>
            ) : null}
            {mode === "weekly" ? (
              <select
                className="field !py-1.5"
                value={weekday}
                onChange={(e) => setWeekday(Number(e.target.value))}
              >
                {WEEKDAY_LABELS.map((label, i) => (
                  <option key={label} value={i}>
                    Every {label}
                  </option>
                ))}
              </select>
            ) : null}
            <input
              className="field !py-1.5"
              type="date"
              title={mode === "weekly" ? "Effective from" : "Starts"}
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
            />
            <input
              className="field !py-1.5"
              type="date"
              title={mode === "weekly" ? "Effective to" : "Ends"}
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
            />
            <select
              className="field !py-1.5"
              value={dayType}
              disabled={workingOverride}
              onChange={(e) => setDayType(e.target.value as HolidayDayType)}
            >
              {HOLIDAY_DAY_TYPES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          {includesStudents && scope === "class" ? (
            <div className="mt-2 flex max-w-4xl flex-wrap gap-2">
              {state.classes
                .filter((c) => c.isActive !== false)
                .map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-1.5 text-[11px] text-[var(--brand-deep)]"
                  >
                    <input
                      type="checkbox"
                      checked={classIds.includes(c.id)}
                      onChange={() => toggleClass(c.id)}
                    />
                    {c.name}
                  </label>
                ))}
            </div>
          ) : null}

          <div className="mt-2 flex max-w-4xl flex-wrap items-center gap-4 text-[11px]">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={workingOverride}
                onChange={(e) => setWorkingOverride(e.target.checked)}
              />
              Working-day override (suspends weekly off)
            </label>
            {includesStaff && !workingOverride ? (
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={paidForStaff}
                  onChange={(e) => setPaidForStaff(e.target.checked)}
                />
                Paid holiday for staff
              </label>
            ) : null}
          </div>

          {mode === "weekly" ? (
            <div className="mt-2 max-w-4xl">
              <label className="text-[11px] text-[var(--muted)]">
                Exception dates (comma-separated ISO) — weekly rule suspended
              </label>
              <input
                className="field mt-1 !py-1.5"
                placeholder="2025-08-16, 2025-12-20"
                value={exceptionText}
                onChange={(e) => setExceptionText(e.target.value)}
              />
            </div>
          ) : null}

          {draftPreview.length > 0 ? (
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              Preview dates: {draftPreview.join(", ")}
              {draftPreview.length >= 10 ? "…" : ""}
            </p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              className="field !w-auto !py-1.5 text-[11px]"
              value={previewFilter}
              onChange={(e) =>
                setPreviewFilter(
                  (e.target.value || "") as ClassGroupCode | "",
                )
              }
            >
              <option value="">Preview filter (optional)</option>
              {CLASS_GROUPS.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
              onClick={add}
            >
              Add draft rule
            </button>
          </div>
        </MastersWorkCard>
        )
      }
    />
  );
}

/** Staff-related masters only (depts / designations). Employee roster lives in /staff. */
export function StaffMastersPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const [depCode, setDepCode] = useState("");
  const [depName, setDepName] = useState("");
  const [desCode, setDesCode] = useState("");
  const [desName, setDesName] = useState("");
  const [desDep, setDesDep] = useState("");

  const activeDepts = state.departments.filter((d) => d.isActive);
  const activeDes = state.designations.filter((d) => d.isActive);

  function addDept() {
    if (!depCode.trim() || !depName.trim()) return;
    const row: Department = {
      id: newFoundationId("dep"),
      code: depCode.trim().toUpperCase(),
      name: depName.trim(),
      isActive: true,
    };
    commit(
      { ...state, departments: [...state.departments, row] },
      `Department ${row.code}`,
    );
    setDepCode("");
    setDepName("");
  }

  function addDes() {
    if (!desCode.trim() || !desName.trim()) return;
    const row: Designation = {
      id: newFoundationId("des"),
      code: desCode.trim().toUpperCase(),
      name: desName.trim(),
      departmentId: desDep || null,
      isActive: true,
    };
    commit(
      { ...state, designations: [...state.designations, row] },
      `Designation ${row.code}`,
    );
    setDesCode("");
    setDesName("");
  }

  const deptCols: DataTableColumn<(typeof activeDepts)[number]>[] = [
    {
      key: "code", header: "Code", sortable: true,
      value: (d) => d.code,
      render: (d) => <span className="font-semibold text-[var(--brand-deep)]">{d.code}</span>,
    },
    { key: "name", header: "Department", sortable: true, value: (d) => d.name },
  ];

  const desigCols: DataTableColumn<(typeof activeDes)[number]>[] = [
    {
      key: "code", header: "Code", sortable: true,
      value: (d) => d.code,
      render: (d) => <span className="font-semibold">{d.code}</span>,
    },
    { key: "name", header: "Designation", sortable: true, value: (d) => d.name },
    {
      key: "dept", header: "Department", sortable: true,
      value: (d) => state.departments.find((x) => x.id === d.departmentId)?.name ?? "—",
    },
  ];

  return (
    <MastersTabStack
      tables={
        <MastersTablesRow cols={2}>
          <MastersTableCard title="Departments">
            <DataTable
              columns={deptCols}
              rows={activeDepts}
              rowKey={(d) => d.id}
              minWidth="min-w-[320px]"
              emptyTitle="No active departments"
            />
          </MastersTableCard>
          <MastersTableCard title="Designations">
            <DataTable
              columns={desigCols}
              rows={activeDes}
              rowKey={(d) => d.id}
              minWidth="min-w-[380px]"
              emptyTitle="No active designations"
            />
          </MastersTableCard>
        </MastersTablesRow>
      }
      work={
        <div className="space-y-4">
          <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-3 text-sm text-[var(--muted)]">
            Departments and designations. School day hours are under{" "}
            <span className="font-semibold text-[var(--brand-deep)]">
              School
            </span>
            ; leave types and attendance rules under{" "}
            <span className="font-semibold text-[var(--brand-deep)]">
              Leave setup
            </span>
            . Manage employees in the{" "}
            <Link
              href="/staff"
              className="font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
            >
              Staff module
            </Link>
            .
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <MastersWorkCard title="Add department">
              <div className="flex flex-wrap gap-2">
                <input
                  className="field !py-1.5 w-28"
                  placeholder="Code"
                  value={depCode}
                  onChange={(e) => setDepCode(e.target.value)}
                />
                <input
                  className="field !py-1.5 min-w-[8rem] flex-1"
                  placeholder="Name"
                  value={depName}
                  onChange={(e) => setDepName(e.target.value)}
                />
                <button
                  type="button"
                  className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
                  onClick={addDept}
                >
                  Add
                </button>
              </div>
            </MastersWorkCard>
            <MastersWorkCard title="Add designation">
              <div className="flex flex-wrap gap-2">
                <input
                  className="field !py-1.5 w-28"
                  placeholder="Code"
                  value={desCode}
                  onChange={(e) => setDesCode(e.target.value)}
                />
                <input
                  className="field !py-1.5 min-w-[6rem] flex-1"
                  placeholder="Name"
                  value={desName}
                  onChange={(e) => setDesName(e.target.value)}
                />
                <select
                  className="field !py-1.5"
                  value={desDep}
                  onChange={(e) => setDesDep(e.target.value)}
                >
                  <option value="">Dept…</option>
                  {state.departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
                  onClick={addDes}
                >
                  Add
                </button>
              </div>
            </MastersWorkCard>
          </div>
        </div>
      }
    />
  );
}

/**
 * Leave setup, in the order it is built: the leave types and their caps
 * first (approval needs something to approve), then who approves, then how
 * attendance is taken, then the rules that adjust it and who they apply to.
 */
type LeaveSetupStep = "types" | "approval" | "attendance" | "rules";

const LEAVE_SETUP_STEPS: StepDef<LeaveSetupStep>[] = [
  {
    id: "types",
    title: "Leave types & caps",
    what: "The kinds of leave staff can take (CL, ML, EL…), days allotted per academic year and what carries forward. Everything after this uses these types.",
  },
  {
    id: "approval",
    title: "Approval flow",
    what: "How a leave request is approved — automatically, or in one or two levels — and how many minutes after start count as late.",
  },
  {
    id: "attendance",
    title: "Attendance settings",
    what: "How staff attendance is taken: self-punch, WhatsApp IN/OUT, campus geofence, auto-applying punch rules, and syncing approved leave into the register.",
  },
  {
    id: "rules",
    title: "Attendance rules",
    what: "Punch rules (late and early buffers and the rest) — build a rule, then assign it to the staff it applies to.",
  },
];

/** Leave types, approval settings, and staff attendance adjustment rules. */
export function LeaveMastersPanel() {
  const [leaveStep, setLeaveStep] = useState<LeaveSetupStep>("types");
  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-3 text-sm text-[var(--muted)]">
        Leave types / caps, leave rules (auto-approve, 2-level, late minutes),
        attendance settings / rules, and sync leave → attendance. School clock
        times stay in{" "}
        <span className="font-semibold text-[var(--brand-deep)]">School</span>.
        Apply leave in{" "}
        <Link
          href="/staff"
          className="font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
        >
          Staff → Leave
        </Link>
        ; mark punches in Attendance → Staff.
      </p>
      <StepTabs
        aria-label="Leave setup steps"
        steps={LEAVE_SETUP_STEPS}
        value={leaveStep}
        onChange={setLeaveStep}
      >
        {leaveStep === "types" ? <StaffLeaveTypesPanel /> : null}
        {leaveStep === "approval" ? <LeaveApprovalSettingsPanel /> : null}
        {leaveStep === "attendance" ? <StaffAttendanceSettingsPanel /> : null}
        {leaveStep === "rules" ? <StaffAttendanceRulesPanel /> : null}
      </StepTabs>
    </div>
  );
}
