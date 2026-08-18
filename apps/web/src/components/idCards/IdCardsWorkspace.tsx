"use client";

import { useEffect, useMemo, useState } from "react";
import { CreditCard } from "lucide-react";
import { useDemoSession, useSessionReadOnly } from "@/components/shell/SessionContext";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { field } from "@/components/ui/erp-ui";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import {
  buildStaffIdCardDoc,
  buildStudentIdCardDoc,
  downloadIdCardsPdf,
  idCardTemplateIsHeavy,
} from "@/lib/idCardsPdf";
import {
  ID_CARD_FIELD_CATALOG,
  ID_CARD_PRESETS,
  emptyIdCardTemplateState,
  loadIdCardTemplateState,
  saveIdCardTemplateState,
  type IdCardFieldId,
  type IdCardKind,
  type IdCardTemplate,
  type IdCardTemplateState,
} from "@/lib/idCardTemplate";
import { useModuleStateHydration } from "@/lib/useModuleStateHydration";

type Tab = "student" | "staff" | "design";

const TABS: ModuleTabItem[] = [
  { id: "student", label: "Student ID cards", tone: "navy" },
  { id: "staff", label: "Staff ID cards", tone: "teal" },
  { id: "design", label: "Card design", tone: "amber" },
];

function templateSummary(t: IdCardTemplate): string {
  const orientation = t.orientation === "portrait" ? "Portrait" : "Landscape";
  const sides = t.sides === "front_back" ? "Front & back" : "Front only";
  return `${orientation} · ${sides}`;
}

