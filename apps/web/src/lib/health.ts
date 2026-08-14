/**
 * Health / infirmary — nurse visit log, medication register, vaccination
 * records, plus a merged "By student" view surfacing the emergency-contact
 * and medical fields already on SisStudent (bloodGroup, emergencyName/
 * emergencyMobile, medicalNotes). Greenfield module — nothing in this
 * codebase previously tracked visits/medications/vaccinations.
 *
 * Storage: localStorage only for now, same deliberate scope limit as
 * lib/discipline.ts/lib/dutyRoster.ts — wiring into the desk-slice sync
 * pattern needs a new Supabase migration, not done this round.
 *
 * saveHealth follows lib/discipline.ts's saveDiscipline pattern (a real
 * assertModulePermission guard), not lib/dutyRoster.ts's ungated one.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";
import { householdOf, householdWhatsApp, type SisState } from "@/lib/sis";

export type HealthVisitReason = "injury" | "illness" | "checkup" | "medication" | "other";

export const HEALTH_VISIT_REASONS: { value: HealthVisitReason; label: string }[] = [
  { value: "injury", label: "Injury" },
  { value: "illness", label: "Illness" },
  { value: "checkup", label: "Routine check-up" },
  { value: "medication", label: "Scheduled medication" },
  { value: "other", label: "Other" },
];

export type HealthVisit = {
  id: string;
  studentId: string;
  academicYearCode: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string;
  reason: HealthVisitReason;
  symptoms: string;
  actionTaken: string;
  referredToHospital: boolean;
  reportedByStaffId: string;
  /** ISO timestamp of the last "Notify parent" send, or null. */
  notifiedParentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MedicationRecord = {
  id: string;
  studentId: string;
  medicineName: string;
  dosage: string;
  schedule: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD, empty = ongoing */
  endDate: string;
  prescribedBy: string;
  notes: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type VaccinationRecord = {
  id: string;
  studentId: string;
  vaccineName: string;
  doseNumber: number;
  /** YYYY-MM-DD */
  dateGiven: string;
  /** YYYY-MM-DD, empty = no next dose scheduled */
  nextDueDate: string;
  administeredBy: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type HealthState = {
  version: 1;
  visits: HealthVisit[];
  medications: MedicationRecord[];
  vaccinations: VaccinationRecord[];
};

const STORAGE_KEY = "bhb_health_v1";
const REASON_SET = new Set<HealthVisitReason>(HEALTH_VISIT_REASONS.map((r) => r.value));

function nid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function healthVisitReasonLabel(reason: HealthVisitReason): string {
  return HEALTH_VISIT_REASONS.find((r) => r.value === reason)?.label || reason;
}

function normalizeVisit(raw: Partial<HealthVisit> | null | undefined): HealthVisit | null {
  if (!raw?.studentId || !raw.date) return null;
  const reason = REASON_SET.has(raw.reason as HealthVisitReason)
    ? (raw.reason as HealthVisitReason)
    : "other";
  const now = nowIso();
  return {
    id: raw.id || nid("hvisit"),
    studentId: raw.studentId,
    academicYearCode: raw.academicYearCode || "",
    date: raw.date.slice(0, 10),
    time: raw.time || "",
    reason,
    symptoms: String(raw.symptoms || "").trim(),
    actionTaken: String(raw.actionTaken || "").trim(),
    referredToHospital: !!raw.referredToHospital,
    reportedByStaffId: raw.reportedByStaffId || "",
    notifiedParentAt: raw.notifiedParentAt || null,
    createdAt: raw.createdAt || now,
    updatedAt: now,
  };
}

function normalizeMedication(
  raw: Partial<MedicationRecord> | null | undefined,
): MedicationRecord | null {
  if (!raw?.studentId || !raw.medicineName) return null;
  const now = nowIso();
  return {
    id: raw.id || nid("hmed"),
    studentId: raw.studentId,
    medicineName: String(raw.medicineName).trim(),
    dosage: String(raw.dosage || "").trim(),
    schedule: String(raw.schedule || "").trim(),
    startDate: (raw.startDate || "").slice(0, 10),
    endDate: (raw.endDate || "").slice(0, 10),
    prescribedBy: String(raw.prescribedBy || "").trim(),
    notes: String(raw.notes || "").trim(),
    active: raw.active !== false,
    createdAt: raw.createdAt || now,
    updatedAt: now,
  };
}

function normalizeVaccination(
  raw: Partial<VaccinationRecord> | null | undefined,
): VaccinationRecord | null {
  if (!raw?.studentId || !raw.vaccineName || !raw.dateGiven) return null;
  const now = nowIso();
  return {
    id: raw.id || nid("hvax"),
    studentId: raw.studentId,
    vaccineName: String(raw.vaccineName).trim(),
    doseNumber: Number.isFinite(raw.doseNumber) ? Number(raw.doseNumber) : 1,
    dateGiven: raw.dateGiven.slice(0, 10),
    nextDueDate: (raw.nextDueDate || "").slice(0, 10),
    administeredBy: String(raw.administeredBy || "").trim(),
    notes: String(raw.notes || "").trim(),
    createdAt: raw.createdAt || now,
    updatedAt: now,
  };
}

export function emptyHealthState(): HealthState {
  return { version: 1, visits: [], medications: [], vaccinations: [] };
}

export function normalizeHealthState(raw: unknown): HealthState {
  if (!raw || typeof raw !== "object") return emptyHealthState();
  const r = raw as Partial<HealthState>;
  return {
    version: 1,
    visits: Array.isArray(r.visits)
      ? r.visits.map((v) => normalizeVisit(v as Partial<HealthVisit>)).filter((x): x is HealthVisit => !!x)
      : [],
    medications: Array.isArray(r.medications)
      ? r.medications
          .map((m) => normalizeMedication(m as Partial<MedicationRecord>))
          .filter((x): x is MedicationRecord => !!x)
      : [],
    vaccinations: Array.isArray(r.vaccinations)
      ? r.vaccinations
          .map((v) => normalizeVaccination(v as Partial<VaccinationRecord>))
          .filter((x): x is VaccinationRecord => !!x)
      : [],
  };
}

export function loadHealth(): HealthState {
  if (typeof window === "undefined") return emptyHealthState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyHealthState();
    return normalizeHealthState(JSON.parse(raw));
  } catch {
    return emptyHealthState();
  }
}

/** The real permission guard — see file header for why this differs from
 * lib/dutyRoster.ts's saveDutyRoster, which has no such check. */
export function saveHealth(state: HealthState): HealthState {
  if (!assertModulePermission("health", "edit", "saveHealth")) {
    return state;
  }
  const next = normalizeHealthState(state);
  if (typeof window !== "undefined") {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("bhb-health"));
  }
  return next;
}

