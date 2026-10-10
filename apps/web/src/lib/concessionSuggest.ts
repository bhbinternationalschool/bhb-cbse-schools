/**
 * Auto-suggest students for concession grants by policy kind.
 */

import {
  concessionIdsForCode,
  ordinalChildLabel,
  resolveSiblingTierValue,
  type ConcessionGrant,
  type ConcessionRule,
  type MastersState,
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

function concessionGrantIds(
  masters: MastersState | undefined,
  concession: ConcessionRule,
): Set<string> {
  if (!masters) return new Set([concession.id]);
  return new Set(concessionIdsForCode(masters, concession.code));
}

function alreadyGranted(
  studentId: string,
  concession: ConcessionRule,
  grants: ConcessionGrant[],
  masters?: MastersState,
): boolean {
  const ids = concessionGrantIds(masters, concession);
  return grants.some(
    (g) =>
      g.studentId === studentId &&
      ids.has(g.concessionId) &&
      g.status !== "rejected",
  );
}

function ayNorm(code: string): string {
  const t = (code || "").trim().replace(/\s+/g, "").replace(/–/g, "-");
  const full = t.match(/^(20\d{2})-(20\d{2})$/);
  if (full) return `${full[1]}-${full[2]!.slice(2)}`;
  return t;
}

/**
 * Active students scoped to one session so a child promoted across years is
 * listed once. With an ay: only that session's records. Without: one record
 * per admission no (latest session wins).
 */
function activeStudentsForSession(
  sis: SisState,
  academicYearCode?: string,
): SisStudent[] {
  const active = sis.students.filter((s) => s.status === "active");
  const scope = ayNorm(academicYearCode || "");
  if (scope) {
    return active.filter((s) => ayNorm(s.academicYearCode) === scope);
  }
  const byAdm = new Map<string, SisStudent>();
  for (const s of active) {
    const key = s.admissionNo.trim().toUpperCase() || s.id;
    const prev = byAdm.get(key);
    if (!prev || ayNorm(s.academicYearCode) > ayNorm(prev.academicYearCode)) {
      byAdm.set(key, s);
    }
  }
  return [...byAdm.values()];
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

/** Active household members oldest → youngest (1st child first), one per child. */
export function rankHouseholdSiblings(
  sis: SisState,
  householdId: string,
  academicYearCode?: string,
): SisStudent[] {
  if (!householdId) return [];
  return activeStudentsForSession(sis, academicYearCode)
    .filter((s) => s.householdId === householdId)
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
  // Rank within the student's own session so cross-session duplicates of the
  // same child never shift the ordinal.
  const ranked = rankHouseholdSiblings(
    sis,
    student.householdId,
    student.academicYearCode,
  );
  const idx = ranked.findIndex((s) => s.id === student.id);
  if (idx >= 0) return idx + 1;
  const adm = student.admissionNo.trim().toUpperCase();
  const byAdm = ranked.findIndex(
    (s) => s.admissionNo.trim().toUpperCase() === adm,
  );
  return byAdm < 0 ? 1 : byAdm + 1;
}

/** Active students who share a household with at least one other active sibling. */
export function listSiblingCandidates(
  sis: SisState,
  excludeIds?: Set<string>,
  rule?: ConcessionRule,
  academicYearCode?: string,
): ConcessionSuggest[] {
  const active = activeStudentsForSession(sis, academicYearCode);
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
    const ranked = rankHouseholdSiblings(sis, hhId, academicYearCode);
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
  academicYearCode?: string,
  masters?: MastersState,
): ConcessionSuggest[] {
  const grantIds = concessionGrantIds(masters, concession);
  const exclude = new Set(
    grants
      .filter((g) => grantIds.has(g.concessionId) && g.status !== "rejected")
      .map((g) => g.studentId),
  );
  const kind = concession.kind;
  const active = activeStudentsForSession(sis, academicYearCode);

  if (kind === "sibling") {
    return listSiblingCandidates(sis, exclude, concession, academicYearCode);
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

/**
 * A live discount already sitting on this fee head, whoever granted it.
 *
 * alreadyGranted() only asks whether the SAME rule is already on the student,
 * so nothing stopped a second, different rule landing on the same head — an
 * imported ₹150 off tuition and a counter ₹150 off tuition both apply, and
 * the parent is charged ₹300 less than the school thinks.
 *
 * The office's instruction is that a head carries one discount at a time: to
 * change it, remove the first. This is what enforces that, so return the
 * offending grant rather than a boolean — the caller has to be able to name
 * what is already there.
 *
 * RTE is deliberately exempt. A free-ship plus its per-head waivers is one
 * policy expressed as several grants, each capped at the amount billed, and
 * blocking it would break exemptions the school is legally required to give.
 */
export function activeGrantOnHead(
  masters: MastersState,
  studentId: string,
  feeHeadId: string,
  grants?: ConcessionGrant[],
): { grant: ConcessionGrant; rule: ConcessionRule } | null {
  const all = grants ?? masters.concessionGrants ?? [];
  for (const g of all) {
    if (g.studentId !== studentId) continue;
    if (g.status === "rejected") continue;
    const rule = (masters.concessions ?? []).find(
      (c) => c.id === g.concessionId,
    );
    if (!rule || !rule.isActive) continue;
    if (rule.kind === "rte") continue;
    if (rule.feeHeadIds.length > 0 && !rule.feeHeadIds.includes(feeHeadId)) {
      continue;
    }
    return { grant: g, rule };
  }
  return null;
}

export function isStudentAlreadyGranted(
  studentId: string,
  concession: ConcessionRule,
  grants: ConcessionGrant[],
  masters?: MastersState,
): boolean {
  return alreadyGranted(studentId, concession, grants, masters);
}