export function IdCardsWorkspace() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const ay = session.academicYearCode || DEFAULT_AY;
  const [tab, setTab] = useState<Tab>("student");
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);

  const [departmentId, setDepartmentId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);

  const [templateState, setTemplateState] = useState<IdCardTemplateState>(() =>
    emptyIdCardTemplateState(),
  );
  const [designKind, setDesignKind] = useState<IdCardKind>("student");

  // Re-read when the server copy of this module lands (login/refresh hydration).
  useModuleStateHydration("id_card_template", () => { setTemplateState(loadIdCardTemplateState()); });
  useEffect(() => {
    setMasters(loadMasters());
    setSis(loadSis());
    setTemplateState(loadIdCardTemplateState());
    void (async () => {
      const [{ ensureMastersHydrated }, { ensureSisHydrated }, { withHydrationSlot }] =
        await Promise.all([
          import("@/lib/mastersPersistence"),
          import("@/lib/sisPersistence"),
          import("@/lib/deskHydrateGuard"),
        ]);
      await Promise.all([
        withHydrationSlot(() => ensureMastersHydrated()),
        withHydrationSlot(() => ensureSisHydrated()),
      ]);
      setMasters(loadMasters());
      setSis(loadSis());
    })();
  }, []);

  const classes = useMemo(
    () =>
      (masters?.classes ?? [])
        .filter((c) => c.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [masters],
  );
  const sections = useMemo(
    () =>
      (masters?.sections ?? [])
        .filter((s) => s.isActive && (!classId || s.classId === classId))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [masters, classId],
  );

  const students = useMemo(() => {
    if (!sis) return [];
    return sis.students
      .filter((s) => s.status === "active" && s.academicYearCode === ay)
      .filter((s) => !classId || s.classId === classId)
      .filter((s) => !sectionId || s.sectionId === sectionId)
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [sis, ay, classId, sectionId]);

  useEffect(() => {
    setSelectedStudentIds(students.map((s) => s.id));
  }, [students]);

  const departments = useMemo(
    () => (masters?.departments ?? []).filter((d) => d.isActive),
    [masters],
  );
  const designations = useMemo(
    () =>
      (masters?.designations ?? []).filter(
        (d) => d.isActive && (!departmentId || d.departmentId === departmentId),
      ),
    [masters, departmentId],
  );

  const staff = useMemo(() => {
    if (!masters) return [];
    return (masters.staff ?? [])
      .filter((s) => s.status === "active")
      .filter((s) => !departmentId || s.departmentId === departmentId)
      .filter((s) => !designationId || s.designationId === designationId)
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [masters, departmentId, designationId]);

  useEffect(() => {
    setSelectedStaffIds(staff.map((s) => s.id));
  }, [staff]);

  function toggleStudent(id: string) {
    setSelectedStudentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }
  function toggleStaffMember(id: string) {
    setSelectedStaffIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 4000);
  }

  async function onGenerateStudentCards() {
    if (!masters || !sis) return;
    const picked = students.filter((s) => selectedStudentIds.includes(s.id));
    if (!picked.length) {
      setError("Select at least one student.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const template = loadIdCardTemplateState().student;
      const docs = picked.map((s) => buildStudentIdCardDoc(s, sis, masters));
      await downloadIdCardsPdf(docs, template, { fileBaseName: "student_id_cards" });
      flash(`${docs.length} student ID card(s) generated.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onGenerateStaffCards() {
    if (!masters) return;
    const picked = staff.filter((s) => selectedStaffIds.includes(s.id));
    if (!picked.length) {
      setError("Select at least one staff member.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const template = loadIdCardTemplateState().staff;
      const docs = picked.map((s) => buildStaffIdCardDoc(s, masters));
      await downloadIdCardsPdf(docs, template, { fileBaseName: "staff_id_cards" });
      flash(`${docs.length} staff ID card(s) generated.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const draftTemplate = templateState[designKind];

  function updateDraft(patch: Partial<IdCardTemplate>) {
    setTemplateState((prev) => ({ ...prev, [designKind]: { ...prev[designKind], ...patch } }));
  }

  function toggleDraftField(side: "front" | "back", fieldId: IdCardFieldId) {
    const key = side === "front" ? "frontFields" : "backFields";
    const list = draftTemplate[key];
    updateDraft({
      [key]: list.includes(fieldId) ? list.filter((f) => f !== fieldId) : [...list, fieldId],
    } as Partial<IdCardTemplate>);
  }

  function onSaveTemplate() {
    const saved = saveIdCardTemplateState(templateState);
    setTemplateState(saved);
    flash("Card design saved.");
  }

  function fieldGroup(side: "front" | "back", kind: "photo" | "qr" | "text", label: string) {
    const ids = (Object.keys(ID_CARD_FIELD_CATALOG) as IdCardFieldId[]).filter(
      (id) => ID_CARD_FIELD_CATALOG[id].kind === kind && ID_CARD_FIELD_CATALOG[id].appliesTo.includes(designKind),
    );
    if (!ids.length) return null;
    const list = side === "front" ? draftTemplate.frontFields : draftTemplate.backFields;
    return (
      <div key={`${side}-${kind}`}>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
          {ids.map((id) => (
            <label key={id} className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={list.includes(id)}
                onChange={() => toggleDraftField(side, id)}
              />
              {ID_CARD_FIELD_CATALOG[id].label}
            </label>
          ))}
        </div>
      </div>
    );
  }

  return (
    <ErpWorkspaceShell
      title="ID cards"
      subtitle="Batch-print student & staff ID cards — photo, QR, class/roll or emp code"
      icon={<CreditCard className="size-6" aria-hidden />}
      notice={notice}
      error={error}
    >
      <ModuleTabs value={tab} onChange={(id) => setTab(id as Tab)} items={TABS} />

      {tab === "student" ? (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Class</span>
              <select
                className={`${field} !py-1.5`}
                value={classId}
                onChange={(e) => {
                  setClassId(e.target.value);
                  setSectionId("");
                }}
              >
                <option value="">All classes</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Section</span>
              <select
                className={`${field} !py-1.5`}
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value)}
                disabled={!classId}
              >
                <option value="">All sections</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
              onClick={() => setSelectedStudentIds(students.map((s) => s.id))}
            >
              Select all
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
              onClick={() => setSelectedStudentIds([])}
            >
              Clear
            </button>
            <span className="text-[11px] text-[var(--muted)]">
              {selectedStudentIds.length} of {students.length} selected
            </span>
          </div>

          <div className="max-h-96 overflow-y-auto rounded-xl border border-[var(--border)]">
            {students.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                No active students match this filter.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {students.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-2">
                    <input
                      type="checkbox"
                      checked={selectedStudentIds.includes(s.id)}
                      onChange={() => toggleStudent(s.id)}
                    />
                    <span className="flex-1 truncate text-sm">{s.fullName}</span>
                    <span className="text-xs text-[var(--muted)]">{s.admissionNo}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-accent rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
              disabled={readOnly || busy || !selectedStudentIds.length}
              onClick={onGenerateStudentCards}
            >
              {busy ? "Generating…" : `Print ${selectedStudentIds.length} card(s)`}
            </button>
            <span className="text-[11px] text-[var(--muted)]">
              Using: {templateSummary(templateState.student)} —{" "}
              <button
                type="button"
                className="font-semibold text-[var(--brand-deep)] underline"
                onClick={() => {
                  setDesignKind("student");
                  setTab("design");
                }}
              >
                change
              </button>
            </span>
          </div>
        </div>
      ) : null}

      {tab === "staff" ? (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Department</span>
              <select
                className={`${field} !py-1.5`}
                value={departmentId}
                onChange={(e) => {
                  setDepartmentId(e.target.value);
                  setDesignationId("");
                }}
              >
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Designation</span>
              <select
                className={`${field} !py-1.5`}
                value={designationId}
                onChange={(e) => setDesignationId(e.target.value)}
              >
                <option value="">All designations</option>
                {designations.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
              onClick={() => setSelectedStaffIds(staff.map((s) => s.id))}
            >
              Select all
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
              onClick={() => setSelectedStaffIds([])}
            >
              Clear
            </button>
            <span className="text-[11px] text-[var(--muted)]">
              {selectedStaffIds.length} of {staff.length} selected
            </span>
          </div>

          <div className="max-h-96 overflow-y-auto rounded-xl border border-[var(--border)]">
            {staff.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                No active staff match this filter.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {staff.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-2">
                    <input
                      type="checkbox"
                      checked={selectedStaffIds.includes(s.id)}
                      onChange={() => toggleStaffMember(s.id)}
                    />
                    <span className="flex-1 truncate text-sm">{s.fullName}</span>
                    <span className="text-xs text-[var(--muted)]">{s.empCode}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-accent rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
              disabled={readOnly || busy || !selectedStaffIds.length}
              onClick={onGenerateStaffCards}
            >
              {busy ? "Generating…" : `Print ${selectedStaffIds.length} card(s)`}
            </button>
            <span className="text-[11px] text-[var(--muted)]">
              Using: {templateSummary(templateState.staff)} —{" "}
              <button
                type="button"
                className="font-semibold text-[var(--brand-deep)] underline"
                onClick={() => {
                  setDesignKind("staff");
                  setTab("design");
                }}
              >
                change
              </button>
            </span>
          </div>
        </div>
      ) : null}

      {tab === "design" ? (
        <div className="mt-5 max-w-2xl space-y-5">
          <div className="flex gap-2">
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                designKind === "student"
                  ? "btn-accent"
                  : "border border-[var(--border)]"
              }`}
              onClick={() => setDesignKind("student")}
            >
              Student cards
            </button>
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                designKind === "staff" ? "btn-accent" : "border border-[var(--border)]"
              }`}
              onClick={() => setDesignKind("staff")}
            >
              Staff cards
            </button>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] text-[var(--muted)]">Presets</p>
            <div className="flex flex-wrap gap-2">
              {ID_CARD_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
                  onClick={() => updateDraft(p.build(designKind))}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold text-[var(--muted)]">Orientation</p>
              <div className="flex gap-4 text-xs">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={draftTemplate.orientation === "landscape"}
                    onChange={() => updateDraft({ orientation: "landscape" })}
                  />
                  Landscape
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={draftTemplate.orientation === "portrait"}
                    onChange={() => updateDraft({ orientation: "portrait" })}
                  />
                  Portrait
                </label>
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-semibold text-[var(--muted)]">Sides</p>
              <div className="flex gap-4 text-xs">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={draftTemplate.sides === "front_only"}
                    onChange={() => updateDraft({ sides: "front_only" })}
                  />
                  Front only
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={draftTemplate.sides === "front_back"}
                    onChange={() => updateDraft({ sides: "front_back" })}
                  />
                  Front &amp; back
                </label>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="text-xs font-bold text-[var(--brand-deep)]">Front</h3>
            <div className="mt-2 space-y-2">
              {fieldGroup("front", "photo", "Photos")}
              {fieldGroup("front", "qr", "QR")}
              {fieldGroup("front", "text", "Details")}
            </div>
          </div>

          {draftTemplate.sides === "front_back" ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <h3 className="text-xs font-bold text-[var(--brand-deep)]">Back</h3>
              <div className="mt-2 space-y-2">
                {fieldGroup("back", "photo", "Photos")}
                {fieldGroup("back", "qr", "QR")}
                {fieldGroup("back", "text", "Details")}
              </div>
            </div>
          ) : null}

          {idCardTemplateIsHeavy(draftTemplate) ? (
            <p className="rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning)]">
              Large batches with parent photos on front &amp; back may take a while to generate —
              consider printing in smaller runs.
            </p>
          ) : null}

          <button
            type="button"
            className="btn-accent rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
            disabled={readOnly}
            onClick={onSaveTemplate}
          >
            Save card design
          </button>
        </div>
      ) : null}
    </ErpWorkspaceShell>
  );
}