export function upsertVisit(
  state: HealthState,
  input: Partial<HealthVisit> & { studentId: string; date: string },
): { state: HealthState; visit: HealthVisit } {
  const existing = input.id ? state.visits.find((v) => v.id === input.id) : undefined;
  const visit = normalizeVisit({ ...existing, ...input, id: existing?.id || input.id, createdAt: existing?.createdAt })!;
  const visits = existing
    ? state.visits.map((v) => (v.id === visit.id ? visit : v))
    : [visit, ...state.visits];
  return { state: { ...state, visits }, visit };
}

export function deleteVisit(state: HealthState, id: string): HealthState {
  return saveHealth({ ...state, visits: state.visits.filter((v) => v.id !== id) });
}

export function upsertMedication(
  state: HealthState,
  input: Partial<MedicationRecord> & { studentId: string; medicineName: string },
): { state: HealthState; medication: MedicationRecord } {
  const existing = input.id ? state.medications.find((m) => m.id === input.id) : undefined;
  const medication = normalizeMedication({
    ...existing,
    ...input,
    id: existing?.id || input.id,
    createdAt: existing?.createdAt,
  })!;
  const medications = existing
    ? state.medications.map((m) => (m.id === medication.id ? medication : m))
    : [medication, ...state.medications];
  return { state: { ...state, medications }, medication };
}

