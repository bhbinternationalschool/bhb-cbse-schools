"use client";

import { useEffect, useMemo, useState } from "react";
import { HeartPulse } from "lucide-react";
import { useDemoSession, useSessionReadOnly } from "@/components/shell/SessionContext";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { field } from "@/components/ui/erp-ui";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import type { RowAction } from "@/components/ui/erp-grid";
import { DEFAULT_AY, loadMasters, type MastersState, currentAcademicYearCode} from "@/lib/masters";
import { classSectionLabel } from "@/lib/timetable";
import { loadSis, type SisState, type SisStudent, studentsInSession} from "@/lib/sis";
import {
  deleteMedication,
  deleteVaccination,
  deleteVisit,
  emptyHealthState,
  healthVisitReasonLabel,
  HEALTH_VISIT_REASONS,
  isVaccinationOverdue,
  listHealthRecordsForStudent,
  loadHealth,
  notifyHealthParent,
  saveHealth,
  upsertMedication,
  upsertVaccination,
  upsertVisit,
  type HealthState,
  type HealthVisitReason,
} from "@/lib/health";
import { useModuleStateHydration } from "@/lib/useModuleStateHydration";

type Tab = "log" | "visits" | "medications" | "vaccinations" | "student";

const TABS: ModuleTabItem[] = [
  { id: "log", label: "Log visit", tone: "rose" },
  { id: "visits", label: "Visit log", tone: "amber" },
  { id: "medications", label: "Medications", tone: "green" },
  { id: "vaccinations", label: "Vaccinations", tone: "sky" },
  { id: "student", label: "By student", tone: "violet" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function StudentPicker({
  sis,
  masters,
  value,
  onPick,
  onClear,
}: {
  sis: SisState | null;
  masters: MastersState | null;
  value: SisStudent | null;
  onPick: (s: SisStudent) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    if (!sis) return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];
      // One row per child, this session. SIS keeps a row per child per
      // year and marks them all active, so the same name appeared several
      // times and, in a capped list, pushed real matches off the end.
    return studentsInSession(sis, currentAcademicYearCode(masters))
      .filter((s) => s.fullName.toLowerCase().includes(q) || s.admissionNo.toLowerCase().includes(q))
      .slice(0, 15);
  }, [sis, query]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2">
        <span className="text-sm font-semibold">
          {value.fullName}
          {masters ? ` · ${classSectionLabel(masters, value.classId, value.sectionId)}` : ""}
        </span>
        <button type="button" className="text-xs font-semibold text-[var(--brand-deep)] underline" onClick={onClear}>
          Change
        </button>
      </div>
    );
  }

  return (
    <>
      <input
        className={field}
        placeholder="Search name or admission no…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {matches.length > 0 ? (
        <ul className="mt-1 max-h-52 overflow-y-auto rounded-lg border border-[var(--border)]">
          {matches.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-sunken)]"
                onClick={() => {
                  onPick(s);
                  setQuery("");
                }}
              >
                {s.fullName}
                <span className="ml-2 text-xs text-[var(--muted)]">{s.admissionNo}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export function HealthWorkspace() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const ay = session.academicYearCode || DEFAULT_AY;
  const [tab, setTab] = useState<Tab>("log");
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [state, setState] = useState<HealthState>(emptyHealthState());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-read when the server copy of this module lands (login/refresh hydration).
  useModuleStateHydration("health", () => { setState(loadHealth()); });
  useEffect(() => {
    setMasters(loadMasters());
    setSis(loadSis());
    setState(loadHealth());
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

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 4000);
  }

  function studentName(id: string): string {
    return sis?.students.find((s) => s.id === id)?.fullName || "—";
  }

  // --- Log visit ---
  const [pickedStudent, setPickedStudent] = useState<SisStudent | null>(null);
  const [logReason, setLogReason] = useState<HealthVisitReason>("illness");
  const [logDate, setLogDate] = useState(todayIso());
  const [logTime, setLogTime] = useState("");
  const [logSymptoms, setLogSymptoms] = useState("");
  const [logAction, setLogAction] = useState("");
  const [logReferred, setLogReferred] = useState(false);

  function resetLogForm() {
    setPickedStudent(null);
    setLogReason("illness");
    setLogDate(todayIso());
    setLogTime("");
    setLogSymptoms("");
    setLogAction("");
    setLogReferred(false);
  }

  function onLogVisit() {
    if (!pickedStudent) {
      setError("Pick a student.");
      return;
    }
    const { state: withVisit } = upsertVisit(state, {
      studentId: pickedStudent.id,
      academicYearCode: ay,
      date: logDate,
      time: logTime,
      reason: logReason,
      symptoms: logSymptoms,
      actionTaken: logAction,
      referredToHospital: logReferred,
      reportedByStaffId: session.staffId || "",
    });
    setState(saveHealth(withVisit));
    resetLogForm();
    flash("Visit logged.");
  }

  // --- Visit log ---
  const [filterReason, setFilterReason] = useState<HealthVisitReason | "">("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const visitRows = useMemo(() => {
    return state.visits
      .filter((v) => !filterReason || v.reason === filterReason)
      .filter((v) => !filterFrom || v.date >= filterFrom)
      .filter((v) => !filterTo || v.date <= filterTo)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [state, filterReason, filterFrom, filterTo]);

  async function onNotifyParent(visitId: string) {
    if (!sis) return;
    const visit = state.visits.find((v) => v.id === visitId);
    if (!visit) return;
    const res = await notifyHealthParent(visit, sis);
    if (!res.ok) {
      setError(res.error || "Notify failed");
      return;
    }
    const { state: next } = upsertVisit(state, { ...visit, notifiedParentAt: new Date().toISOString() });
    setState(saveHealth(next));
    flash(`Parent notified for ${studentName(visit.studentId)}.`);
  }

  function onDeleteVisit(id: string) {
    if (!window.confirm("Delete this visit record?")) return;
    setState(deleteVisit(state, id));
  }

  // --- Medications ---
  const [medStudent, setMedStudent] = useState<SisStudent | null>(null);
  const [medName, setMedName] = useState("");
  const [medDosage, setMedDosage] = useState("");
  const [medSchedule, setMedSchedule] = useState("");
  const [medStart, setMedStart] = useState(todayIso());
  const [medEnd, setMedEnd] = useState("");
  const [medPrescribedBy, setMedPrescribedBy] = useState("");
  const [medNotes, setMedNotes] = useState("");

  function resetMedForm() {
    setMedStudent(null);
    setMedName("");
    setMedDosage("");
    setMedSchedule("");
    setMedStart(todayIso());
    setMedEnd("");
    setMedPrescribedBy("");
    setMedNotes("");
  }

  function onAddMedication() {
    if (!medStudent) {
      setError("Pick a student.");
      return;
    }
    if (!medName.trim()) {
      setError("Medicine name is required.");
      return;
    }
    const { state: next } = upsertMedication(state, {
      studentId: medStudent.id,
      medicineName: medName,
      dosage: medDosage,
      schedule: medSchedule,
      startDate: medStart,
      endDate: medEnd,
      prescribedBy: medPrescribedBy,
      notes: medNotes,
      active: true,
    });
    setState(saveHealth(next));
    resetMedForm();
    flash("Medication added.");
  }

  function onToggleMedicationActive(id: string, active: boolean) {
    const med = state.medications.find((m) => m.id === id);
    if (!med) return;
    const { state: next } = upsertMedication(state, { ...med, active });
    setState(saveHealth(next));
  }

  function onDeleteMedication(id: string) {
    if (!window.confirm("Delete this medication record?")) return;
    setState(deleteMedication(state, id));
  }

  const medicationRows = useMemo(
    () => state.medications.slice().sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [state],
  );

  // --- Vaccinations ---
  const [vaxStudent, setVaxStudent] = useState<SisStudent | null>(null);
  const [vaxName, setVaxName] = useState("");
  const [vaxDose, setVaxDose] = useState("1");
  const [vaxDateGiven, setVaxDateGiven] = useState(todayIso());
  const [vaxNextDue, setVaxNextDue] = useState("");
  const [vaxAdministeredBy, setVaxAdministeredBy] = useState("");
  const [vaxNotes, setVaxNotes] = useState("");

  function resetVaxForm() {
    setVaxStudent(null);
    setVaxName("");
    setVaxDose("1");
    setVaxDateGiven(todayIso());
    setVaxNextDue("");
    setVaxAdministeredBy("");
    setVaxNotes("");
  }

  function onAddVaccination() {
    if (!vaxStudent) {
      setError("Pick a student.");
      return;
    }
    if (!vaxName.trim()) {
      setError("Vaccine name is required.");
      return;
    }
    const { state: next } = upsertVaccination(state, {
      studentId: vaxStudent.id,
      vaccineName: vaxName,
      doseNumber: Number(vaxDose) || 1,
      dateGiven: vaxDateGiven,
      nextDueDate: vaxNextDue,
      administeredBy: vaxAdministeredBy,
      notes: vaxNotes,
    });
    setState(saveHealth(next));
    resetVaxForm();
    flash("Vaccination recorded.");
  }

  function onDeleteVaccination(id: string) {
    if (!window.confirm("Delete this vaccination record?")) return;
    setState(deleteVaccination(state, id));
  }

  const vaccinationRows = useMemo(
    () => state.vaccinations.slice().sort((a, b) => b.dateGiven.localeCompare(a.dateGiven)),
    [state],
  );

  // --- By student ---
  const [byStudent, setByStudent] = useState<SisStudent | null>(null);
  const timeline = byStudent ? listHealthRecordsForStudent(state, byStudent.id) : [];

  /* ------------------------------------------------------------------ */
  /* The three registers, as registers                                   */
  /* ------------------------------------------------------------------ */

  /**
   * These were cards in a list: the student's name in bold and everything
   * else run together in one grey line — reason, date, time, referral — so
   * nothing could be sorted, scanned down a column, or exported. A school
   * nurse's registers are the oldest table in the building; this is that
   * table. The narrative timeline on the student tab stays a list, because
   * it is read as a story and not compared column by column.
   */
  const visitCols: DataTableColumn<(typeof visitRows)[number]>[] = [
    { key: "student", header: "Student", value: (v) => studentName(v.studentId), sortable: true },
    { key: "reason", header: "Reason", value: (v) => healthVisitReasonLabel(v.reason), sortable: true },
    {
      key: "when", header: "When", sortable: true,
      value: (v) => `${v.date}${v.time ? ` ${v.time}` : ""}`,
    },
    { key: "symptoms", header: "Symptoms", value: (v) => v.symptoms || "—" },
    { key: "action", header: "Action taken", value: (v) => v.actionTaken || "—" },
    {
      key: "referred", header: "Referred", sortable: true,
      value: (v) => (v.referredToHospital ? "Hospital" : ""),
      render: (v) =>
        v.referredToHospital ? (
          <span className="rounded-full bg-[var(--danger)]/15 px-2 py-0.5 text-[10px] font-bold text-[var(--danger)]">
            Hospital
          </span>
        ) : (
          <span className="text-[var(--muted)]">—</span>
        ),
    },
    {
      key: "parent", header: "Parent told", sortable: true,
      value: (v) => (v.notifiedParentAt ? v.notifiedParentAt : ""),
      render: (v) =>
        v.notifiedParentAt ? (
          <span className="text-[var(--ok)]">Notified</span>
        ) : (
          <span className="text-[var(--muted)]">Not yet</span>
        ),
    },
  ];

  const visitActions: RowAction<(typeof visitRows)[number]>[] = [
    {
      id: "notify",
      label: "Notify parent",
      onSelect: (v) => void onNotifyParent(v.id),
      disabled: (v) => readOnly || !!v.notifiedParentAt,
    },
    {
      id: "delete",
      label: "Delete",
      tone: "danger",
      separatorAbove: true,
      onSelect: (v) => onDeleteVisit(v.id),
      disabled: () => readOnly,
    },
  ];

  const medicationCols: DataTableColumn<(typeof medicationRows)[number]>[] = [
    { key: "student", header: "Student", value: (m) => studentName(m.studentId), sortable: true },
    { key: "medicine", header: "Medicine", value: (m) => m.medicineName, sortable: true },
    { key: "dosage", header: "Dosage", value: (m) => m.dosage },
    { key: "schedule", header: "Schedule", value: (m) => m.schedule },
    { key: "from", header: "From", value: (m) => m.startDate, sortable: true },
    { key: "to", header: "To", value: (m) => m.endDate || "ongoing", sortable: true },
    {
      key: "active", header: "Active", sortable: true,
      value: (m) => (m.active ? "Active" : "Stopped"),
      render: (m) => (
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={m.active}
            disabled={readOnly}
            onChange={(e) => onToggleMedicationActive(m.id, e.target.checked)}
          />
          {m.active ? "Active" : "Stopped"}
        </label>
      ),
    },
    { key: "notes", header: "Notes", value: (m) => m.notes || "—" },
  ];

  const medicationActions: RowAction<(typeof medicationRows)[number]>[] = [
    {
      id: "delete",
      label: "Delete",
      tone: "danger",
      onSelect: (m) => onDeleteMedication(m.id),
      disabled: () => readOnly,
    },
  ];

  const vaccinationCols: DataTableColumn<(typeof vaccinationRows)[number]>[] = [
    { key: "student", header: "Student", value: (v) => studentName(v.studentId), sortable: true },
    { key: "vaccine", header: "Vaccine", value: (v) => v.vaccineName, sortable: true },
    { key: "dose", header: "Dose", value: (v) => v.doseNumber, sortable: true },
    { key: "given", header: "Given", value: (v) => v.dateGiven, sortable: true },
    {
      key: "due", header: "Next due", sortable: true,
      value: (v) => v.nextDueDate || "",
      render: (v) =>
        v.nextDueDate ? (
          <span className={isVaccinationOverdue(v) ? "font-semibold text-[var(--danger)]" : undefined}>
            {v.nextDueDate}
            {isVaccinationOverdue(v) ? " · overdue" : ""}
          </span>
        ) : (
          <span className="text-[var(--muted)]">—</span>
        ),
    },
    { key: "notes", header: "Notes", value: (v) => v.notes || "—" },
  ];

  const vaccinationActions: RowAction<(typeof vaccinationRows)[number]>[] = [
    {
      id: "delete",
      label: "Delete",
      tone: "danger",
      onSelect: (v) => onDeleteVaccination(v.id),
      disabled: () => readOnly,
    },
  ];


  return (
    <ErpWorkspaceShell
      title="Health / infirmary"
      subtitle="Nurse visit log, medication & vaccination records, emergency contacts"
      icon={<HeartPulse className="size-6" aria-hidden />}
      notice={notice}
      error={error}
    >
      <ModuleTabs value={tab} onChange={(id) => setTab(id as Tab)} items={TABS} />

      {tab === "log" ? (
        <div className="mt-5 max-w-xl space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Student</span>
            <StudentPicker
              sis={sis}
              masters={masters}
              value={pickedStudent}
              onPick={setPickedStudent}
              onClear={() => setPickedStudent(null)}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Date</span>
              <input type="date" className={field} value={logDate} onChange={(e) => setLogDate(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Time</span>
              <input type="time" className={field} value={logTime} onChange={(e) => setLogTime(e.target.value)} />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Reason</span>
            <select className={field} value={logReason} onChange={(e) => setLogReason(e.target.value as HealthVisitReason)}>
              {HEALTH_VISIT_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Symptoms</span>
            <textarea className={field} rows={2} value={logSymptoms} onChange={(e) => setLogSymptoms(e.target.value)} />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Action taken</span>
            <textarea className={field} rows={2} value={logAction} onChange={(e) => setLogAction(e.target.value)} />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={logReferred} onChange={(e) => setLogReferred(e.target.checked)} />
            Referred to hospital
          </label>

          <button
            type="button"
            className="btn-accent rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
            disabled={readOnly}
            onClick={onLogVisit}
          >
            Log visit
          </button>
        </div>
      ) : null}

      {tab === "visits" ? (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Reason</span>
              <select
                className={`${field} !py-1.5`}
                value={filterReason}
                onChange={(e) => setFilterReason(e.target.value as HealthVisitReason | "")}
              >
                <option value="">All</option>
                {HEALTH_VISIT_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">From</span>
              <input type="date" className={`${field} !py-1.5`} value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">To</span>
              <input type="date" className={`${field} !py-1.5`} value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
            </label>
          </div>

          <DataTable
            columns={visitCols}
            rows={visitRows}
            rowKey={(v) => v.id}
            rowActions={visitActions}
            minWidth="min-w-[980px]"
            exportFileBaseName="health-visits"
            exportTitle="Infirmary visits"
            emptyTitle="No visits match this filter."
          />
        </div>
      ) : null}

      {tab === "medications" ? (
        <div className="mt-5 space-y-5">
          <div className="max-w-xl space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="text-sm font-bold">Add medication</p>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Student</span>
              <StudentPicker sis={sis} masters={masters} value={medStudent} onPick={setMedStudent} onClear={() => setMedStudent(null)} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">Medicine name</span>
                <input className={field} value={medName} onChange={(e) => setMedName(e.target.value)} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">Dosage</span>
                <input className={field} value={medDosage} onChange={(e) => setMedDosage(e.target.value)} />
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Schedule</span>
              <input className={field} placeholder="e.g. twice daily after meals" value={medSchedule} onChange={(e) => setMedSchedule(e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">Start date</span>
                <input type="date" className={field} value={medStart} onChange={(e) => setMedStart(e.target.value)} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">End date (optional)</span>
                <input type="date" className={field} value={medEnd} onChange={(e) => setMedEnd(e.target.value)} />
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Prescribed by</span>
              <input className={field} value={medPrescribedBy} onChange={(e) => setMedPrescribedBy(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Notes</span>
              <textarea className={field} rows={2} value={medNotes} onChange={(e) => setMedNotes(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn-accent rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
              disabled={readOnly}
              onClick={onAddMedication}
            >
              Add medication
            </button>
          </div>

          <DataTable
            columns={medicationCols}
            rows={medicationRows}
            rowKey={(m) => m.id}
            rowActions={medicationActions}
            minWidth="min-w-[980px]"
            exportFileBaseName="health-medications"
            exportTitle="Medication records"
            emptyTitle="No medication records yet."
          />
        </div>
      ) : null}

      {tab === "vaccinations" ? (
        <div className="mt-5 space-y-5">
          <div className="max-w-xl space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="text-sm font-bold">Record vaccination</p>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Student</span>
              <StudentPicker sis={sis} masters={masters} value={vaxStudent} onPick={setVaxStudent} onClear={() => setVaxStudent(null)} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">Vaccine name</span>
                <input className={field} value={vaxName} onChange={(e) => setVaxName(e.target.value)} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">Dose #</span>
                <input type="number" className={field} value={vaxDose} onChange={(e) => setVaxDose(e.target.value)} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">Date given</span>
                <input type="date" className={field} value={vaxDateGiven} onChange={(e) => setVaxDateGiven(e.target.value)} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">Next due (optional)</span>
                <input type="date" className={field} value={vaxNextDue} onChange={(e) => setVaxNextDue(e.target.value)} />
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Administered by</span>
              <input className={field} value={vaxAdministeredBy} onChange={(e) => setVaxAdministeredBy(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Notes</span>
              <textarea className={field} rows={2} value={vaxNotes} onChange={(e) => setVaxNotes(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn-accent rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
              disabled={readOnly}
              onClick={onAddVaccination}
            >
              Record vaccination
            </button>
          </div>

          <DataTable
            columns={vaccinationCols}
            rows={vaccinationRows}
            rowKey={(v) => v.id}
            rowActions={vaccinationActions}
            minWidth="min-w-[900px]"
            exportFileBaseName="health-vaccinations"
            exportTitle="Vaccination records"
            emptyTitle="No vaccination records yet."
          />
        </div>
      ) : null}

      {tab === "student" ? (
        <div className="mt-5 space-y-4">
          <label className="block max-w-md text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Student</span>
            <StudentPicker sis={sis} masters={masters} value={byStudent} onPick={setByStudent} onClear={() => setByStudent(null)} />
          </label>

          {byStudent ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:grid-cols-4">
                <div>
                  <p className="text-[11px] text-[var(--muted)]">Blood group</p>
                  <p className="text-sm font-semibold">{byStudent.bloodGroup || "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--muted)]">Emergency contact</p>
                  <p className="text-sm font-semibold">
                    {byStudent.emergencyName || "—"}
                    {byStudent.emergencyMobile ? ` · ${byStudent.emergencyMobile}` : ""}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-[11px] text-[var(--muted)]">Medical notes on file</p>
                  <p className="text-sm font-semibold">{byStudent.medicalNotes || "None on file"}</p>
                </div>
              </div>

              {timeline.length === 0 ? (
                <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
                  No health records for this student.
                </p>
              ) : (
                <ul className="space-y-2">
                  {timeline.map((entry) => (
                    <li
                      key={`${entry.kind}-${entry.record.id}`}
                      className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-sm"
                    >
                      <span className="font-semibold">{entry.date}</span>{" "}
                      <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--muted)]">
                        {entry.kind}
                      </span>
                      {entry.kind === "visit" ? (
                        <p className="text-[var(--muted)]">
                          {healthVisitReasonLabel(entry.record.reason)}
                          {entry.record.symptoms ? ` — ${entry.record.symptoms}` : ""}
                        </p>
                      ) : entry.kind === "medication" ? (
                        <p className="text-[var(--muted)]">
                          {entry.record.medicineName} · {entry.record.dosage} · {entry.record.schedule}
                        </p>
                      ) : (
                        <p className="text-[var(--muted)]">
                          {entry.record.vaccineName} · dose {entry.record.doseNumber}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </ErpWorkspaceShell>
  );
}
