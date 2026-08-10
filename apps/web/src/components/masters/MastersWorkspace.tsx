"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import {
  FEE_FREQUENCIES,
  currentAcademicYearCode,
  checkCampusRemoval,
  checkClassRemoval,
  checkFeeHeadCategoryRemoval,
  checkFeeHeadRemoval,
  checkSectionRemoval,
  feeHeadCategoryLabel,
  loadMasters,
  listConcessionPolicies,
  newId,
  removeCampus,
  removeClass,
  removeFeeHead,
  removeFeeHeadCategory,
  removeSection,
  resolveFeeHeadCategories,
  saveMasters,
  type Campus,
  type FeeHead,
  type FeeHeadCategory,
  type FeeHeadCategoryDef,
  type FeeFrequency,
  type MastersState,
  type SchoolClass,
  type Section,
  CLASS_GROUPS,
  classesInGroup,
  classGroupCodeForName,
} from "@/lib/masters";
import { EditControl } from "@/components/masters/EditControl";
import { RemoveControl } from "@/components/masters/RemoveControl";
import {
  FeeGroupsPanel,
  InstallmentsPanel,
  LateFeePanel,
  MidYearFeePolicyPanel,
} from "@/components/masters/FeeSetupPanels";
import { FeeStructurePanel } from "@/components/masters/FeeStructureBoard";
import { SpecialFeesPanel } from "@/components/masters/SpecialFeesPanel";
import { ConcessionsPanel } from "@/components/masters/ConcessionsPanel";
import {
  AcademicPanel,
  HolidaysPanel,
  LeaveMastersPanel,
  NumberSeriesPanel,
  SchoolProfilePanel,
  StaffMastersPanel,
  SubjectsPanel,
} from "@/components/masters/FoundationPanels";
import { SalarySetupPanel } from "@/components/masters/SalarySetupPanel";
import { RolesPermissionsPanel } from "@/components/masters/RolesPermissionsPanel";
import { WaTemplatesPanel } from "@/components/masters/WaTemplatesPanel";
import { AutomationPanel } from "@/components/masters/AutomationPanel";
import { WaChatbotPanel } from "@/components/masters/WaChatbotPanel";
import { SchoolBrandAssetsPanel } from "@/components/masters/SchoolBrandAssetsPanel";
import {
  MastersEmptyRow,
  MastersTabStack,
  MastersTableCard,
  MastersTablesRow,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";
import { ModuleTabGroups, type ModuleTabGroup } from "@/components/ui/ModuleTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { useDemoSession, useSessionReadOnly } from "@/components/shell/SessionContext";
import {
  canAccessMastersTab,
  canConfigureRbac,
  loadRbac,
} from "@/lib/rbac";

type Tab =
  | "overview"
  | "school"
  | "academic"
  | "campuses"
  | "classes"
  | "subjects"
  | "series"
  | "holidays"
  | "staff"
  | "leave"
  | "salary"
  | "roles"
  | "fee-heads"
  | "fee-groups"
  | "fee-structure"
  | "special-fees"
  | "concessions"
  | "installments"
  | "late-fee"
  | "mid-year"
  | "wa-templates"
  | "automation"
  | "wa-chatbot"
  | "brand";

const TAB_GROUPS: ModuleTabGroup[] = [
  {
    id: "home",
    label: "Overview",
    tone: "navy",
    tabs: [{ id: "overview", label: "Dashboard", tone: "navy" }],
  },
  {
    id: "institution",
    label: "Institution",
    tone: "teal",
    tabs: [
      { id: "school", label: "School", tone: "teal" },
      { id: "brand", label: "Brand & stamps", tone: "teal" },
      { id: "campuses", label: "Campuses", tone: "teal" },
      { id: "staff", label: "Staff setup", tone: "slate" },
      { id: "roles", label: "Roles & permissions", tone: "navy" },
      { id: "leave", label: "Leave setup", tone: "coral" },
      { id: "salary", label: "Salary setup", tone: "green" },
      { id: "series", label: "Numbering", tone: "slate" },
    ],
  },
  {
    id: "academic",
    label: "Academic",
    tone: "sky",
    tabs: [
      { id: "academic", label: "Session", tone: "sky" },
      { id: "classes", label: "Classes & sections", tone: "sky" },
      { id: "subjects", label: "Subjects", tone: "violet" },
      { id: "holidays", label: "Holidays", tone: "amber" },
    ],
  },
  {
    id: "fees",
    label: "Fee setup",
    tone: "green",
    tabs: [
      { id: "fee-heads", label: "Fee heads", tone: "green" },
      { id: "fee-groups", label: "Fee groups", tone: "green" },
      { id: "fee-structure", label: "Fee structure", tone: "green" },
      { id: "special-fees", label: "Special fees", tone: "teal" },
      { id: "concessions", label: "Concessions", tone: "teal" },
      { id: "installments", label: "Due dates", tone: "amber" },
      { id: "late-fee", label: "Late fee", tone: "rose" },
      { id: "mid-year", label: "Mid-year", tone: "rose" },
    ],
  },
  {
    id: "comms-automation",
    label: "Comms & automation",
    tone: "violet",
    tabs: [
      { id: "wa-templates", label: "WhatsApp templates", tone: "violet" },
      { id: "automation", label: "Automation", tone: "amber" },
      { id: "wa-chatbot", label: "WhatsApp chatbot", tone: "teal" },
    ],
  },
];

export function MastersWorkspace() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const [tab, setTab] = useState<Tab>("overview");
  const [rbac, setRbac] = useState(() =>
    typeof window === "undefined" ? null : loadRbac(),
  );
  const [state, setState] = useState<MastersState | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return loadMasters();
    } catch {
      return null;
    }
  });
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("tab");
    const allowed: Tab[] = [
      "overview",
      "school",
      "academic",
      "campuses",
      "classes",
      "subjects",
      "series",
      "holidays",
      "staff",
      "leave",
      "salary",
      "roles",
      "fee-heads",
      "fee-groups",
      "fee-structure",
      "special-fees",
      "concessions",
      "installments",
      "late-fee",
      "mid-year",
      "wa-templates",
      "automation",
      "wa-chatbot",
      "brand",
    ];
    if (raw && (allowed as string[]).includes(raw)) setTab(raw as Tab);
  }, []);

  useEffect(() => {
    setState(loadMasters());
    void (async () => {
      const { ensureMastersHydrated } = await import("@/lib/mastersPersistence");
      const { ensureStaffHydrated } = await import("@/lib/staffPersistence");
      const { ensureRbacHydrated } = await import("@/lib/rbacPersistence");
      await Promise.all([
        ensureMastersHydrated(),
        ensureStaffHydrated(),
        ensureRbacHydrated(),
      ]);
      setState(loadMasters());
      setRbac(loadRbac());
    })();
  }, []);

  const visibleTabGroups = useMemo(() => {
    const r = rbac ?? loadRbac();
    const masters = state;
    return TAB_GROUPS.map((g) => ({
      ...g,
      tabs: g.tabs.filter((t) => {
        if (t.id === "overview") return true;
        if (!masters) return false;
        if (t.id === "roles") {
          return canConfigureRbac(session, masters, r);
        }
        return canAccessMastersTab(session, masters, t.id, r);
      }),
    })).filter((g) => g.tabs.length > 0);
  }, [session, state, rbac]);

  useEffect(() => {
    if (!state) return;
    const r = rbac ?? loadRbac();
    if (tab !== "overview" && !canAccessMastersTab(session, state, tab, r)) {
      if (tab === "roles" && canConfigureRbac(session, state, r)) return;
      setTab("overview");
    }
  }, [tab, session, state, rbac]);

  function commit(next: MastersState, msg?: string) {
    if (readOnly) {
      setNotice("Selected session is closed — masters are read-only");
      window.setTimeout(() => setNotice(null), 2800);
      return;
    }
    setState(next);
    // The success notice must wait for the database, not for React. Showing
    // it synchronously is what made 16 refused writes look like 16 saves on
    // 2026-08-09 — the screen said "session changed" every time while the
    // server was rejecting the push. On failure we stay silent here: the
    // push path raises a sticky error toast naming the actual reason.
    if (msg) setNotice("Saving…");
    void saveMasters(next).then((outcome) => {
      if (!outcome.ok) {
        setNotice(null);
        return;
      }
      if (msg) {
        setNotice(msg);
        window.setTimeout(() => setNotice(null), 2200);
      }
    });
  }

  if (!state) {
    return (
      <p className="text-sm text-[var(--muted)]">Loading masters…</p>
    );
  }

  return (
    <ErpWorkspaceShell
      title="Masters"
      subtitle={`Institution, academic, subjects, holidays, staff setup, and fee setup · selected session ${session.academicYearCode}`}
      icon={<SlidersHorizontal className="size-6" aria-hidden />}
      notice={notice}
    >
      <ModuleTabGroups
        aria-label="Masters"
        value={tab}
        onChange={(id) => setTab(id as Tab)}
        groups={visibleTabGroups}
      />

      <div className="mt-5">
        {tab === "overview" ? (
          <Overview state={state} onGo={setTab} commit={commit} />
        ) : null}
        {tab === "school" ? (
          <SchoolProfilePanel state={state} commit={commit} />
        ) : null}
        {tab === "brand" ? (
          <SchoolBrandAssetsPanel state={state} commit={commit} />
        ) : null}
        {tab === "academic" ? (
          <AcademicPanel state={state} commit={commit} />
        ) : null}
        {tab === "campuses" ? (
          <CampusesPanel state={state} commit={commit} />
        ) : null}
        {tab === "classes" ? (
          <ClassesPanel state={state} commit={commit} />
        ) : null}
        {tab === "subjects" ? (
          <SubjectsPanel state={state} commit={commit} />
        ) : null}
        {tab === "series" ? (
          <NumberSeriesPanel state={state} commit={commit} />
        ) : null}
        {tab === "holidays" ? (
          <HolidaysPanel state={state} commit={commit} />
        ) : null}
        {tab === "staff" ? (
          <StaffMastersPanel state={state} commit={commit} />
        ) : null}
        {tab === "leave" ? <LeaveMastersPanel /> : null}
        {tab === "roles" ? <RolesPermissionsPanel /> : null}
        {tab === "salary" ? <SalarySetupPanel /> : null}
        {tab === "fee-heads" ? (
          <FeeHeadsPanel state={state} commit={commit} />
        ) : null}
        {tab === "fee-groups" ? (
          <FeeGroupsPanel state={state} commit={commit} />
        ) : null}
        {tab === "fee-structure" ? (
          <FeeStructurePanel state={state} commit={commit} />
        ) : null}
        {tab === "special-fees" ? (
          <SpecialFeesPanel state={state} commit={commit} />
        ) : null}
        {tab === "concessions" ? (
          <ConcessionsPanel state={state} commit={commit} />
        ) : null}
        {tab === "installments" ? (
          <InstallmentsPanel state={state} commit={commit} />
        ) : null}
        {tab === "late-fee" ? (
          <LateFeePanel state={state} commit={commit} />
        ) : null}
        {tab === "mid-year" ? (
          <MidYearFeePolicyPanel state={state} commit={commit} />
        ) : null}
        {tab === "wa-templates" ? (
          canAccessMastersTab(session, state, "wa-templates", rbac ?? undefined) ? (
            <WaTemplatesPanel />
          ) : (
            <MastersAccessDenied label="WhatsApp templates" />
          )
        ) : null}
        {tab === "automation" ? (
          canAccessMastersTab(session, state, "automation", rbac ?? undefined) ? (
            <AutomationPanel />
          ) : (
            <MastersAccessDenied label="Automation" />
          )
        ) : null}
        {tab === "wa-chatbot" ? (
          canAccessMastersTab(session, state, "wa-chatbot", rbac ?? undefined) ? (
            <WaChatbotPanel />
          ) : (
            <MastersAccessDenied label="WhatsApp chatbot" />
          )
        ) : null}
      </div>
    </ErpWorkspaceShell>
  );
}

