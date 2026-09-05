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
  isSubjectGroup,
  normalizeSubject,
  subjectChildren,
  subjectsInDisplayOrder,
  type AcademicTerm,
  type AcademicYearMaster,
  type AyStatus,
  type BoardMode,
  type ClassSubjectLink,
  type Department,
  type Designation,
  type Holiday,
  type HolidayAppliesTo,
  type HolidayDayType,
  type HolidayKind,
  type HolidayMode,
  type HolidayScope,
  type NumberSeries,
  type Subject,
  type SubjectCategory,
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
import {
  NCF_SUBJECT_TAGS,
  cbseGroupForSubject,
  groupSubjectsByCbse,
  languageSubtypeOf,
  type LanguageSubtype,
  type NcfTagId,
} from "@/lib/cbseSubjectGroups";

/** Alias — Masters still iterates the same A/B/C/D tag list */
const CBSE_SUBJECT_GROUPS = NCF_SUBJECT_TAGS;
type CbseGroupId = NcfTagId;
import { syncWorkspaceAcademicYear, type MastersState } from "@/lib/masters";
import { WORKSPACE_AY_ALIGNED_KEY } from "@/lib/workspaceSession";
import {
  CLASS_GROUPS,
  classesInGroup,
  type ClassGroupCode,
} from "@/lib/masters";
import { useRouter } from "next/navigation";
import { EditControl } from "@/components/masters/EditControl";
import { RemoveControl } from "@/components/masters/RemoveControl";
import { SchoolTimingPanel } from "@/components/masters/SchoolTimingPanel";
import { StatutoryConfigPanel } from "@/components/masters/StatutoryConfigPanel";
import { LeaveApprovalSettingsPanel } from "@/components/masters/LeaveApprovalSettingsPanel";
import { StaffAttendanceSettingsPanel } from "@/components/masters/StaffAttendanceSettingsPanel";
import { StaffLeaveTypesPanel } from "@/components/masters/StaffLeaveTypesPanel";
import { StaffAttendanceRulesPanel } from "@/components/masters/StaffAttendanceRulesPanel";
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
  NEP_STAGE_PACKS,
  analyseNepPack,
  applyNepSuggestions,
  applySeniorStreamPackages,
  periodsForSuggestion,
  suggestedPeriodsPerWeek,
  suggestedWeeklyLoad,
  type NepStage,
} from "@/lib/nepSubjectSuggestions";
import {
  ncfCartOfferingsReady,
  seedNcfCartOfferings,
} from "@/lib/ncfCartSeed";
import {
  loadSalarySetup,
  salarySetupCompleteness,
} from "@/lib/salarySetup";
import { completeMastersSetup } from "@/lib/mastersCompleteSetup";
import { forgetSchoolIdentity } from "@/lib/schoolIdentity";

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

