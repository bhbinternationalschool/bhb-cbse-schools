"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FEE_CATEGORIES,
  FEE_FREQUENCIES,
  DEFAULT_AY,
  checkCampusRemoval,
  checkClassRemoval,
  checkFeeHeadRemoval,
  checkSectionRemoval,
  loadMasters,
  newId,
  removeCampus,
  removeClass,
  removeFeeHead,
  removeSection,
  saveMasters,
  type Campus,
  type FeeHead,
  type FeeHeadCategory,
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
  CompletenessDashboard,
  HolidaysPanel,
  NumberSeriesPanel,
  SchoolProfilePanel,
  StaffMastersPanel,
  SubjectsPanel,
} from "@/components/masters/FoundationPanels";
import {
  MastersEmptyRow,
  MastersTabStack,
  MastersTableCard,
  MastersTablesRow,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";

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
  | "fee-heads"
  | "fee-groups"
  | "fee-structure"
  | "special-fees"
  | "concessions"
  | "installments"
  | "late-fee"
  | "mid-year";

const TABS: { id: Tab; label: string; tone: string }[] = [
  { id: "overview", label: "Overview", tone: "navy" },
  { id: "school", label: "School", tone: "teal" },
  { id: "academic", label: "Academic", tone: "teal" },
  { id: "campuses", label: "Campuses", tone: "teal" },
  { id: "classes", label: "Classes & sections", tone: "teal" },
  { id: "subjects", label: "Subjects", tone: "teal" },
  { id: "series", label: "Numbering", tone: "slate" },
  { id: "holidays", label: "Holidays", tone: "amber" },
  { id: "staff", label: "Staff", tone: "slate" },
  { id: "fee-heads", label: "Fee heads", tone: "green" },
  { id: "fee-groups", label: "Fee groups", tone: "green" },
  { id: "fee-structure", label: "Fee structure", tone: "green" },
  { id: "special-fees", label: "Special fees", tone: "green" },
  { id: "concessions", label: "Concessions", tone: "green" },
  { id: "installments", label: "Due dates", tone: "green" },
  { id: "late-fee", label: "Late fee", tone: "rose" },
  { id: "mid-year", label: "Mid-year", tone: "rose" },
];

const TAB_TONE: Record<
  string,
  { idle: string; hover: string; active: string; dot: string }
> = {
  navy: {
    idle: "bg-[rgba(32,48,80,0.08)] text-[var(--brand-deep)]",
    hover: "hover:bg-[rgba(32,48,80,0.14)]",
    active:
      "bg-[var(--brand-deep)] text-white shadow-[0_2px_10px_rgba(32,48,80,0.35)] ring-2 ring-[var(--brand-gold)] ring-offset-2",
    dot: "bg-[var(--brand-gold)]",
  },
  teal: {
    idle: "bg-[rgba(15,118,110,0.1)] text-[#0f766e]",
    hover: "hover:bg-[rgba(15,118,110,0.18)]",
    active:
      "bg-[#0f766e] text-white shadow-[0_2px_10px_rgba(15,118,110,0.35)] ring-2 ring-[#5eead4] ring-offset-2",
    dot: "bg-[#5eead4]",
  },
  slate: {
    idle: "bg-[rgba(71,85,105,0.1)] text-[#334155]",
    hover: "hover:bg-[rgba(71,85,105,0.18)]",
    active:
      "bg-[#334155] text-white shadow-[0_2px_10px_rgba(51,65,85,0.35)] ring-2 ring-[#94a3b8] ring-offset-2",
    dot: "bg-[#94a3b8]",
  },
  amber: {
    idle: "bg-[rgba(197,160,40,0.14)] text-[#8a6d12]",
    hover: "hover:bg-[rgba(197,160,40,0.24)]",
    active:
      "bg-[#b8860b] text-white shadow-[0_2px_10px_rgba(184,134,11,0.4)] ring-2 ring-[var(--brand-gold)] ring-offset-2",
    dot: "bg-[#fde68a]",
  },
  green: {
    idle: "bg-[rgba(22,163,74,0.1)] text-[#15803d]",
    hover: "hover:bg-[rgba(22,163,74,0.18)]",
    active:
      "bg-[#15803d] text-white shadow-[0_2px_10px_rgba(21,128,61,0.35)] ring-2 ring-[#86efac] ring-offset-2",
    dot: "bg-[#86efac]",
  },
  rose: {
    idle: "bg-[rgba(190,24,93,0.1)] text-[#9d174d]",
    hover: "hover:bg-[rgba(190,24,93,0.18)]",
    active:
      "bg-[#9d174d] text-white shadow-[0_2px_10px_rgba(157,23,77,0.35)] ring-2 ring-[#f9a8d4] ring-offset-2",
    dot: "bg-[#f9a8d4]",
  },
};

export function MastersWorkspace() {
  const [tab, setTab] = useState<Tab>("overview");
  const [state, setState] = useState<MastersState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setState(loadMasters());
  }, []);

  function commit(next: MastersState, msg?: string) {
    setState(next);
    saveMasters(next);
    if (msg) {
      setNotice(msg);
      window.setTimeout(() => setNotice(null), 2200);
    }
  }

  if (!state) {
    return (
      <p className="text-sm text-[var(--muted)]">Loading masters…</p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--brand-deep)]">
            Masters
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Institution, academic, subjects, holidays, staff, and fee setup (
            {DEFAULT_AY})

          </p>
        </div>
        {notice ? (
          <span className="rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-1.5 text-xs font-medium text-[var(--brand-deep)]">
            {notice}
          </span>
        ) : null}
      </div>

      <div
        className="mt-6 flex flex-wrap gap-2 rounded-xl border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] p-2.5"
        role="tablist"
        aria-label="Masters sections"
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          const tone = TAB_TONE[t.tone] ?? TAB_TONE.navy!;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] transition ${
                active
                  ? `font-bold ${tone.active}`
                  : `font-semibold ${tone.idle} ${tone.hover}`
              }`}
            >
              {active ? (
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${tone.dot} ring-2 ring-white/40`}
                  aria-hidden
                />
              ) : null}
              <span>{t.label}</span>
              {active ? (
                <span className="ml-0.5 rounded bg-white/20 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide">
                  Open
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {tab === "overview" ? <Overview state={state} onGo={setTab} /> : null}
        {tab === "school" ? (
          <SchoolProfilePanel state={state} commit={commit} />
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
      </div>
    </div>
  );
}

function Overview({
  state,
  onGo,
}: {
  state: MastersState;
  onGo: (t: Tab) => void;
}) {
  const activeClasses = state.classes.filter((c) => c.isActive).length;
  const activeSections = state.sections.filter((s) => s.isActive).length;
  const activeHeads = state.feeHeads.filter((f) => f.isActive).length;
  const campuses = state.campuses.filter((c) => c.isActive).length;
  const groups = state.feeGroups.filter((g) => g.isActive).length;
  const installments = state.installments.filter((i) => i.isActive).length;

  const specialCount = state.specialFees?.filter((f) => f.isActive).length ?? 0;
  const concessionCount =
    state.concessions?.filter((c) => c.isActive).length ?? 0;

  const subjectCount = state.subjects?.filter((s) => s.isActive).length ?? 0;
  const staffCount =
    state.staff?.filter((s) => s.status === "active").length ?? 0;
  const holidayPub =
    state.holidays?.filter((h) => h.isPublished).length ?? 0;

  const cards = [
    { label: "Campuses", value: campuses, tab: "campuses" as Tab },
    { label: "Classes", value: activeClasses, tab: "classes" as Tab },
    { label: "Sections", value: activeSections, tab: "classes" as Tab },
    { label: "Subjects", value: subjectCount, tab: "subjects" as Tab },
    { label: "Staff", value: staffCount, tab: "staff" as Tab },
    { label: "Holidays (pub)", value: holidayPub, tab: "holidays" as Tab },
    { label: "Fee heads", value: activeHeads, tab: "fee-heads" as Tab },
    { label: "Fee groups", value: groups, tab: "fee-groups" as Tab },
    { label: "Special fees", value: specialCount, tab: "special-fees" as Tab },
    { label: "Concessions", value: concessionCount, tab: "concessions" as Tab },
    { label: "Due dates", value: installments, tab: "installments" as Tab },
    { label: "Mid-year rules", value: "Edit", tab: "mid-year" as Tab },
  ];

  return (
    <div className="space-y-6">
      <CompletenessDashboard
        state={state}
        onGo={(t) => onGo(t as Tab)}
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
        <button
          type="button"
          onClick={() => onGo("holidays")}
          className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm font-medium text-[var(--brand-deep)]"
        >
          Holidays →
        </button>
        <button
          type="button"
          onClick={() => onGo("staff")}
          className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm font-medium text-[var(--brand-deep)]"
        >
          Staff masters →
        </button>
      </div>
      <p className="text-sm text-[var(--muted)]">
        Fee setup for {DEFAULT_AY}: heads → groups →{" "}
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
                <MastersEmptyRow label="No campuses yet" />
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
                <MastersEmptyRow label="No sections yet" />
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [category, setCategory] = useState<FeeHeadCategory>(
    FEE_CATEGORIES[0]!.value,
  );
  const [frequency, setFrequency] = useState<FeeFrequency>(
    FEE_FREQUENCIES[1]!.value,
  );
  const [optional, setOptional] = useState(false);

  function resetForm() {
    setEditingId(null);
    setCode("");
    setNameEn("");
    setCategory(FEE_CATEGORIES[0]!.value);
    setFrequency(FEE_FREQUENCIES[1]!.value);
    setOptional(false);
  }

  function startEdit(f: FeeHead) {
    setEditingId(f.id);
    setCode(f.code);
    setNameEn(f.nameEn);
    setCategory(f.category);
    setFrequency(f.frequency);
    setOptional(f.isOptional);
  }

  function saveHead(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !nameEn.trim()) return;
    const nextCode = code.trim().toUpperCase();
    if (
      state.feeHeads.some(
        (f) =>
          f.code.toUpperCase() === nextCode && f.id !== editingId,
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
        <MastersTablesRow cols={1}>
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
                        {f.category} · {f.frequency}
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
        <MastersWorkCard
          title={editingId ? "Edit fee head" : "Add fee head"}
          hint="Working form"
        >
          <form onSubmit={saveHead} className="max-w-xl space-y-1">
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
                onChange={(e) =>
                  setCategory(e.target.value as FeeHeadCategory)
                }
                className="field"
              >
                {FEE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
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
            <label className="mt-3 flex items-center gap-2 text-sm text-[var(--brand-deep)]">
              <input
                type="checkbox"
                checked={optional}
                onChange={(e) => setOptional(e.target.checked)}
              />
              Optional (e.g. transport)
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
                {editingId ? "Update fee head" : "Save fee head"}
              </button>
            </div>
          </form>
        </MastersWorkCard>
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