function MastersAccessDenied({ label }: { label: string }) {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      You do not have permission to open <strong>{label}</strong>. Ask your
      principal to grant access under Masters → Roles & permissions →{" "}
      <em>WhatsApp & automation</em>.
    </p>
  );
}

function Overview({
  state,
  onGo,
  commit,
}: {
  state: MastersState;
  onGo: (t: Tab) => void;
  commit: (s: MastersState, msg?: string) => void;
}) {
  const session = useDemoSession();
  const ay = session.academicYearCode;
  const activeClasses = state.classes.filter((c) => c.isActive).length;
  const activeSections = state.sections.filter((s) => s.isActive).length;
  const activeHeads = state.feeHeads.filter((f) => f.isActive).length;
  const campuses = state.campuses.filter((c) => c.isActive).length;
  const groups = state.feeGroups.filter(
    (g) => g.isActive && g.academicYearCode === ay,
  ).length;
  const installments = state.installments.filter(
    (i) => i.isActive && i.academicYearCode === ay,
  ).length;

  const specialCount =
    state.specialFees?.filter(
      (f) => f.isActive && f.academicYearCode === ay,
    ).length ?? 0;
  const concessionCount =
    listConcessionPolicies(state, { preferAy: ay }).filter((c) => c.isActive)
      .length ?? 0;

  const subjectCount = state.subjects?.filter((s) => s.isActive).length ?? 0;
  const deptCount =
    state.departments?.filter((d) => d.isActive).length ?? 0;
  const holidayPub =
    state.holidays?.filter(
      (h) => h.isPublished && h.academicYearCode === ay,
    ).length ?? 0;

  const rbacState = loadRbac();
  const cards = [
    { label: "Campuses", value: campuses, tab: "campuses" as Tab },
    { label: "Classes", value: activeClasses, tab: "classes" as Tab },
    { label: "Sections", value: activeSections, tab: "classes" as Tab },
    { label: "Subjects", value: subjectCount, tab: "subjects" as Tab },
    { label: "Departments", value: deptCount, tab: "staff" as Tab },
    { label: "Holidays (pub)", value: holidayPub, tab: "holidays" as Tab },
    { label: "Fee heads", value: activeHeads, tab: "fee-heads" as Tab },
    { label: "Fee groups", value: groups, tab: "fee-groups" as Tab },
    { label: "Special fees", value: specialCount, tab: "special-fees" as Tab },
    { label: "Concessions", value: concessionCount, tab: "concessions" as Tab },
    { label: "Due dates", value: installments, tab: "installments" as Tab },
    { label: "Mid-year rules", value: "Edit", tab: "mid-year" as Tab },
    { label: "WA templates", value: "EN+HI", tab: "wa-templates" as Tab },
    { label: "Automation", value: "Rules", tab: "automation" as Tab },
    { label: "WA chatbot", value: "Flows", tab: "wa-chatbot" as Tab },
  ].filter((c) => canAccessMastersTab(session, state, c.tab, rbacState));

  return (
    <div className="space-y-6">
      <ModuleDashboardHost
        moduleId="masters"
        onNavigateTab={(t) => onGo(t as Tab)}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => onGo(c.tab)}
            className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white px-4 py-4 text-left transition hover:border-[rgba(197,160,40,0.45)]"
          >
            <div className="text-2xl font-semibold text-[var(--brand-deep)]">
              {c.value}
            </div>
            <div className="mt-1 text-sm text-[var(--muted)]">{c.label}</div>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onGo("school")}
          className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm font-medium text-[var(--brand-deep)]"
        >
          School profile →
        </button>
        <button
          type="button"
          onClick={() => onGo("fee-structure")}
          className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm font-medium text-[var(--brand-deep)]"
        >
          Edit fee structure →
        </button>
        <Link
          href="/students"
          className="rounded-lg border border-[rgba(197,160,40,0.45)] bg-[rgba(197,160,40,0.12)] px-3 py-2 text-sm font-medium text-[var(--brand-deep)]"
        >
          Import students (CSV) →
        </Link>
        <button
          type="button"
          onClick={() => onGo("holidays")}
          className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm font-medium text-[var(--brand-deep)]"
        >
          Holidays →
        </button>
        <Link
          href="/staff"
          className="rounded-lg border border-[rgba(197,160,40,0.45)] bg-[rgba(197,160,40,0.12)] px-3 py-2 text-sm font-medium text-[var(--brand-deep)]"
        >
          Staff module →
        </Link>
        <button
          type="button"
          onClick={() => onGo("staff")}
          className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm font-medium text-[var(--brand-deep)]"
        >
          Staff setup →
        </button>
        <button
          type="button"
          onClick={() => onGo("roles")}
          className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm font-medium text-[var(--brand-deep)]"
        >
          Roles &amp; permissions →
        </button>
        <button
          type="button"
          onClick={() => onGo("leave")}
          className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm font-medium text-[var(--brand-deep)]"
        >
          Leave setup →
        </button>
      </div>
      <p className="text-sm text-[var(--muted)]">
        Fee setup for {ay}: heads → groups →{" "}
        <strong>fee structure</strong> (class amounts + publish) → concessions
        → due dates → late fee. Published structure bills in Fee Take.
      </p>
    </div>
  );
}

function CampusesPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: (s: MastersState, msg?: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [makePrimary, setMakePrimary] = useState(false);

  function resetForm() {
    setEditingId(null);
    setCode("");
    setName("");
    setAddress("");
    setMakePrimary(false);
  }

  function startEdit(c: Campus) {
    setEditingId(c.id);
    setCode(c.code);
    setName(c.name);
    setAddress(c.address ?? "");
    setMakePrimary(c.isPrimary);
  }

  function saveCampus(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    const nextCode = code.trim().toUpperCase();
    if (
      state.campuses.some(
        (c) =>
          c.code.toUpperCase() === nextCode &&
          c.id !== editingId,
      )
    ) {
      commit(state, "Campus code already exists");
      return;
    }

    if (editingId) {
      const wantPrimary = makePrimary;
      commit(
        {
          ...state,
          campuses: state.campuses.map((c) => {
            if (c.id === editingId) {
              return {
                ...c,
                code: nextCode,
                name: name.trim(),
                address: address.trim() || undefined,
                isPrimary: wantPrimary || c.isPrimary,
              };
            }
            if (wantPrimary) return { ...c, isPrimary: false };
            return c;
          }),
        },
        "Campus updated",
      );
      resetForm();
      return;
    }

    const campus: Campus = {
      id: newId("cam"),
      code: nextCode,
      name: name.trim(),
      address: address.trim() || undefined,
      isPrimary: state.campuses.length === 0 || makePrimary,
      isActive: true,
    };
    commit(
      {
        ...state,
        campuses: [
          ...(makePrimary
            ? state.campuses.map((c) => ({ ...c, isPrimary: false }))
            : state.campuses),
          campus,
        ],
      },
      "Campus added",
    );
    resetForm();
  }

  return (
    <MastersTabStack
      tables={
        <MastersTablesRow cols={1}>
          <MastersTableCard title="Campuses">
            <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
              {state.campuses.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div>
                    <div className="font-medium text-[var(--brand-deep)]">
                      {c.name}{" "}
                      <span className="text-xs font-normal text-[var(--muted)]">
                        {c.code}
                      </span>
                      {c.isPrimary ? (
                        <span className="ml-2 rounded bg-[rgba(197,160,40,0.2)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--brand-deep)]">
                          Primary
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      {c.address || "—"} · {c.isActive ? "Active" : "Inactive"}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                    <EditControl
                      active={editingId === c.id}
                      onEdit={() => startEdit(c)}
                    />
                    <button
                      type="button"
                      className="text-xs font-medium text-[var(--brand-mid)]"
                      onClick={() =>
                        commit(
                          {
                            ...state,
                            campuses: state.campuses.map((x) =>
                              x.id === c.id
                                ? { ...x, isActive: !x.isActive }
                                : x,
                            ),
                          },
                          c.isActive ? "Campus inactivated" : "Campus activated",
                        )
                      }
                    >
                      {c.isActive ? "Inactivate" : "Activate"}
                    </button>
                    <RemoveControl
                      check={checkCampusRemoval(state, c.id)}
                      onRemove={() => {
                        const result = removeCampus(state, c.id);
                        if (!result.ok) {
                          commit(state, result.reason);
                          return;
                        }
                        if (editingId === c.id) resetForm();
                        commit(result.state, "Campus removed");
                      }}
                    />
                  </div>
                </li>
              ))}
              {state.campuses.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                  No campuses yet
                </li>
              ) : null}
            </ul>
          </MastersTableCard>
        </MastersTablesRow>
      }
      work={
        <MastersWorkCard
          title={editingId ? "Edit campus" : "Add campus"}
          hint="Working form"
        >
          <form onSubmit={saveCampus} className="max-w-xl space-y-1">
            <Field label="Code">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="field"
                placeholder="MAIN"
                required
              />
            </Field>
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="field"
                placeholder="Main Campus"
                required
              />
            </Field>
            <Field label="Address">
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="field"
                placeholder="Varanasi, Uttar Pradesh"
              />
            </Field>
            <label className="mt-3 flex items-center gap-2 text-sm text-[var(--brand-deep)]">
              <input
                type="checkbox"
                checked={makePrimary}
                onChange={(e) => setMakePrimary(e.target.checked)}
              />
              Primary campus
            </label>
            <div className="mt-4 flex gap-2">
              {editingId ? (
                <button
                  type="button"
                  className="rounded-xl border border-[rgba(32,48,80,0.2)] px-4 py-2.5 text-sm font-semibold text-[var(--brand-deep)]"
                  onClick={resetForm}
                >
                  Cancel
                </button>
              ) : null}
              <button
                type="submit"
                className="btn-accent flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold"
              >
                {editingId ? "Update campus" : "Save campus"}
              </button>
            </div>
          </form>
        </MastersWorkCard>
      }
    />
  );
}

function ClassesPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: (s: MastersState, msg?: string) => void;
}) {
  const [className, setClassName] = useState("");
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState(
    state.classes[0]?.id ?? "",
  );
  const [sectionName, setSectionName] = useState("");
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);

  const selected = useMemo(
    () => state.classes.find((c) => c.id === selectedClassId),
    [state.classes, selectedClassId],
  );
  const sectionsForClass = state.sections.filter(
    (s) => s.classId === selectedClassId,
  );

  function resetClassForm() {
    setEditingClassId(null);
    setClassName("");
  }

  function startEditClass(c: SchoolClass) {
    setSelectedClassId(c.id);
    setEditingClassId(c.id);
    setClassName(c.name);
  }

  function saveClass(e: React.FormEvent) {
    e.preventDefault();
    if (!className.trim()) return;
    const nextName = className.trim();
    if (
      state.classes.some(
        (c) =>
          c.name.toLowerCase() === nextName.toLowerCase() &&
          c.id !== editingClassId,
      )
    ) {
      commit(state, "Class already exists");
      return;
    }

    if (editingClassId) {
      commit(
        {
          ...state,
          classes: state.classes.map((c) =>
            c.id === editingClassId
              ? {
                  ...c,
                  name: nextName,
                  groupCode: classGroupCodeForName(nextName),
                }
              : c,
          ),
        },
        "Class updated",
      );
      resetClassForm();
      return;
    }

    const cls: SchoolClass = {
      id: newId("cls"),
      name: nextName,
      sortOrder: state.classes.length + 1,
      isActive: true,
      groupCode: classGroupCodeForName(nextName),
    };
    const secs: Section[] = ["A", "B"].map((name) => ({
      id: newId("sec"),
      classId: cls.id,
      name,
      isActive: true,
    }));
    commit(
      {
        ...state,
        classes: [...state.classes, cls],
        sections: [...state.sections, ...secs],
      },
      `Class ${cls.name} added with A & B`,
    );
    setSelectedClassId(cls.id);
    resetClassForm();
  }

  function resetSectionForm() {
    setEditingSectionId(null);
    setSectionName("");
  }

  function startEditSection(s: Section) {
    setEditingSectionId(s.id);
    setSectionName(s.name);
  }

  function saveSection(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedClassId || !sectionName.trim()) return;
    const nextName = sectionName.trim().toUpperCase();
    if (
      sectionsForClass.some(
        (s) =>
          s.name.toLowerCase() === nextName.toLowerCase() &&
          s.id !== editingSectionId,
      )
    ) {
      commit(state, "Section already exists");
      return;
    }

    if (editingSectionId) {
      commit(
        {
          ...state,
          sections: state.sections.map((s) =>
            s.id === editingSectionId ? { ...s, name: nextName } : s,
          ),
        },
        "Section updated",
      );
      resetSectionForm();
      return;
    }

    const sec: Section = {
      id: newId("sec"),
      classId: selectedClassId,
      name: nextName,
      isActive: true,
    };
    commit(
      { ...state, sections: [...state.sections, sec] },
      `Section ${sec.name} added`,
    );
    resetSectionForm();
  }

  return (
    <MastersTabStack
      intro="Classes are grouped: Pre-Primary (Nursery–UKG), Primary (I–V), Middle (VI–VIII), Secondary (IX–X), Senior (XI–XII)."
      tables={
        <MastersTablesRow>
          <MastersTableCard title="Classes by group" maxHeight="max-h-[min(70vh,560px)]">
            {CLASS_GROUPS.map((g) => {
              const rows = classesInGroup(state.classes, g.code);
              return (
                <div key={g.code}>
                  <div className="sticky top-0 z-[1] border-b border-[rgba(32,48,80,0.08)] bg-[rgba(32,48,80,0.05)] px-4 py-2">
                    <div className="text-xs font-bold text-[var(--brand-deep)]">
                      {g.label}{" "}
                      <span className="font-semibold text-[var(--muted)]">
                        · {g.shortLabel}
                      </span>
                    </div>
                    <p className="text-[10px] text-[var(--muted)]">{g.nepHint}</p>
                  </div>
                  <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
                    {rows.map((c) => {
                      const count = state.sections.filter(
                        (s) => s.classId === c.id && s.isActive,
                      ).length;
                      const active = c.id === selectedClassId;
                      return (
                        <li
                          key={c.id}
                          className={`flex items-start justify-between gap-2 px-4 py-2.5 ${
                            active ? "bg-[rgba(32,48,80,0.06)]" : ""
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedClassId(c.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="font-medium text-[var(--brand-deep)]">
                              {c.name}
                              {!c.isActive ? (
                                <span className="ml-2 text-xs text-[var(--muted)]">
                                  inactive
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-0.5 block text-xs text-[var(--muted)]">
                              {count} sections
                            </span>
                          </button>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <EditControl
                              active={editingClassId === c.id}
                              onEdit={() => startEditClass(c)}
                            />
                            <RemoveControl
                              check={checkClassRemoval(state, c.id)}
                              onRemove={() => {
                                const result = removeClass(state, c.id);
                                if (!result.ok) {
                                  commit(state, result.reason);
                                  return;
                                }
                                const nextId =
                                  result.state.classes.find(
                                    (x) => x.id === selectedClassId,
                                  )?.id ??
                                  result.state.classes[0]?.id ??
                                  "";
                                setSelectedClassId(nextId);
                                if (editingClassId === c.id) resetClassForm();
                                commit(result.state, "Class removed");
                              }}
                            />
                          </div>
                        </li>
                      );
                    })}
                    {rows.length === 0 ? (
                      <li className="px-4 py-3 text-xs text-[var(--muted)]">
                        No classes in this group
                      </li>
                    ) : null}
                  </ul>
                </div>
              );
            })}
          </MastersTableCard>

          <MastersTableCard title={`Sections · ${selected?.name ?? "—"}`}>
            <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
              {sectionsForClass.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="font-medium text-[var(--brand-deep)]">
                    {selected?.name}-{s.name}
                    {!s.isActive ? (
                      <span className="ml-2 text-xs text-[var(--muted)]">
                        inactive
                      </span>
                    ) : null}
                  </span>
                  <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                    <EditControl
                      active={editingSectionId === s.id}
                      onEdit={() => startEditSection(s)}
                    />
                    <button
                      type="button"
                      className="text-xs text-[var(--brand-mid)]"
                      onClick={() =>
                        commit(
                          {
                            ...state,
                            sections: state.sections.map((x) =>
                              x.id === s.id
                                ? { ...x, isActive: !x.isActive }
                                : x,
                            ),
                          },
                          s.isActive
                            ? "Section inactivated"
                            : "Section activated",
                        )
                      }
                    >
                      {s.isActive ? "Inactivate" : "Activate"}
                    </button>
                    <RemoveControl
                      check={checkSectionRemoval(state, s.id)}
                      onRemove={() => {
                        const result = removeSection(state, s.id);
                        if (!result.ok) {
                          commit(state, result.reason);
                          return;
                        }
                        if (editingSectionId === s.id) resetSectionForm();
                        commit(result.state, "Section removed");
                      }}
                    />
                  </div>
                </li>
              ))}
              {sectionsForClass.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                  No sections yet
                </li>
              ) : null}
            </ul>
          </MastersTableCard>
        </MastersTablesRow>
      }
      work={
        <div className="grid gap-4 lg:grid-cols-2">
          <MastersWorkCard
            title={editingClassId ? "Edit class" : "Add class"}
          >
            <form onSubmit={saveClass} className="flex flex-wrap gap-2">
              <input
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                className="field min-w-[8rem] flex-1"
                placeholder={
                  editingClassId ? "Rename class" : "New class (e.g. XIII)"
                }
              />
              {editingClassId ? (
                <button
                  type="button"
                  className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)]"
                  onClick={resetClassForm}
                >
                  Cancel
                </button>
              ) : null}
              <button
                type="submit"
                className="btn-accent rounded-lg px-3 py-2 text-xs font-semibold"
              >
                {editingClassId ? "Update" : "Add"}
              </button>
            </form>
          </MastersWorkCard>
          <MastersWorkCard
            title={
              editingSectionId
                ? `Edit section · ${selected?.name ?? ""}`
                : `Add section · ${selected?.name ?? "—"}`
            }
          >
            <form onSubmit={saveSection} className="flex flex-wrap gap-2">
              <input
                value={sectionName}
                onChange={(e) => setSectionName(e.target.value)}
                className="field min-w-[8rem] flex-1"
                placeholder={
                  editingSectionId ? "Rename section" : "Section (e.g. C)"
                }
                disabled={!selectedClassId}
              />
              {editingSectionId ? (
                <button
                  type="button"
                  className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)]"
                  onClick={resetSectionForm}
                >
                  Cancel
                </button>
              ) : null}
              <button
                type="submit"
                className="btn-accent rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
                disabled={!selectedClassId}
              >
                {editingSectionId ? "Update" : "Add"}
              </button>
            </form>
          </MastersWorkCard>
        </div>
      }
    />
  );
}

function FeeHeadsPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: (s: MastersState, msg?: string) => void;
}) {
  const categories = resolveFeeHeadCategories(state);
  const activeCategories = categories.filter((c) => c.isActive);
  const defaultCat = activeCategories[0]?.code ?? categories[0]?.code ?? "misc";

  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [category, setCategory] = useState<FeeHeadCategory>(defaultCat);
  const [frequency, setFrequency] = useState<FeeFrequency>(
    FEE_FREQUENCIES[1]!.value,
  );
  const [optional, setOptional] = useState(false);
  const [refundable, setRefundable] = useState(false);

  const [catEditingId, setCatEditingId] = useState<string | null>(null);
  const [catCode, setCatCode] = useState("");
  const [catLabel, setCatLabel] = useState("");

  function resetForm() {
    setEditingId(null);
    setCode("");
    setNameEn("");
    setCategory(defaultCat);
    setFrequency(FEE_FREQUENCIES[1]!.value);
    setOptional(false);
    setRefundable(false);
  }

  function resetCatForm() {
    setCatEditingId(null);
    setCatCode("");
    setCatLabel("");
  }

  function startEdit(f: FeeHead) {
    setEditingId(f.id);
    setCode(f.code);
    setNameEn(f.nameEn);
    setCategory(f.category);
    setFrequency(f.frequency);
    setOptional(f.isOptional);
    setRefundable(!!f.isRefundable);
  }

  function startEditCategory(c: FeeHeadCategoryDef) {
    setCatEditingId(c.id);
    setCatCode(c.code);
    setCatLabel(c.label);
  }

  function saveCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!catCode.trim() || !catLabel.trim()) return;
    const nextCode = catCode
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
    if (!nextCode) {
      commit(state, "Category code is invalid");
      return;
    }
    const list = resolveFeeHeadCategories(state);
    if (list.some((c) => c.code === nextCode && c.id !== catEditingId)) {
      commit(state, "Category code already exists");
      return;
    }

    if (catEditingId) {
      const prev = list.find((c) => c.id === catEditingId);
      const oldCode = prev?.code ?? nextCode;
      commit(
        {
          ...state,
          feeHeadCategories: list.map((c) =>
            c.id === catEditingId
              ? { ...c, code: nextCode, label: catLabel.trim() }
              : c,
          ),
          feeHeads:
            oldCode === nextCode
              ? state.feeHeads
              : state.feeHeads.map((h) =>
                  h.category === oldCode ? { ...h, category: nextCode } : h,
                ),
        },
        "Fee category updated",
      );
      resetCatForm();
      return;
    }

    const row: FeeHeadCategoryDef = {
      id: newId("fhc"),
      code: nextCode,
      label: catLabel.trim(),
      isActive: true,
      sortOrder: (list.at(-1)?.sortOrder ?? 0) + 10,
    };
    commit(
      { ...state, feeHeadCategories: [...list, row] },
      "Fee category added",
    );
    resetCatForm();
  }

  function saveHead(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !nameEn.trim()) return;
    const nextCode = code.trim().toUpperCase();
    if (
      state.feeHeads.some(
        (f) => f.code.toUpperCase() === nextCode && f.id !== editingId,
      )
    ) {
      commit(state, "Fee head code already exists");
      return;
    }

    if (editingId) {
      commit(
        {
          ...state,
          feeHeads: state.feeHeads.map((f) =>
            f.id === editingId
              ? {
                  ...f,
                  code: nextCode,
                  nameEn: nameEn.trim(),
                  category,
                  frequency,
                  isOptional: optional,
                  isRefundable: refundable,
                }
              : f,
          ),
        },
        "Fee head updated",
      );
      resetForm();
      return;
    }

    const head: FeeHead = {
      id: newId("fh"),
      code: nextCode,
      nameEn: nameEn.trim(),
      category,
      frequency,
      isOptional: optional,
      isRefundable: refundable,
      isActive: true,
      sortOrder: (state.feeHeads.at(-1)?.sortOrder ?? 0) + 10,
    };
    commit(
      { ...state, feeHeads: [...state.feeHeads, head] },
      "Fee head added",
    );
    resetForm();
  }

  return (
    <MastersTabStack
      tables={
        <MastersTablesRow cols={2}>
          <MastersTableCard title="Fee head categories">
            <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
              {categories.map((c) => {
                const used = state.feeHeads.filter(
                  (h) => h.category === c.code,
                ).length;
                return (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div>
                      <div className="font-medium text-[var(--brand-deep)]">
                        {c.label}{" "}
                        <span className="text-xs font-normal text-[var(--muted)]">
                          {c.code}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--muted)]">
                        {used} fee head{used === 1 ? "" : "s"}
                        {!c.isActive ? " · inactive" : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-start">
                      <EditControl
                        active={catEditingId === c.id}
                        onEdit={() => startEditCategory(c)}
                      />
                      <button
                        type="button"
                        className="text-xs font-medium text-[var(--brand-mid)]"
                        onClick={() =>
                          commit(
                            {
                              ...state,
                              feeHeadCategories: resolveFeeHeadCategories(
                                state,
                              ).map((x) =>
                                x.id === c.id
                                  ? { ...x, isActive: !x.isActive }
                                  : x,
                              ),
                            },
                            c.isActive
                              ? "Category inactivated"
                              : "Category activated",
                          )
                        }
                      >
                        {c.isActive ? "Inactivate" : "Activate"}
                      </button>
                      <RemoveControl
                        check={checkFeeHeadCategoryRemoval(state, c.id)}
                        onRemove={() => {
                          const result = removeFeeHeadCategory(state, c.id);
                          if (!result.ok) {
                            commit(state, result.reason);
                            return;
                          }
                          if (catEditingId === c.id) resetCatForm();
                          commit(result.state, "Category removed");
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </MastersTableCard>
          <MastersTableCard title="Fee heads">
            <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
              {state.feeHeads
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div>
                      <div className="font-medium text-[var(--brand-deep)]">
                        {f.nameEn}{" "}
                        <span className="text-xs font-normal text-[var(--muted)]">
                          {f.code}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--muted)]">
                        {feeHeadCategoryLabel(state, f.category)} · {f.frequency}
                        {f.isRefundable
                          ? " · refundable"
                          : " · non-refundable"}
                        {f.isOptional ? " · optional" : ""}
                        {!f.isActive ? " · inactive" : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-start">
                      <EditControl
                        active={editingId === f.id}
                        onEdit={() => startEdit(f)}
                      />
                      <button
                        type="button"
                        className="text-xs font-medium text-[var(--brand-mid)]"
                        onClick={() =>
                          commit(
                            {
                              ...state,
                              feeHeads: state.feeHeads.map((x) =>
                                x.id === f.id
                                  ? { ...x, isActive: !x.isActive }
                                  : x,
                              ),
                            },
                            f.isActive
                              ? "Fee head inactivated"
                              : "Fee head activated",
                          )
                        }
                      >
                        {f.isActive ? "Inactivate" : "Activate"}
                      </button>
                      <RemoveControl
                        check={checkFeeHeadRemoval(state, f.id)}
                        onRemove={() => {
                          const result = removeFeeHead(state, f.id);
                          if (!result.ok) {
                            commit(state, result.reason);
                            return;
                          }
                          if (editingId === f.id) resetForm();
                          commit(result.state, "Fee head removed");
                        }}
                      />
                    </div>
                  </li>
                ))}
            </ul>
          </MastersTableCard>
        </MastersTablesRow>
      }
      work={
        <div className="grid gap-4 lg:grid-cols-2">
          <MastersWorkCard
            title={catEditingId ? "Edit category" : "Add category"}
            hint="Manage fee head categories"
          >
            <form onSubmit={saveCategory} className="space-y-1">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Code">
                  <input
                    value={catCode}
                    onChange={(e) => setCatCode(e.target.value)}
                    className="field"
                    placeholder="sports"
                    required
                  />
                </Field>
                <Field label="Label">
                  <input
                    value={catLabel}
                    onChange={(e) => setCatLabel(e.target.value)}
                    className="field"
                    placeholder="Sports"
                    required
                  />
                </Field>
              </div>
              <div className="mt-4 flex gap-2">
                {catEditingId ? (
                  <button
                    type="button"
                    className="rounded-xl border border-[rgba(32,48,80,0.2)] px-4 py-2.5 text-sm font-semibold text-[var(--brand-deep)]"
                    onClick={resetCatForm}
                  >
                    Cancel
                  </button>
                ) : null}
                <button
                  type="submit"
                  className="btn-accent flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold"
                >
                  {catEditingId ? "Update category" : "Save category"}
                </button>
              </div>
            </form>
          </MastersWorkCard>

          <MastersWorkCard
            title={editingId ? "Edit fee head" : "Add fee head"}
            hint="Working form"
          >
            <form onSubmit={saveHead} className="space-y-1">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Code">
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="field"
                    placeholder="SPORTS"
                    required
                  />
                </Field>
                <Field label="Name">
                  <input
                    value={nameEn}
                    onChange={(e) => setNameEn(e.target.value)}
                    className="field"
                    placeholder="Sports Fee"
                    required
                  />
                </Field>
                <Field label="Category">
                  <select
                    value={category}
                    onChange={(e) => {
                      const next = e.target.value;
                      setCategory(next);
                      if (next === "deposit") setRefundable(true);
                    }}
                    className="field"
                  >
                    {(activeCategories.length
                      ? activeCategories
                      : categories
                    ).map((c) => (
                      <option key={c.id} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Frequency">
                  <select
                    value={frequency}
                    onChange={(e) =>
                      setFrequency(e.target.value as FeeFrequency)
                    }
                    className="field"
                  >
                    {FEE_FREQUENCIES.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Refund type">
                  <select
                    value={refundable ? "refundable" : "non_refundable"}
                    onChange={(e) =>
                      setRefundable(e.target.value === "refundable")
                    }
                    className="field"
                  >
                    <option value="non_refundable">Non-refundable</option>
                    <option value="refundable">
                      Refundable (security / caution deposit)
                    </option>
                  </select>
                </Field>
                <label className="mt-3 flex items-end gap-2 pb-2 text-sm text-[var(--brand-deep)]">
                  <input
                    type="checkbox"
                    checked={optional}
                    onChange={(e) => setOptional(e.target.checked)}
                  />
                  Optional (e.g. transport)
                </label>
              </div>
              <div className="mt-4 flex gap-2">
                {editingId ? (
                  <button
                    type="button"
                    className="rounded-xl border border-[rgba(32,48,80,0.2)] px-4 py-2.5 text-sm font-semibold text-[var(--brand-deep)]"
                    onClick={resetForm}
                  >
                    Cancel
                  </button>
                ) : null}
                <button
                  type="submit"
                  className="btn-accent flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold"
                >
                  {editingId ? "Update fee head" : "Save fee head"}
                </button>
              </div>
            </form>
          </MastersWorkCard>
        </div>
      }
    />
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mt-3 block text-sm">
      <span className="mb-1.5 block text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}
