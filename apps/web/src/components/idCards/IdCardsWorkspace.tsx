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
} from "@/lib/idCardsPdf";

type Tab = "student" | "staff";

const TABS: ModuleTabItem[] = [
  { id: "student", label: "Student ID cards", tone: "navy" },
  { id: "staff", label: "Staff ID cards", tone: "teal" },
];

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

  useEffect(() => {
    setMasters(loadMasters());
    setSis(loadSis());
    void (async () => {
      const { ensureMastersHydrated } = await import("@/lib/mastersPersistence");
      const { ensureSisHydrated } = await import("@/lib/sisPersistence");
      await Promise.all([ensureMastersHydrated(), ensureSisHydrated()]);
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

  async function onGenerateStudentCards() {
    if (!masters) return;
    const picked = students.filter((s) => selectedStudentIds.includes(s.id));
    if (!picked.length) {
      setError("Select at least one student.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const docs = picked.map((s) => buildStudentIdCardDoc(s, masters));
      await downloadIdCardsPdf(docs, { fileBaseName: "student_id_cards" });
      setNotice(`${docs.length} student ID card(s) generated.`);
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
      const docs = picked.map((s) => buildStaffIdCardDoc(s, masters));
      await downloadIdCardsPdf(docs, { fileBaseName: "staff_id_cards" });
      setNotice(`${docs.length} staff ID card(s) generated.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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

          <button
            type="button"
            className="btn-accent rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
            disabled={readOnly || busy || !selectedStudentIds.length}
            onClick={onGenerateStudentCards}
          >
            {busy ? "Generating…" : `Print ${selectedStudentIds.length} card(s)`}
          </button>
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

          <button
            type="button"
            className="btn-accent rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
            disabled={readOnly || busy || !selectedStaffIds.length}
            onClick={onGenerateStaffCards}
          >
            {busy ? "Generating…" : `Print ${selectedStaffIds.length} card(s)`}
          </button>
        </div>
      ) : null}
    </ErpWorkspaceShell>
  );
}