export function deleteMedication(state: HealthState, id: string): HealthState {
  return saveHealth({ ...state, medications: state.medications.filter((m) => m.id !== id) });
}

export function upsertVaccination(
  state: HealthState,
  input: Partial<VaccinationRecord> & { studentId: string; vaccineName: string; dateGiven: string },
): { state: HealthState; vaccination: VaccinationRecord } {
  const existing = input.id ? state.vaccinations.find((v) => v.id === input.id) : undefined;
  const vaccination = normalizeVaccination({
    ...existing,
    ...input,
    id: existing?.id || input.id,
    createdAt: existing?.createdAt,
  })!;
  const vaccinations = existing
    ? state.vaccinations.map((v) => (v.id === vaccination.id ? vaccination : v))
    : [vaccination, ...state.vaccinations];
  return { state: { ...state, vaccinations }, vaccination };
}

export function deleteVaccination(state: HealthState, id: string): HealthState {
  return saveHealth({ ...state, vaccinations: state.vaccinations.filter((v) => v.id !== id) });
}

export function listVisitsForStudent(state: HealthState, studentId: string): HealthVisit[] {
  return state.visits.filter((v) => v.studentId === studentId).sort((a, b) => b.date.localeCompare(a.date));
}

export function listMedicationsForStudent(state: HealthState, studentId: string): MedicationRecord[] {
  return state.medications
    .filter((m) => m.studentId === studentId)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
}

export function listVaccinationsForStudent(state: HealthState, studentId: string): VaccinationRecord[] {
  return state.vaccinations
    .filter((v) => v.studentId === studentId)
    .sort((a, b) => b.dateGiven.localeCompare(a.dateGiven));
}

export type HealthTimelineEntry =
  | { kind: "visit"; date: string; record: HealthVisit }
  | { kind: "medication"; date: string; record: MedicationRecord }
  | { kind: "vaccination"; date: string; record: VaccinationRecord };

/** Merged, date-sorted (newest first) timeline across all three record
 * types for a single student — backs the "By student" tab. */
export function listHealthRecordsForStudent(state: HealthState, studentId: string): HealthTimelineEntry[] {
  const entries: HealthTimelineEntry[] = [
    ...listVisitsForStudent(state, studentId).map((record) => ({ kind: "visit" as const, date: record.date, record })),
    ...listMedicationsForStudent(state, studentId).map((record) => ({
      kind: "medication" as const,
      date: record.startDate,
      record,
    })),
    ...listVaccinationsForStudent(state, studentId).map((record) => ({
      kind: "vaccination" as const,
      date: record.dateGiven,
      record,
    })),
  ];
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

/** True when a vaccination's next dose is overdue as of `asOf`. */
export function isVaccinationOverdue(v: VaccinationRecord, asOf = new Date().toISOString().slice(0, 10)): boolean {
  return !!v.nextDueDate && v.nextDueDate < asOf;
}

/** WA parent notify — mirrors lib/discipline.ts's notifyDisciplineParent
 * shape, staff-triggered only, never automatic. */
export async function notifyHealthParent(
  visit: HealthVisit,
  sis: SisState,
  opts?: { dryRun?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const student = sis.students.find((s) => s.id === visit.studentId);
  if (!student) return { ok: false, error: "Student not found" };
  const household = householdOf(sis, student.householdId);
  const mobile = householdWhatsApp(household);
  if (!mobile) return { ok: false, error: "No WhatsApp number on file" };
  const body =
    `Infirmary note for ${student.fullName}: ${healthVisitReasonLabel(visit.reason)} on ${visit.date}${visit.time ? ` at ${visit.time}` : ""}. ` +
    `${visit.symptoms ? `Symptoms: ${visit.symptoms}. ` : ""}${visit.actionTaken ? `Action taken: ${visit.actionTaken}.` : ""}`.trim();
  try {
    const res = await fetch("/api/wa/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module: "health",
        dryRun: !!opts?.dryRun,
        messages: [{ mobile, body }],
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
