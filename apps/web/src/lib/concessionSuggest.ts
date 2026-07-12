/**
 * Auto-suggest students for concession grants by policy kind.
 */

import {
  ordinalChildLabel,
  resolveSiblingTierValue,
  type ConcessionGrant,
  type ConcessionRule,
} from "@/lib/masters";
import {
  siblingsOf,
  type SisState,
  type SisStudent,
} from "@/lib/sis";
import { loadTransport } from "@/lib/transport";

export type ConcessionSuggest = {
  student: SisStudent;
  hint: string;
  /** Sibling ordinal in household (1 = eldest). */
  siblingChildNo?: number;
};

function alreadyGranted(
  studentId: string,
  concessionId: string,
  grants: ConcessionGrant[],
): boolean {
  return grants.some(
    (g) =>
      g.studentId === studentId &&
      g.concessionId === concessionId &&
      g.status !== "rejected",
  );
}

function looksLikeStaffWard(s: SisStudent): boolean {
  const blob = [
    s.notes,
    s.guardianRelation,
    s.previousSchool,
    s.fatherName,
    s.motherName,
  ]
    .join(" ")
    .toLowerCase();
  return /staff\s*ward|staff\s*child|employee|teacher\s*ward|\bstaff\b/.test(
    blob,
  );
}

/** Active household members oldest → youngest (1st child first). */
export function rankHouseholdSiblings(
  sis: SisState,
  householdId: string,
): SisStudent[] {
  if (!householdId) return [];
  return sis.students
    .filter((s) => s.status === "active" && s.householdId === householdId)
    .sort((a, b) => {
      if (a.dob && b.dob && a.dob !== b.dob) return a.dob.localeCompare(b.dob);
      return a.admissionNo.localeCompare(b.admissionNo);
    });
}

/** 1-based child number in household (eldest = 1). */
export function siblingChildNumber(
  sis: SisState,
  student: SisStudent,
): number {
  const ranked = rankHouseholdSiblings(sis, student.householdId);
  const idx = ranked.findIndex((s) => s.id === student.id);
  return idx < 0 ? 1 : idx + 1;
}

/** Active students who share a household with at least one other active sibling. */
export function listSiblingCandidates(
  sis: SisState,
  excludeIds?: Set<string>,
  rule?: ConcessionRule,
): ConcessionSuggest[] {
  const active = sis.students.filter((s) => s.status === "active");
  const byHh = new Map<string, SisStudent[]>();
  for (const s of active) {
    if (!s.householdId) continue;
    const list = byHh.get(s.householdId) ?? [];
    list.push(s);
    byHh.set(s.householdId, list);
  }

  const out: ConcessionSuggest[] = [];
  for (const [hhId, members] of byHh) {
    if (members.length < 2) continue;
    const ranked = rankHouseholdSiblings(sis, hhId);
    for (const s of ranked) {
      if (excludeIds?.has(s.id)) continue;
      const childNo = siblingChildNumber(sis, s);
      const others = ranked
        .filter((x) => x.id !== s.id)
        .map((x) => x.fullName)
        .join(", ");
      let hint = `${ordinalChildLabel(childNo)} child · sibling of ${others}`;
      if (rule) {
        const tier = resolveSiblingTierValue(rule, childNo);
        if (tier) {
          hint +=
            tier.mode === "percent"
              ? ` · ${tier.value}%`
              : ` · ₹${(tier.value / 100).toFixed(0)}`;
        } else {
          hint += " · no discount (1st child)";
        }
      }
      out.push({ student: s, hint, siblingChildNo: childNo });
    }
  }
  return out.sort((a, b) =>
    a.student.fullName.localeCompare(b.student.fullName),
  );
}

export function suggestStudentsForConcession(
  concession: ConcessionRule,
  sis: SisState,
  grants: ConcessionGrant[],
): ConcessionSuggest[] {
  const exclude = new Set(
    grants
      .filter(
        (g) =>
          g.concessionId === concession.id && g.status !== "rejected",
      )
      .map((g) => g.studentId),
  );
  const kind = concession.kind;
  const active = sis.students.filter((s) => s.status === "active");

  if (kind === "sibling") {
    return listSiblingCandidates(sis, exclude, concession);
  }

  if (kind === "staff_ward") {
    return active
      .filter((s) => !exclude.has(s.id) && looksLikeStaffWard(s))
      .map((s) => ({
        student: s,
        hint: "Tagged as staff ward (notes / guardian)",
      }))
      .sort((a, b) => a.student.fullName.localeCompare(b.student.fullName));
  }

  if (kind === "rte_ews") {
    return active
      .filter(
        (s) =>
          !exclude.has(s.id) &&
          (s.studentType === "RTE" ||
            s.category === "EWS" ||
            /rte|ews/i.test(s.notes)),
      )
      .map((s) => ({
        student: s,
        hint:
          s.studentType === "RTE"
            ? "RTE student type"
            : s.category === "EWS"
              ? "EWS category"
              : "RTE/EWS in notes",
      }))
      .sort((a, b) => a.student.fullName.localeCompare(b.student.fullName));
  }

  if (kind === "transport") {
    const transport = loadTransport();
    const today = new Date().toISOString().slice(0, 10);
    const onBus = new Set(
      transport.assignments
        .filter(
          (a) =>
            a.effectiveFrom <= today &&
            (a.effectiveTo == null || a.effectiveTo >= today),
        )
        .map((a) => a.studentId),
    );
    return active
      .filter((s) => !exclude.has(s.id) && onBus.has(s.id))
      .map((s) => ({
        student: s,
        hint: "Active transport assignment",
      }))
      .sort((a, b) => a.student.fullName.localeCompare(b.student.fullName));
  }

  return [];
}

/** Sibling names for reason autofill when granting sibling discount. */
export function siblingGrantHint(
  sis: SisState,
  student: SisStudent,
  childNo?: number,
): string {
  const n = childNo ?? siblingChildNumber(sis, student);
  const sibs = siblingsOf(sis, student).filter((s) => s.status === "active");
  const base = `${ordinalChildLabel(n)} child discount`;
  if (sibs.length === 0) return base;
  return `${base} · sibling of ${sibs.map((s) => s.fullName).join(", ")}`;
}

export function isStudentAlreadyGranted(
  studentId: string,
  concessionId: string,
  grants: ConcessionGrant[],
): boolean {
  return alreadyGranted(studentId, concessionId, grants);
}
