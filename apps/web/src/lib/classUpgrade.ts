/**
 * Post-admission class / section / student-type upgrade.
 */

import {
  loadMasters,
  resolveFeeGroupId,
  sortClassIdsByClassBand,
  type FeeStudentType,
  type MastersState,
} from "@/lib/masters";
import {
  loadSis,
  normalizeStudent,
  saveSis,
  type ClassUpgradeRecord,
  type SisState,
  type SisStudent,
} from "@/lib/sis";
import {
  defaultCurriculum,
  validateCurriculum,
} from "@/lib/studentCurriculum";

export type { ClassUpgradeRecord };

const VALID_TYPES: FeeStudentType[] = ["NEW", "PROMOTE", "MID_YEAR", "RTE"];

function uid() {
  return `upg_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeUpgradeRecord(
  raw: Partial<ClassUpgradeRecord> & {
    id: string;
    studentId: string;
  },
): ClassUpgradeRecord {
  return {
    id: raw.id,
    studentId: raw.studentId,
    studentName: raw.studentName ?? "",
    admissionNo: raw.admissionNo ?? "",
    fromClassId: raw.fromClassId ?? "",
    fromSectionId: raw.fromSectionId ?? "",
    toClassId: raw.toClassId ?? "",
    toSectionId: raw.toSectionId ?? "",
    fromFeeGroupId: raw.fromFeeGroupId ?? null,
    toFeeGroupId: raw.toFeeGroupId ?? null,
    fromStudentType: raw.fromStudentType ?? "",
    toStudentType: raw.toStudentType ?? raw.fromStudentType ?? "",
    reason: raw.reason ?? "",
    effectiveOn: raw.effectiveOn ?? "",
    createdAt: raw.createdAt ?? new Date().toISOString(),
    createdBy: raw.createdBy ?? "office",
  };
}

export function listClassUpgrades(sis?: SisState): ClassUpgradeRecord[] {
  const state = sis ?? loadSis();
  return (state.classUpgrades ?? [])
    .map((u) => normalizeUpgradeRecord(u))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function upgradesForStudent(
  studentId: string,
  sis?: SisState,
): ClassUpgradeRecord[] {
  return listClassUpgrades(sis).filter((u) => u.studentId === studentId);
}

export type UpgradeClassInput = {
  studentId: string;
  toClassId: string;
  toSectionId: string;
  /** Change NEW ↔ PROMOTE / MID_YEAR / RTE */
  toStudentType?: FeeStudentType;
  /** When true, remaps fee group for new class and/or type */
  remapFeeGroup?: boolean;
  /** Optional override fee group id */
  feeGroupId?: string | null;
  reason?: string;
  effectiveOn?: string;
  /** Reset subject cart when class band changes (default true) */
  resetCurriculum?: boolean;
  /** Bypass the promotion lock (upward moves are blocked when locked). */
  override?: boolean;
  masters?: MastersState;
};

export function upgradeStudentClass(
  input: UpgradeClassInput,
):
  | { ok: true; state: SisState; record: ClassUpgradeRecord; student: SisStudent }
  | { ok: false; error: string } {
  const masters = input.masters ?? loadMasters();
  const sis = loadSis();
  const idx = sis.students.findIndex((s) => s.id === input.studentId);
  if (idx < 0) return { ok: false, error: "Student not found" };

  const student = sis.students[idx]!;
  if (student.status !== "active") {
    return { ok: false, error: "Only active students can be upgraded" };
  }

  const toClass = masters.classes.find(
    (c) => c.id === input.toClassId && c.isActive,
  );
  if (!toClass) return { ok: false, error: "Target class not found" };

  // Promotion lock: block moving a locked student UP a class (age/MBU hold).
  // Same-class or lower moves (corrections) are always allowed.
  if (student.promotionLocked && !input.override) {
    const ordered = sortClassIdsByClassBand(
      masters,
      masters.classes.filter((c) => c.isActive).map((c) => c.id),
    );
    const fromRank = ordered.indexOf(student.classId);
    const toRank = ordered.indexOf(input.toClassId);
    if (fromRank >= 0 && toRank > fromRank) {
      return {
        ok: false,
        error: `Promotion locked: ${
          student.promotionLockReason || "under-age for class (UDISE MBU)"
        }. Unlock first, or keep the same/lower class.`,
      };
    }
  }

  const toSection = masters.sections.find(
    (s) =>
      s.id === input.toSectionId &&
      s.isActive &&
      s.classId === input.toClassId,
  );
  if (!toSection) {
    return {
      ok: false,
      error: "Pick a section that belongs to the target class",
    };
  }

  const nextType: FeeStudentType =
    input.toStudentType && VALID_TYPES.includes(input.toStudentType)
      ? input.toStudentType
      : student.studentType;

  const classChanged = student.classId !== input.toClassId;
  const sectionChanged = student.sectionId !== input.toSectionId;
  const typeChanged = nextType !== student.studentType;

  if (!classChanged && !sectionChanged && !typeChanged) {
    return {
      ok: false,
      error: "Nothing to change — pick a new section, class, or student type",
    };
  }

  const remap = input.remapFeeGroup !== false;
  let nextFeeGroupId = student.feeGroupId;
  if (input.feeGroupId !== undefined) {
    nextFeeGroupId = input.feeGroupId;
  } else if (remap && (classChanged || typeChanged)) {
    nextFeeGroupId = resolveFeeGroupId(masters, {
      studentType: nextType,
      classId: input.toClassId,
      academicYearCode: student.academicYearCode,
    });
  }

  let curriculum = student.curriculum;
  if (classChanged && input.resetCurriculum !== false) {
    curriculum = defaultCurriculum(
      {
        classId: input.toClassId,
        academicYearCode: student.academicYearCode,
        curriculum: null,
      },
      masters,
    );
    const check = validateCurriculum(
      {
        classId: input.toClassId,
        academicYearCode: student.academicYearCode,
      },
      curriculum,
      masters,
    );
    if (!check.ok) {
      curriculum = {
        academicYearCode: student.academicYearCode,
        seniorStreamId: null,
        chosenSubjectIds: [],
        confirmedAt: "",
        confirmedBy: "office",
      };
    }
  }

  const effectiveOn =
    input.effectiveOn?.trim() || new Date().toISOString().slice(0, 10);
  let reason = (input.reason ?? "").trim();
  if (!reason) {
    if (typeChanged && !classChanged && !sectionChanged) {
      reason = `Student type ${student.studentType} → ${nextType}`;
    } else if (classChanged) {
      reason = typeChanged
        ? `Class upgrade + type ${student.studentType} → ${nextType}`
        : "Post-admission class upgrade";
    } else if (sectionChanged && typeChanged) {
      reason = `Section change + type ${student.studentType} → ${nextType}`;
    } else {
      reason = "Section change (same class)";
    }
  }

  const updated = normalizeStudent({
    ...student,
    classId: input.toClassId,
    sectionId: input.toSectionId,
    studentType: nextType,
    feeGroupId: nextFeeGroupId,
    curriculum,
  });

  const record = normalizeUpgradeRecord({
    id: uid(),
    studentId: student.id,
    studentName: student.fullName,
    admissionNo: student.admissionNo,
    fromClassId: student.classId,
    fromSectionId: student.sectionId,
    toClassId: input.toClassId,
    toSectionId: input.toSectionId,
    fromFeeGroupId: student.feeGroupId,
    toFeeGroupId: nextFeeGroupId,
    fromStudentType: student.studentType,
    toStudentType: nextType,
    reason,
    effectiveOn,
    createdAt: new Date().toISOString(),
    createdBy: "office",
  });

  const students = [...sis.students];
  students[idx] = updated;
  const state: SisState = {
    ...sis,
    students,
    classUpgrades: [record, ...(sis.classUpgrades ?? [])],
  };
  saveSis(state);
  return { ok: true, state, record, student: updated };
}