export function SchoolProfilePanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const p = state.schoolProfile;
  const [draft, setDraft] = useState(p);

  function set<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <div className="space-y-6">
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
                  ["Board", draft.boardMode],
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
    <SchoolTimingPanel state={state} commit={commit} />
    <StatutoryConfigPanel state={state} commit={commit} />
    </div>
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
            <ul className="divide-y divide-[var(--border)]">
              {state.academicYears.map((y) => (
                <li
                  key={y.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-[var(--brand-deep)]">
                      {y.label}{" "}
                      <span className="text-[11px] font-medium text-[var(--muted)]">
                        {y.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--muted)]">
                      {y.startsOn} → {y.endsOn}
                    </p>
                  </div>
                  {y.status !== "current" ? (
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-[var(--brand-deep)]"
                      onClick={() => setCurrent(y.id)}
                    >
                      Set current
                    </button>
                  ) : (
                    <span className="rounded bg-[rgba(197,160,40,0.2)] px-2 py-0.5 text-[10px] font-bold text-[var(--brand-deep)]">
                      CURRENT
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </MastersTableCard>
          <MastersTableCard title="Terms">
            <ul className="divide-y divide-[var(--border)]">
              {state.academicTerms
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((t) => (
                  <li key={t.id} className="px-4 py-3 text-sm">
                    <span className="font-semibold text-[var(--brand-deep)]">
                      {t.academicYearCode} · {t.code}
                    </span>{" "}
                    {t.label}
                    <span className="ml-2 text-[11px] text-[var(--muted)]">
                      {t.startsOn} → {t.endsOn}
                    </span>
                  </li>
                ))}
              {state.academicTerms.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                  No academic terms yet
                </li>
              ) : null}
            </ul>
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

const CLASS_GROUP_TO_NEP: Record<ClassGroupCode, NepStage> = {
  PRE_PRIMARY: "foundational",
  PRIMARY: "preparatory",
  MIDDLE: "middle",
  SECONDARY: "secondary_9_10",
  SENIOR: "secondary_11_12",
};

export function SubjectsPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const [code, setCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [category, setCategory] = useState<SubjectCategory>("scholastic");
  const [area, setArea] = useState("");
  const [parentId, setParentId] = useState("");
  const [cbseGroupId, setCbseGroupId] = useState<CbseGroupId | "">("");
  const [languageSubtype, setLanguageSubtype] =
    useState<LanguageSubtype>("");
  const [mapClassId, setMapClassId] = useState("");
  const [mapSubjectIds, setMapSubjectIds] = useState<string[]>([]);
  const [periods, setPeriods] = useState(0);
  const [linkAsOptional, setLinkAsOptional] = useState(false);
  const [classGroup, setClassGroup] = useState<ClassGroupCode | null>(null);

  const nepStage: NepStage = classGroup
    ? CLASS_GROUP_TO_NEP[classGroup]
    : "middle";

  const nepPack =
    NEP_STAGE_PACKS.find((p) => p.id === nepStage) ?? NEP_STAGE_PACKS[2]!;
  const nepAnalysis = useMemo(
    () => analyseNepPack(nepPack, state.subjects),
    [nepPack, state.subjects],
  );
  const weeklyLoad = useMemo(
    () => suggestedWeeklyLoad(nepPack),
    [nepPack],
  );

  const activeGroupDef = CLASS_GROUPS.find((g) => g.code === classGroup);
  const groupClasses = useMemo(
    () => (classGroup ? classesInGroup(state.classes, classGroup) : []),
    [state.classes, classGroup],
  );
  const groupClassIds = useMemo(
    () => new Set(groupClasses.map((c) => c.id)),
    [groupClasses],
  );
  const groupLinks = useMemo(
    () =>
      state.classSubjects.filter(
        (l) => l.isActive && groupClassIds.has(l.classId),
      ),
    [state.classSubjects, groupClassIds],
  );

  /** Subjects & parent groups relevant to the open class group. */
  const groupRelatedSubjects = useMemo(() => {
    if (!classGroup) return [];
    const nepCodes = new Set(
      nepPack.subjects.map((s) => s.code.toUpperCase()),
    );
    // Also include underCode parents from NEP pack
    for (const s of nepPack.subjects) {
      if (s.underCode) nepCodes.add(s.underCode.toUpperCase());
    }
    const linkedIds = new Set(groupLinks.map((l) => l.subjectId));
    // Expand: parents of linked components, children of linked groups
    for (const id of [...linkedIds]) {
      const sub = state.subjects.find((s) => s.id === id);
      if (sub?.parentId) linkedIds.add(sub.parentId);
    }
    for (const s of state.subjects) {
      if (s.parentId && linkedIds.has(s.parentId)) linkedIds.add(s.id);
    }

    const related = state.subjects.filter((s) => {
      if (linkedIds.has(s.id)) return true;
      if (nepCodes.has(s.code.toUpperCase())) return true;
      // Parent group if any child matches NEP / linked
      if (
        !s.parentId &&
        state.subjects.some(
          (c) =>
            c.parentId === s.id &&
            (linkedIds.has(c.id) || nepCodes.has(c.code.toUpperCase())),
        )
      ) {
        return true;
      }
      return false;
    });
    return subjectsInDisplayOrder(related);
  }, [classGroup, nepPack, groupLinks, state.subjects]);

  const groupParents = groupRelatedSubjects.filter(
    (s) => s.isActive && !s.parentId,
  );

  const subjectsByCbse = useMemo(
    () => groupSubjectsByCbse(groupRelatedSubjects),
    [groupRelatedSubjects],
  );

  const linksByCbse = useMemo(() => {
    const enriched = groupLinks
      .map((l) => {
        const subject = state.subjects.find((s) => s.id === l.subjectId);
        return subject ? { link: l, subject } : null;
      })
      .filter((x): x is { link: ClassSubjectLink; subject: Subject } => !!x);

    const buckets = new Map<
      CbseGroupId,
      { link: ClassSubjectLink; subject: Subject }[]
    >();
    for (const g of CBSE_SUBJECT_GROUPS) buckets.set(g.id, []);
    for (const row of enriched) {
      const gid = cbseGroupForSubject(row.subject);
      buckets.get(gid)!.push(row);
    }
    return CBSE_SUBJECT_GROUPS.map((group) => ({
      group,
      rows: buckets.get(group.id) ?? [],
    })).filter((b) => b.rows.length > 0);
  }, [groupLinks, state.subjects]);

  const nepCodeSet = useMemo(() => {
    const codes = new Set(nepPack.subjects.map((s) => s.code.toUpperCase()));
    for (const s of nepPack.subjects) {
      if (s.underCode) codes.add(s.underCode.toUpperCase());
    }
    return codes;
  }, [nepPack]);

  function openClassGroup(code: ClassGroupCode) {
    setClassGroup(code);
    setMapSubjectIds([]);
    const first = classesInGroup(state.classes, code).find((c) => c.isActive);
    setMapClassId(first?.id ?? "");
  }

  function applyNepPack() {
    const { subjects, added } = applyNepSuggestions(
      state.subjects,
      nepPack,
    );
    if (added === 0) {
      commit(state, "All NEP suggestions for this stage are already present");
      return;
    }
    commit(
      { ...state, subjects },
      `Added ${added} NEP/NCF subject${added === 1 ? "" : "s"} · ${nepPack.label}`,
    );
  }

  function seedCartOfferings() {
    const seeded = seedNcfCartOfferings({
      classes: state.classes,
      subjects: state.subjects,
      classSubjects: state.classSubjects ?? [],
    });
    commit(
      {
        ...state,
        subjects: seeded.subjects,
        classSubjects: seeded.classSubjects,
      },
      seeded.alreadySeeded
        ? "IX–X / XI–XII cart offerings already complete · tags refreshed"
        : `Seeded cart · +${seeded.subjectsAdded} subjects · +${seeded.linksAdded} class links`,
    );
  }

  function applyStreams() {
    const result = applySeniorStreamPackages(
      state.subjects,
      state.seniorStreams ?? [],
    );
    commit(
      {
        ...state,
        subjects: result.subjects,
        seniorStreams: result.seniorStreams,
      },
      result.subjectsAdded > 0
        ? `Streams ready · ${result.subjectsAdded} subjects added · ${result.streamsUpserted} pathways`
        : `XI–XII streams refreshed · ${result.streamsUpserted} pathways`,
    );
  }

  const streams = (state.seniorStreams ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);

  function addSubject() {
    if (!code.trim() || !nameEn.trim()) return;
    const parent = parentId
      ? state.subjects.find((s) => s.id === parentId)
      : null;
    const row = normalizeSubject({
      id: newFoundationId("sub"),
      code: code.trim().toUpperCase(),
      nameEn: nameEn.trim(),
      category: parent?.category ?? category,
      coScholasticArea:
        (parent?.category ?? category) === "co_scholastic" ? area : "",
      parentId: parentId || null,
      isElective: false,
      isActive: true,
      sortOrder: parentId
        ? subjectChildren(state.subjects, parentId).length + 1
        : state.subjects.filter((s) => !s.parentId).length + 1,
      ncfTagId: (cbseGroupId as CbseGroupId) || undefined,
      cbseGroupId:
        (cbseGroupId as CbseGroupId) ||
        parent?.ncfTagId ||
        parent?.cbseGroupId ||
        null,
      languageSubtype:
        languageSubtype || parent?.languageSubtype || undefined,
    });
    commit(
      { ...state, subjects: [...state.subjects, row] },
      parent
        ? `Added ${row.code} under ${parent.code}`
        : `Added ${row.code}`,
    );
    setCode("");
    setNameEn("");
    setCbseGroupId("");
    setLanguageSubtype("");
  }

  function setSubjectCbseGroup(id: string, next: CbseGroupId) {
    commit(
      {
        ...state,
        subjects: state.subjects.map((s) =>
          s.id === id
            ? normalizeSubject({ ...s, ncfTagId: next, cbseGroupId: next })
            : s,
        ),
      },
      `NCF tag → ${next}`,
    );
  }

  function setSubjectLanguageSubtype(id: string, next: LanguageSubtype) {
    commit(
      {
        ...state,
        subjects: state.subjects.map((s) =>
          s.id === id
            ? normalizeSubject({ ...s, languageSubtype: next })
            : s,
        ),
      },
      next ? `Language subtype → ${next}` : "Language subtype cleared",
    );
  }

  function toggleSubject(id: string) {
    commit({
      ...state,
      subjects: state.subjects.map((s) =>
        s.id === id ? { ...s, isActive: !s.isActive } : s,
      ),
    });
  }

  function toggleMapSubject(id: string) {
    const kids = subjectChildren(state.subjects, id).map((s) => s.id);
    setMapSubjectIds((prev) => {
      const on = prev.includes(id);
      if (kids.length > 0) {
        // Group head: select/deselect all components
        if (on || kids.every((k) => prev.includes(k))) {
          return prev.filter((x) => x !== id && !kids.includes(x));
        }
        return [...new Set([...prev, id, ...kids])];
      }
      return on ? prev.filter((x) => x !== id) : [...prev, id];
    });
  }

  function selectAllMapSubjects() {
    const ids = groupRelatedSubjects
      .filter((s) => s.isActive)
      .map((s) => s.id);
    setMapSubjectIds(ids);
  }

  function clearMapSubjects() {
    setMapSubjectIds([]);
  }

  function addMap() {
    if (!mapClassId || mapSubjectIds.length === 0) return;
    const existing = new Set(
      state.classSubjects
        .filter((l) => l.classId === mapClassId && l.isActive)
        .map((l) => l.subjectId),
    );
    const toAdd = mapSubjectIds.filter((id) => !existing.has(id));
    if (toAdd.length === 0) {
      commit(state, "Those subjects are already linked to this class");
      return;
    }
    const useSuggested = periods <= 0;
    const rows: ClassSubjectLink[] = toAdd.map((subjectId) => {
      const sub = state.subjects.find((s) => s.id === subjectId);
      const suggested = sub
        ? suggestedPeriodsPerWeek(nepStage, sub.code, sub.category)
        : 5;
      return {
        id: newFoundationId("csub"),
        classId: mapClassId,
        subjectId,
        periodsPerWeek: useSuggested ? suggested : periods,
        isActive: true,
        isOptional: linkAsOptional || !!sub?.isElective,
      };
    });
    commit(
      { ...state, classSubjects: [...state.classSubjects, ...rows] },
      `Linked ${rows.length} subject${rows.length === 1 ? "" : "s"} to class`,
    );
    setMapSubjectIds([]);
    setLinkAsOptional(false);
  }

  function applySuggestedPeriodsToClass() {
    if (!mapClassId) return;
    let changed = 0;
    const next = state.classSubjects.map((l) => {
      if (l.classId !== mapClassId || !l.isActive) return l;
      const sub = state.subjects.find((s) => s.id === l.subjectId);
      if (!sub) return l;
      const p = suggestedPeriodsPerWeek(nepStage, sub.code, sub.category);
      if (l.periodsPerWeek === p) return l;
      changed += 1;
      return { ...l, periodsPerWeek: p };
    });
    if (changed === 0) {
      commit(state, "Periods already match NEP suggestions for this class");
      return;
    }
    commit(
      { ...state, classSubjects: next },
      `Updated periods/week on ${changed} link(s) · ${nepPack.label}`,
    );
  }

  function removeMap(id: string) {
    commit({
      ...state,
      classSubjects: state.classSubjects.filter((l) => l.id !== id),
    });
  }

  return (
    <MastersTabStack
      intro="Pick a class group to open only that stage’s subject configuration (NEP pack, map, linking). Other groups stay closed."
      tables={
        <>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-[var(--brand-deep)]">
                  Class group
                </h2>
                <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                  Click a group to configure subjects for those classes only.
                </p>
              </div>
              {classGroup ? (
                <button
                  type="button"
                  className="text-[11px] font-semibold text-[var(--brand-mid)] underline-offset-2 hover:underline"
                  onClick={() => {
                    setClassGroup(null);
                    setMapClassId("");
                    setMapSubjectIds([]);
                  }}
                >
                  Close · back to groups
                </button>
              ) : null}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {CLASS_GROUPS.map((g) => {
                const n = classesInGroup(state.classes, g.code).filter(
                  (c) => c.isActive,
                ).length;
                const on = classGroup === g.code;
                return (
                  <button
                    key={g.code}
                    type="button"
                    onClick={() => openClassGroup(g.code)}
                    className={`rounded-xl border px-3 py-3 text-left transition ${
                      on
                        ? "border-[var(--brand-deep)] bg-[var(--primary)] text-[var(--primary-foreground)] shadow-md ring-2 ring-[var(--brand-gold)] ring-offset-2"
                        : "border-[var(--border)] bg-[var(--surface-sunken)] text-[var(--brand-deep)] hover:border-[rgba(197,160,40,0.5)]"
                    }`}
                  >
                    <div className="text-sm font-bold">{g.label}</div>
                    <div
                      className={`mt-0.5 text-[11px] font-semibold ${
                        on ? "text-white/80" : "text-[var(--muted)]"
                      }`}
                    >
                      {g.shortLabel} · {n} classes
                    </div>
                    <div
                      className={`mt-1 text-[10px] leading-snug ${
                        on ? "text-white/70" : "text-[var(--muted)]"
                      }`}
                    >
                      {g.nepHint}
                    </div>
                    {on ? (
                      <span className="mt-2 inline-block rounded bg-[var(--card)]/20 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide">
                        Open
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          {!classGroup ? (
            <p className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
              Select a class group above to open its NEP suggestions, class–subject
              map, and linking form.
            </p>
          ) : (
            <>
          <div className="rounded-xl border border-[rgba(15,118,110,0.25)] bg-[rgba(15,118,110,0.06)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold text-[#0f766e]">
                  {activeGroupDef?.label} · NEP / NCF suggestions
                </h2>
                <p className="mt-0.5 text-[11px] leading-snug text-[var(--muted)]">
                  {activeGroupDef?.shortLabel} · {nepPack.label} (ages{" "}
                  {nepPack.ages}). Suggestions apply to this class group’s stage
                  only.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {(classGroup === "SECONDARY" || classGroup === "SENIOR") && (
                  <button
                    type="button"
                    className="rounded-lg border border-[#0f766e] bg-[var(--card)] px-3 py-2 text-xs font-bold text-[#0f766e]"
                    onClick={seedCartOfferings}
                  >
                    {ncfCartOfferingsReady(state)
                      ? "Refresh cart seed"
                      : "Seed cart for IX–XII"}
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-lg bg-[#0f766e] px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                  disabled={nepAnalysis.missingCount === 0}
                  onClick={applyNepPack}
                >
                  {nepAnalysis.missingCount === 0
                    ? "Stage complete"
                    : `Add ${nepAnalysis.missingCount} missing`}
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-lg bg-[var(--card)]/80 p-3">
                <p className="text-xs font-semibold text-[var(--brand-deep)]">
                  {nepPack.label} · ages {nepPack.ages}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
                  {nepPack.summary}
                </p>
                <ul className="mt-2 space-y-1">
                  {nepPack.tips.map((t) => (
                    <li
                      key={t}
                      className="text-[11px] leading-snug text-[var(--brand-deep)]"
                    >
                      <span className="mr-1 text-[#0f766e]">▸</span>
                      {t}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[11px] font-semibold text-[var(--brand-deep)]">
                  Classes in this group
                </p>
                <p className="text-[11px] text-[var(--muted)]">
                  {groupClasses.map((c) => c.name).join(" · ") || "—"}
                </p>
              </div>
              <div className="rounded-lg bg-[var(--card)]/80 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-[var(--brand-deep)]">
                    Checklist · periods / week
                  </p>
                  <p className="text-[10px] font-semibold text-[var(--muted)]">
                    {nepAnalysis.presentCount}/{nepAnalysis.gaps.length} · ~
                    {weeklyLoad.total} p/wk
                  </p>
                </div>
                <ul className="max-h-44 space-y-1 overflow-y-auto">
                  {nepAnalysis.gaps.map(({ item, status }) => {
                    const p = periodsForSuggestion(nepStage, item);
                    return (
                      <li
                        key={item.code}
                        className="flex items-start justify-between gap-2 text-[11px]"
                      >
                        <span className="min-w-0">
                          <span className="font-semibold text-[var(--brand-deep)]">
                            {item.code}
                          </span>{" "}
                          <span className="text-[var(--muted)]">
                            {item.nameEn}
                            {item.underCode ? ` · under ${item.underCode}` : ""}
                          </span>
                          {item.note ? (
                            <span className="mt-0.5 block text-[10px] text-[var(--muted)]">
                              {item.note}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-0.5">
                          <span className="rounded bg-[rgba(15,118,110,0.12)] px-1.5 py-0.5 text-[9px] font-bold text-[#0f766e]">
                            {p}/wk
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                              status === "present"
                                ? "bg-[rgba(22,163,74,0.15)] text-[var(--success)]"
                                : "bg-[rgba(220,38,38,0.1)] text-[#b91c1c]"
                            }`}
                          >
                            {status === "present" ? "Have" : "Add"}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-[10px] leading-snug text-[var(--muted)]">
                  Indicative CBSE-style load (~{weeklyLoad.total} periods/week for
                  listed cores). Typical school week is 40–48 periods — trim
                  electives to fit your bell schedule.
                </p>
              </div>
            </div>
          </div>

          {classGroup === "SENIOR" ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-[var(--brand-deep)]">
                  XI–XII streams / pathways
                </h2>
                <p className="mt-0.5 max-w-2xl text-[11px] leading-snug text-[var(--muted)]">
                  Offer the usual packages parents expect —{" "}
                  <strong className="text-[var(--brand-deep)]">
                    Science (PCM / PCB), Commerce, Humanities
                  </strong>
                  . Activate only the streams your school runs. Multidisciplinary
                  is optional (NEP flexible choice) and off by default.
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-bold text-[var(--primary-foreground)]"
                onClick={applyStreams}
              >
                Sync streams + XI–XII subjects
              </button>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {streams.map((st) => (
                <div
                  key={st.id}
                  className={`rounded-xl border px-3 py-3 ${
                    st.isActive
                      ? "border-[var(--border)] bg-[var(--card)]"
                      : "border-[var(--border)] bg-[var(--surface-sunken)] opacity-70"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-[var(--brand-deep)]">
                      {st.nameEn}
                    </span>
                    <span className="rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--muted)]">
                      {st.traditionalLabel}
                    </span>
                    {st.code === "MULTI" ? (
                      <span className="rounded bg-[rgba(196,149,58,0.15)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--brand-gold)]">
                        Optional
                      </span>
                    ) : null}
                    {!st.isActive ? (
                      <span className="text-[10px] text-[var(--muted)]">
                        inactive
                      </span>
                    ) : (
                      <span className="rounded bg-[rgba(15,118,110,0.12)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#0f766e]">
                        Offered
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] leading-snug text-[var(--muted)]">
                    {st.nepNote}
                  </p>
                  <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Core · suggested /wk
                  </p>
                  <p className="text-[11px] font-medium text-[var(--brand-deep)]">
                    {st.coreCodes
                      .map(
                        (c) =>
                          `${c} (${suggestedPeriodsPerWeek("secondary_11_12", c)}/wk)`,
                      )
                      .join(" · ") || "—"}
                  </p>
                  <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Electives / open
                  </p>
                  <p className="text-[11px] text-[var(--muted)]">
                    {st.electiveCodes
                      .map(
                        (c) =>
                          `${c} (${suggestedPeriodsPerWeek("secondary_11_12", c)}/wk)`,
                      )
                      .join(" · ") || "—"}
                  </p>
                  <button
                    type="button"
                    className="mt-2 text-[11px] font-semibold text-[var(--brand-mid)] underline-offset-2 hover:underline"
                    onClick={() => {
                      commit(
                        {
                          ...state,
                          seniorStreams: state.seniorStreams.map((x) =>
                            x.id === st.id
                              ? { ...x, isActive: !x.isActive }
                              : x,
                          ),
                        },
                        st.isActive
                          ? `${st.nameEn} inactivated`
                          : `${st.nameEn} activated`,
                      );
                    }}
                  >
                    {st.isActive ? "Inactivate" : "Activate"}
                  </button>
                </div>
              ))}
              {streams.length === 0 ? (
                <p className="text-sm text-[var(--muted)] md:col-span-2">
                  No streams yet — click Sync to load Science / Commerce /
                  Humanities packages (Multidisciplinary optional).
                </p>
              ) : null}
            </div>
          </div>
          ) : null}

          <MastersTablesRow>
          <MastersTableCard
            title={`CBSE groups · ${activeGroupDef?.shortLabel ?? ""}`}
          >
            <p className="border-b border-[var(--border)] px-4 py-2 text-[11px] leading-snug text-[var(--muted)]">
              Same CBSE / NCF groups for every class. Nur–VIII use this as the
              common curriculum (no student choice). IX–XII optional picks use
              the same groups. Change a subject’s group anytime.
            </p>
            {groupRelatedSubjects.length === 0 ? (
              <p className="px-4 py-3 text-sm text-[var(--muted)]">
                No subjects for this stage yet — apply the NEP pack below or
                add a subject.
              </p>
            ) : null}
            {subjectsByCbse.map(({ group, subjects }) => (
              <div key={group.id}>
                <div className="sticky top-0 z-[1] border-b border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-2">
                  <div className="text-xs font-bold text-[var(--brand-deep)]">
                    {group.label}
                  </div>
                  <p className="text-[10px] text-[var(--muted)]">{group.hint}</p>
                </div>
                <ul className="divide-y divide-[var(--border)]">
                  {subjects.map((s) => {
                    const isChild = !!s.parentId;
                    const isGroup = isSubjectGroup(state.subjects, s.id);
                    const inNep = nepCodeSet.has(s.code.toUpperCase());
                    const linked = groupLinks.some((l) => l.subjectId === s.id);
                    const gId = cbseGroupForSubject(s);
                    return (
                      <li
                        key={s.id}
                        className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 ${
                          isChild ? "bg-[var(--surface-sunken)]" : ""
                        }`}
                      >
                        <div className={isChild ? "pl-5" : ""}>
                          <span className="text-sm font-semibold text-[var(--brand-deep)]">
                            {isChild ? "↳ " : ""}
                            {s.code}
                          </span>{" "}
                          <span className="text-sm">{s.nameEn}</span>
                          {isGroup ? (
                            <span className="ml-2 rounded bg-[rgba(15,118,110,0.12)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#0f766e]">
                              Head
                            </span>
                          ) : null}
                          {isChild ? (
                            <span className="ml-2 rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--muted)]">
                              Component
                            </span>
                          ) : null}
                          {inNep ? (
                            <span className="ml-2 rounded bg-[rgba(196,149,58,0.15)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--brand-gold)]">
                              NEP
                            </span>
                          ) : null}
                          {linked ? (
                            <span className="ml-2 rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--brand-mid)]">
                              Linked
                            </span>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            className="field !w-auto !py-1 text-[11px]"
                            value={gId}
                            title="NCF tag"
                            onChange={(e) =>
                              setSubjectCbseGroup(
                                s.id,
                                e.target.value as CbseGroupId,
                              )
                            }
                          >
                            {CBSE_SUBJECT_GROUPS.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.id} · {g.shortLabel}
                              </option>
                            ))}
                          </select>
                          {gId === "A" ? (
                            <select
                              className="field !w-auto !py-1 text-[11px]"
                              value={languageSubtypeOf(s) || ""}
                              title="Language subtype"
                              onChange={(e) =>
                                setSubjectLanguageSubtype(
                                  s.id,
                                  e.target.value as LanguageSubtype,
                                )
                              }
                            >
                              <option value="native">Native</option>
                              <option value="regional">Regional</option>
                              <option value="foreign">Foreign</option>
                            </select>
                          ) : null}
                          <button
                            type="button"
                            className="text-[11px] font-semibold"
                            onClick={() => toggleSubject(s.id)}
                          >
                            {s.isActive ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </MastersTableCard>
          <MastersTableCard
            title={`Class–subject map · ${activeGroupDef?.shortLabel ?? ""}`}
          >
            {groupLinks.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                No links for this class group yet
              </div>
            ) : null}
            {linksByCbse.map(({ group, rows }) => (
              <div key={group.id}>
                <div className="sticky top-0 z-[1] border-b border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-2 text-xs font-bold text-[var(--brand-deep)]">
                  {group.shortLabel}
                </div>
                <ul className="divide-y divide-[var(--border)]">
                  {rows.map(({ link: l, subject: sub }) => {
                    const cls = state.classes.find((c) => c.id === l.classId);
                    const parent = sub.parentId
                      ? state.subjects.find((s) => s.id === sub.parentId)
                      : null;
                    return (
                      <li
                        key={l.id}
                        className="flex items-center justify-between gap-2 px-4 py-2 text-sm"
                      >
                        <span>
                          {cls?.name ?? "?"} ·{" "}
                          {parent ? (
                            <span className="text-[var(--muted)]">
                              {parent.code}/
                            </span>
                          ) : null}
                          {sub.code} ({l.periodsPerWeek}/wk)
                          {l.isOptional || sub.isElective ? (
                            <span className="ml-1 rounded bg-[rgba(196,149,58,0.15)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--brand-gold)]">
                              Optional
                            </span>
                          ) : null}
                          <span className="ml-1 text-[10px] text-[var(--muted)]">
                            · NEP{" "}
                            {suggestedPeriodsPerWeek(
                              nepStage,
                              sub.code,
                              sub.category,
                            )}
                            /wk
                          </span>
                        </span>
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-[var(--danger)]"
                          onClick={() => removeMap(l.id)}
                        >
                          Remove
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </MastersTableCard>
        </MastersTablesRow>
        </>
          )}
        </>
      }
      work={
        !classGroup ? null : (
        <div className="grid gap-4 lg:grid-cols-2">
          <MastersWorkCard
            title="Add subject / component"
            hint="Leave group empty for a top-level subject. Choose a group to add Oral, Written, etc."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Under group (optional)
                </span>
                <select
                  className="field !py-1.5"
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                >
                  <option value="">— Top-level / new group —</option>
                  {groupParents.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.nameEn}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  NCF tag (A / B / C / D)
                </span>
                <select
                  className="field !py-1.5"
                  value={cbseGroupId}
                  onChange={(e) =>
                    setCbseGroupId(e.target.value as CbseGroupId | "")
                  }
                >
                  <option value="">— Auto from code —</option>
                  {CBSE_SUBJECT_GROUPS.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>
              {(cbseGroupId === "A" ||
                (!cbseGroupId &&
                  code &&
                  ["ENG", "HIN", "SKT", "URDU", "L1", "L2", "L3"].includes(
                    code.trim().toUpperCase(),
                  ))) ? (
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Language subtype
                  </span>
                  <select
                    className="field !py-1.5"
                    value={languageSubtype}
                    onChange={(e) =>
                      setLanguageSubtype(e.target.value as LanguageSubtype)
                    }
                  >
                    <option value="">— Auto from code —</option>
                    <option value="native">Native</option>
                    <option value="regional">Regional</option>
                    <option value="foreign">Foreign</option>
                  </select>
                </label>
              ) : null}
              <input
                className="field !py-1.5"
                placeholder={parentId ? "Code e.g. ENG-ORAL" : "Code e.g. ENG"}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <input
                className="field !py-1.5"
                placeholder={
                  parentId ? "Name e.g. English — Oral" : "Name e.g. English"
                }
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
              />
              {!parentId ? (
                <>
                  <select
                    className="field !py-1.5"
                    value={category}
                    onChange={(e) =>
                      setCategory(e.target.value as SubjectCategory)
                    }
                  >
                    <option value="scholastic">Scholastic</option>
                    <option value="co_scholastic">Co-scholastic</option>
                  </select>
                  <input
                    className="field !py-1.5"
                    placeholder="Co-scholastic area"
                    value={area}
                    disabled={category !== "co_scholastic"}
                    onChange={(e) => setArea(e.target.value)}
                  />
                </>
              ) : null}
            </div>
            <button
              type="button"
              className="mt-3 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
              onClick={addSubject}
            >
              {parentId ? "Add component" : "Add subject"}
            </button>
          </MastersWorkCard>
          <MastersWorkCard
            title={`Link · ${activeGroupDef?.label ?? "class group"}`}
          >
            <div className="space-y-3">
              <select
                className="field !py-1.5"
                value={mapClassId}
                onChange={(e) => setMapClassId(e.target.value)}
              >
                <option value="">Class in {activeGroupDef?.shortLabel}…</option>
                {groupClasses
                  .filter((c) => c.isActive)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>

              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-[var(--muted)]">
                    Subjects (tap a group to select all components)
                  </span>
                  <span className="flex gap-2 text-[11px]">
                    <button
                      type="button"
                      className="font-semibold text-[var(--brand-mid)] underline-offset-2 hover:underline"
                      onClick={selectAllMapSubjects}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="font-semibold text-[var(--brand-mid)] underline-offset-2 hover:underline"
                      onClick={clearMapSubjects}
                    >
                      Clear
                    </button>
                  </span>
                </div>
                <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-[var(--border)] p-2">
                  {groupRelatedSubjects
                    .filter((s) => s.isActive)
                    .map((s) => {
                      const on = mapSubjectIds.includes(s.id);
                      const kids = subjectChildren(state.subjects, s.id);
                      const isGroup = kids.length > 0;
                      const already =
                        !!mapClassId &&
                        state.classSubjects.some(
                          (l) =>
                            l.classId === mapClassId &&
                            l.subjectId === s.id &&
                            l.isActive,
                        );
                      return (
                        <button
                          key={s.id}
                          type="button"
                          title={s.nameEn}
                          onClick={() => toggleMapSubject(s.id)}
                          className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                            s.parentId ? "ml-2" : ""
                          } ${
                            on
                              ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                              : already
                                ? "bg-[var(--surface-sunken)] text-[var(--muted)] ring-1 ring-[var(--border)]"
                                : isGroup
                                  ? "bg-[rgba(15,118,110,0.12)] text-[#0f766e]"
                                  : "bg-[var(--surface)] text-[var(--brand-deep)]"
                          }`}
                        >
                          {isGroup ? "▣ " : s.parentId ? "· " : ""}
                          {s.code}
                          {already && !on ? " ✓" : ""}
                        </button>
                      );
                    })}
                </div>
                <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                  {mapSubjectIds.length} selected
                  {mapClassId
                    ? ` · will link to ${
                        state.classes.find((c) => c.id === mapClassId)?.name ??
                        "class"
                      }`
                    : ""}
                </p>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Override periods / week
                  </span>
                  <input
                    className="field !py-1.5 w-28"
                    type="number"
                    min={0}
                    max={12}
                    value={periods}
                    onChange={(e) => setPeriods(Number(e.target.value) || 0)}
                    title="0 = use NEP suggested periods per subject"
                  />
                  <span className="mt-0.5 block text-[10px] text-[var(--muted)]">
                    0 = NEP suggest each
                  </span>
                </label>
                <label className="flex items-center gap-2 pb-2 text-xs font-semibold text-[var(--brand-deep)]">
                  <input
                    type="checkbox"
                    checked={linkAsOptional}
                    onChange={(e) => setLinkAsOptional(e.target.checked)}
                  />
                  Mark as optional (student choice)
                </label>
                <button
                  type="button"
                  className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-40"
                  disabled={!mapClassId || mapSubjectIds.length === 0}
                  onClick={addMap}
                >
                  Link {mapSubjectIds.length || ""} subject
                  {mapSubjectIds.length === 1 ? "" : "s"}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[rgba(15,118,110,0.35)] px-3 py-2 text-xs font-semibold text-[#0f766e] disabled:opacity-40"
                  disabled={!mapClassId}
                  onClick={applySuggestedPeriodsToClass}
                >
                  Apply NEP periods to class
                </button>
              </div>
            </div>
          </MastersWorkCard>
        </div>
        )
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
                        <span className="rounded-full bg-[rgba(15,118,110,0.12)] px-2 py-0.5 text-[10px] font-semibold text-[#0f766e]">
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
                {preview.warning ? <div className="mt-1 text-[#b45309]">{preview.warning}</div> : null}
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

export function HolidaysPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
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

  return (
    <MastersTabStack
      intro={`Holiday policy for session ${sessionAy}: lists and matrix follow the header session selector. Choose who it applies to (students / teachers / non-teaching / both), then school or class-group scope · one-off or weekly · publish to apply on attendance.`}
      tables={
        <>
          {upSuggestions.length > 0 ? (
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
          <MastersTablesRow>
            <MastersTableCard title={`Published (${published.length})`}>
              <ul className="divide-y divide-[var(--border)]">
                {published.map((h) => (
                  <HolidayRuleRow
                    key={h.id}
                    h={h}
                    trailing={
                      <div className="flex items-center gap-2">
                        {h.mode !== "weekly" ? <HolidayNotifyButton holiday={h} /> : null}
                        <button
                          type="button"
                          className="text-[11px] font-semibold"
                          onClick={() => unpublish(h.id)}
                        >
                          Unpublish
                        </button>
                      </div>
                    }
                  />
                ))}
                {published.length === 0 ? (
                  <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                    No published holidays
                  </li>
                ) : null}
              </ul>
            </MastersTableCard>
            <MastersTableCard title={`Drafts (${drafts.length})`}>
              <ul className="divide-y divide-[var(--border)]">
                {drafts.map((h) => (
                  <HolidayRuleRow
                    key={h.id}
                    h={h}
                    trailing={
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="rounded-lg bg-[var(--primary)] px-2.5 py-1 text-[11px] font-semibold text-[var(--primary-foreground)]"
                          onClick={() => publish(h.id)}
                        >
                          Publish
                        </button>
                        <RemoveControl
                          check={{
                            canRemove: true,
                            blockers: [],
                            confirmMessage: "Remove this holiday rule?",
                            suggestion: "",
                          }}
                          onRemove={() => remove(h.id)}
                        />
                      </div>
                    }
                  />
                ))}
                {drafts.length === 0 ? (
                  <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                    No drafts
                  </li>
                ) : null}
              </ul>
            </MastersTableCard>
          </MastersTablesRow>
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
        </>
      }
      work={
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

  return (
    <MastersTabStack
      tables={
        <MastersTablesRow cols={2}>
          <MastersTableCard title="Departments">
            <ul className="divide-y divide-[var(--border)]">
              {activeDepts.map((d) => (
                <li key={d.id} className="px-4 py-2.5 text-sm">
                  <span className="font-semibold text-[var(--brand-deep)]">
                    {d.code}
                  </span>{" "}
                  {d.name}
                </li>
              ))}
              {activeDepts.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                  No active departments
                </li>
              ) : null}
            </ul>
          </MastersTableCard>
          <MastersTableCard title="Designations">
            <ul className="divide-y divide-[var(--border)]">
              {activeDes.map((d) => {
                const dep = state.departments.find(
                  (x) => x.id === d.departmentId,
                );
                return (
                  <li key={d.id} className="px-4 py-2 text-sm">
                    <span className="font-semibold">{d.code}</span> {d.name}
                    {dep ? (
                      <span className="ml-2 text-[11px] text-[var(--muted)]">
                        {dep.name}
                      </span>
                    ) : null}
                  </li>
                );
              })}
              {activeDes.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                  No active designations
                </li>
              ) : null}
            </ul>
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

/** Leave types, approval settings, and staff attendance adjustment rules. */
export function LeaveMastersPanel() {
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
      <LeaveApprovalSettingsPanel />
      <StaffAttendanceSettingsPanel />
      <StaffLeaveTypesPanel />
      <StaffAttendanceRulesPanel />
    </div>
  );
}
